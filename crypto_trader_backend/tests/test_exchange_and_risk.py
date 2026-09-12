"""Simulator + rate limiter + risk manager behaviour."""

from __future__ import annotations

import asyncio
import math

import pytest
from app.binance.ratelimit import RateLimiter, backoff_delay
from app.binance.simulator import INTERVAL_SECONDS, MarketSimulator, SimSymbol, generate_history
from app.errors import InsufficientFundsError, ValidationError_
from app.risk.manager import RiskManager, SymbolFilters, risk_profile


@pytest.fixture()
def sim() -> MarketSimulator:
    return MarketSimulator(["BTCUSDT", "ETHUSDT"], seed=99)


def test_deterministic_seeding():
    a = SimSymbol("BTCUSDT", 1234)
    b = SimSymbol("BTCUSDT", 1234)
    c = SimSymbol("BTCUSDT", 9999)
    assert a.price == b.price, "all instances anchor on the same market price"
    assert a.klines("1m", 60) == b.klines("1m", 60), "same seed => identical candles"
    assert a.klines("1h", 60) != c.klines("1h", 60), "different seed => different shape"
    assert a.depth_dict(5)["bids"][0][1] != c.depth_dict(5)["bids"][0][1]


def test_candles_are_valid_ohlc(sim):
    for interval in INTERVAL_SECONDS:
        bars = sim.symbols["BTCUSDT"].klines(interval, 150)
        assert bars, interval
        for b in bars:
            assert b["high"] >= max(b["open"], b["close"]) - 1e-9
            assert b["low"] <= min(b["open"], b["close"]) + 1e-9
            assert b["high"] >= b["low"]
            assert b["volume"] > 0
        times = [b["open_time"] for b in bars]
        assert times == sorted(times), "candles must be chronological"


def test_all_timeframes_agree_with_the_live_price(sim):
    sym = sim.symbols["BTCUSDT"]
    price = sym.price
    for interval in ("1m", "15m", "1h", "4h", "1d"):
        last = sym.klines(interval, 5)[-1]
        assert last["low"] - 1e-6 <= price <= last["high"] + 1e-6, f"{interval} must contain the live mark"


def test_ticks_update_the_last_candle_and_roll_new_ones(sim):
    sym = sim.symbols["ETHUSDT"]
    bars = sym.klines("1m", 20)
    before_open_time = bars[-1]["open_time"]
    before_close = bars[-1]["close"]
    sym.advance()
    after = sym.klines("1m", 20)[-1]
    assert after["open_time"] == before_open_time
    assert after["close"] != before_close, "the live candle must move"


async def test_market_order_fills_and_updates_balances(sim):
    async def go():
        before = await sim.account()
        usdt_before = next(b["free"] for b in before["balances"] if b["asset"] == "USDT")
        res = await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET", "quantity": 0.01, "clientOrderId": "m1"})
        after = await sim.account()
        usdt_after = next(b["free"] for b in after["balances"] if b["asset"] == "USDT")
        btc_after = next(b["free"] for b in after["balances"] if b["asset"] == "BTC")
        return res, usdt_before, usdt_after, btc_after

    res, usdt_before, usdt_after, btc_after = await go()
    assert res["status"] == "FILLED"
    assert res["executedQty"] == pytest.approx(0.01)
    assert usdt_after < usdt_before, "quote balance must decrease on a buy"
    assert btc_after > 0


async def test_insufficient_balance_is_rejected(sim):
    with pytest.raises(InsufficientFundsError):
        await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET", "quantity": 500})


async def test_min_notional_enforced(sim):
    with pytest.raises(ValidationError_):
        await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET", "quantity": 0.0000001})


async def test_limit_orders_rest_then_fill_on_cross(sim):
    async def go():
        sym = sim.symbols["BTCUSDT"]
        price = sym.price * 1.05
        resting = await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "LIMIT", "quantity": 0.002, "price": price, "clientOrderId": "l1"})
        assert resting["status"] == "NEW"
        open_before = await sim.open_orders("BTCUSDT")
        assert len(open_before) == 1
        cancelled = await sim.cancel_order("BTCUSDT", "l1")
        assert cancelled["status"] == "CANCELED"
        assert await sim.open_orders("BTCUSDT") == []
        # a forced price cross must fill the resting order
        await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "LIMIT", "quantity": 0.002, "price": sym.price * 2, "clientOrderId": "l2"})
        events = await sim.step()
        assert any(e["type"] == "fill" for e in events), "crossing the level must produce a fill event"
        assert await sim.open_orders("BTCUSDT") == []

    await go()


