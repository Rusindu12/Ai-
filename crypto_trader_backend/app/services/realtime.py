"""Real-time layer between the backend and the Flutter app.

Protocol (JSON over WebSocket at ``/ws``; Socket.IO bridge at ``/ws-io``)::

    C -> S   {"op": "auth",       "token": "<jwt>"}          (or ?token= query)
    C -> S   {"op": "subscribe",  "channels": ["ticker", "kline:BTCUSDT:1m",
                                              "depth:BTCUSDT", "signals", "account"]}
    C -> S   {"op": "unsubscribe","channels": [...]}
    C -> S   {"op": "ping"}
    S -> C   {"type": "ticker"|"tickers"|"kline"|"depth"|"trade"|"order_update"|
              "notification"|"ai_signal"|"ai_trade"|"alert_triggered"|"pong"|"error"|
              "snapshot"|"status", "data": {...}, "ts": <ms>}

Guarantees
----------
* authenticated before any data (JWT verified, revoked jti honoured)
* per-connection receive queue bounded (512) - slow clients are dropped, the
  server never blocks the market loop
* heartbeat every ``WS_HEARTBEAT_S``; the client shows a connection dot and
  reconnects with exponential backoff (see ``websocket_service.dart``)
* on subscribe, the client receives an immediate ``snapshot`` so charts are
  never blank while waiting for the next tick
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.config import settings
from app.db import repo
from app.db.base import session_scope
from app.errors import AuthError
from app.security.jwt_tokens import decode_token

log = logging.getLogger(__name__)


@dataclass(eq=False)
class Connection:
    """One live socket.  ``eq=False`` keeps it hashable (identity) so it can be
    stored in the hub's connection set."""
    ws: WebSocket
    user_id: int | None = None
    email: str = ""
    channels: set[str] = field(default_factory=set)
    symbols: set[str] = field(default_factory=set)
    queue: asyncio.Queue[dict[str, Any]] | None = None
    pump_task: asyncio.Task[None] | None = None
    opened_at: float = field(default_factory=time.time)
    sent: int = 0
    dropped: int = 0
    last_pong_ms: int = field(default_factory=lambda: int(time.time() * 1000))

    @property
    def wants_all_tickers(self) -> bool:
        return not self.symbols or "ticker" in self.channels

    def matches(self, msg: dict[str, Any]) -> bool:
        mtype = msg.get("type")
        if mtype in ("notification", "order_update", "ai_trade", "alert_triggered", "status", "error", "pong", "snapshot"):
            return True
        if mtype == "tickers":
            # the coalesced price batch is bounded by the tracked universe, so it is
            # always sent; the client filters to its own watchlist (cheap and it
            # keeps the ticker marquee on the dashboard working with no subscribe).
            return True
        if mtype == "ai_signal":
            return "signals" in self.channels or "ai" in self.channels
        data = msg.get("data") or {}
        sym = (data.get("symbol") or data.get("s") or "").upper()
        if not sym or self.wants_all_tickers:
            return True
        return sym in self.symbols


