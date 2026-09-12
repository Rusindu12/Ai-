"""AI auto-trading control plane (Screen 4).

    GET  /api/auto                     current config + stats + performance
    PUT  /api/auto                     enable/disable, pairs, risk, limits
    POST /api/auto/stop                STOP ALL (optional: flatten positions)
    POST /api/auto/resume              release the kill switch
    POST /api/auto/cycle               run one evaluation cycle now
    GET  /api/auto/log                 AI decision log (scrollable trade log)
    GET  /api/auto/performance         win rate / P&L / Sharpe / drawdown
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_auto_trader, rate_limit
from app.api.schemas import AutoTradeConfig, StopAllRequest
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.risk.manager import risk_manager, risk_profile
from app.services.trading import trading_service

router = APIRouter(prefix="/api/auto", tags=["ai-trading"], dependencies=[Depends(rate_limit)])


@router.get("")
async def status(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    auto: Any = Depends(get_auto_trader),
) -> dict[str, Any]:
    engine = auto
    return {
        "enabled": bool(user.auto_trade_enabled),
        "kill_switch": bool(user.auto_kill_switch),
        "symbols": user.auto_trade_symbols or [],
        "risk_level": user.risk_level,
        "profile": risk_profile(user.risk_level),
        "max_trade_size_usd": user.max_trade_size_usd,
        "daily_loss_limit_usd": user.daily_loss_limit_usd,
        "min_confidence_pct": settings.AI_MIN_CONFIDENCE_PCT,
        "interval_s": settings.AUTO_TRADE_INTERVAL_S,
        "paper_trading": user.paper_trading,
        "engine": {
            "running": bool(engine and getattr(engine, "task", None) is not None and not engine.task.done()),
            "cycles": getattr(engine, "cycles", 0),
            "executed": getattr(engine, "executed", 0),
            "rejected": getattr(engine, "rejected", 0),
            "last_cycle_ms": getattr(engine, "last_cycle_ms", 0),
            "stopped_users": sorted(getattr(engine, "stopped_users", set())),
        },
        "today": risk_manager.daily_stats(user.id),
    }


@router.put("")
async def configure(
    body: AutoTradeConfig,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if body.enabled and not (await repo.count_credentials(session, user.id) or settings.DEMO_MODE):
        # paper trading is allowed without keys; live mode needs a credential
        from app.services import accounts

        creds = await accounts.resolve_creds(session, user)
        if not creds.paper:
            return {"updated": False, "error": "add a Binance API key in Settings before enabling AI trading"}

    fields: dict[str, Any] = {
        "auto_trade_enabled": body.enabled,
        "auto_trade_symbols": body.symbols,
        "risk_level": body.risk_level,
        "max_trade_size_usd": body.max_trade_size_usd,
        "daily_loss_limit_usd": body.daily_loss_limit_usd,
    }
    if body.enabled:
        fields["auto_kill_switch"] = False
    if body.min_confidence_pct is not None:
        fields["notification_prefs"] = {**(user.notification_prefs or {}), "ai_min_confidence": body.min_confidence_pct}
    await repo.update_user(session, user.id, **fields)
    await repo.audit(
        session,
        user_id=user.id,
        action="auto.configure",
        detail={"enabled": body.enabled, "symbols": body.symbols, "risk_level": body.risk_level},
    )
    await session.commit()
    if body.enabled:
        request.app.state.metrics.inc("auto.enabled")
    updated = await repo.get_user_by_id(session, user.id)
    return {"updated": True, "config": _config_of(updated)}


@router.post("/stop")
async def stop_all(
    body: StopAllRequest | None = None,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    auto: Any = Depends(get_auto_trader),
) -> dict[str, Any]:
    """Emergency stop.  Also closes open orders (and optionally all positions)."""
    await repo.update_user(session, user.id, auto_kill_switch=True, auto_trade_enabled=False)
    if auto is not None:
        auto.kill_switch(user.id, engaged=True, flatten=bool(body and body.flatten))
    cancelled = 0
    try:
        rows = await trading_service.list_open_orders(session, user)
        for row in rows:
            try:
                await trading_service.cancel_order(session, user, str(row.get("clientOrderId") or row.get("orderId")), symbol=row.get("symbol"))
                cancelled += 1
            except Exception:  # pragma: no cover - best effort
                pass
    except Exception:  # pragma: no cover
        pass
    flattened = []
    if body and body.flatten:
        for pos in list(await repo.list_positions(session, user.id, paper=True)):
            if pos.qty > 0:
                try:
                    res = await trading_service.close_position(session, user.id, pos.symbol, reason="stop_all")
                    if res:
                        flattened.append({"symbol": pos.symbol, "realized_pnl": res.get("realized_pnl")})
                except Exception as exc:  # pragma: no cover
                    flattened.append({"symbol": pos.symbol, "error": str(exc)})
    await repo.audit(session, user_id=user.id, action="auto.stop_all", detail={"cancelled": cancelled, "flattened": len(flattened), "reason": (body.reason if body else "")})
    await session.commit()
    return {
        "stopped": True,
        "cancelled_orders": cancelled,
        "flattened_positions": flattened,
        "note": "AI trading halted - resume manually from the AI screen",
    }


@router.post("/resume")
async def resume(user: User = Depends(current_user), session: AsyncSession = Depends(get_session), auto: Any = Depends(get_auto_trader)) -> dict[str, Any]:
    await repo.update_user(session, user.id, auto_kill_switch=False, auto_trade_enabled=True)
    if auto is not None:
        auto.kill_switch(user.id, engaged=False)
    await repo.audit(session, user_id=user.id, action="auto.resume")
    await session.commit()
    return {"resumed": True}


@router.post("/cycle")
async def run_cycle(user: User = Depends(current_user), session: AsyncSession = Depends(get_session), auto: Any = Depends(get_auto_trader), symbol: str | None = Query(default=None)) -> dict[str, Any]:
    """Evaluate immediately (the UI's "Run AI scan now" button)."""
    if auto is None:
        return {"ok": False, "error": "auto trader engine not running"}
    result = await auto.evaluate_user(session, user, force_symbol=symbol)
    await session.commit()
    return {"ok": True, **result}


@router.get("/log")
async def trade_log(user: User = Depends(current_user), session: AsyncSession = Depends(get_session), limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    rows = list(await repo.auto_trade_log(session, user.id, limit=limit))
    return {
        "count": len(rows),
        "entries": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "decision": r.decision,
                "executed": r.executed,
                "confidence": r.confidence,
                "reason": r.reason,
                "order_client_id": r.order_client_id,
                "risk": r.risk_snapshot,
                "created_at_ms": r.created_at_ms,
            }
            for r in rows
        ],
    }


@router.get("/performance")
async def performance(user: User = Depends(current_user), auto: Any = Depends(get_auto_trader)) -> dict[str, Any]:
    if auto is None:
        return {"error": "engine unavailable"}
    return await auto.performance(user.id)


def _config_of(user: User | None) -> dict[str, Any]:
    if user is None:
        return {}
    return {
        "enabled": bool(user.auto_trade_enabled),
        "kill_switch": bool(user.auto_kill_switch),
        "symbols": user.auto_trade_symbols or [],
        "risk_level": user.risk_level,
        "max_trade_size_usd": user.max_trade_size_usd,
        "daily_loss_limit_usd": user.daily_loss_limit_usd,
    }
