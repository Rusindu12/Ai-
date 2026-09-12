"""FastAPI entry point for the AI crypto trading backend.

Run locally::

    uvicorn app.main:app --reload --port 8000
    python -m app.main                 # same thing, reads .env

What happens at startup (``lifespan``)::

    1. configure logging (+ optional Sentry)
    2. ensure the DB schema (Postgres in prod, SQLite for dev/tests)
    3. build the exchange gateway (Binance REST client, or the simulator)
    4. start the MarketDataHub (REST warm-up + WebSocket ingestion)
    5. wire the RealtimeHub (per-socket fan-out) and services
    6. start the alert engine, TP/SL monitor, AI auto-trader and scheduler
    7. optionally mount the Socket.IO bridge for web dashboards

Shutdown cancels every background task cleanly and disposes the engine/pool.
"""

from __future__ import annotations

import contextlib
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import APP_VERSION
from app.api import (
    routes_account,
    routes_ai,
    routes_alerts,
    routes_auth,
    routes_auto,
    routes_health,
    routes_keys,
    routes_market,
    routes_orders,
    routes_settings,
    routes_ws,
)
from app.config import settings
from app.db.base import dispose_db, init_db
from app.errors import BackendError, RateLimitedError, configure_logging
from app.services.auto_trader import auto_trader
from app.services.market_data import MarketDataHub
from app.services.notifications import notification_service
from app.services.portfolio import portfolio_service
from app.services.realtime import realtime_hub
from app.services.trading import trading_service
from app.telemetry import metrics

log = logging.getLogger(__name__)

TAGS_METADATA = [
    {"name": "auth", "description": "Signup, login (email/Google/Firebase/biometric), sessions, 2FA."},
    {"name": "keys", "description": "Encrypted Binance API key enrolment. Keys are stored as ciphertext only."},
    {"name": "market", "description": "Live prices, candles, order book, symbols, watchlist - served from cache."},
    {"name": "account", "description": "Balances, portfolio valuation, positions, CSV export."},
    {"name": "orders", "description": "Place / preview / cancel orders, order + trade history."},
    {"name": "ai", "description": "Signals, sentiment, indicators, models, training and backtesting."},
    {"name": "ai-trading", "description": "Auto-trading configuration, decision log, performance, STOP ALL."},
    {"name": "alerts", "description": "Price / percent alerts and notification history."},
    {"name": "settings", "description": "Theme, locale, security and trading defaults."},
    {"name": "realtime", "description": "WebSocket channel contract for live data."},
    {"name": "ops", "description": "Health, readiness, status and Prometheus metrics."},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(settings.LOG_LEVEL, json_logs=settings.is_prod)
    app.state.metrics = metrics
    started = time.time()
    log.info(
        "starting %s v%s (env=%s demo_mode=%s)", settings.APP_NAME, APP_VERSION, settings.ENV, settings.DEMO_MODE
    )
    for problem in settings.validate_runtime():
        log.warning("config: %s", problem)

    if settings.SENTRY_DSN:  # pragma: no cover - optional
        try:
            import sentry_sdk

            sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.1, environment=settings.ENV)
        except ImportError:
            log.info("sentry-sdk not installed, skipping")

    await init_db()

    from app.services.gateway import close_gateway, get_gateway

    gateway = await get_gateway()
    hub = MarketDataHub(gateway)
    app.state.gateway = gateway
    app.state.hub = hub
    app.state.realtime = realtime_hub
    app.state.notifications = notification_service
    app.state.trading = trading_service
    app.state.portfolio = portfolio_service
    app.state.auto_trader = auto_trader

    # wire services to the hub (single source of truth for live data)
    trading_service.attach_hub(hub)
    portfolio_service.attach_hub(hub)
    notification_service.attach_hub(hub)
    auto_trader.attach_hub(hub)
    auto_trader.gateway = gateway
    realtime_hub.attach_market_hub(hub)

    await hub.start()

    from app.services.alerts import AlertEngine

    alert_engine = AlertEngine(hub)
    app.state.alerts = alert_engine
    await alert_engine.start()
    await auto_trader.start()

    from app.scheduler import build_scheduler

    scheduler = build_scheduler(hub, auto_trader)
    app.state.scheduler = scheduler
    await scheduler.start()

    socketio_app = None
    if settings.ENABLE_SOCKETIO:
        try:
            from app.socketio_app import build_socketio_app

            socketio_app = build_socketio_app(hub, realtime_hub)
            app.mount("/ws-io", socketio_app)
            log.info("Socket.IO bridge mounted at /ws-io")
        except Exception as exc:
            log.warning("Socket.IO bridge unavailable (%s) - native /ws still works", exc)

    log.info("backend ready in %.2fs - docs at /docs, ws at /ws", time.time() - started)
    try:
        yield
    finally:
        log.info("shutting down")
        await scheduler.stop()
        await alert_engine.stop()
        await auto_trader.stop()
        await hub.stop()
        if socketio_app is not None:
            with contextlib.suppress(Exception):
                await socketio_app.engineio_server.shutdown()  # type: ignore[attr-defined]
        await close_gateway()
        await dispose_db()
        log.info("shutdown complete")