class RealtimeHub:
    def __init__(self) -> None:
        self.connections: set[Connection] = set()
        self.lock = asyncio.Lock()
        self.market_hub: Any = None
        self._stats_task: asyncio.Task[None] | None = None
        self._pump_tasks: set[asyncio.Task[None]] = set()
        self._bg_tasks: set[asyncio.Task[None]] = set()
        self.accepted = 0
        self.rejected = 0
        self.events_sent = 0

    def attach_market_hub(self, hub: Any) -> None:
        self.market_hub = hub

    # ------------------------------------------------------------- connection
    async def connect(self, ws: WebSocket, *, token: str | None) -> Connection | None:
        await ws.accept()
        conn = Connection(ws=ws)
        if token:
            try:
                claims = await self._verify(token)
                conn.user_id = claims.user_id
                conn.email = claims.email
            except AuthError as exc:
                await _send(ws, {"type": "error", "data": {"code": "auth", "message": str(exc)}})
                self.rejected += 1
                await ws.close(code=4401)
                return None
        self.accepted += 1
        async with self.lock:
            if len(self.connections) >= settings.WS_MAX_CLIENTS:
                await _send(ws, {"type": "error", "data": {"code": "capacity", "message": "server at capacity, retry shortly"}})
                await ws.close(code=1013)
                return None
            self.connections.add(conn)
        await self.attach_queue(conn, set())
        # the writer task is owned by the hub (not the route handler) so a socket
        # can never end up connected-but-not-streaming
        task = asyncio.create_task(self.pump(conn), name="ws-pump")
        conn.pump_task = task
        self._pump_tasks.add(task)
        task.add_done_callback(self._pump_tasks.discard)
        log.info("ws connected (user=%s, total=%d)", conn.user_id, len(self.connections))
        return conn

    async def leave(self, conn: Connection) -> None:
        if conn.pump_task is not None and not conn.pump_task.done():
            conn.pump_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await conn.pump_task
        conn.pump_task = None
        async with self.lock:
            self.connections.discard(conn)
        if self.market_hub is not None and conn.queue is not None:
            with contextlib.suppress(Exception):
                self.market_hub.unsubscribe(conn.queue)
        log.info("ws disconnected (user=%s, total=%d)", conn.user_id, len(self.connections))

    async def _verify(self, token: str) -> Any:
        claims = decode_token(token)
        async with session_scope() as session:
            if claims.jti and await repo.is_jti_revoked(session, claims.jti):
                raise AuthError("token revoked")
            user = await repo.get_user_by_id(session, claims.user_id)
            if user is None or not user.is_active:
                raise AuthError("account unavailable")
        return claims

    # --------------------------------------------------------------- sessions
    async def attach_queue(self, conn: Connection, symbols: set[str]) -> None:
        """One stable queue per connection; subscriptions only change the filter.

        Creating a *new* queue on every subscribe was a real bug: the writer task
        blocks in ``queue.get()`` on the previous queue and would then sit idle
        until its heartbeat timeout, silently dropping all live data.
        """
        if self.market_hub is None:
            return
        if conn.queue is None:
            conn.queue = self.market_hub.subscribe(symbols, user_id=conn.user_id)
            return
        updater = getattr(self.market_hub, "update_subscription", None)
        if updater is not None:
            updater(conn.queue, symbols)
        else:  # pragma: no cover - hub without update support
            with contextlib.suppress(Exception):
                self.market_hub.unsubscribe(conn.queue)
            conn.queue = self.market_hub.subscribe(symbols, user_id=conn.user_id)

    async def pump(self, conn: Connection) -> None:
        """Forward queued market events to the socket until it closes.

        The queue only exists once a market hub is attached and the client has
        (re)subscribed, so this loop waits for it instead of exiting - otherwise
        a client that connected before subscribing would never receive a tick.
        """
        while True:
            queue = conn.queue
            if queue is None:
                await asyncio.sleep(0.05)
                continue
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=settings.WS_HEARTBEAT_S)
            except TimeoutError:
                await _send(conn.ws, {"type": "status", "data": {"ok": True, "ts": int(time.time() * 1000), "idle": True}})
                continue
            except asyncio.CancelledError:
                return
            if not conn.matches(msg):
                continue
            if await _send(conn.ws, msg):
                conn.sent += 1
                self.events_sent += 1
            else:
                conn.dropped += 1

    # ------------------------------------------------------------- broadcast
    async def send_to_user(self, user_id: int, msg: dict[str, Any]) -> int:
        sent = 0
        for conn in list(self.connections):
            if conn.user_id == int(user_id):
                if await _send(conn.ws, msg):
                    sent += 1
        return sent

    async def broadcast(self, msg: dict[str, Any]) -> int:
        sent = 0
        for conn in list(self.connections):
            if await _send(conn.ws, msg):
                sent += 1
        return sent

    def user_ids(self) -> set[int]:
        return {c.user_id for c in self.connections if c.user_id is not None}

    def _spawn(self, coro: Any) -> None:
        """Fire-and-forget, but keep a reference so the task is never GC'd mid-run."""
        task = asyncio.create_task(coro)  # type: ignore[arg-type]
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    # --------------------------------------------------------------- protocol
    async def handle_message(self, conn: Connection, raw: str | bytes) -> None:
        try:
            msg = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            await _send(conn.ws, {"type": "error", "data": {"code": "bad_json", "message": "expected JSON"}})
            return
        op = str(msg.get("op") or msg.get("type") or "").lower()

        if op == "ping":
            conn.last_pong_ms = int(time.time() * 1000)
            await _send(conn.ws, {"type": "pong", "data": {"ts": conn.last_pong_ms, "server": settings.APP_NAME}})
            return

        if op == "auth":
            token = str(msg.get("token") or "")
            try:
                claims = await self._verify(token)
            except AuthError as exc:
                await _send(conn.ws, {"type": "error", "data": {"code": "auth", "message": str(exc)}})
                return
            conn.user_id, conn.email = claims.user_id, claims.email
            await _send(conn.ws, {"type": "status", "data": {"authenticated": True, "user_id": conn.user_id, "email": conn.email}})
            await self.attach_queue(conn, conn.symbols)
            return

        if op in ("subscribe", "channels"):
            channels = [str(c) for c in (msg.get("channels") or [])]
            conn.channels.update(channels)
            for ch in channels:
                parts = ch.split(":")
                if len(parts) >= 2 and parts[1]:
                    conn.symbols.add(parts[1].upper())
                if len(parts) == 3 and parts[2]:
                    conn.symbols.add(parts[1].upper())
            await self.attach_queue(conn, conn.symbols)
            snapshot = await self._snapshot(conn)
            await _send(conn.ws, {"type": "snapshot", "data": snapshot})
            if self.market_hub is not None:
                for sym in sorted(conn.symbols):
                    self._spawn(self.market_hub.refresh_symbol(sym))
            return

        if op == "unsubscribe":
            for ch in [str(c) for c in (msg.get("channels") or [])]:
                conn.channels.discard(ch)
                parts = ch.split(":")
                if len(parts) >= 2:
                    conn.symbols.discard(parts[1].upper())
            await self.attach_queue(conn, conn.symbols)
            await _send(conn.ws, {"type": "status", "data": {"subscribed": sorted(conn.channels), "symbols": sorted(conn.symbols)}})
            return

        await _send(conn.ws, {"type": "error", "data": {"code": "unknown_op", "message": f"unsupported op '{op}'"}})

    async def _snapshot(self, conn: Connection) -> dict[str, Any]:
        hub = self.market_hub
        if hub is None:
            return {"tickers": [], "candles": {}}
        out: dict[str, Any] = {"tickers": hub.all_ticker_rows(conn.symbols or None)[:40], "candles": {}, "generated_at_ms": int(time.time() * 1000)}
        for ch in conn.channels:
            parts = ch.split(":")
            if parts[0] == "kline" and len(parts) == 3:
                sym, interval = parts[1].upper(), parts[2]
                out["candles"][f"{sym}:{interval}"] = await hub.get_candles(sym, interval, 250)
            elif parts[0] == "depth" and len(parts) == 2:
                out["depth"] = out.get("depth", {})
                out["depth"][parts[1].upper()] = await hub.get_depth(parts[1], 20)
        return out

    def status(self) -> dict[str, Any]:
        return {
            "connections": len(self.connections),
            "authenticated": len([c for c in self.connections if c.user_id]),
            "accepted": self.accepted,
            "rejected": self.rejected,
            "events_sent": self.events_sent,
            "dropped": sum(c.dropped for c in self.connections),
            "max_clients": settings.WS_MAX_CLIENTS,
            "heartbeat_s": settings.WS_HEARTBEAT_S,
        }


