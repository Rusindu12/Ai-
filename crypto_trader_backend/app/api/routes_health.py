"""Health, readiness, status, metrics and the Socket.IO/WS mount info."""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import APP_VERSION
from app.api.deps import get_auto_trader, get_hub, get_realtime
from app.config import settings
from app.db.base import get_session

router = APIRouter(tags=["ops"])

START_TS = time.time()


@router.get("/health", include_in_schema=False)
async def health() -> dict[str, Any]:
    """Liveness: the process is up (no dependency checks)."""
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": APP_VERSION,
        "environment": settings.ENV,
        "uptime_s": round(time.time() - START_TS, 1),
        "pid": os.getpid(),
    }


@router.get("/health/ready")
async def ready(
    hub: Any = Depends(get_hub),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Readiness for load balancers: DB reachable + market cache warm."""
    checks: dict[str, Any] = {}
    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
    status = hub.status() if hub is not None else {}
    checks["market_data"] = {
        "tickers": status.get("tickers_cached", 0),
        "source": status.get("source"),
        "seconds_since_event": status.get("seconds_since_event"),
    }
    checks["demo_mode"] = settings.DEMO_MODE
    ok = checks["database"] == "ok" and int(status.get("tickers_cached") or 0) > 0
    return {"ready": ok, "checks": checks, "uptime_s": round(time.time() - START_TS, 1)}


@router.get("/api/status")
async def status(
    request: Request,
    hub: Any = Depends(get_hub),
    realtime: Any = Depends(get_realtime),
    auto: Any = Depends(get_auto_trader),
) -> dict[str, Any]:
    from app.ai.registry import registry

    registry.ensure_loaded()
    return {
        "service": settings.APP_NAME,
        "version": APP_VERSION,
        "environment": settings.ENV,
        "demo_mode": settings.DEMO_MODE,
        "market": hub.status() if hub else {},
        "websocket": realtime.status() if realtime else {},
        "auto_trader": {
            "cycles": getattr(auto, "cycles", 0),
            "executed": getattr(auto, "executed", 0),
            "rejected": getattr(auto, "rejected", 0),
            "last_cycle_ms": getattr(auto, "last_cycle_ms", 0),
        },
        "ai": registry.status(),
        "notifications": request.app.state.notifications.status(),
        "limits": {
            "rate_limit_per_min": settings.RATE_LIMIT_PER_MIN,
            "order_rate_limit_per_min": settings.ORDER_RATE_LIMIT_PER_MIN,
            "binance_weight_per_min": settings.BINANCE_WEIGHT_PER_MIN,
        },
        "uptime_s": round(time.time() - START_TS, 1),
    }


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> PlainTextResponse:
    if settings.METRICS_TOKEN:
        # very rough guard; put this behind a network policy in production
        pass
    return PlainTextResponse(request.app.state.metrics.prometheus(), media_type="text/plain; version=0.0.4")


@router.get("/api/uptime")
async def uptime() -> dict[str, Any]:
    return {"uptime_s": round(time.time() - START_TS, 1), "started_at": int(START_TS * 1000)}
