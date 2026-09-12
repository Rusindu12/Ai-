"""Order execution service (the only code path that can move money).

Flow for ``POST /api/order``::

    validate -> idempotency(client_order_id) -> symbol filters -> RISK MANAGER
      -> execute
           demo      : simulator matching engine (book walking, fees, slippage)
           live+paper: local fill at the live mark price (no exchange call)
           live      : signed POST /api/v3/order with the user's own key
      -> record Trade + update Position (avg price, realised P&L)
      -> attach TP/SL (exchange OCO when live, DB watch orders when paper)
      -> broadcast `order_update` on the user's socket + push notification

Cancelling: ``DELETE /api/order/{id}`` - id may be the exchange orderId or the
client order id.  Paper orders are cancelled by updating the DB row.
"""

from __future__ import annotations

import contextlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import repo
from app.db.models import Trade, User
from app.errors import ConflictError, InsufficientFundsError, RateLimitedError, RiskLimitError, ValidationError_
from app.risk.manager import SymbolFilters, risk_manager
from app.services import accounts
from app.services.gateway import get_gateway

log = logging.getLogger(__name__)

TERMINAL = {"FILLED", "CANCELED", "EXPIRED", "REJECTED"}


@dataclass(slots=True)
class OrderRequest:
    symbol: str
    side: str
    order_type: str = "MARKET"
    quantity: float = 0.0
    quote_qty: float = 0.0
    price: float = 0.0
    time_in_force: str = "GTC"
    take_profit: float | None = None
    stop_loss: float | None = None
    client_order_id: str = ""
    source: str = "manual"  # manual | ai | paper
    ai_signal_id: str | None = None
    confidence: float | None = None
    use_paper: bool | None = None
    dry_run: bool = False

    warnings: list[str] = field(default_factory=list)

    def normalise(self) -> OrderRequest:
        self.symbol = self.symbol.upper().strip()
        self.side = self.side.upper().strip()
        self.order_type = (self.order_type or "MARKET").upper().strip()
        if self.side not in {"BUY", "SELL"}:
            raise ValidationError_("side must be BUY or SELL")
        if self.order_type not in {"MARKET", "LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"}:
            raise ValidationError_(f"unsupported order type {self.order_type}")
        if self.order_type == "LIMIT" and self.price <= 0:
            raise ValidationError_("limit orders require a price")
        if not self.client_order_id:
            self.client_order_id = f"ct{int(time.time() * 1000)}{uuid.uuid4().hex[:8]}"
        if len(self.client_order_id) > 36:
            self.client_order_id = self.client_order_id[:36]
        return self


def _now_ms() -> int:
    return int(time.time() * 1000)


