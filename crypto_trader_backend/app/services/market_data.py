"""Market data hub - the single source of truth the API and WS layers read.

Responsibilities
----------------
* keep an in-memory cache of tickers, order books and candles for every tracked
  symbol (served instantly to the app, no Binance round-trip per request)
* ingest events from either the live Binance WebSocket or the simulator
* fan events out to subscriber queues (one per connected app client), with a
  coalescing window so 40 clients on 10 symbols do not trigger 400 msgs/sec
* fall back to REST polling when a stream is unavailable and rehydrate candles
  after a reconnect
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import defaultdict, deque
from collections.abc import Iterable
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

CacheKey = tuple[str, str]  # (symbol, interval)


class MarketDataHub:
    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway
        self.symbols: list[str] = list(settings.MARKETS)
        self.tickers: dict[str, dict[str, Any]] = {}
        self.depth: dict[str, dict[str, Any]] = {}
        self.candles: dict[CacheKey, list[dict[str, Any]]] = {}
        self.candle_meta: dict[CacheKey, float] = {}
        self.recent_trades: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=60))
        self._subs: set[asyncio.Queue[dict[str, Any]]] = set()
        self._sub_syms: dict[asyncio.Queue[dict[str, Any]], set[str]] = {}
        self._sub_user: dict[asyncio.Queue[dict[str, Any]], int | None] = {}
        self._lock = asyncio.Lock()
        self._last_rest_poll = 0.0
        self._ticker_events = 0
        self.started_at = time.time()
        self.last_event_ms = 0
        self.source = gateway.name
        self._coalesce_task: asyncio.Task[None] | None = None
        self._stream_task: asyncio.Task[None] | None = None
        self._stream = None
        self._pending: dict[str, dict[str, Any]] = {}
        self._stream = None  # BinanceStreamClient when live

    # ------------------------------------------------------------------ lifecycle
    async def start(self, symbols: Iterable[str] | None = None) -> None:
        if symbols:
            self.symbols = sorted(set(symbols) | set(self.symbols))
        try:
            await self.refresh_all(force=True)
        except Exception:
            log.exception("initial market refresh failed (continuing; will retry)")
        if getattr(self.gateway, "is_simulated", False):
            await self.gateway.start()
            self._stream_task = asyncio.create_task(self._pump_simulator(), name="sim-pump")
        else:
            from app.binance.streams import BinanceStreamClient

            self._stream = BinanceStreamClient(self.symbols, sink=self.ingest, intervals=("1m",))
            await self._stream.start()
            self._stream_task = asyncio.create_task(self._poll_loop(), name="market-poll")
        self._coalesce_task = asyncio.create_task(self._coalescer(), name="ticker-coalescer")
        log.info("market hub started (source=%s, %d symbols)", self.source, len(self.symbols))

    async def stop(self) -> None:
        for q in list(self._subs):
            self._subs.discard(q)
            self._sub_syms.pop(q, None)
            self._sub_user.pop(q, None)
        for attr in ("_stream_task", "_coalesce_task"):
            task = getattr(self, attr, None)
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        if self._stream is not None:
            await self._stream.stop()
        if getattr(self.gateway, "is_simulated", False):
            with contextlib.suppress(Exception):
                await self.gateway.stop()

    async def _pump_simulator(self) -> None:
        q = self.gateway.add_listener()
        try:
            while True:
                event = await q.get()
                await self.ingest(event)
        except asyncio.CancelledError:
            pass
        finally:
            with contextlib.suppress(Exception):
                self.gateway.remove_listener(q)

    async def _poll_loop(self) -> None:
        """REST safety net: keeps tickers fresh even if the WS stream dies."""
        while True:
            idle_ms = (time.time() * 1000 - self.last_event_ms) if self.last_event_ms else 1e12
            try:
                await self.refresh_all(force=idle_ms > 15_000)
            except Exception:
                log.warning("market poll failed", exc_info=True)
            await asyncio.sleep(5.0 if idle_ms > 15_000 else 20.0)

    # ---------------------------------------------------------------- ingestion
    async def refresh_all(self, *, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_rest_poll < settings.KLINE_CACHE_TTL_S:
            return
        self._last_rest_poll = now
        rows = await self.gateway.all_tickers()
        wanted = set(self.symbols)
        for row in rows:
            sym = row.get("symbol")
            if sym in wanted or not wanted:
                self.tickers[sym] = row if "price" in row else _from_raw_ticker(row)
        for sym in list(self.symbols):
            if sym not in self.tickers:
                with contextlib.suppress(Exception):
                    self.tickers[sym] = await self.gateway.ticker(sym)

    async def refresh_symbol(self, symbol: str, *, interval: str = "1m", limit: int = 300) -> None:
        symbol = symbol.upper()
        if symbol not in self.symbols:
            self.symbols.append(symbol)
        async with self._lock:
            with contextlib.suppress(Exception):
                self.tickers[symbol] = await self.gateway.ticker(symbol)
            await self.load_candles(symbol, interval, limit, force=True)

    async def load_candles(self, symbol: str, interval: str, limit: int, *, force: bool = False) -> list[dict[str, Any]]:
        from app.binance.simulator import SUPPORTED_INTERVALS
        from app.errors import ValidationError_

        interval = (interval or "").lower().strip()
        if interval not in SUPPORTED_INTERVALS:
            raise ValidationError_(f"unsupported interval '{interval}'", details={"supported": sorted(SUPPORTED_INTERVALS)})
        key = (symbol.upper(), interval)
        cached = self.candles.get(key)
        age = time.time() - self.candle_meta.get(key, 0)
        if cached and not force and age < settings.KLINE_CACHE_TTL_S and len(cached) >= min(limit, 200):
            return cached[-limit:]
        try:
            rows = await self.gateway.klines(key[0], interval, limit)
        except Exception as exc:
            log.warning("kline fetch failed for %s/%s: %s", key[0], interval, exc)
            return cached[-limit:] if cached else []
        if rows:
            self.candles[key] = rows
            self.candle_meta[key] = time.time()
        return rows

    async def get_candles(self, symbol: str, interval: str, limit: int = 300) -> list[dict[str, Any]]:
        return await self.load_candles(symbol, interval, limit)

    async def ingest(self, event: dict[str, Any]) -> None:
        etype = event.get("type")
        data = event.get("data") or {}
        if etype == "ticker":
            sym = data.get("symbol")
            if not sym:
                return
            self.tickers[sym] = data
            self.last_event_ms = int(time.time() * 1000)
            self._ticker_events += 1
            self._pending[sym] = {"type": "ticker", "data": data}  # coalesced fan-out
        elif etype == "kline":
            sym = data.get("s")
            iv = data.get("i") or "1m"
            if not sym:
                return
            self.last_event_ms = int(time.time() * 1000)
            key = (sym, iv)
            rows = self.candles.get(key)
            bar = {
                "open_time": data.get("open_time"),
                "open": data.get("o"),
                "high": data.get("h"),
                "low": data.get("l"),
                "close": data.get("c"),
                "volume": data.get("v"),
                "quote_volume": data.get("q", 0.0),
                "trades": data.get("n", 0),
                "taker_buy_volume": data.get("V", 0.0),
                "closed": bool(data.get("x")),
            }
            if rows is None:
                rows = await self.load_candles(sym, iv, settings.AI_LOOKBACK_BARS, force=True)
                self.candles[key] = rows
            if rows and rows[-1].get("open_time") == bar["open_time"]:
                rows[-1] = bar
            else:
                rows.append(bar)
                if len(rows) > settings.KLINE_MAX_BARS:
                    del rows[: len(rows) - settings.KLINE_MAX_BARS]
            await self._broadcast({"type": "kline", "data": {**data, "symbol": sym, "interval": iv}}, {sym})
        elif etype == "depth":
            sym = data.get("symbol")
            if sym:
                self.depth[sym] = data
                self.last_event_ms = int(time.time() * 1000)
                await self._broadcast({"type": "depth", "data": data}, {sym})
        elif etype == "trade":
            sym = data.get("symbol")
            if sym:
                self.recent_trades[sym].append(data)
                await self._broadcast({"type": "trade", "data": data}, {sym})
        elif etype in ("fill", "order_update"):
            await self._broadcast({"type": etype, "data": data})

    async def _coalescer(self) -> None:
        """Batch ticker updates to ``WS_BROADCAST_INTERVAL_MS``."""
        interval = settings.WS_BROADCAST_INTERVAL_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            batch, self._pending = self._pending, {}
            if not batch:
                continue
            msg = {"type": "tickers", "data": list(batch.values())}
            await self._broadcast(msg)

    # ----------------------------------------------------------------- subscribers
    def subscribe(self, symbols: Iterable[str] | None = None, *, user_id: int | None = None) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)
        self._subs.add(q)
        self._sub_syms[q] = {s.upper() for s in symbols} if symbols else set()
        self._sub_user[q] = user_id
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subs.discard(q)
        self._sub_syms.pop(q, None)
        self._sub_user.pop(q, None)

    def owned_queue(self, q: asyncio.Queue[dict[str, Any]]) -> int | None:
        return self._sub_user.get(q)

    async def broadcast_to_user(self, msg: dict[str, Any], user_id: int | None) -> None:
        """Send a user-scoped event (order fills, alerts, AI trades) to sockets."""
        if user_id is None:
            return
        for q in list(self._subs):
            if self._sub_user.get(q) == int(user_id):
                try:
                    q.put_nowait(msg)
                except asyncio.QueueFull:
                    with contextlib.suppress(Exception):
                        q.get_nowait()
                    with contextlib.suppress(Exception):
                        q.put_nowait(msg)

    async def broadcast_all(self, msg: dict[str, Any]) -> None:
        await self._broadcast(msg)

    def connected_user_ids(self) -> list[int]:
        return sorted({u for u in self._sub_user.values() if u is not None})

    def update_subscription(self, q: asyncio.Queue[dict[str, Any]], symbols: Iterable[str]) -> None:
        """Change which symbols a live connection receives (no re-subscribe race)."""
        wanted = {s.upper() for s in symbols}
        self._sub_syms[q] = wanted
        for sym in wanted:
            with contextlib.suppress(RuntimeError):
                asyncio.get_running_loop().create_task(self.refresh_symbol(sym))

    async def _broadcast(self, msg: dict[str, Any], symbols: set[str] | None = None) -> None:
        if not self._subs:
            return
        for q in list(self._subs):
            want = self._sub_syms.get(q) or set()
            if symbols and want and not (symbols & want) and msg.get("type") != "tickers":
                continue
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                with contextlib.suppress(Exception):
                    q.get_nowait()
                with contextlib.suppress(Exception):
                    q.put_nowait(msg)

    # -------------------------------------------------------------------- reads
    def price(self, symbol: str) -> float:
        return float((self.tickers.get(symbol.upper()) or {}).get("price", 0.0))

    def ticker(self, symbol: str) -> dict[str, Any] | None:
        return self.tickers.get(symbol.upper())

    def all_ticker_rows(self, symbols: Iterable[str] | None = None) -> list[dict[str, Any]]:
        rows = []
        wanted = {s.upper() for s in symbols} if symbols else None
        for sym, t in self.tickers.items():
            if wanted and sym not in wanted:
                continue
            rows.append(t)
        rows.sort(key=lambda r: -(r.get("quote_volume_24h") or 0))
        return rows

    def depth_snapshot(self, symbol: str) -> dict[str, Any]:
        sym = symbol.upper()
        cached = self.depth.get(sym)
        if cached:
            return {**cached, "cached": True}
        return {"symbol": sym, "bids": [], "asks": [], "cached": False}

    async def get_depth(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        sym = symbol.upper()
        cached = self.depth.get(sym)
        if cached and (time.time() - (cached.get("_t", 0))) < 1.5:
            return {k: v for k, v in cached.items() if k != "_t"}
        try:
            snap = await self.gateway.depth(sym, limit)
            snap["_t"] = time.time()
            self.depth[sym] = snap
            return snap
        except Exception as exc:
            log.warning("depth fetch failed for %s: %s", sym, exc)
            return {**self.depth_snapshot(sym), "error": str(exc)}

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "demo_mode": settings.DEMO_MODE,
            "symbols": len(self.symbols),
            "tickers_cached": len(self.tickers),
            "subscribers": len(self._subs),
            "ticker_events": self._ticker_events,
            "last_event_ms": self.last_event_ms,
            "seconds_since_event": round(time.time() - self.last_event_ms / 1000.0, 1) if self.last_event_ms else None,
            "uptime_s": round(time.time() - self.started_at, 1),
            "stream": self._stream.status() if self._stream else {"connected": True, "note": "simulator"},
        }


def _from_raw_ticker(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": row.get("symbol", ""),
        "price": float(row.get("lastPrice", row.get("price", 0)) or 0),
        "change_24h": float(row.get("priceChange", 0) or 0),
        "change_percent_24h": float(row.get("priceChangePercent", 0) or 0),
        "high_24h": float(row.get("highPrice", 0) or 0),
        "low_24h": float(row.get("lowPrice", 0) or 0),
        "volume_24h": float(row.get("volume", 0) or 0),
        "quote_volume_24h": float(row.get("quoteVolume", 0) or 0),
        "trades_24h": int(row.get("count", 0) or 0),
        "bid": float(row.get("bidPrice", 0) or 0),
        "ask": float(row.get("askPrice", 0) or 0),
        "open_24h": float(row.get("openPrice", 0) or 0),
        "updated_at_ms": int(time.time() * 1000),
    }