def create_app(*, extra_routers: list[Any] | None = None) -> FastAPI:
    app = FastAPI(
        title="AI Crypto Trading Backend",
        description=(
            "Backend for the Flutter Android app: Binance market relay, order "
            "execution, AI signals, auto-trading, alerts and real-time WebSocket "
            "streaming.  The mobile app talks **only** to this service - the "
            "exchange keys never leave the server."
        ),
        version=APP_VERSION,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        contact={"name": "CryptoTrader Backend", "url": "https://github.com/Rusindu12/Ai-"},
    )

    app.add_middleware(GZipMiddleware, minimum_size=800)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials="*" not in settings.CORS_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Id", "X-Integrity-Token", "X-Integrity-Nonce", "X-Request-Id"],
        expose_headers=["X-Request-Id", "X-RateLimit-Remaining"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        start = time.perf_counter()
        request_id = request.headers.get("X-Request-Id") or f"req{int(time.time() * 1000) % 1_000_000:x}"
        try:
            response = await call_next(request)
        except Exception:
            metrics.inc("http.errors", path=request.url.path)
            raise
        duration = time.perf_counter() - start
        metrics.observe("http.request", duration, path=request.url.path)
        metrics.inc("http.requests", status=response.status_code // 100)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Server-Time-Ms"] = str(int(time.time() * 1000))
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    for module in (
        routes_health,
        routes_auth,
        routes_keys,
        routes_market,
        routes_account,
        routes_orders,
        routes_ai,
        routes_auto,
        routes_alerts,
        routes_settings,
        routes_ws,
    ):
        app.include_router(module.router)
    for extra in extra_routers or []:
        app.include_router(extra)

    @app.exception_handler(BackendError)
    async def _backend_error(request: Request, exc: BackendError) -> JSONResponse:
        payload: dict[str, Any] = {"error": exc.error_code, "message": exc.message}
        if exc.details:
            payload["details"] = exc.details
        headers = {}
        if isinstance(exc, RateLimitedError):
            headers["Retry-After"] = str(int(getattr(exc, "retry_after_s", 1)))
        return JSONResponse(status_code=exc.status_code, content=payload, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "validation_error",
                "message": "request body did not match the schema",
                "details": {"errors": _jsonable(exc.errors())},
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": _code_for(exc.status_code), "message": str(exc.detail)})

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:  # pragma: no cover - safety net
        log.exception("unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"error": "internal_error", "message": "internal server error"})

    @app.get("/", tags=["ops"])
    async def root() -> dict[str, Any]:
        return {
            "service": settings.APP_NAME,
            "version": APP_VERSION,
            "docs": "/docs",
            "openapi": "/openapi.json",
            "websocket": "/ws",
            "health": "/health",
            "demo_mode": settings.DEMO_MODE,
            "quickstart": {
                "signup": "POST /api/auth/signup {email,password}",
                "login": "POST /api/auth/login {email,password}",
                "prices": "GET /api/prices",
                "signal": "GET /api/ai/signal/BTCUSDT?interval=1m",
            },
        }

    return app


def _code_for(status: int) -> str:
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        405: "method_not_allowed",
        429: "rate_limited",
        500: "internal_error",
        502: "upstream_error",
        503: "unavailable",
    }.get(status, "error")


def _jsonable(items: Any) -> Any:
    try:
        import json

        return json.loads(json.dumps(items, default=str))
    except Exception:  # pragma: no cover
        return [{"msg": str(i)} for i in items]


app = create_app()


def main() -> None:  # pragma: no cover - manual entry
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG and not settings.is_prod,
        log_level=settings.LOG_LEVEL.lower(),
        ws_ping_interval=settings.WS_HEARTBEAT_S,
        ws_ping_timeout=20,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