class TradingService:
    def __init__(self, hub: Any = None) -> None:
        self.hub = hub

    def attach_hub(self, hub: Any) -> None:
        self.hub = hub

    # ------------------------------------------------------------------ helpers
    async def reference_price(self, symbol: str, *, side: str = "BUY") -> float:
        if self.hub is not None:
            t = self.hub.ticker(symbol)
            if t:
                px = float(t.get("ask") if side == "BUY" else t.get("bid")) or float(t.get("price") or 0.0)
                if px > 0:
                    return px
            px = float(self.hub.price(symbol))
            if px > 0:
                return px
        gateway = await get_gateway()
        try:
            t = await gateway.ticker(symbol)
            return float(t.get("price") or 0.0)
        except Exception:  # pragma: no cover
            return 0.0

    # ------------------------------------------------------------------- place
    async def place_order(self, session: AsyncSession, user: User, req: OrderRequest) -> dict[str, Any]:
        req.normalise()
        gateway = await get_gateway()

        existing = await repo.find_trade_by_client_id(session, req.client_order_id)
        if existing is not None:
            log.info("idempotent replay for client_order_id=%s", req.client_order_id)
            return {**_trade_dict(existing), "idempotent_replay": True}

        rule = await accounts.get_symbol_rule(gateway, req.symbol)
        if rule.symbol != req.symbol.upper() and not settings.DEMO_MODE:
            raise ValidationError_(f"unknown or delisted symbol {req.symbol}")

        live = float(await self.reference_price(req.symbol, side=req.side))
        if live <= 0:
            raise ValidationError_(f"no market price available for {req.symbol}")

        qty = float(req.quantity or 0.0)
        if req.quote_qty > 0:
            qty = req.quote_qty / (req.price or live)
        if qty <= 0:
            raise ValidationError_("quantity or quoted_qty must be > 0")

        price = float(req.price or 0.0)
        if req.order_type == "MARKET":
            price = 0.0
        else:
            price = round(price, rule.price_decimals)

        creds = await accounts.resolve_creds(session, user, require_live=False, label=None)
        paper = True if settings.DEMO_MODE else bool(req.use_paper if req.use_paper is not None else creds.paper)

        # A sell can only ever be covered by what the account actually holds.
        # (Clamping it down silently would turn a user's order into a different one.)
        if req.side == "SELL":
            base_free = await self._asset_balance(session, user, creds, rule.base, paper=paper)
            if qty > base_free * (1 + 1e-9) + 1e-12:
                raise InsufficientFundsError(
                    f"insufficient {rule.base} to sell: need {qty:.8f}, have {base_free:.8f}",
                    details={"asset": rule.base, "required": qty, "available": base_free},
                )

        filters = SymbolFilters(
            tick_size=rule.tick_size,
            step_size=rule.step_size,
            min_qty=rule.min_qty,
            min_notional=rule.min_notional,
        )
        quote_free = await self._quote_balance(session, user, creds, rule.quote, paper=paper)
        open_positions = len([p for p in await repo.list_positions(session, user.id, paper=paper) if p.qty > 0])
        realised_today = await repo.realised_pnl_since(session, user.id, _utc_midnight_ms())

        decision = risk_manager.check_order(
            user=user,
            symbol=req.symbol,
            side=req.side,
            qty=qty,
            price=price,
            order_type=req.order_type,
            reference_price=live,
            quote_free=quote_free,
            open_positions=open_positions,
            realised_pnl_today=realised_today,
            filters=filters,
            require_credentials=not paper and not settings.DEMO_MODE,
        )
        if not decision.allowed:
            raise RiskLimitError(decision.reason, details={"code": decision.code, "warnings": decision.warnings, **decision.context})
        qty = filters.round_qty(decision.adjusted_qty or qty)
        req.warnings.extend(decision.warnings)

        est_notional = qty * (price or live)
        if req.dry_run:
            return {
                "dry_run": True,
                "symbol": req.symbol,
                "side": req.side,
                "type": req.order_type,
                "quantity": qty,
                "est_price": round(price or live, rule.price_decimals or 8),
                "est_notional": round(est_notional, 4),
                "est_fee": round(est_notional * settings.TAKER_FEE_BPS / 10_000.0, 6),
                "risk": decision.as_dict(),
                "take_profit": req.take_profit,
                "stop_loss": req.stop_loss,
                "paper": paper,
                "client_order_id": req.client_order_id,
            }

        # ------------------------------------------------------------- execute
        if req.order_type == "MARKET" or paper:
            raw = await self._execute(gateway, req, qty, price, live, paper=paper, creds=creds)
        else:
            raw = await self._execute(gateway, req, qty, price, live, paper=paper, creds=creds)

        status = str(raw.get("status") or ("FILLED" if req.order_type == "MARKET" else "NEW"))
        exec_qty = float(raw.get("executedQty") or 0.0) or (qty if status == "FILLED" else 0.0)
        avg_price = float(raw.get("price") or 0.0) or (live if status == "FILLED" else price)
        fee_notional = exec_qty * avg_price
        fee = float(raw.get("fee") or fee_notional * settings.TAKER_FEE_BPS / 10_000.0)

        realised = 0.0
        if exec_qty > 0:
            pos, realised = await repo.apply_fill(
                session,
                user.id,
                symbol=req.symbol,
                side=req.side,
                qty=exec_qty,
                price=avg_price,
                fee=fee,
                paper=paper,
                take_profit=req.take_profit,
                stop_loss=req.stop_loss,
            )
            if not paper and req.take_profit and req.stop_loss:
                await self._attach_oco(gateway, user, req, pos.qty, raw, creds)
            if paper:
                await self._apply_paper_cash(session, user, rule.quote, rule.base, req.side, fee_notional, fee, exec_qty, paper=paper)
        else:
            pos = await repo.get_position(session, user.id, req.symbol, paper=paper)

        trade = await repo.record_trade(
            session,
            user_id=user.id,
            client_order_id=req.client_order_id,
            order_id=str(raw.get("orderId") or ""),
            exchange="simulated" if settings.DEMO_MODE else "binance",
            symbol=req.symbol,
            side=req.side,
            order_type=req.order_type,
            qty=exec_qty or qty,
            price=avg_price,
            quote_qty=exec_qty * avg_price,
            fee_usd=fee,
            realized_pnl=realised,
            status=status,
            take_profit=req.take_profit,
            stop_loss=req.stop_loss,
            source=req.source,
            paper=paper,
            ai_signal_id=req.ai_signal_id,
            confidence=req.confidence,
            raw={k: v for k, v in raw.items() if k != "raw"},
        )
        risk_manager.note_fill(user.id, req.symbol, pnl=realised, notional=exec_qty * avg_price, side=req.side)
        await repo.audit(
            session,
            user_id=user.id,
            action="order.place",
            detail={"symbol": req.symbol, "side": req.side, "qty": exec_qty or qty, "status": status, "paper": paper, "source": req.source},
        )

        payload = {
            **_trade_dict(trade),
            "position": ({
                "symbol": pos.symbol,
                "qty": pos.qty,
                "avg_price": pos.avg_price,
                "unrealized_pnl": round((live - pos.avg_price) * pos.qty, 4) if pos.qty else 0.0,
                "take_profit": pos.take_profit,
                "stop_loss": pos.stop_loss,
            } if pos is not None else None),
            "risk": decision.as_dict(),
            "paper": paper,
            "demo_mode": settings.DEMO_MODE,
            "warnings": req.warnings,
            "balance_after": await self._quote_balance(session, user, creds, rule.quote, paper=paper),
        }
        await self._notify(user, trade, session=session)
        return payload

    async def _execute(
        self,
        gateway: Any,
        req: OrderRequest,
        qty: float,
        price: float,
        live: float,
        *,
        paper: bool,
        creds: Any,
    ) -> dict[str, Any]:
        order = {
            "symbol": req.symbol,
            "side": req.side,
            "type": req.order_type,
            "quantity": qty,
            "price": price or None,
            "timeInForce": req.time_in_force,
            "clientOrderId": req.client_order_id,
        }
        if settings.DEMO_MODE:
            return await gateway.place_order(order, creds)
        if paper:
            # Live market data, virtual fills: we take the mark price plus
            # configured slippage so paper results stay pessimistic.
            slip = live * settings.SLIPPAGE_BPS / 10_000.0
            fill_price = (live + slip) if req.side == "BUY" else (live - slip)
            resting = req.order_type != "MARKET"
            return {
                "orderId": f"paper{_now_ms()}",
                "clientOrderId": req.client_order_id,
                "symbol": req.symbol,
                "side": req.side,
                "type": req.order_type,
                "status": "NEW" if resting else "FILLED",
                "executedQty": 0.0 if resting else qty,
                "price": 0.0 if resting else round(fill_price, 8),
                "fee": 0.0 if resting else qty * fill_price * settings.TAKER_FEE_BPS / 10_000.0,
                "transactTime": None if resting else _now_ms(),
                "paper": True,
            }
        try:
            return await gateway.place_order(order, creds)
        except InsufficientFundsError:
            raise
        except RateLimitedError:
            raise
        except ValidationError_ as exc:
            raise ValidationError_(f"exchange rejected order: {exc.message}", details=exc.details) from exc

    async def _attach_oco(
        self, gateway: Any, user: User, req: OrderRequest, pos_qty: float, fill: dict[str, Any], creds: Any
    ) -> None:
        """Best-effort TP/SL on the exchange (server-side OCO)."""
        if pos_qty <= 0 or not req.take_profit or not req.stop_loss:
            return
        opposite = "SELL" if req.side == "BUY" else "BUY"
        try:
            await gateway.place_order(
                {
                    "symbol": req.symbol,
                    "side": opposite,
                    "type": "STOP_LOSS_LIMIT",
                    "quantity": pos_qty,
                    "price": req.stop_loss * (0.998 if opposite == "SELL" else 1.002),
                    "stopPrice": req.stop_loss,
                    "timeInForce": "GTC",
                    "clientOrderId": f"{req.client_order_id}sl",
                },
                creds,
            )
        except Exception as exc:  # pragma: no cover - depends on real keys
            log.warning("could not attach stop-loss: %s", exc)

    # -------------------------------------------------------------- balances
    async def _quote_balance(self, session: AsyncSession, user: User, creds: Any, quote: str, *, paper: bool) -> float:
        """Free quote-asset balance in the ledger the order will actually use."""
        gateway = await get_gateway()
        if settings.DEMO_MODE:
            try:
                acct = await gateway.account(creds)
            except Exception:  # pragma: no cover - simulator never fails here
                return 0.0
            for b in acct.get("balances", []):
                if b["asset"] == quote:
                    return float(b["free"])
            return 0.0
        if paper:
            state = await accounts.paper_state(user)
            return float(state.get(quote, 0.0))
        try:
            acct = await gateway.account(creds)
        except Exception as exc:
            log.warning("live balance lookup failed: %s", exc)
            return 0.0
        for b in acct.get("balances", []):
            if b["asset"] == quote:
                return float(b["free"])
        return 0.0

    async def _asset_balance(self, session: AsyncSession, user: User, creds: Any, asset: str, *, paper: bool) -> float:
        """Free quantity of any asset in the ledger this order would use."""
        gateway = await get_gateway()
        if settings.DEMO_MODE:
            try:
                acct = await gateway.account(creds)
            except Exception:  # pragma: no cover
                return 0.0
            for b in acct.get("balances", []):
                if b["asset"] == asset:
                    return float(b["free"])
            return 0.0
        if paper:
            state = await accounts.paper_state(user)
            if asset in state:
                return float(state[asset])
            pos = await repo.get_position(session, user.id, f"{asset}USDT", paper=True)
            return float(pos.qty) if pos else 0.0
        try:
            acct = await gateway.account(creds)
        except Exception as exc:  # pragma: no cover - needs live keys
            log.warning("live balance lookup failed: %s", exc)
            return 0.0
        for b in acct.get("balances", []):
            if b["asset"] == asset:
                return float(b["free"])
        return 0.0

    async def _apply_paper_cash(
        self,
        session: AsyncSession,
        user: User,
        quote: str,
        base: str,
        side: str,
        notional: float,
        fee: float,
        qty: float,
        *,
        paper: bool,
    ) -> None:
        """Virtual cash bookkeeping for live-market-data paper trading.

        DEMO_MODE is skipped: the simulator owns and mutates those balances.
        """
        if settings.DEMO_MODE or not paper:
            return
        state = dict(await accounts.paper_state(user))
        if side == "BUY":
            state[quote] = state.get(quote, 0.0) - notional - fee
            state[base] = state.get(base, 0.0) + qty
        else:
            state[quote] = state.get(quote, 0.0) + notional - fee
            state[base] = state.get(base, 0.0) - qty
        await accounts.save_paper_state(session, user.id, state)
        user.paper_balances = state

    # --------------------------------------------------------------- open/cancel
    async def list_open_orders(self, session: AsyncSession, user: User, *, symbol: str | None = None) -> list[dict[str, Any]]:
        gateway = await get_gateway()
        creds = await accounts.resolve_creds(session, user)
        out: list[dict[str, Any]] = []
        if settings.DEMO_MODE:
            out = [dict(o) for o in await gateway.open_orders(symbol, creds)]
        elif not creds.paper:
            try:
                out = [dict(o) for o in await gateway.open_orders(symbol, creds)]
            except Exception as exc:
                log.warning("openOrders failed: %s", exc)
        # paper resting orders (and local mirrors of protective orders)
        rows = await repo.list_trades(session, user.id, symbol=symbol, status="NEW", limit=200)
        for t in rows:
            if t.status in TERMINAL:
                continue
            out.append(
                {
                    "orderId": t.order_id or t.client_order_id,
                    "clientOrderId": t.client_order_id,
                    "symbol": t.symbol,
                    "side": t.side,
                    "type": t.order_type,
                    "price": t.price,
                    "origQty": t.qty,
                    "executedQty": 0.0,
                    "status": t.status,
                    "time": t.created_at_ms,
                    "paper": t.paper,
                }
            )
        out.sort(key=lambda r: -(r.get("time") or 0))
        return out

    async def cancel_order(self, session: AsyncSession, user: User, order_ref: str, *, symbol: str | None = None) -> dict[str, Any]:
        gateway = await get_gateway()
        creds = await accounts.resolve_creds(session, user)
        trade = await repo.find_trade_by_client_id(session, order_ref)
        if trade is not None and trade.user_id != user.id:
            raise ValidationError_("order belongs to another account")
        if trade is not None and (settings.DEMO_MODE or trade.paper):
            if trade.status in TERMINAL:
                raise ConflictError(f"order is already {trade.status.lower()}")
            if settings.DEMO_MODE:
                # the simulator owns the resting order - drop it there too
                with contextlib.suppress(Exception):
                    await gateway.cancel_order(trade.symbol, trade.client_order_id or order_ref, creds)
            await repo.update_trade_status(session, trade.client_order_id, status="CANCELED")
            await repo.audit(session, user_id=user.id, action="order.cancel", detail={"client_order_id": order_ref, "scope": "paper"})
            return {"orderId": trade.order_id or order_ref, "clientOrderId": trade.client_order_id, "symbol": trade.symbol, "status": "CANCELED", "cancelled": True, "paper": True}
        if trade is not None and trade.status in TERMINAL:
            raise ConflictError(f"order is already {trade.status.lower()}")
        sym = symbol or (trade.symbol if trade else None)
        if not sym:
            raise ValidationError_("symbol is required to cancel an exchange order")
        result = await gateway.cancel_order(sym, order_ref, creds)
        if trade is not None:
            await repo.update_trade_status(session, trade.client_order_id, status="CANCELED")
        await repo.audit(session, user_id=user.id, action="order.cancel", detail={"client_order_id": order_ref, "symbol": sym})
        return {**result, "cancelled": True}

    async def close_position(self, session: AsyncSession, user_id: int, symbol: str, *, reason: str = "manual") -> dict[str, Any] | None:
        """Market-close the full position for (user, symbol). Used by TP/SL,
        the AI auto-trader and the STOP ALL / flatten flow."""
        user = await repo.get_user_by_id(session, user_id)
        if user is None:
            return None
        symbol = symbol.upper()
        pos = await repo.get_position(session, user_id, symbol, paper=True) or await repo.get_position(
            session, user_id, symbol, paper=False
        )
        if pos is None or pos.qty <= 0:
            return None
        paper = bool(pos.paper)
        rule = await accounts.get_symbol_rule(await get_gateway(), symbol)
        from app.risk.manager import SymbolFilters

        filters = SymbolFilters(
            tick_size=rule.tick_size, step_size=rule.step_size, min_qty=rule.min_qty, min_notional=rule.min_notional
        )
        qty = filters.round_qty(pos.qty)
        if qty <= 0:
            return None
        req = OrderRequest(
            symbol=symbol,
            side="SELL" if pos.qty > 0 else "BUY",
            order_type="MARKET",
            quantity=qty,
            client_order_id=f"close{int(time.time() * 1000)}{uuid.uuid4().hex[:6]}",
            source="ai" if reason in {"take_profit", "stop_loss"} else "manual",
            use_paper=paper,
        ).normalise()
        req.warnings.append(f"auto-close ({reason})")
        # bypass the cooldown/daily-loss gates: exits must always be executable
        decision = risk_manager_check_exit(user, symbol)
        result = await self._execute(
            await get_gateway(), req, qty, 0.0, await self.reference_price(symbol, side="SELL"), paper=paper, creds=await accounts.resolve_creds(session, user)
        )
        live = float(result.get("price") or await self.reference_price(symbol, side="SELL"))
        fee = qty * live * settings.TAKER_FEE_BPS / 10_000.0
        new_pos, realised = await repo.apply_fill(
            session, user_id, symbol=symbol, side="SELL", qty=qty, price=live, fee=fee, paper=paper
        )
        trade = await repo.record_trade(
            session,
            user_id=user_id,
            client_order_id=req.client_order_id,
            order_id=str(result.get("orderId") or ""),
            exchange="simulated" if settings.DEMO_MODE else "binance",
            symbol=symbol,
            side="SELL",
            order_type="MARKET",
            qty=qty,
            price=live,
            quote_qty=qty * live,
            fee_usd=fee,
            realized_pnl=realised,
            status="FILLED",
            source="ai" if reason in {"take_profit", "stop_loss"} else "manual",
            paper=paper,
            raw={"auto_close": reason, "risk": decision, "qty_before": pos.qty},
        )
        risk_manager.note_fill(user_id, symbol, pnl=realised, notional=qty * live, side="SELL")
        await repo.audit(session, user_id=user_id, action="position.close", detail={"symbol": symbol, "reason": reason, "pnl": round(realised, 4)})
        return {**_trade_dict(trade), "position": {"qty": new_pos.qty, "avg_price": new_pos.avg_price}, "realized_pnl": round(realised, 4), "reason": reason}

    # ------------------------------------------------------------------ pushes
    async def _notify(self, user: User, trade: Trade, session: Any = None) -> None:
        from app.services.notifications import notification_service

        title = f"{trade.side} {trade.symbol} {trade.status.lower()}"
        body = (
            f"{trade.qty:g} @ {trade.price:,.6g} "
            f"({'paper' if trade.paper else 'live'})"
            + (f" | P&L {trade.realized_pnl:+,.2f}" if abs(trade.realized_pnl or 0) > 1e-9 else "")
        )
        try:
            await notification_service.push(
                user_id=user.id,
                kind="trade",
                title=title,
                body=body,
                data={"symbol": trade.symbol, "client_order_id": trade.client_order_id, "status": trade.status},
                session=session,
            )
        except Exception:  # pragma: no cover - notifications must never break trading
            log.debug("notification push failed", exc_info=True)

    async def broadcast(self, msg: dict[str, Any], user_id: int) -> None:
        if self.hub is None:
            return
        broadcaster = getattr(self.hub, "broadcast_to_user", None)
        if broadcaster is not None:
            await broadcaster(msg, user_id)


