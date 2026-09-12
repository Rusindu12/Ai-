"""Order entry points.

    POST   /api/order                 place (market/limit) - risk checked
    DELETE /api/order/{ref}          cancel by client_order_id or exchange orderId
    GET    /api/orders                open orders (paper ledger + exchange)
    GET    /api/orders/history        all recorded orders with filters
    GET    /api/trades                filled trade history (exchange + local)
    POST   /api/order/preview         dry run: sizing + fees + risk verdict, no order
    DELETE /api/orders                cancel everything for a symbol (or all)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_trading, rate_limit_orders
from app.api.schemas import BulkOrderCreate, OrderCreate
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import RateLimitedError, ValidationError_
from app.services.trading import OrderRequest, trade_to_dict

router = APIRouter(tags=["orders"])


def _to_request(body: OrderCreate) -> OrderRequest:
    return OrderRequest(
        symbol=body.symbol,
        side=body.side,
        order_type=body.order_type,
        quantity=body.quantity,
        quote_qty=body.quoted_qty,
        price=body.price,
        time_in_force=body.time_in_force,
        take_profit=body.take_profit,
        stop_loss=body.stop_loss,
        client_order_id=body.client_order_id,
        use_paper=body.use_paper,
        dry_run=body.dry_run,
        ai_signal_id=body.ai_signal_id,
        confidence=body.confidence,
    )


@router.post("/api/order")
async def place_order(
    body: OrderCreate,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
) -> dict[str, Any]:
    await rate_limit_orders(request)
    result = await trading.place_order(session, user, _to_request(body))
    await session.commit()
    request.app.state.metrics.inc("order.placed", symbol=body.symbol, side=body.side)
    return result


@router.post("/api/order/preview")
async def preview_order(
    body: OrderCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
) -> dict[str, Any]:
    payload = body.model_copy(update={"dry_run": True})
    return await trading.place_order(session, user, _to_request(payload))


@router.post("/api/orders/bulk")
async def place_bulk(
    body: BulkOrderCreate,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
) -> dict[str, Any]:
    """Batch entry (used by the AI screen's "trade all selected pairs")."""
    await rate_limit_orders(request)
    if len(body.orders) > 10:
        raise RateLimitedError("bulk orders are limited to 10 per request")
    results = []
    for order in body.orders:
        try:
            results.append({"ok": True, "result": await trading.place_order(session, user, _to_request(order))})
        except Exception as exc:
            results.append({"ok": False, "symbol": order.symbol, "error": str(exc), "code": getattr(exc, "error_code", "error"), "details": getattr(exc, "details", {})})
    await session.commit()
    return {"count": len(results), "succeeded": len([r for r in results if r["ok"]]), "results": results}


@router.delete("/api/order/{ref}")
async def cancel_order(
    ref: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
    symbol: str | None = Query(default=None),
) -> dict[str, Any]:
    result = await trading.cancel_order(session, user, ref, symbol=symbol)
    await session.commit()
    return result


@router.get("/api/orders")
async def open_orders(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
    symbol: str | None = Query(default=None),
) -> dict[str, Any]:
    rows = await trading.list_open_orders(session, user, symbol=symbol)
    return {"count": len(rows), "orders": rows}


@router.delete("/api/orders")
async def cancel_all(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
    symbol: str | None = Query(default=None),
) -> dict[str, Any]:
    rows = await trading.list_open_orders(session, user, symbol=symbol)
    cancelled, failed = [], []
    for row in rows:
        ref = row.get("clientOrderId") or row.get("orderId")
        try:
            await trading.cancel_order(session, user, str(ref), symbol=row.get("symbol"))
            cancelled.append(ref)
        except Exception as exc:
            failed.append({"ref": ref, "error": str(exc)})
    await session.commit()
    return {"cancelled": len(cancelled), "ids": cancelled, "failed": failed}


@router.get("/api/orders/history")
async def order_history(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    symbol: str | None = Query(default=None),
    side: str | None = Query(default=None, pattern="^(BUY|SELL|buy|sell)$"),
    status: str | None = Query(default=None),
    source: str | None = Query(default=None, pattern="^(manual|ai|paper)$"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    rows = list(await repo.list_trades(session, user.id, symbol=symbol, side=side.upper() if side else None, status=status, source=source, limit=limit, offset=offset))
    stats = await repo.trade_stats(session, user.id)
    return {"count": len(rows), "trades": [trade_to_dict(t) for t in rows], "stats": stats, "limit": limit, "offset": offset}


@router.get("/api/trades")
async def trades(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    source: str = "exchange",
) -> dict[str, Any]:
    """Fill history.  ``source=exchange`` mirrors the exchange ledger, ``local`` is
    the backend's own record (which also covers paper trades)."""
    if source == "local":
        rows = [trade_to_dict(t) for t in await repo.list_trades(session, user.id, symbol=symbol, limit=limit)]
        return {"source": "local", "count": len(rows), "trades": rows}
    from app.services import accounts
    from app.services.gateway import get_gateway

    gateway = await get_gateway()
    creds = await accounts.resolve_creds(session, user)
    rows = await gateway.my_trades(symbol, limit, creds)
    return {"source": "exchange" if not getattr(gateway, "is_simulated", False) else "simulated", "count": len(rows), "trades": rows}


@router.get("/api/trades/summary")
async def trades_summary(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    stats = await repo.trade_stats(session, user.id)
    stats["realized_today"] = round(await repo.realised_pnl_since(session, user.id, _utc_midnight_ms()), 2)
    return stats


def _utc_midnight_ms() -> int:
    import time

    now = time.gmtime()
    return int(time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, 0)) * 1000)


@router.get("/api/order/{ref}")
async def order_status(
    ref: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    trade = await repo.find_trade_by_client_id(session, ref)
    if trade is None:
        raise ValidationError_("no order recorded with that id")
    if trade.user_id != user.id:
        raise ValidationError_("not authorised for this order")
    return trade_to_dict(trade)