async def test_cancel_unknown_order_raises(sim):
    with pytest.raises(ValidationError_):
        await sim.cancel_order("BTCUSDT", "does-not-exist")


async def test_accounts_are_isolated_per_user(sim):
    from app.binance.base import Creds

    class C1(Creds):
        def __init__(self):
            super().__init__("k1", "s1")
            self.user_id = 11

    class C2(Creds):
        def __init__(self):
            super().__init__("k2", "s2")
            self.user_id = 22

    async def go():
        await sim.place_order({"symbol": "BTCUSDT", "side": "BUY", "type": "MARKET", "quantity": 0.01}, C1())
        acc1 = await sim.account(C1())
        acc2 = await sim.account(C2())
        btc1 = {b["asset"]: b["free"] for b in acc1["balances"]}.get("BTC", 0)
        btc2 = {b["asset"]: b["free"] for b in acc2["balances"]}.get("BTC", 0)
        assert btc1 > btc2, "user 11 bought, user 22 must be untouched"
        assert len(await sim.my_trades(None, 10, C2())) == 0
        assert len(await sim.my_trades(None, 10, C1())) == 1

    await go()


def test_depth_book_is_ordered_and_around_mid(sim):
    book = sim.symbols["BTCUSDT"].depth_dict(12)
    bids = [p for p, _ in book["bids"]]
    asks = [p for p, _ in book["asks"]]
    assert bids == sorted(bids, reverse=True)
    assert asks == sorted(asks)
    assert max(bids) < min(asks)


def test_generate_history_length_and_shape():
    rows = generate_history("SOLUSDT", interval="5m", bars=1500)
    assert len(rows) == 1500
    assert all(r["high"] >= r["low"] for r in rows)
    assert all(rows[i]["open_time"] < rows[i + 1]["open_time"] for i in range(len(rows) - 1))


async def test_exchange_info_filters(sim):
    info = await sim.exchange_info("BTCUSDT")
    entry = info["symbols"][0]
    kinds = {f["filterType"] for f in entry["filters"]}
    assert {"PRICE_FILTER", "LOT_SIZE", "MIN_NOTIONAL"} <= kinds


# --------------------------------------------------------------------------- #
# Rate limiter
# --------------------------------------------------------------------------- #
async def test_rate_limiter_blocks_when_exhausted():
    limiter = RateLimiter(weight_per_min=5, orders_per_min=100, orders_per_day=100)

    async def go():
        for _ in range(5):
            await limiter.acquire(1.0)
        assert limiter.weight.used == pytest.approx(5.0)
        try:
            await asyncio.wait_for(limiter.acquire(3.0), timeout=0.25)
            return "waited"
        except TimeoutError:
            return "blocked"

    assert await go() == "blocked"


def test_rate_limiter_adopts_server_headers():
    limiter = RateLimiter(weight_per_min=100, orders_per_min=50, orders_per_day=1000)
    limiter.sync_from_headers({"x-mbx-used-weight-1m": "95", "x-mbx-order-count-10m": "40"})
    assert limiter.weight.used >= 95
    assert limiter.orders.used >= 40


def test_rate_limiter_penalties():
    limiter = RateLimiter(weight_per_min=100, orders_per_min=50, orders_per_day=1000)
    wait = limiter.penalise(retry_after_s=2.0, ip_ban=False)
    assert 1.9 <= wait <= 2.1
    hard = limiter.penalise(retry_after_s=None, ip_ban=True)
    assert hard >= 100
    snap = limiter.snapshot()
    assert snap["weight_limit_1m"] == 100


def test_backoff_is_bounded_and_jittered():
    values = [backoff_delay(i) for i in range(12)]
    assert all(0 <= v <= 12.0 for v in values)
    assert len(set(values)) > 5, "jitter must vary"
    assert max(values[7:]) > min(values[:3])


# --------------------------------------------------------------------------- #
# Risk manager
# --------------------------------------------------------------------------- #
class FakeUser:
    def __init__(self, **kw):
        self.id = kw.pop("id", 1)
        self.risk_level = "moderate"
        self.max_trade_size_usd = 500.0
        self.daily_loss_limit_usd = 200.0
        self.auto_trade_enabled = False
        self.auto_kill_switch = False
        self.binance_credential = object()
        self.__dict__.update(kw)


