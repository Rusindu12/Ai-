"""Realtime layer: protocol handling, auth gating, fan-out and back-pressure.

The socket is exercised with a fake Starlette WebSocket so the tests stay fast
and deterministic (no ports, no network).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any

import pytest
from app.services.realtime import Connection, RealtimeHub


class FakeWebSocket:
    def __init__(self, incoming: list[Any] | None = None) -> None:
        self.sent: list[dict] = []
        self.closed_code: int | None = None
        self.accepted = False
        self._incoming = asyncio.Queue()
        for item in incoming or []:
            self._incoming.put_nowait(item)

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))

    async def receive_text(self) -> str:
        item = await self._incoming.get()
        if isinstance(item, Exception):
            raise item
        return item if isinstance(item, str) else json.dumps(item)

    async def close(self, code: int = 1000) -> None:
        self.closed_code = code

    def types(self) -> list[str]:
        return [m["type"] for m in self.sent]

    def last(self, type_: str) -> dict | None:
        for msg in reversed(self.sent):
            if msg["type"] == type_:
                return msg
        return None


class StubHub:
    """Minimal market-hub double: records subscriptions, replays canned events."""

    def __init__(self) -> None:
        self.queues: dict[Any, set[str]] = {}
        self.users: dict[Any, int | None] = {}
        self.refreshed: list[str] = []

    def subscribe(self, symbols=None, *, user_id=None):
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)
        self.queues[q] = {s.upper() for s in (symbols or [])}
        self.users[q] = user_id
        return q

    def unsubscribe(self, q) -> None:
        self.queues.pop(q, None)
        self.users.pop(q, None)

    def update_subscription(self, q, symbols) -> None:
        """Mirrors MarketDataHub: filter change, same queue object."""
        self.queues[q] = {s.upper() for s in symbols}
        for sym in self.queues[q]:
            self.refreshed.append(sym)

    async def refresh_symbol(self, symbol: str) -> None:
        self.refreshed.append(symbol)

    def all_ticker_rows(self, symbols=None) -> list[dict[str, Any]]:
        return [{"symbol": "BTCUSDT", "price": 68_000.0, "change_percent_24h": 1.2}]

    async def get_candles(self, symbol: str, interval: str, limit: int = 250) -> list[dict[str, Any]]:
        return [{"open_time": 1, "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 10.0}]

    async def get_depth(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        return {"symbol": symbol, "bids": [[1.0, 2.0]], "asks": [[1.1, 3.0]]}


def make_hub() -> tuple[RealtimeHub, StubHub]:
    market = StubHub()
    hub = RealtimeHub()
    hub.attach_market_hub(market)
    return hub, market


# --------------------------------------------------------------------------- #
def test_connection_status_is_reported_even_without_data() -> None:
    assert RealtimeHub().status()["connections"] == 0


@pytest.mark.asyncio
async def test_socket_greeting_and_ping():
    from app.services.realtime import serve_socket

    hub, _market = make_hub()
    ws = FakeWebSocket([{"op": "ping"}])
    task = asyncio.create_task(serve_socket(ws, hub, token=None))
    await asyncio.sleep(0.05)
    await ws._incoming.put(_Disconnect())
    with contextlib.suppress(Exception):
        await asyncio.wait_for(task, timeout=2)
    assert ws.accepted
    assert ws.types()[0] == "status"
    assert ws.sent[0]["data"]["connected"] is True
    assert ws.sent[0]["data"]["authenticated"] is False
    assert "pong" in ws.types()
    assert ws.last("pong")["data"]["ts"] > 0


@pytest.mark.asyncio
async def test_subscribe_returns_snapshot_and_warms_symbols():
    from app.services.realtime import serve_socket

    hub, market = make_hub()
    ws = FakeWebSocket(
        [
            {"op": "subscribe", "channels": ["ticker", "kline:BTCUSDT:1m", "depth:BTCUSDT", "signals"]},
        ]
    )
    task = asyncio.create_task(serve_socket(ws, hub, token=None))
    await asyncio.sleep(0.08)
    await ws._incoming.put(_Disconnect())
    with contextlib.suppress(Exception):
        await asyncio.wait_for(task, timeout=2)
    snapshot = ws.last("snapshot")
    assert snapshot is not None
    data = snapshot["data"]
    assert data["tickers"], "snapshot must include current prices"
    assert "BTCUSDT:1m" in data["candles"], "candles must be replayed on subscribe"
    assert "BTCUSDT" in data["depth"]
    assert "BTCUSDT" in market.refreshed
    conn = next(iter(hub.connections)) if hub.connections else None
    assert conn is None, "the connection must be removed after disconnect"


@pytest.mark.asyncio
async def test_bad_token_closes_with_4401():
    from app.services.realtime import serve_socket

    hub, _market = make_hub()
    ws = FakeWebSocket([])
    with contextlib.suppress(Exception):
        await asyncio.wait_for(serve_socket(ws, hub, token="garbage.token.value"), timeout=2)
    assert ws.closed_code == 4401
    assert ws.last("error")["data"]["code"] == "auth"


@pytest.mark.asyncio
async def test_auth_message_upgrades_the_socket() -> None:
    from app.db.base import init_db

    await init_db()
    hub, market = make_hub()
    ws = FakeWebSocket()
    conn = await hub.connect(ws, token=None)
    assert conn is not None and conn in hub.connections
    from app.security.jwt_tokens import issue_token_pair

    pair = issue_token_pair(987654321, "ghost@example.com")
    # the token verifies, but the account does not exist -> must be refused
    await hub.handle_message(conn, json.dumps({"op": "auth", "token": pair.access_token}))
    assert conn.ws.last("error")["data"]["code"] == "auth"
    assert conn.user_id is None

    await hub.handle_message(conn, json.dumps({"op": "totally-bogus"}))
    assert conn.ws.last("error")["data"]["code"] == "unknown_op"
    await hub.leave(conn)
    assert not hub.connections


@pytest.mark.asyncio
async def test_channel_filtering_and_user_routing() -> None:
    hub, market = make_hub()
    btc = Connection(ws=FakeWebSocket(), user_id=1)
    eth = Connection(ws=FakeWebSocket(), user_id=2)
    btc.symbols = {"BTCUSDT"}
    eth.symbols = {"ETHUSDT"}
    hub.connections.update({btc, eth})
    await hub.attach_queue(btc, {"BTCUSDT"})
    await hub.attach_queue(eth, {"ETHUSDT"})

    btc_q = market.queues[btc.queue]
    eth_q = market.queues[eth.queue]
    assert btc_q == {"BTCUSDT"} and eth_q == {"ETHUSDT"}

    event = {"type": "kline", "data": {"symbol": "BTCUSDT", "c": 1.0}}
    assert btc.matches(event) is True
    assert eth.matches(event) is False, "ETH client must not receive BTC candles"

    all_event = {"type": "tickers", "data": []}
    assert btc.matches(all_event) and eth.matches(all_event), "price batches are broadcast"

    notification = {"type": "notification", "data": {"k": 1}}
    assert btc.matches(notification) and eth.matches(notification)

    sent = await hub.send_to_user(1, {"type": "order_update", "data": {"x": 1}})
    assert sent == 1
    assert btc.ws.last("order_update") is not None
    assert eth.ws.last("order_update") is None

    broadcast = await hub.broadcast({"type": "ai_signal", "data": {"symbol": "BTCUSDT"}})
    assert broadcast == 2


@pytest.mark.asyncio
async def test_backpressure_drops_events_instead_of_stalling() -> None:
    """A slow consumer must never block the market loop."""
    market = _TinyQueueHub()
    hub = RealtimeHub()
    hub.attach_market_hub(market)
    conn = Connection(ws=FakeWebSocket())
    await hub.connect(conn.ws, token=None)
    await hub.attach_queue(conn, {"BTCUSDT"})
    assert conn.queue is not None

    for i in range(40):
        await market.publish({"type": "ticker", "data": {"symbol": "BTCUSDT", "price": 1.0 + i}})
    await asyncio.sleep(0.01)
    await hub.leave(conn)


class _TinyQueueHub:
    def __init__(self, size: int = 8) -> None:
        self.size = size
        self.q: asyncio.Queue | None = None

    def subscribe(self, symbols=None, *, user_id=None) -> asyncio.Queue:
        self.q = asyncio.Queue(maxsize=self.size)
        return self.q

    def unsubscribe(self, q) -> None:
        self.q = None

    async def publish(self, msg: dict) -> None:
        if self.q is None:
            return
        try:
            self.q.put_nowait(msg)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self.q.get_nowait()
            self.q.put_nowait(msg)

    def all_ticker_rows(self, symbols=None) -> list[dict]:
        return []

    async def get_candles(self, *a, **k) -> list[dict]:
        return []

    async def get_depth(self, *a, **k) -> dict:
        return {}

    async def refresh_symbol(self, symbol: str) -> None:
        return None


class _Disconnect(Exception):
    pass


@pytest.mark.asyncio
async def test_resubscribe_keeps_the_same_queue_and_keeps_streaming():
    """Regression: swapping the queue on every subscribe starved the writer task
    (the app froze after the first snapshot). One queue per connection, forever."""
    hub, market = make_hub()
    conn = await hub.connect(FakeWebSocket(), token=None)
    assert conn is not None
    first = conn.queue
    await hub.handle_message(conn, json.dumps({"op": "subscribe", "channels": ["kline:BTCUSDT:1m"]}))
    assert conn.queue is first, "the queue object must be reused"
    assert market.queues[first] == {"BTCUSDT"}, "the symbol filter is updated in place"
    await hub.handle_message(conn, json.dumps({"op": "subscribe", "channels": ["ticker", "kline:ETHUSDT:1h"]}))
    assert conn.queue is first
    assert market.queues[first] == {"BTCUSDT", "ETHUSDT"}

    # events pushed into that single queue reach the socket
    for _ in range(3):
        first.put_nowait({"type": "kline", "data": {"symbol": "BTCUSDT", "c": 1.0}})
    await asyncio.sleep(0.15)
    assert conn.ws.last("kline") is not None
    await hub.leave(conn)


@pytest.mark.asyncio
async def test_live_events_reach_a_real_socket_through_the_real_hub(client, hub):
    """End-to-end over the actual market hub: connect -> subscribe -> ticks arrive."""
    from app.services.realtime import realtime_hub

    ws = FakeWebSocket([{"op": "subscribe", "channels": ["ticker", f"kline:{hub.symbols[0]}:1m"]}])
    conn = await realtime_hub.connect(ws, token=None)
    try:
        assert conn is not None
        assert conn.queue is not None
        before = conn.sent
        await hub._broadcast({"type": "tickers", "data": hub.all_ticker_rows()[:3]})
        await asyncio.sleep(0.05)
        assert conn.sent > before, "the writer must forward broadcast events"
    finally:
        await realtime_hub.leave(conn)
        assert not realtime_hub.connections, "leave() must clean up the connection and its task"
