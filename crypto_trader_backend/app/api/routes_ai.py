"""AI endpoints: signals, sentiment, indicators, models, training, backtesting.

    GET  /api/ai/signal/{symbol}          BUY/SELL/HOLD + confidence + reason + plan
    GET  /api/ai/signals                  every tracked symbol at once
    GET  /api/ai/sentiment                market-wide bullish/bearish badge
    GET  /api/ai/indicators/{symbol}/{iv} raw indicator series for chart overlays
    GET  /api/ai/models                   active model version + metrics
    GET  /api/ai/history/{symbol}         persisted past signals (+ outcomes)
    POST /api/ai/train                    train now (admin only in prod)
    POST /api/ai/backtest                 vectorised backtest with metrics
    GET  /api/ai/strategies               available strategies
    POST /api/ai/signal/{symbol}/execute  act on a signal (AI trade button)
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_hub, get_trading, rate_limit
from app.api.schemas import BacktestRequest, OrderCreate, TrainRequest
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import ValidationError_

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(rate_limit)])

_TRAIN_LOCK = asyncio.Lock()


@router.get("/signal/{symbol}")
async def signal(
    symbol: str,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    hub: Any = Depends(get_hub),
    interval: str = Query(default="1m"),
    bars: int = Query(default=400, ge=120, le=1000),
    persist: bool = Query(default=True),
) -> dict[str, Any]:
    from app.ai.registry import registry
    from app.ai.signals import build_signal

    bundle = registry.ensure_loaded()
    candles = await hub.get_candles(symbol.upper(), interval, max(bars, bundle.look_back + 20))
    if len(candles) < 60:
        await hub.refresh_symbol(symbol.upper())
        candles = await hub.get_candles(symbol.upper(), interval, max(bars, bundle.look_back + 20))
    if len(candles) < 60:
        raise ValidationError_(f"not enough candles for {symbol} {interval} (got {len(candles)})")

    equity = await _equity_for(user, session)
    result = build_signal(
        candles, symbol, interval=interval, bundle=bundle, balance_hint=equity, risk_level=user.risk_level
    )
    payload = result.as_dict()
    payload["account"] = {"equity_usd": round(equity, 2), "risk_level": user.risk_level, "paper_trading": user.paper_trading}
    if persist:
        await repo.save_signal(
            session,
            signal_id=result.signal_id,
            user_id=user.id,
            symbol=symbol.upper(),
            action=result.action,
            confidence=round(result.confidence, 2),
            reason=result.reason[:1000],
            indicators={k: v for k, v in payload["indicators"].items() if k != "indicator_series"},
            model_version=result.model_version,
            price_at_signal=result.price,
        )
        await session.commit()
    request.app.state.metrics.inc("ai.signal", action=result.action)
    return payload


@router.get("/signals")
async def signals_all(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    hub: Any = Depends(get_hub),
    interval: str = Query(default="15m"),
    symbols: str | None = Query(default=None),
) -> dict[str, Any]:
    """Batch signals for the dashboard / pair list (computed in parallel)."""
    from app.ai.registry import registry
    from app.ai.signals import build_signal

    wanted = [s.strip().upper() for s in symbols.split(",")] if symbols else list(hub.symbols)
    bundle = registry.ensure_loaded()
    equity = await _equity_for(user, session)

    async def one(sym: str) -> dict[str, Any]:
        try:
            candles = await hub.get_candles(sym, interval, max(300, bundle.look_back + 20))
            if len(candles) < 60:
                return {"symbol": sym, "action": "HOLD", "confidence": 0.0, "reason": "insufficient history", "error": True}
            res = build_signal(candles, sym, interval=interval, bundle=bundle, balance_hint=equity, risk_level=user.risk_level)
            d = res.as_dict()
            return {
                "symbol": sym,
                "action": d["action"],
                "confidence": d["confidence"],
                "reason": d["reason"],
                "score": d["score"],
                "price": d["price"],
                "signal_id": d["signal_id"],
                "trade_plan": d["trade_plan"],
                "models": {k: v for k, v in d["models"].items() if k in ("classifier_action", "classifier_confidence", "lstm_pred_return")},
            }
        except Exception as exc:  # pragma: no cover - per-symbol isolation
            log.debug("signal failed for %s: %s", sym, exc)
            return {"symbol": sym, "action": "HOLD", "confidence": 0.0, "reason": f"error: {type(exc).__name__}", "error": True}

    rows = await asyncio.gather(*(one(s) for s in wanted))
    counts = {a: len([r for r in rows if r["action"] == a]) for a in ("BUY", "SELL", "HOLD")}
    return {"interval": interval, "count": len(rows), "signals": list(rows), "counts": counts, "model_version": bundle.version}


@router.get("/sentiment")
async def sentiment(hub: Any = Depends(get_hub), interval: str = Query(default="15m"), limit: int = Query(default=10, ge=3, le=25)) -> dict[str, Any]:
    from app.ai.signals import build_signal, summarise_market

    rows = hub.all_ticker_rows()
    symbols = [r["symbol"] for r in rows][:limit]

    async def one(sym: str) -> dict[str, Any] | None:
        try:
            candles = await hub.get_candles(sym, interval, 300)
            if len(candles) < 80:
                return None
            res = build_signal(candles, sym, interval=interval)
            return {"symbol": sym, "action": res.action, "confidence": res.confidence, "score": res.score}
        except Exception:
            return None

    computed = [r for r in await asyncio.gather(*(one(s) for s in symbols)) if r]
    payload = summarise_market(rows, {r["symbol"]: r for r in computed})
    payload["per_symbol"] = computed
    payload["note"] = "aggregate of trend/momentum/volume + model votes across the tracked universe"
    return payload


@router.get("/indicators/{symbol}/{interval}")
async def indicators(symbol: str, interval: str, limit: int = Query(default=300, ge=60, le=1000), hub: Any = Depends(get_hub)) -> dict[str, Any]:
    from app.ai import indicators as ind

    candles = await hub.get_candles(symbol.upper(), interval.lower(), limit)
    if len(candles) < 60:
        raise ValidationError_(f"need >= 60 candles, have {len(candles)}")
    snap = ind.compute(candles, symbol.upper(), interval.lower())
    payload = snap.as_dict()
    payload.update({"symbol": symbol.upper(), "interval": interval.lower(), "count": len(candles), "candles_tail": candles[-120:]})
    return payload


@router.get("/models")
async def models() -> dict[str, Any]:
    from app.ai.registry import registry

    registry.ensure_loaded()
    return {"active": registry.status(), "retrain_policy": {"days": settings.AI_RETRAIN_DAYS, "auto": True}, "model_dir": settings.AI_MODEL_DIR}


@router.get("/history/{symbol}")
async def history(symbol: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session), limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    rows = list(await repo.recent_signals(session, user.id, symbol=symbol.upper(), limit=limit))
    return {
        "count": len(rows),
        "signals": [
            {
                "signal_id": r.signal_id,
                "symbol": r.symbol,
                "action": r.action,
                "confidence": r.confidence,
                "reason": r.reason,
                "price_at_signal": r.price_at_signal,
                "acted_on": r.acted_on,
                "model_version": r.model_version,
                "created_at_ms": r.created_at_ms,
            }
            for r in rows
        ],
    }


@router.post("/train")
async def train(body: TrainRequest, request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    """Fit LSTM + classifier now.  Serialized so concurrent calls don't clash."""
    if _TRAIN_LOCK.locked():
        raise ValidationError_("a training run is already in progress", details={"retry_after_s": 30})
    async with _TRAIN_LOCK:
        from app.ai.train import train_models

        started = time.time()
        report = await train_models(
            symbols=body.symbols or None,
            interval=body.interval,
            bars=body.bars,
            look_back=body.look_back,
            horizon=body.horizon,
            hidden=body.hidden,
            epochs_lstm=body.epochs_lstm,
            epochs_clf=body.epochs_clf,
            publish=body.publish,
        )
        request.app.state.metrics.inc("ai.train")
        return {"ok": True, "seconds": round(time.time() - started, 2), "report": dict(report)}