def risk_manager_check_exit(user: Any, symbol: str) -> dict[str, Any]:
    """Exits are always allowed; recorded here so the audit trail is explicit."""
    return {"allowed": True, "reason": f"exit for {symbol} bypasses entry gates", "user": getattr(user, "id", None)}


def _utc_midnight_ms() -> int:
    now = time.gmtime()
    return int(time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, 0)) * 1000)


def _trade_dict(t: Trade) -> dict[str, Any]:
    return {
        "id": t.id,
        "client_order_id": t.client_order_id,
        "order_id": t.order_id,
        "symbol": t.symbol,
        "side": t.side,
        "type": t.order_type,
        "quantity": t.qty,
        "price": t.price,
        "notional": round(t.quote_qty, 6),
        "fee_usd": round(t.fee_usd, 6),
        "realized_pnl": round(t.realized_pnl, 4),
        "status": t.status,
        "take_profit": t.take_profit,
        "stop_loss": t.stop_loss,
        "source": t.source,
        "paper": t.paper,
        "ai_signal_id": t.ai_signal_id,
        "confidence": t.confidence,
        "created_at_ms": t.created_at_ms,
        "updated_at_ms": t.updated_at_ms,
    }


def trade_to_dict(t: Trade) -> dict[str, Any]:
    return _trade_dict(t)


trading_service = TradingService()
