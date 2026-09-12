"""Optional Socket.IO bridge (web dashboards / third party integrations).

The mobile app uses the native ``/ws`` endpoint (fewer moving parts, better
resume behaviour on Android).  Some teams still want Socket.IO rooms, so this
module mounts an ``python-socketio`` ASGI app alongside the FastAPI app at
``/ws-io`` when ``ENABLE_SOCKETIO=true``.

Events mirror the native protocol exactly, so a web client and the app see the
same payloads.  Requires ``python-socketio>=5`` (installed on demand).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)


def build_socketio_app(hub: Any, realtime: Any) -> Any:
    import socketio

    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=settings.CORS_ORIGINS if "*" not in settings.CORS_ORIGINS else "*",
        ping_interval=settings.WS_HEARTBEAT_S,
        ping_timeout=20,
        max_http_buffer_size=2**20,
    )
    app = socketio.ASGIApp(sio, socketio_path="socket.io")
    pumps: dict[str, asyncio.Task[None]] = {}

    async def _pump(sid: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            while True:
                msg = await queue.get()
                await sio.emit(msg.pop("type", "message"), msg, room=sid)
        except asyncio.CancelledError:
            pass
        except Exception:  # pragma: no cover
            log.debug("socketio pump %s stopped", sid, exc_info=True)

    @sio.event
    async def connect(sid: str, environ: dict, auth: dict | None = None) -> bool:
        token = (auth or {}).get("token")
        if token:
            try:
                from app.services.realtime import realtime_hub as rh

                await rh._verify(token)
            except Exception:
                log.info("socketio %s rejected: bad token", sid)
                return False
        log.info("socketio connected %s", sid)
        return True

    @sio.event
    async def disconnect(sid: str) -> None:
        task = pumps.pop(sid, None)
        if task is not None:
            task.cancel()

    @sio.event
    async def subscribe(sid: str, data: dict[str, Any]) -> dict[str, Any]:
        symbols = {str(s).upper() for s in (data or {}).get("symbols", []) if s}
        queue = hub.subscribe(symbols or None)
        task = pumps.get(sid)
        if task is not None:
            task.cancel()
        pumps[sid] = asyncio.create_task(_pump(sid, queue))
        await sio.enter_room(sid, f"sym:{next(iter(symbols))}" if len(symbols) == 1 else sid)
        tickers = hub.all_ticker_rows(symbols or None)
        await sio.emit("snapshot", {"tickers": tickers[:40]}, room=sid)
        return {"subscribed": sorted(symbols) or ["*"], "symbols": len(symbols or hub.symbols)}

    @sio.event
    async def unsubscribe(sid: str, _data: dict[str, Any] | None = None) -> dict[str, Any]:
        task = pumps.pop(sid, None)
        if task is not None:
            task.cancel()
        return {"subscribed": []}

    @sio.event
    async def ping(_sid: str, data: Any = None) -> dict[str, Any]:
        import time

        return {"pong": int(time.time() * 1000), "echo": data}

    return app
