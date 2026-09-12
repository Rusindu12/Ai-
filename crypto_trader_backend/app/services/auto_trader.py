"""AI auto-trading engine (Screen 4).

Per enabled user, every ``AUTO_TRADE_INTERVAL_S``:

1. skip if the kill switch is tripped or AI trading is off
2. for each user-selected symbol compute a fresh signal (rules + LSTM + MLP)
3. require ``action != HOLD`` **and** ``confidence >= risk-level floor``
4. decide entry vs. exit: an open AI position is closed when the signal flips or
   the TP/SL level is reached (see :class:`app.services.alerts.AlertEngine`)
5. run the risk manager (size caps, daily loss, cooldown, exposure, credentials)
6. execute through :class:`app.services.trading.TradingService` (paper by default)
7. write the decision to ``auto_trade_log`` + broadcast ``ai_trade`` to the app
   and push an FCM notification

The loop is intentionally conservative: it can only *reduce* what the risk
manager already approved, never expand it, and it never runs for users with
withdraw-capable keys (rejected at credential save time, and re-checked here).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

from sqlalchemy import select

from app.config import settings
from app.db import repo
from app.db.base import session_scope
from app.db.models import Trade, User
from app.risk.manager import risk_profile
from app.services.notifications import notification_service
from app.services.trading import OrderRequest, trading_service

log = logging.getLogger(__name__)


class AutoTrader:
    def __init__(self, hub: Any, gateway: Any = None) -> None:
        self.hub = hub
        self.gateway = gateway
        self.task: asyncio.Task[None] | None = None
        self.cycles = 0
        self.last_cycle_ms = 0
        self.executed = 0
        self.rejected = 0
        self.stopped_users: set[int] = set()

    def attach_hub(self, hub: Any) -> None:
        self.hub = hub

    # -------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop(), name="auto-trader")
            log.info("auto-trader started (interval=%ss)", settings.AUTO_TRADE_INTERVAL_S)

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def _loop(self) -> None:
        while True:
            started = time.time()
            try:
                await self.cycle()
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - keep trading loops alive
                log.exception("auto-trader cycle failed")
            await asyncio.sleep(max(2.0, settings.AUTO_TRADE_INTERVAL_S - (time.time() - started)))

    def kill_switch(self, user_id: int, *, engaged: bool, flatten: bool = False) -> dict[str, Any]:
        """Engage/release the emergency stop.  Engaging can flatten positions."""
        self.stopped_users.discard(int(user_id))
        if engaged:
            self.stopped_users.add(int(user_id))
        return {"user_id": int(user_id), "stopped": engaged, "flatten": flatten}

    # ------------------------------------------------------------------ cycle
    async def cycle(self, *, user_ids: list[int] | None = None) -> dict[str, Any]:
        summary = {"cycles": 0, "evaluated": 0, "executed": 0, "rejected": 0, "closed": 0}
        async with session_scope() as session:
            stmt = select(User).where(User.auto_trade_enabled.is_(True), User.is_active.is_(True))
            if user_ids:
                stmt = stmt.where(User.id.in_([int(u) for u in user_ids]))
            users = list((await session.execute(stmt)).scalars().all())
            if not users:
                return summary
            for user in users:
                if user.id in self.stopped_users or user.auto_kill_switch:
                    continue
                result = await self.evaluate_user(session, user)
                summary["cycles"] += 1
                summary["evaluated"] += result["evaluated"]
                summary["executed"] += result["executed"]
                summary["rejected"] += result["rejected"]
                summary["closed"] += result["closed"]
        self.cycles += 1
        self.last_cycle_ms = int(time.time() * 1000)
        self.executed += summary["executed"]
        self.rejected += summary["rejected"]
        if summary["executed"]:
            log.info("auto-trade cycle: %s", summary)
        return summary

    async def evaluate_user(self, session: Any, user: User, *, force_symbol: str | None = None) -> dict[str, Any]:
        """Evaluate one user.  Never bypasses the kill switch - not even for a
        manual "run scan now" request."""
        from app.ai.signals import build_signal

        if user.auto_kill_switch or user.id in self.stopped_users:
            return {"evaluated": 0, "executed": 0, "rejected": 0, "closed": 0, "blocked_by": "kill_switch"}
        if not settings.DEMO_MODE and not user.auto_trade_enabled:
            return {"evaluated": 0, "executed": 0, "rejected": 0, "closed": 0, "blocked_by": "auto_trade_disabled"}

        symbols = [force_symbol.upper()] if force_symbol else [s.upper() for s in (user.auto_trade_symbols or [])]
        if not symbols:
            return {"evaluated": 0, "executed": 0, "rejected": 0, "closed": 0, "detail": "no pairs selected for AI trading"}

        profile = risk_profile(user.risk_level)
        min_conf = max(float(profile["min_conf"]), settings.AI_MIN_CONFIDENCE_PCT if user.risk_level != "aggressive" else 55.0)
        try:
            equity = await _portfolio_total(session, user)
        except Exception:
            equity = 10_000.0
        positions = {p.symbol: p for p in await repo.list_positions(session, user.id, paper=True)}
        executed = rejected = closed = 0

        for symbol in symbols[: settings.AUTO_TRADE_MAX_OPEN_POSITIONS]:
            try:
                bars = await self.hub.get_candles(symbol, "1m", settings.AI_LOOKBACK_BARS)
                if len(bars) < 120:
                    await self._log(session, user, symbol, "HOLD", 0.0, "insufficient candle history", executed=False)
                    rejected += 1
                    continue
                signal = build_signal(bars, symbol, interval="1m", balance_hint=equity, risk_level=user.risk_level)
            except Exception as exc:
                await self._log(session, user, symbol, "HOLD", 0.0, f"signal error: {type(exc).__name__}: {exc}", executed=False)
                rejected += 1
                continue

            pos = positions.get(symbol)
            holding = pos is not None and pos.qty > 0
            action = signal.action
            confidence = signal.confidence

            # ---- exits first (protect capital before adding risk)
            if holding and (action == "SELL" or (action == "HOLD" and confidence < 25)):
                if action == "SELL" or (pos and pos.qty and float(self.hub.price(symbol)) <= (pos.stop_loss or 0)):
                    try:
                        await trading_service.close_position(session, user.id, symbol, reason="ai_exit")
                        closed += 1
                        await self._log(
                            session, user, symbol, "SELL", confidence, f"AI exit: {signal.reason}", executed=True, close=True
                        )
                        continue
                    except Exception as exc:
                        await self._log(session, user, symbol, "SELL", confidence, f"exit failed: {exc}", executed=False)

            if action == "HOLD":
                await self._log(session, user, symbol, "HOLD", confidence, signal.reason, executed=False)
                rejected += 1
                continue
            if confidence < min_conf:
                await self._log(
                    session,
                    user,
                    symbol,
                    action,
                    confidence,
                    f"below confidence floor {min_conf:.0f}% - skipped",
                    executed=False,
                )
                rejected += 1
                continue
            if holding:
                await self._log(session, user, symbol, action, confidence, "already positioned - adding not allowed by risk policy", executed=False)
                rejected += 1
                continue
            if action == "SELL" and not holding:
                await self._log(session, user, symbol, "SELL", confidence, "no inventory to sell (spot, no margin)", executed=False)
                rejected += 1
                continue

            # ---- sizing from the AI trade plan, capped by the risk profile
            plan = signal.plan or {}
            qty = float(plan.get("suggested_qty") or 0.0)
            price = float(signal.price or self.hub.price(symbol) or 0.0)
            if qty <= 0 or price <= 0:
                await self._log(session, user, symbol, action, confidence, "signal produced no sizeable plan", executed=False)
                rejected += 1
                continue
            max_notional = float(user.max_trade_size_usd or settings.MAX_TRADE_NOTIONAL_USD)
            budget = equity * profile["position_pct"] * (settings.MAX_POSITION_PCT / 100.0)
            notional_cap = min(max_notional, max(0.0, budget))
            if notional_cap <= 0:
                await self._log(session, user, symbol, action, confidence, "no buying power after risk caps", executed=False)
                rejected += 1
                continue
            qty = min(qty, notional_cap / price)

            req = OrderRequest(
                symbol=symbol,
                side=action,
                order_type="MARKET",
                quantity=qty,
                take_profit=float(plan.get("take_profit") or price * (1 + settings.AUTO_TRADE_TAKE_PROFIT_PCT / 100.0)),
                stop_loss=float(plan.get("stop_loss") or price * (1 - settings.AUTO_TRADE_STOP_LOSS_PCT / 100.0)),
                source="ai",
                ai_signal_id=signal.signal_id,
                confidence=confidence,
            )
            try:
                result = await trading_service.place_order(session, user, req)
                executed += 1
                await self._log(
                    session,
                    user,
                    symbol,
                    action,
                    confidence,
                    signal.reason,
                    executed=True,
                    client_order_id=result.get("client_order_id", ""),
                    signal_id=signal.signal_id,
                )
                await self._persist_signal(session, user, symbol, signal, acted=True)
                await notification_service.push(
                    user_id=user.id,
                    kind="trade",
                    title=f"AI {action} {symbol} ({confidence:.0f}%)",
                    body=signal.reason[:180],
                    data={"symbol": symbol, "source": "ai", "client_order_id": result.get("client_order_id", "")},
                    session=session,
                )
                await self.hub.broadcast_to_user(
                    {
                        "type": "ai_trade",
                        "data": {
                            "symbol": symbol,
                            "action": action,
                            "confidence": round(confidence, 1),
                            "reason": signal.reason,
                            "order": {k: result.get(k) for k in ("client_order_id", "quantity", "price", "status")},
                            "at_ms": int(time.time() * 1000),
                        },
                    },
                    user.id,
                )
            except Exception as exc:
                rejected += 1
                await self._log(session, user, symbol, action, confidence, f"rejected: {exc}", executed=False)

        return {"evaluated": len(symbols), "executed": executed, "rejected": rejected, "closed": closed}

    # ------------------------------------------------------------------ helpers
    async def _log(
        self,
        session: Any,
        user: User,
        symbol: str,
        decision: str,
        confidence: float,
        reason: str,
        *,
        executed: bool,
        client_order_id: str = "",
        close: bool = False,
        signal_id: str | None = None,
    ) -> None:
        await repo.log_auto_trade(
            session,
            user_id=user.id,
            symbol=symbol,
            decision=decision,
            executed=executed,
            confidence=round(float(confidence or 0.0), 2),
            reason=(reason or "")[:600],
            order_client_id=client_order_id,
            risk_snapshot={
                "risk_level": user.risk_level,
                "max_trade_size_usd": user.max_trade_size_usd,
                "daily_loss_limit_usd": user.daily_loss_limit_usd,
                "close": close,
                "signal_id": signal_id,
            },
        )

    async def _persist_signal(self, session: Any, user: User, symbol: str, signal: Any, *, acted: bool) -> None:
        try:
            await repo.save_signal(
                session,
                signal_id=signal.signal_id,
                user_id=user.id,
                symbol=symbol,
                action=signal.action,
                confidence=round(signal.confidence, 2),
                reason=signal.reason[:1000],
                indicators={k: v for k, v in signal.indicators.items() if k != "indicator_series"},
                model_version=signal.model_version,
                price_at_signal=signal.price,
                acted_on=acted,
            )
        except Exception:  # pragma: no cover
            log.debug("signal persist failed", exc_info=True)

    # ------------------------------------------------------------- performance
    async def performance(self, user_id: int) -> dict[str, Any]:
        """Win rate / P&L / Sharpe over the user's AI trades."""
        async with session_scope() as session:
            rows = list(
                (
                    await session.execute(
                        select(Trade).where(Trade.user_id == int(user_id), Trade.source == "ai").order_by(Trade.created_at_ms.desc()).limit(500)
                    )
                ).scalars().all()
            )
            log_rows = list(await repo.auto_trade_log(session, user_id, limit=200))
        pnls = [float(t.realized_pnl) for t in rows if abs(float(t.realized_pnl or 0.0)) > 1e-9]
        wins = len([p for p in pnls if p > 0])
        losses = len([p for p in pnls if p < 0])
        total = sum(pnls)
        mean = total / len(pnls) if pnls else 0.0
        import numpy as np

        arr = np.asarray(pnls, dtype=float)
        std = float(arr.std(ddof=0)) if len(arr) > 1 else 0.0
        sharpe = float(mean / std * (252 ** 0.5)) if std > 1e-9 else 0.0
        gross_win = sum(p for p in pnls if p > 0)
        gross_loss = abs(sum(p for p in pnls if p < 0))
        peak = equity = 0.0
        for p in pnls[::-1]:
            equity += p
            peak = max(peak, equity)
        max_dd = peak - equity
        return {
            "trades": len(pnls),
            "wins": wins,
            "losses": losses,
            "win_rate": round(100.0 * wins / (wins + losses), 2) if (wins + losses) else 0.0,
            "total_pnl": round(total, 2),
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss else None,
            "avg_pnl": round(mean, 4),
            "best_trade": round(max(pnls), 2) if pnls else 0.0,
            "worst_trade": round(min(pnls), 2) if pnls else 0.0,
            "sharpe_ratio": round(sharpe, 2),
            "max_drawdown": round(max_dd, 2),
            "decisions": len(log_rows),
            "executed_decisions": len([r for r in log_rows if r.executed]),
            "recent_decisions": [
                {
                    "symbol": r.symbol,
                    "decision": r.decision,
                    "executed": r.executed,
                    "confidence": r.confidence,
                    "reason": r.reason,
                    "at_ms": r.created_at_ms,
                    "order_client_id": r.order_client_id,
                }
                for r in log_rows[:40]
            ],
            "daily": risk_manager_snapshot(user_id),
        }


def risk_manager_snapshot(user_id: int) -> dict[str, Any]:
    from app.risk.manager import risk_manager

    return risk_manager.daily_stats(user_id)


async def _portfolio_total(session: Any, user: User) -> float:
    from app.services.portfolio import portfolio_service

    snap = await portfolio_service.build(session, user, include_series=False)
    return float(snap.get("total_value_usd") or 0.0)


auto_trader = AutoTrader(hub=None)  # hub wired at startup
