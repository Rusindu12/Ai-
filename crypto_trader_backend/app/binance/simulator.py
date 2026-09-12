"""High-fidelity market + paper-exchange simulator.

Used whenever ``DEMO_MODE=true`` so the entire product (live prices, candles on
every timeframe, order book, balances, fills, P&L, AI signals, auto-trading)
runs end to end with **no** Binance credentials, no network and no money.  It
implements the same :class:`~app.binance.base.ExchangeGateway` contract as the
real REST client, so no service in the stack is special-cased.

Price process
-------------
* Volatility-clustering GBM: log-variance is mean reverting (GARCH-like), with
  rare jump events (0.8-3.5% gaps) and intraday volume seasonality.
* Candles exist **per interval** and are all anchored to the same live price,
  so the 1m, 15m, 1h, 4h and 1D charts of a symbol are mutually consistent.
* Order book: exponential depth ladder around mid, spread tied to realised
  vol.  Market orders walk the book (real slippage); limit/stop orders rest and
  fill when the price crosses their level.
* Deterministic: every symbol is seeded from ``sha256(symbol:SIM_SEED)`` so
  CI runs, screenshots and demos are reproducible.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import math
import random
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from app.binance.base import Creds, ExchangeGateway
from app.config import settings
from app.errors import InsufficientFundsError, ValidationError_

log = logging.getLogger(__name__)

INTERVAL_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800,
    "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800,
}

# symbol -> (anchor price, annualised vol, USD liquidity per book level)
SEED_MARKETS: dict[str, tuple[float, float, float]] = {
    "BTCUSDT": (68_450.0, 0.45, 260_000.0),
    "BTCBUSD": (68_400.0, 0.45, 90_000.0),
    "ETHUSDT": (3_320.0, 0.55, 140_000.0),
    "BNBUSDT": (605.0, 0.58, 60_000.0),
    "SOLUSDT": (168.0, 0.75, 55_000.0),
    "XRPUSDT": (0.615, 0.72, 30_000.0),
    "ADAUSDT": (0.438, 0.78, 22_000.0),
    "DOGEUSDT": (0.1415, 0.88, 18_000.0),
    "AVAXUSDT": (37.2, 0.80, 20_000.0),
    "LINKUSDT": (17.4, 0.79, 15_000.0),
    "MATICUSDT": (0.718, 0.83, 12_000.0),
    "LTCUSDT": (84.3, 0.70, 14_000.0),
    "DOTUSDT": (6.9, 0.79, 12_000.0),
    "TRXUSDT": (0.158, 0.66, 9_000.0),
    "ATOMUSDT": (7.8, 0.80, 9_000.0),
}


SUPPORTED_INTERVALS = frozenset(INTERVAL_SECONDS)


def _require_interval(interval: str) -> str:
    iv = (interval or "").lower().strip()
    if iv not in SUPPORTED_INTERVALS:
        raise ValidationError_(
            f"unsupported interval '{interval}'",
            details={"supported": sorted(SUPPORTED_INTERVALS, key=lambda k: INTERVAL_SECONDS[k])},
        )
    return iv


def _precision(price: float) -> tuple[float, float, int]:
    """Return (tick_size, step_size, decimals) plausible for the price scale."""
    if price >= 10_000:
        return 0.10, 0.001, 5
    if price >= 1_000:
        return 0.01, 0.001, 4
    if price >= 100:
        return 0.01, 0.01, 4
    if price >= 1:
        return 0.001, 0.1, 4
    if price >= 0.1:
        return 0.0001, 1.0, 5
    return 0.00001, 10.0, 6


def _stable_seed(symbol: str, seed: int) -> int:
    digest = hashlib.sha256(f"{symbol}:{seed}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _derive_price(symbol: str) -> float:
    return 5.0 + (_stable_seed(symbol, 7) % 950)


@dataclass(slots=True)
class Bar:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    quote_volume: float
    trades: int
    taker_buy_volume: float

    def as_dict(self, *, closed: bool = True) -> dict[str, Any]:
        return {
            "open_time": self.open_time,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": round(self.volume, 8),
            "quote_volume": round(self.quote_volume, 8),
            "trades": self.trades,
            "taker_buy_volume": round(self.taker_buy_volume, 8),
            "taker_buy_quote_volume": round(self.taker_buy_volume * self.close, 8),
            "closed": closed,
        }


@dataclass(eq=False)
class SimSymbol:
    """One simulated instrument (price + per-interval candles + book)."""

    def __init__(self, symbol: str, seed: int) -> None:
        start, vol, liq = SEED_MARKETS.get(symbol, (_derive_price(symbol), 0.8, 10_000.0))
        tick, step, dec = _precision(start)
        self.symbol = symbol
        self.base = symbol[: len(symbol) - 4] if symbol.endswith(("USDT", "BUSD", "USDC")) else symbol[:-4]
        self.quote = symbol[len(self.base) :] or "USDT"
        self.price = start
        self.annual_vol = vol
        self.book_liquidity = liq
        self.tick_size = tick
        self.step = step
        self.decimals = dec
        self.rng = random.Random(_stable_seed(symbol, seed))
        self.log_var = math.log((vol**2) / 365.0 / 86400.0 * 60.0)
        self.series: dict[str, list[Bar]] = {}
        self.live_bucket: dict[str, int] = {}
        self.open_24h = start
        self.high_24h = start
        self.low_24h = start
        self.volume_24h = 0.0
        self.quote_volume_24h = 0.0
        self.trades_24h = 0
        half = max(self.tick_size, self.price * 0.00012)
        self.bid = round(self.price - half, self.decimals)
        self.ask = round(self.price + half, self.decimals)
        self._seed_day_stats()

    # ------------------------------------------------------------------ history
    def _seed_day_stats(self) -> None:
        bars = self.ensure_interval("1d", 30)
        if bars:
            yday = bars[-2] if len(bars) > 1 else bars[-1]
            self.open_24h = yday.close if len(bars) > 1 else bars[-1].open
            self.high_24h = bars[-1].high
            self.low_24h = bars[-1].low
            self.volume_24h = bars[-1].volume
            self.quote_volume_24h = bars[-1].quote_volume
            self.trades_24h = bars[-1].trades

    def ensure_interval(self, interval: str, limit: int = 500) -> list[Bar]:
        """Build (once) an interval's history, anchored on the live price."""
        interval = _require_interval(interval)
        bars = self.series.get(interval)
        if bars is not None:
            return bars
        step_s = INTERVAL_SECONDS[interval]
        n = max(300, min(max(int(limit), 300), settings.KLINE_MAX_BARS))
        now = int(time.time())
        end_bucket = now - now % step_s
        per_bar_vol = self.annual_vol / math.sqrt(365.0 * 86400.0 / step_s)
        # random walk backwards then flip, so the newest bar == current price
        rets = [self.rng.gauss(0.0, per_bar_vol) for _ in range(n)]
        for i in range(1, len(rets)):  # light momentum => visible trends
            rets[i] = 0.55 * rets[i - 1] + 0.45 * rets[i]
        prices: list[float] = []
        p = self.price
        for r in reversed(rets):
            prices.append(p)
            p = p / math.exp(r)
        prices.reverse()
        out: list[Bar] = []
        base_vol = self.book_liquidity / max(self.price, 1e-9) * (step_s / 60.0) ** 0.75
        for i, c in enumerate(prices):
            o = prices[i - 1] if i else c * (1 + self.rng.gauss(0, per_bar_vol))
            wick = abs(c - o) * 0.6 + abs(c) * abs(self.rng.gauss(0, per_bar_vol * 0.7))
            hi = max(o, c) + wick * self.rng.uniform(0.15, 1.0)
            lo = min(o, c) - wick * self.rng.uniform(0.15, 1.0)
            v = max(1e-6, base_vol * self.rng.uniform(0.35, 2.1))
            ts = end_bucket - (n - 1 - i) * step_s
            out.append(
                Bar(
                    open_time=ts * 1000,
                    open=round(o, self.decimals),
                    high=round(hi, self.decimals),
                    low=round(max(lo, 1e-8), self.decimals),
                    close=round(c, self.decimals),
                    volume=v,
                    quote_volume=v * c,
                    trades=int(self.rng.uniform(200, 6000) * (step_s / 60.0) ** 0.5),
                    taker_buy_volume=v * self.rng.uniform(0.38, 0.62),
                )
            )
        # rescale so the walk lands exactly on the live price
        factor = self.price / out[-1].close if out[-1].close else 1.0
        if abs(factor - 1.0) > 1e-9:
            for b in out:
                b.open = round(b.open * factor, self.decimals)
                b.high = round(b.high * factor, self.decimals)
                b.low = round(b.low * factor, self.decimals)
                b.close = round(b.close * factor, self.decimals)
        self.series[interval] = out
        self.live_bucket[interval] = end_bucket
        return out

    # ------------------------------------------------------------------ process
    def _step_return(self, dt_seconds: float) -> float:
        target = math.log(max(1e-18, self.annual_vol**2 / 365.0 / 86400.0 * dt_seconds))
        self.log_var = 0.94 * self.log_var + 0.06 * target + 0.05 * self.rng.gauss(0, abs(target) or 1e-9)
        sigma = math.sqrt(max(1e-14, math.exp(self.log_var)))
        ret = -0.5 * sigma * sigma + sigma * self.rng.gauss(0, 1)
        if self.rng.random() < 1e-4 * dt_seconds:  # news shock
            ret += self.rng.choice([-1, 1]) * self.rng.uniform(0.008, 0.035)
        return ret

    def _sample_volume(self, o: float, c: float, scale: float = 1.0) -> float:
        hour = (int(time.time()) // 3600) % 24
        season = 0.65 + 0.55 * math.sin((hour - 3) / 24 * 2 * math.pi) ** 2
        move = abs(math.log(max(c, 1e-9) / max(o, 1e-9)))
        base = self.book_liquidity / max(c, 1e-9)
        return max(1e-8, base * season * (0.35 + 30 * move + self.rng.uniform(0, 0.35)) * scale)

    def advance(self) -> dict[str, Any]:
        """Advance one simulator tick: new price, update all live candles."""
        dt_s = settings.SIM_TICK_MS / 1000.0
        prev = self.price
        self.price = max(1e-8, self.price * math.exp(self._step_return(dt_s)))
        spread_frac = 0.00022 + min(0.004, abs(math.log(self.price / prev)) * 1.6)
        spread = max(self.tick_size, self.price * spread_frac)
        self.bid = round(self.price - spread / 2, self.decimals)
        self.ask = round(self.price + spread / 2, self.decimals)

        now = int(time.time())
        for interval, bars in list(self.series.items()):
            step_s = INTERVAL_SECONDS.get(interval)
            if step_s is None:  # pragma: no cover - defensive
                self.series.pop(interval, None)
                continue
            bucket = now - now % step_s
            if bucket != self.live_bucket.get(interval) or not bars:
                bars.append(
                    Bar(
                        open_time=bucket * 1000, open=self.price, high=self.price, low=self.price,
                        close=self.price, volume=self._sample_volume(prev, self.price, scale=(step_s / 60.0) ** 0.75),
                        quote_volume=0.0, trades=0, taker_buy_volume=0.0,
                    )
                )
                self.live_bucket[interval] = bucket
                if len(bars) > settings.KLINE_MAX_BARS + 50:
                    del bars[: len(bars) - settings.KLINE_MAX_BARS]
            bar = bars[-1]
            bar.close = round(self.price, self.decimals)
            bar.high = round(max(bar.high, bar.close), self.decimals)
            bar.low = round(min(bar.low, bar.close), self.decimals)
            add = self._sample_volume(prev, self.price, scale=(settings.SIM_TICK_MS / 1000.0 / 60.0))
            bar.volume += add
            bar.quote_volume += add * bar.close
            bar.trades += int(self.rng.uniform(1, 11))
            if bar.close >= prev:
                bar.taker_buy_volume += add
        self.high_24h = max(self.high_24h, self.price)
        self.low_24h = min(self.low_24h, self.price)
        return self.ticker_dict()

    # ------------------------------------------------------------------ output
    def ticker_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "price": self.price,
            "change_24h": self.price - self.open_24h,
            "change_percent_24h": (self.price / self.open_24h - 1.0) * 100 if self.open_24h else 0.0,
            "high_24h": self.high_24h,
            "low_24h": self.low_24h,
            "volume_24h": self.volume_24h,
            "quote_volume_24h": self.quote_volume_24h,
            "trades_24h": self.trades_24h,
            "bid": self.bid or round(self.price - self.tick_size, self.decimals),
            "ask": self.ask or round(self.price + self.tick_size, self.decimals),
            "open_24h": self.open_24h,
            "updated_at_ms": int(time.time() * 1000),
        }

    def depth_dict(self, levels: int = 20) -> dict[str, Any]:
        """Book ladder: geometric spacing outside the touch, decayed size."""
        mid = self.price
        half = max(self.tick_size, mid * 0.00006)
        step = max(self.tick_size, mid * 0.00004)
        asks: list[list[float]] = []
        bids: list[list[float]] = []
        for i in range(levels):
            px_a = mid + half + step * i
            px_b = mid - half - step * i
            if px_b <= 0:
                break
            size = (self.book_liquidity / max(mid, 1e-9)) * math.exp(-0.05 * i) * self.rng.uniform(0.55, 1.45)
            asks.append([round(px_a, self.decimals), round(size, 8)])
            bids.append([round(px_b, self.decimals), round(size, 8)])
        bids.sort(key=lambda r: -r[0])
        return {"symbol": self.symbol, "lastUpdateId": int(time.time() * 1000), "bids": bids, "asks": asks}

    def klines(self, interval: str, limit: int) -> list[dict[str, Any]]:
        interval = _require_interval(interval)
        bars = self.ensure_interval(interval, max(limit, 300))
        window = bars[-int(limit) :] if limit and limit > 0 else bars
        live = self.live_bucket.get(interval, 0) * 1000
        return [b.as_dict(closed=b.open_time != live) for b in window]

    def sparkline(self, points: int = 40, interval: str = "1h") -> list[float]:
        try:
            bars = self.ensure_interval(interval, max(points, 60))[-points:]
        except ValidationError_:  # pragma: no cover - cosmetic series
            return []
        return [round(b.close, self.decimals) for b in bars]

    def round_qty(self, qty: float) -> float:
        return math.floor(qty / self.step) * self.step if self.step else qty

    def round_price(self, price: float) -> float:
        return round(round(price / self.tick_size) * self.tick_size, self.decimals)


