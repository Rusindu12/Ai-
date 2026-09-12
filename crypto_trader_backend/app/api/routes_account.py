"""Account, portfolio and export endpoints.

    GET  /api/account              balances + valuation + P&L (dashboard + portfolio)
    GET  /api/account/positions    open positions with TP/SL
    GET  /api/portfolio/allocation pie-chart data
    GET  /api/portfolio/history    equity history points
    GET  /api/export/csv           transaction history (CSV download)
    POST /api/account/paper/reset  refill the virtual balance
"""

from __future__ import annotations

from datetime import UTC
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_hub, get_portfolio, rate_limit
from app.api.schemas import ResetPaperRequest
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.services import accounts

router = APIRouter(tags=["account"], dependencies=[Depends(rate_limit)])


@router.get("/api/account")
async def account(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    portfolio: Any = Depends(get_portfolio),
    include_series: bool = Query(default=True),
) -> dict[str, Any]:
    snap = await portfolio.build(session, user, include_series=include_series)
    creds = await accounts.resolve_creds(session, user)
    return {
        **snap,
        "credential": creds.label if not settings.DEMO_MODE else "simulated",
        "limits": {
            "max_trade_size_usd": user.max_trade_size_usd,
            "daily_loss_limit_usd": user.daily_loss_limit_usd,
            "risk_level": user.risk_level,
        },
    }


@router.get("/api/account/positions")
async def positions(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    hub: Any = Depends(get_hub),
) -> dict[str, Any]:
    rows = []
    for pos in list(await repo.list_positions(session, user.id)):
        price = float(hub.price(pos.symbol)) if hub is not None else 0.0
        value = price * pos.qty
        upnl = (price - pos.avg_price) * pos.qty if pos.avg_price else 0.0
        rows.append(
            {
                "symbol": pos.symbol,
                "qty": round(pos.qty, 8),
                "avg_price": round(pos.avg_price, 8),
                "cost_basis": round(pos.cost_basis, 2),
                "mark_price": round(price, 8),
                "value_usd": round(value, 2),
                "unrealized_pnl": round(upnl, 2),
                "unrealized_pnl_pct": round((price / pos.avg_price - 1) * 100, 2) if pos.avg_price else None,
                "realized_pnl": round(pos.realized_pnl, 2),
                "take_profit": pos.take_profit,
                "stop_loss": pos.stop_loss,
                "paper": pos.paper,
                "updated_at_ms": pos.updated_at_ms,
                "distance_to_tp_pct": round((pos.take_profit / price - 1) * 100, 2) if pos.take_profit and price else None,
                "distance_to_sl_pct": round((pos.stop_loss / price - 1) * 100, 2) if pos.stop_loss and price else None,
            }
        )
    rows.sort(key=lambda r: -abs(r["value_usd"]))
    return {"count": len(rows), "positions": rows, "total_unrealized": round(sum(r["unrealized_pnl"] for r in rows), 2)}


@router.get("/api/portfolio/allocation")
async def allocation(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    portfolio: Any = Depends(get_portfolio),
) -> dict[str, Any]:
    snap = await portfolio.build(session, user, include_series=False)
    return {
        "total_value_usd": snap["total_value_usd"],
        "cash_usd": snap["cash_usd"],
        "invested_usd": snap["invested_value_usd"],
        "allocation": snap["allocation"],
        "currency": "USD",
    }


@router.get("/api/portfolio/history")
async def history(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    days: int = Query(default=30, ge=1, le=365),
) -> dict[str, Any]:
    """Daily equity reconstruction from the trade ledger (portable SQL + Python bucketing)."""
    from datetime import datetime, timedelta

    since_ms = int((datetime.now(UTC) - timedelta(days=days)).timestamp() * 1000)
    trades = list(await repo.list_trades(session, user.id, limit=5000))
    trades = [t for t in trades if (t.created_at_ms or 0) >= since_ms]
    buckets: dict[str, dict[str, float]] = {}
    for t in sorted(trades, key=lambda r: r.created_at_ms or 0):
        day = datetime.fromtimestamp((t.created_at_ms or 0) / 1000.0, tz=UTC).strftime("%Y-%m-%d")
        b = buckets.setdefault(day, {"pnl": 0.0, "trades": 0.0, "volume": 0.0})
        b["pnl"] += float(t.realized_pnl or 0.0)
        b["trades"] += 1
        b["volume"] += float(t.quote_qty or 0.0)
    start_equity = float(getattr(user, "paper_balances", {}) or {}).get("USDT", 10_000.0)
    equity = start_equity
    points = []
    for day in sorted(buckets):
        b = buckets[day]
        equity += b["pnl"]
        points.append({"date": day, "equity": round(equity, 2), "trades": int(b["trades"]), "volume": round(b["volume"], 2)})
    return {"days": days, "points": points, "start_equity": points[0]["equity"] if points else equity}


@router.get("/api/export/csv")
async def export_csv(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    portfolio: Any = Depends(get_portfolio),
    kind: str = Query(default="trades", pattern="^(trades|portfolio)$"),
) -> Response:
    body = await portfolio.export_csv(session, user, kind=kind)
    filename = f"cryptotrader-{kind}-{settings.ENV}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/account/paper/reset")
async def reset_paper(
    body: ResetPaperRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await accounts.save_paper_state(session, user.id, dict(accounts.DEFAULT_PAPER_CASH))
    from sqlalchemy import delete

    from app.db.models import Position, Trade

    await session.execute(delete(Position).where(Position.user_id == user.id, Position.paper.is_(True)))
    await session.execute(delete(Trade).where(Trade.user_id == user.id, Trade.paper.is_(True)))
    await repo.audit(session, user_id=user.id, action="paper.reset")
    await session.commit()
    if settings.DEMO_MODE:
        from app.services.gateway import get_gateway

        gateway = await get_gateway()
        creds = await accounts.resolve_creds(session, user)
        gateway.reset_account(creds)
    return {"reset": True, "balances": accounts.DEFAULT_PAPER_CASH}