@router.post("/backtest")
async def backtest(body: BacktestRequest, user: User = Depends(current_user)) -> dict[str, Any]:
    from app.ai.backtest import run_backtest

    res = await run_backtest(
        symbol=body.symbol,
        interval=body.interval,
        bars=body.bars,
        strategy=body.strategy,
        start_equity=body.start_equity,
        risk_per_trade=body.risk_per_trade,
        max_position_pct=body.max_position_pct,
        atr_sl_mult=body.atr_sl_mult,
        atr_tp_mult=body.atr_tp_mult,
        allow_short=body.allow_short,
        optimistic=body.optimistic,
    )
    return res.as_dict(include_curve=body.include_curve)


@router.get("/strategies")
async def strategies() -> dict[str, Any]:
    from app.strategies import describe

    return {"strategies": describe()}


@router.post("/signal/{symbol}/execute")
async def execute_signal(
    symbol: str,
    request: Request,
    body: dict[str, Any],
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    trading: Any = Depends(get_trading),
) -> dict[str, Any]:
    """The "AI trade" button: place the order the signal recommends."""
    from app.ai.registry import registry
    from app.ai.signals import build_signal

    interval = str(body.get("interval", "1m"))
    hub = request.app.state.hub
    signal_id = body.get("signal_id")
    candles = await hub.get_candles(symbol.upper(), interval, 400)
    result = build_signal(candles, symbol, interval=interval, bundle=registry.ensure_loaded(), balance_hint=await _equity_for(user, session), risk_level=user.risk_level)
    if signal_id and result.signal_id != signal_id:
        log.info("executing recomputed signal for %s (client had %s)", symbol, signal_id)
    if result.action == "HOLD":
        return {"executed": False, "reason": "AI currently says HOLD", "signal": result.as_dict()}

    plan = result.plan or {}
    qty = float(body.get("quantity") or plan.get("suggested_qty") or 0.0)
    if qty <= 0:
        raise ValidationError_("no tradeable size in the AI plan (check your balance and limits)")
    order = OrderCreate(
        symbol=symbol.upper(),
        side=result.action,
        order_type="MARKET",
        quantity=qty,
        take_profit=plan.get("take_profit"),
        stop_loss=plan.get("stop_loss"),
        source="ai",
        ai_signal_id=result.signal_id,
        confidence=result.confidence,
        use_paper=body.get("use_paper"),
    )
    order_payload = _to_ai_request(order, result)
    outcome = await trading.place_order(session, user, order_payload)
    await session.commit()
    return {"executed": True, "signal": {"action": result.action, "confidence": result.confidence, "reason": result.reason}, "order": outcome}


def _to_ai_request(order: OrderCreate, result: Any):
    from app.services.trading import OrderRequest

    return OrderRequest(
        symbol=order.symbol,
        side=order.side,
        order_type=order.order_type,
        quantity=order.quantity,
        price=order.price,
        take_profit=order.take_profit,
        stop_loss=order.stop_loss,
        source="ai",
        ai_signal_id=result.signal_id,
        confidence=result.confidence,
        use_paper=order.use_paper,
    )


async def _equity_for(user: User, session: AsyncSession) -> float:
    from app.services.portfolio import portfolio_service

    try:
        snap = await portfolio_service.build(session, user, include_series=False)
        return float(snap.get("total_value_usd") or 0.0)
    except Exception:
        return 10_000.0
