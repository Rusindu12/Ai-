"""Alert engine: price levels, 24h % moves, AI-signal triggers + TP/SL monitor.

Runs as a background loop (``ALERT_SCAN_INTERVAL_S``) inside the API process, so
a single container serves the app, the streams and the alert scanner.  For a
horizontal fleet, move this loop to a worker and keep the API read-only - the
scan is idempotent and guarded by a cooldown per alert.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

from app.config import settings
from app.db import repo
from app.db.base import session_scope
from app.services.notifications import notification_service

log = logging.getLogger(__name__)


def _cmp(value: float, operator: str, threshold: float) -> bool:
    try:
        op = (operator or ">").strip()
        if op == ">":
            return value > threshold
        if op == "<":
            return value < threshold
        if op == ">=":
            return value >= threshold
        if op == "<=":
            return value <= threshold
        if op == "==":
            return abs(value - threshold) < 1e-9
    except (TypeError, ValueError):
        return False
    return False


class AlertEngine:
    def __init__(self, hub: Any) -> None:
        self.hub = hub
        self.task: asyncio.Task[None] | None = None
        self.last_scan_ms: int = 0
        self.triggered = 0
        self.checked = 0
        self._last_by_alert: dict[int, float] = {}

    async def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop(), name="alert-engine")
            log.info("alert engine started")

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self.scan_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - keep the loop alive
                log.exception("alert scan failed")
            with contextlib.suppress(Exception):
                await self.check_positions()
            await asyncio.sleep(settings.ALERT_SCAN_INTERVAL_S)

    # ------------------------------------------------------------------ engine
    async def scan_once(self) -> int:
        """Evaluate every active alert against the live cache. Returns triggers."""
        fired = 0
        self.last_scan_ms = int(time.time() * 1000)
        async with session_scope() as session:
            alerts = list(await repo.active_alerts_for_scan(session))
            self.checked += len(alerts)
            for alert in alerts:
                now = time.time()
                cooldown = alert.cooldown_s or 900
                if now - self._last_by_alert.get(alert.id, 0.0) < cooldown:
                    continue
                ticker = self.hub.ticker(alert.symbol) or {}
                price = float(ticker.get("price") or 0.0)
                if price <= 0:
                    continue
                if alert.direction == "pct_change":
                    value = float(ticker.get("change_percent_24h") or 0.0)
                    unit = "%"
                else:
                    value = price
                    unit = ""
                if not _cmp(value, alert.operator, float(alert.threshold)):
                    continue
                fired += 1
                self.triggered += 1
                self._last_by_alert[alert.id] = now
                human = f"{alert.symbol} {alert.operator} {alert.threshold:g}{unit}"
                await repo.update_alert(session, alert.id, alert.user_id, triggered_once=True, last_triggered_at_ms=int(now * 1000))
                await notification_service.push(
                    user_id=alert.user_id,
                    kind="alert",
                    title=f"Price alert: {human}",
                    body=f"{alert.symbol} is now {value:,.6g}{unit} (trigger: {human})",
                    data={
                        "symbol": alert.symbol,
                        "price": price,
                        "alert_id": alert.id,
                        "change_percent_24h": float(ticker.get("change_percent_24h") or 0.0),
                    },
                    session=session,
                )
                await self.hub.broadcast_to_user(
                    {
                        "type": "alert_triggered",
                        "data": {
                            "alert_id": alert.id,
                            "user_id": alert.user_id,
                            "symbol": alert.symbol,
                            "price": price,
                            "value": value,
                            "trigger": human,
                            "at_ms": int(now * 1000),
                        },
                    },
                    alert.user_id,
                )
        return fired

    # ------------------------------------------------- TP/SL + resting orders
    async def check_positions(self) -> int:
        """Fill resting paper orders and hit take-profit / stop-loss levels."""
        from app.services.trading import trading_service

        hits = 0
        async with session_scope() as session:
            from sqlalchemy import select

            from app.db.models import Position, Trade

            resting = (
                await session.execute(
                    select(Trade).where(Trade.status == "NEW", Trade.order_type.in_(["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"]))
                )
            ).scalars().all()
            for order in resting:
                t = self.hub.ticker(order.symbol) or {}
                price = float(t.get("price") or 0.0)
                if price <= 0:
                    continue
                level = float(order.price or 0.0)
                if order.side == "BUY" and price > level:
                    continue
                if order.side == "SELL" and price < level:
                    continue
                if settings.DEMO_MODE or order.paper:
                    await repo.update_trade_status(
                        session, order.client_order_id, status="FILLED", price=price, quote_qty=price * order.qty, updated_at_ms=int(time.time() * 1000)
                    )
                    await repo.apply_fill(
                        session, order.user_id, symbol=order.symbol, side=order.side, qty=order.qty, price=price, fee=price * order.qty * settings.TAKER_FEE_BPS / 10_000.0, paper=order.paper
                    )
                    hits += 1
                    await notification_service.push(
                        user_id=order.user_id,
                        kind="trade",
                        title=f"{order.side} {order.symbol} filled",
                        body=f"Limit order executed at {price:,.6g}",
                        data={"symbol": order.symbol, "client_order_id": order.client_order_id, "price": price},
                        session=session,
                    )
            positions = (await session.execute(select(Position).where(Position.qty > 0))).scalars().all()
            for pos in positions:
                t = self.hub.ticker(pos.symbol) or {}
                price = float(t.get("price") or 0.0)
                if price <= 0:
                    continue
                for kind, level in (("TAKE_PROFIT", pos.take_profit), ("STOP_LOSS", pos.stop_loss)):
                    if not level:
                        continue
                    hit = (price >= level) if kind == "TAKE_PROFIT" else (price <= level)
                    if not hit:
                        continue
                    log.info("auto %s hit for %s user=%s (%g vs %g)", kind, pos.symbol, pos.user_id, price, level)
                    await trading_service.close_position(session, pos.user_id, pos.symbol, reason=kind.lower())
                    hits += 1
                    break
        return hits


alert_engine_ref: AlertEngine | None = None


async def run_alert_scan(hub: Any) -> int:  # pragma: no cover - convenience wrapper
    engine = AlertEngine(hub)
    return await engine.scan_once()
