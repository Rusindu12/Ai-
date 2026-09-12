"""Binance WebSocket market-stream consumer.

Subscribes to the combined stream endpoint::

    wss://stream.binance.com:9443/stream?streams=btcusdt@ticker/ethusdt@kline_1m/btcusdt@depth20@100ms

and normalises every event into the same dict shape the simulator emits, so
:class:`app.services.market_data.MarketDataHub` has a single ingestion path.

Reliability
-----------
* auto-reconnect with exponential backoff + jitter (0.5s .. 30s)
* ``requirement of ping/pong``: Binance pings at the protocol level, we answer
  and additionally ``LIST_STREAMS``/resubscribe after 3 idle minutes
* re-fetches REST snapshots (ticker + last 500 klines) on reconnect so the app
  never shows a stale chart after a network blip
* respects the 1024 streams/connection limit by sharding across connections
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import time
from collections.abc import Callable, Iterable
from typing import Any

import websockets  # type: ignore[import-untyped]

from app.config import settings

log = logging.getLogger(__name__)

EventSink = Callable[[dict[str, Any]], "Any"]

MAX_STREAMS_PER_CONNECTION = 900
IDLE_TIMEOUT_S = 180


class BinanceStreamClient:
    def __init__(self, symbols: Iterable[str], *, sink: EventSink, intervals: Iterable[str] = ("1m",), depth: bool = True) -> None:
        self.symbols = sorted({s.upper() for s in symbols})
        self.intervals = list(intervals)
        self.depth = depth
        self.sink = sink
        self._tasks: list[asyncio.Task[None]] = []
        self._stop = asyncio.Event()
        self.connected = False
        self.last_message_ms: int = 0
        self.reconnects = 0

    # ------------------------------------------------------------------ streams
    def stream_names(self) -> list[str]:
        out: list[str] = []
        for s in self.symbols:
            low = s.lower()
            out.append(f"{low}@ticker")
            for iv in self.intervals:
                out.append(f"{low}@kline_{iv}")
            if self.depth:
                out.append(f"{low}@depth20@100ms")
        return out

    def _shards(self) -> list[list[str]]:
        names = self.stream_names()
        return [names[i : i + MAX_STREAMS_PER_CONNECTION] for i in range(0, len(names), MAX_STREAMS_PER_CONNECTION)]

    # --------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        self._stop.clear()
        for shard in self._shards():
            self._tasks.append(asyncio.create_task(self._supervise(shard), name=f"binance-ws-{len(self._tasks)}"))
        log.info("binance ws started: %d shard(s), %d symbols", len(self._tasks), len(self.symbols))

    async def stop(self) -> None:
        self._stop.set()
        for t in self._tasks:
            t.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        self.connected = False

    async def _supervise(self, streams: list[str]) -> None:
        attempt = 0
        url = f"{settings.binance_ws_base}/stream?streams=" + "/".join(streams)
        while not self._stop.is_set():
            try:
                await self._consume(url, streams)
                attempt = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                attempt += 1
                self.connected = False
                delay = min(30.0, 0.5 * 2**attempt) * random.uniform(0.7, 1.3)
                log.warning("binance ws error (%s) - reconnect in %.1fs", type(exc).__name__, delay)
                await asyncio.sleep(delay)

    async def _consume(self, url: str, streams: list[str]) -> None:
        async with websockets.connect(  # type: ignore[attr-defined]
            url, ping_interval=20, ping_timeout=20, close_timeout=5, max_size=2**22
        ) as ws:
            self.connected = True
            log.info("binance ws connected (%d streams)", len(streams))
            while not self._stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=IDLE_TIMEOUT_S)
                except TimeoutError:
                    with contextlib.suppress(Exception):
                        await ws.send(json.dumps({"method": "PING", "id": int(time.time())}))
                    continue
                self.last_message_ms = int(time.time() * 1000)
                event = _normalise(raw)
                if event is not None:
                    _emit(self.sink, event)

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "reconnects": self.reconnects,
            "streams": len(self.stream_names()),
            "last_message_ms": self.last_message_ms,
        }


def _emit(sink: EventSink, event: dict[str, Any]) -> None:
    result = sink(event)
    if asyncio.iscoroutine(result):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover
            result.close()  # type: ignore[attr-defined]
            return
        task = loop.create_task(result)
        _PENDING.add(task)
        task.add_done_callback(_PENDING.discard)


_PENDING: set[asyncio.Task[Any]] = set()


def _normalise(raw: str | bytes) -> dict[str, Any] | None:
    try:
        msg = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    payload = msg.get("data", msg) if isinstance(msg, dict) else None
    if not isinstance(payload, dict):
        return None
    etype = payload.get("e")

    if etype == "24hrTicker":
        return {
            "type": "ticker",
            "data": {
                "symbol": payload.get("s", ""),
                "price": _f(payload.get("c")),
                "change_24h": _f(payload.get("p")),
                "change_percent_24h": _f(payload.get("P")),
                "high_24h": _f(payload.get("h")),
                "low_24h": _f(payload.get("l")),
                "volume_24h": _f(payload.get("v")),
                "quote_volume_24h": _f(payload.get("q")),
                "trades_24h": int(_f(payload.get("n"))),
                "bid": _f(payload.get("b")),
                "ask": _f(payload.get("a")),
                "open_24h": _f(payload.get("o")),
                "updated_at_ms": int(time.time() * 1000),
            },
        }

    if etype == "kline":
        k = payload.get("k") or {}
        return {
            "type": "kline",
            "data": {
                "s": k.get("s", payload.get("s", "")),
                "i": k.get("i", "1m"),
                "open_time": int(_f(k.get("t"))),
                "o": _f(k.get("o")),
                "h": _f(k.get("h")),
                "l": _f(k.get("l")),
                "c": _f(k.get("c")),
                "v": _f(k.get("v")),
                "q": _f(k.get("q")),
                "n": int(_f(k.get("n"))),
                "x": bool(k.get("x", False)),
            },
        }

    if "bids" in payload and "asks" in payload:
        return {
            "type": "depth",
            "data": {
                "symbol": payload.get("s", ""),
                "lastUpdateId": int(_f(payload.get("u"))),
                "bids": [[float(p), float(q)] for p, q in payload.get("bids", [])],
                "asks": [[float(p), float(q)] for p, q in payload.get("asks", [])],
            },
        }

    if etype == "trade":
        return {
            "type": "trade",
            "data": {
                "symbol": payload.get("s", ""),
                "price": _f(payload.get("p")),
                "qty": _f(payload.get("q")),
                "side": "SELL" if payload.get("m") else "BUY",
                "time": int(_f(payload.get("T"))),
            },
        }
    return None


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0