def test_risk_happy_path_sizes_down_to_limits():
    rm = RiskManager()
    d = rm.check_order(
        user=FakeUser(), symbol="BTCUSDT", side="BUY", qty=0.01, price=0, reference_price=68_000, quote_free=9_000,
        filters=SymbolFilters(tick_size=0.1, step_size=0.001, min_qty=0.001, min_notional=10.0),
    )
    # 500 / 68000 = 0.00735 floored to the 0.001 LOT_SIZE step
    assert d.allowed and d.adjusted_qty == pytest.approx(0.007)
    assert "max trade size" in " ".join(d.warnings)


def test_risk_kill_switch_blocks_everything():
    rm = RiskManager()
    d = rm.check_order(user=FakeUser(auto_kill_switch=True), symbol="BTCUSDT", side="BUY", qty=0.001, reference_price=68_000, quote_free=1000)
    assert not d.allowed and d.code == "kill_switch"


def test_risk_rejects_small_orders_and_bad_sides():
    rm = RiskManager()
    assert rm.check_order(user=FakeUser(), symbol="X", side="BUY", qty=0, reference_price=100).code == "bad_qty"
    assert rm.check_order(user=FakeUser(), symbol="X", side="BUY", qty=0.0001, reference_price=100).code == "min_notional"
    assert rm.check_order(user=FakeUser(), symbol="X", side="BUY", qty=1, price=10.005, reference_price=100, filters=SymbolFilters(tick_size=0.1)).code == "tick_size"


def test_risk_daily_loss_limit_trips():
    rm = RiskManager()
    user = FakeUser()
    rm.note_fill(user.id, "BTCUSDT", pnl=-250.0, notional=500)
    d = rm.check_order(user=user, symbol="BTCUSDT", side="BUY", qty=0.002, reference_price=68_000, quote_free=5_000)
    assert not d.allowed and d.code == "daily_loss_limit"


def test_risk_warns_near_the_limit():
    rm = RiskManager()
    user = FakeUser()
    rm.note_fill(user.id, "BTCUSDT", pnl=-170.0, notional=500)  # 85% of 200
    d = rm.check_order(user=user, symbol="BTCUSDT", side="BUY", qty=0.002, reference_price=68_000, quote_free=5_000)
    assert d.allowed
    assert any("approaching daily loss limit" in w for w in d.warnings)


def test_risk_cooldown_after_fill(monkeypatch):
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "TRADE_COOLDOWN_S", 60)
    rm = RiskManager()
    user = FakeUser(auto_trade_enabled=True)
    rm.note_fill(user.id, "ETHUSDT", pnl=1.0, notional=100)
    d = rm.check_order(user=user, symbol="ETHUSDT", side="BUY", qty=0.1, reference_price=3000, quote_free=5000)
    assert not d.allowed and d.code == "cooldown"
    rm2 = RiskManager()
    assert rm2.check_order(user=user, symbol="ETHUSDT", side="BUY", qty=0.1, reference_price=3000, quote_free=5000).allowed


def test_daily_stats_reset_across_days():
    rm = RiskManager()
    rm.note_fill(7, "BTCUSDT", pnl=-50, notional=100)
    assert rm.daily_stats(7)["orders"] == 1
    rm._daily[7]["day"] = "2000-01-01"
    assert rm.daily_stats(7)["orders"] == 0, "yesterday's counts must not leak"


def test_missing_credentials_when_required():
    rm = RiskManager()
    user = FakeUser(binance_credential=None)
    d = rm.check_order(user=user, symbol="BTCUSDT", side="BUY", qty=0.01, reference_price=68_000, quote_free=5000, require_credentials=True)
    assert not d.allowed and d.code == "missing_credentials"


def test_risk_profiles_are_ordered():
    c, m, a = (risk_profile(x) for x in ("conservative", "moderate", "aggressive"))
    assert c["risk_per_trade"] < m["risk_per_trade"] < a["risk_per_trade"]
    assert c["min_conf"] > m["min_conf"] > a["min_conf"]
    assert a["tp_atr"] > c["tp_atr"]
    assert math.isfinite(a["position_pct"])