@dataclass(slots=True)
class SimAccount:
    """Per-(user, credential) simulated balances, open orders and history."""

    quote_balances: dict[str, float] = field(default_factory=lambda: {"USDT": 10_000.0})
    base_balances: dict[str, float] = field(default_factory=dict)
    orders: dict[str, dict[str, Any]] = field(default_factory=dict)
    trades: list[dict[str, Any]] = field(default_factory=list)
    seq: int = 0


class MarketSimulator(ExchangeGateway):
    """Drop-in gateway replacement used in DEMO_MODE."""

    name = "simulator"
    is_simulated = True

    def __init__(self, symbols: Iterable[str] | None = None, *, seed: int | None = None) -> None:
        self.seed = seed if seed is not None else settings.SIM_SEED
        self.symbols: dict[str, SimSymbol] = {s.upper(): SimSymbol(s.upper(), self.seed) for s in (symbols or settings.MARKETS)}
        self._accounts: dict[str, SimAccount] = {}
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._listeners: list[asyncio.Queue[dict[str, Any]]] = []
        self.fee_rate = settings.TAKER_FEE_BPS / 10_000.0
        self._fills = 0

    # ------------------------------------------------------------------ events
    def add_listener(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1024)
        self._listeners.append(q)
        return q

    def remove_listener(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        with contextlib.suppress(ValueError):
            self._listeners.remove(q)

    def _publish(self, events: list[dict[str, Any]]) -> None:
        for q in list(self._listeners):
            for ev in events:
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(ev)

    async def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="market-simulator")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _run(self) -> None:
        interval = settings.SIM_TICK_MS / 1000.0
        while True:
            try:
                await self.step()
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - defensive
                log.exception("simulator step failed")
            await asyncio.sleep(interval)

    async def step(self) -> list[dict[str, Any]]:
        """Advance every symbol one tick and match resting orders. Returns events."""
        events: list[dict[str, Any]] = []
        async with self._lock:
            for sym in self.symbols.values():
                events.append({"type": "ticker", "data": sym.advance()})
                for interval, bars in sym.series.items():
                    if not bars:
                        continue
                    live = sym.live_bucket.get(interval, 0) * 1000
                    bar = bars[-1]
                    events.append(
                        {
                            "type": "kline",
                            "data": {
                                "s": sym.symbol, "i": interval, "open_time": bar.open_time,
                                "o": bar.open, "h": bar.high, "l": bar.low, "c": bar.close,
                                "v": bar.volume, "q": bar.quote_volume, "n": bar.trades,
                                "x": bar.open_time != live,
                            },
                        }
                    )
                if settings.DEMO_MODE:
                    events.append({"type": "depth", "data": sym.depth_dict(15)})
                for acct in list(self._accounts.values()):
                    self._match_resting(sym, acct, events)
        self._publish(events)
        return events

    # ---------------------------------------------------------------- accounts
    def account_for(self, creds: Creds | None) -> SimAccount:
        key = str(getattr(creds, "user_id", None) or (creds.api_key if creds is not None else "demo"))
        acct = self._accounts.get(key)
        if acct is None:
            acct = SimAccount(
                quote_balances={"USDT": 10_000.0, "BUSD": 1_000.0},
                base_balances={
                    "BTC": 0.0845, "ETH": 1.82, "BNB": 6.4, "SOL": 42.0,
                    "XRP": 5200.0, "LINK": 120.0, "ADA": 3100.0, "DOGE": 21000.0,
                },
            )
            self._accounts[key] = acct
        return acct

    def reset_account(self, creds: Creds | None = None) -> None:
        key = str(getattr(creds, "user_id", None) or (creds.api_key if creds is not None else "demo"))
        self._accounts.pop(key, None)

    def _match_resting(self, sym: SimSymbol, acct: SimAccount, events: list[dict[str, Any]]) -> None:
        if not acct.orders:
            return
        for cid, order in list(acct.orders.items()):
            level = float(order.get("stopPrice") or order.get("price") or 0.0)
            side = order["side"]
            otype = order.get("type", "LIMIT")
            if otype == "LIMIT":
                hit = (side == "BUY" and sym.price <= level) or (side == "SELL" and sym.price >= level)
            elif otype == "STOP_LOSS_LIMIT":
                hit = (side == "SELL" and sym.price <= level) or (side == "BUY" and sym.price >= level)
            elif otype == "TAKE_PROFIT_LIMIT":
                hit = (side == "SELL" and sym.price >= level) or (side == "BUY" and sym.price <= level)
            else:
                hit = False
            if hit:
                ev = self._fill(sym, acct, side, level or sym.price, float(order["origQty"]), order)
                events.append(ev)
                acct.orders.pop(cid, None)

    def _fill(
        self, sym: SimSymbol, acct: SimAccount, side: str, ref_price: float, qty: float, order: dict[str, Any]
    ) -> dict[str, Any]:
        slip = sym.price * sym.rng.uniform(0.00005, 0.00045)
        exec_price = sym.round_price(ref_price + slip if side == "BUY" else ref_price - slip)
        notional = exec_price * qty
        fee = notional * self.fee_rate
        if side == "BUY":
            acct.quote_balances[sym.quote] = acct.quote_balances.get(sym.quote, 0.0) - notional - fee
            acct.base_balances[sym.base] = acct.base_balances.get(sym.base, 0.0) + qty
        else:
            acct.quote_balances[sym.quote] = acct.quote_balances.get(sym.quote, 0.0) + notional - fee
            acct.base_balances[sym.base] = acct.base_balances.get(sym.base, 0.0) - qty
        acct.seq += 1
        self._fills += 1
        order.update({"status": "FILLED", "executedQty": qty, "price": exec_price, "updateTime": int(time.time() * 1000)})
        trade = {
            "id": str(acct.seq),
            "orderId": str(order.get("orderId", acct.seq)),
            "symbol": sym.symbol,
            "side": side,
            "price": exec_price,
            "qty": qty,
            "quoteQty": notional,
            "commission": fee,
            "commissionAsset": sym.base if side == "SELL" else sym.quote,
            "time": int(time.time() * 1000),
            "clientOrderId": order.get("clientOrderId", ""),
        }
        acct.trades.append(trade)
        if len(acct.trades) > 3000:
            del acct.trades[: len(acct.trades) - 3000]
        return {"type": "fill", "data": {"order": dict(order), "trade": trade}}

    # ----------------------------------------------------- gateway: market data
    async def server_time(self) -> dict[str, Any]:
        return {"serverTime": int(time.time() * 1000), "localOffsetMs": 0, "latencyMs": 1}

    async def exchange_info(self, symbol: str | None = None) -> dict[str, Any]:
        syms = [self._sym(symbol)] if symbol else list(self.symbols.values())
        return {
            "timezone": "UTC",
            "serverTime": int(time.time() * 1000),
            "rateLimits": [{"limit": settings.BINANCE_WEIGHT_PER_MIN, "interval": "MINUTE", "intervalNum": 1}],
            "symbols": [
                {
                    "symbol": s.symbol, "status": "TRADING", "baseAsset": s.base, "quoteAsset": s.quote,
                    "baseAssetPrecision": s.decimals, "quotePrecision": 8, "orderTypes": ["LIMIT", "MARKET", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"],
                    "icebergAllowed": True, "ocoAllowed": True, "isSpotTradingAllowed": True, "quoteOrderQtyMarketAllowed": True,
                    "filters": [
                        {"filterType": "PRICE_FILTER", "tickSize": _fmt(s.tick_size)},
                        {"filterType": "LOT_SIZE", "stepSize": _fmt(s.step), "minQty": _fmt(s.step)},
                        {"filterType": "MIN_NOTIONAL", "notional": f"{settings.MIN_ORDER_NOTIONAL_USD:.8f}"},
                    ],
                }
                for s in syms
            ],
        }

    async def all_tickers(self) -> list[dict[str, Any]]:
        return [s.ticker_dict() for s in self.symbols.values()]

    async def ticker(self, symbol: str) -> dict[str, Any]:
        return self._sym(symbol).ticker_dict()

    async def klines(
        self, symbol: str, interval: str, limit: int = 500, *, start_ms: int | None = None, end_ms: int | None = None
    ) -> list[dict[str, Any]]:
        interval = _require_interval(interval)
        sym = self._sym(symbol)
        if start_ms:
            # long synthetic history for training / long charts
            return generate_history(symbol, interval=interval, bars=max(1, int(limit)), start_ms=int(start_ms))
        return sym.klines(interval, limit)

    async def depth(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        return self._sym(symbol).depth_dict(levels=min(int(limit), 50))

    # ------------------------------------------------------- gateway: user data
    async def account(self, creds: Creds | None = None) -> dict[str, Any]:
        acct = self.account_for(creds)
        balances = []
        for asset, free in {**acct.quote_balances, **acct.base_balances}.items():
            if free > 1e-9:
                balances.append({"asset": asset, "free": round(free, 8), "locked": 0.0, "total": round(free, 8)})
        return {
            "makerCommission": int(settings.MAKER_FEE_BPS * 100),
            "takerCommission": int(settings.TAKER_FEE_BPS * 100),
            "canTrade": True, "canWithdraw": False, "canDeposit": True,
            "updateTime": int(time.time() * 1000),
            "balances": balances, "permissions": ["SPOT"], "simulated": True,
        }

    async def api_permissions(self, creds: Creds | None = None) -> dict[str, Any]:
        return {"can_trade": True, "can_withdraw": False, "ip_restricted": True, "checked": True, "simulated": True}

    async def open_orders(self, symbol: str | None = None, creds: Creds | None = None) -> list[dict[str, Any]]:
        acct = self.account_for(creds)
        rows = [dict(o) for o in acct.orders.values() if not symbol or o["symbol"] == symbol.upper()]
        return sorted(rows, key=lambda r: -(r.get("time") or 0))

    async def my_trades(self, symbol: str | None = None, limit: int = 50, creds: Creds | None = None) -> list[dict[str, Any]]:
        acct = self.account_for(creds)
        rows = [t for t in acct.trades if not symbol or t["symbol"] == symbol.upper()]
        return list(reversed(rows[-int(limit) :]))

    async def place_order(self, order: dict[str, Any], creds: Creds | None = None) -> dict[str, Any]:
        sym = self._sym(order["symbol"])
        side = str(order["side"]).upper()
        otype = str(order.get("type", "MARKET")).upper()
        qty = float(order.get("quantity") or 0)
        price = float(order.get("price") or 0)
        if side not in ("BUY", "SELL"):
            raise ValidationError_("side must be BUY or SELL")
        if qty <= 0:
            raise ValidationError_("quantity must be > 0")
        acct = self.account_for(creds)
        notional = (price or sym.price) * qty
        if notional < settings.MIN_ORDER_NOTIONAL_USD:
            raise ValidationError_(
                f"order notional {notional:.2f} is below the exchange minimum ({settings.MIN_ORDER_NOTIONAL_USD:.2f})",
                details={"binance_code": -1013, "filter": "MIN_NOTIONAL"},
            )
        if side == "BUY":
            need = notional * (1 + self.fee_rate)
            if acct.quote_balances.get(sym.quote, 0.0) < need:
                raise InsufficientFundsError(
                    f"insufficient {sym.quote}: need {need:.2f}, have {acct.quote_balances.get(sym.quote, 0.0):.2f}"
                )
        elif acct.base_balances.get(sym.base, 0.0) < qty:
            raise InsufficientFundsError(
                f"insufficient {sym.base}: need {qty:.8f}, have {acct.base_balances.get(sym.base, 0.0):.8f}"
            )

        acct.seq += 1
        cid = order.get("clientOrderId") or f"sim{acct.seq:010d}"
        record = {
            "orderId": str(acct.seq),
            "clientOrderId": cid,
            "symbol": sym.symbol,
            "side": side,
            "type": otype,
            "price": sym.round_price(price) if price else 0.0,
            "stopPrice": order.get("stopPrice"),
            "origQty": qty,
            "executedQty": 0.0,
            "cummulativeQuoteQty": 0.0,
            "status": "NEW",
            "time": int(time.time() * 1000),
            "updateTime": int(time.time() * 1000),
            "timeInForce": order.get("timeInForce", "GTC"),
        }
        if otype == "MARKET":
            ev = self._fill(sym, acct, side, sym.price, qty, record)
            return {**ev["data"]["order"], "fills": [], "transactTime": int(time.time() * 1000), "raw": {"simulated": True}}
        acct.orders[cid] = record
        return {**record, "fills": [], "transactTime": None, "raw": {"simulated": True}}

    async def cancel_order(self, symbol: str, order_ref: str, creds: Creds | None = None) -> dict[str, Any]:
        acct = self.account_for(creds)
        order = acct.orders.pop(str(order_ref), None)
        if order is None:
            for cid, o in list(acct.orders.items()):
                if str(o.get("orderId")) == str(order_ref):
                    order = acct.orders.pop(cid)
                    break
        if order is None:
            raise ValidationError_("order already filled or does not exist", details={"binance_code": -2013})
        return {**order, "status": "CANCELED", "raw": {"simulated": True}}

    # ------------------------------------------------------------- app-only API
    def sparkline(self, symbol: str, points: int = 40, interval: str = "1h") -> list[float]:
        return self._sym(symbol).sparkline(points, interval)

    def _sym(self, symbol: str) -> SimSymbol:
        key = symbol.upper()
        sym = self.symbols.get(key)
        if sym is None:
            sym = SimSymbol(key, self.seed)
            self.symbols[key] = sym
            log.info("simulator lazily added %s", key)
        return sym


def generate_history(
    symbol: str,
    *,
    interval: str = "1m",
    bars: int = 5000,
    seed: int | None = None,
    start_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Generate ``bars`` candles of synthetic history for training/long charts.

    Same stochastic process as the live simulator, but unbounded length and no
    anchoring to the current price (that only matters for the live view).
    """
    interval = _require_interval(interval)
    seed = settings.SIM_SEED if seed is None else seed
    sym = SimSymbol(symbol.upper(), seed)
    step_s = INTERVAL_SECONDS[interval]
    n = max(120, int(bars))
    rng = sym.rng
    per_bar_vol = sym.annual_vol / math.sqrt(365.0 * 86400.0 / step_s)
    now_ms = int(start_ms or (time.time() * 1000))
    start_bucket = (now_ms // 1000) - (now_ms // 1000) % step_s - (n - 1) * step_s
    price = sym.price * math.exp(rng.gauss(0, per_bar_vol * math.sqrt(min(n, 240))))
    out: list[dict[str, Any]] = []
    ts = start_bucket
    for _ in range(n):
        o = price
        r = sym._step_return(step_s)
        c = max(1e-8, o * math.exp(r))
        wick = abs(c - o) * 0.7 + abs(o) * abs(sym._step_return(step_s)) * 0.5
        h = max(o, c) + wick * rng.uniform(0.1, 1.0)
        low_ = min(o, c) - wick * rng.uniform(0.1, 1.0)
        v = max(1e-6, sym.book_liquidity / max(c, 1e-9) * (step_s / 60.0) ** 0.75 * rng.uniform(0.3, 2.4))
        out.append(
            {
                "open_time": ts * 1000,
                "open": round(o, sym.decimals),
                "high": round(h, sym.decimals),
                "low": round(max(low_, 1e-8), sym.decimals),
                "close": round(c, sym.decimals),
                "volume": round(v, 8),
                "quote_volume": round(v * c, 8),
                "trades": int(rng.uniform(200, 6000) * (step_s / 60.0) ** 0.5),
                "taker_buy_volume": round(v * rng.uniform(0.36, 0.64), 8),
                "taker_buy_quote_volume": round(v * c * 0.5, 8),
                "closed": True,
            }
        )
        price = c
        ts += step_s
    return out


def _fmt(v: float) -> str:
    out = f"{v:.8f}".rstrip("0").rstrip(".")
    return out or "0"