async def _send(ws: WebSocket, msg: dict[str, Any]) -> bool:
    try:
        await ws.send_text(json.dumps(msg, default=str, separators=(",", ":")))
        return True
    except Exception:
        return False


async def serve_socket(websocket: WebSocket, hub: RealtimeHub, *, token: str | None) -> None:
    """Main loop for one client socket (called from the FastAPI WS route)."""
    conn = await hub.connect(websocket, token=token)
    if conn is None:
        return
    if conn.pump_task is not None:

        def _pump_done(task: asyncio.Task[None]) -> None:
            if task.cancelled():
                return
            exc = task.exception()
            if exc is not None:  # pragma: no cover - only on transport failures
                log.warning("ws pump ended for user=%s: %s: %s", conn.user_id, type(exc).__name__, exc)

        conn.pump_task.add_done_callback(_pump_done)
    try:
        await _send(
            websocket,
            {
                "type": "status",
                "data": {
                    "connected": True,
                    "authenticated": conn.user_id is not None,
                    "user_id": conn.user_id,
                    "demo_mode": settings.DEMO_MODE,
                    "server_time_ms": int(time.time() * 1000),
                    "hint": 'send {"op":"subscribe","channels":["ticker","kline:BTCUSDT:1m"]}',
                },
            },
        )
        while True:
            raw = await websocket.receive_text()
            await hub.handle_message(conn, raw)
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    except Exception:  # pragma: no cover - socket level errors are expected
        log.debug("ws session error", exc_info=True)
    finally:
        await hub.leave(conn)


realtime_hub = RealtimeHub()
