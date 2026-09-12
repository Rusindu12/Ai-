"""Backtester correctness: buy&hold parity, fees, stops, metrics, sizing."""

from __future__ import annotations

import pandas as pd
import pytest
from app.ai.backtest import BacktestResult, position_size, rsi_mean_reversion, run_backtest
from app.binance.simulator import MarketSimulator
from app.services.gateway import set_gateway


@pytest.fixture(autouse=True)
def _sim_gateway():
    sim = MarketSimulator(["BTCUSDT"], seed=77)
    set_gateway(sim)
    yield sim
    set_gateway(None)


def test_position_size_math():
    # $10k equity, 2% risk, $50 stop distance -> 4 units, capped by 50% position
    assert position_size(10_000, 100, 50, 0.02, 0.5) == pytest.approx(4.0)
    # when the stop is tight the cap binds instead
    assert position_size(10_000, 100, 0.1, 0.02, 0.5) == pytest.approx(50.0)
    assert position_size(0, 100, 1, 0.02, 0.5) == 0.0
    assert position_size(10_000, 0, 1, 0.02, 0.5) == 0.0


def test_strategy_functions_return_bounded_positions():
    bars = [dict(b.items()) for b in _flat_bars()]
    df = _enrich(bars)
    fn = rsi_mean_reversion(oversold=32, overbought=68, confirm_volume=False)
    for i in (60, 120, 200):
        assert -1.0 <= fn(df, i) <= 1.0


def _flat_bars(n: int = 300, start: float = 100.0) -> list[dict]:
    return [
        {
            "open_time": 1_700_000_000_000 + i * 60_000,
            "open": start, "high": start * 1.001, "low": start * 0.999, "close": start,
            "volume": 10.0, "quote_volume": 100.0, "trades": 5, "taker_buy_volume": 5.0, "closed": True,
        }
        for i in range(n)
    ]


def _enrich(rows: list[dict]) -> pd.DataFrame:
    from app.ai import indicators as ind

    df = pd.DataFrame(rows)
    df["atr"] = ind.atr(df["high"], df["low"], df["close"], 14)
    df["rsi"] = ind.rsi(df["close"], 14)
    df["macd_hist"] = ind.macd(df["close"])["hist"]
    df["bb_pctb"] = ind.bollinger(df["close"])["percent_b"]
    df["ema20"] = ind.ema(df["close"], 20)
    df["ema50"] = ind.ema(df["close"], 50)
    df["vol_ma"] = df["volume"].rolling(20).mean()
    df["ret1"] = df["close"].pct_change()
    return df.fillna(0.0)


async def test_buy_hold_matches_underlying_return():
    """With no fees/slippage, buy&hold must reproduce the price change exactly."""

    def always_long(df, i):
        return 1.0

    async def go():
        return await run_backtest(
            symbol="BTCUSDT", interval="1m", bars=600, strategy=always_long, fee_bps=0.0, slippage_bps=0.0,
            start_equity=10_000.0, max_position_pct=1.0, risk_per_trade=1e6, atr_sl_mult=1e6, atr_tp_mult=1e6,
        )

    result: BacktestResult = await go()
    assert result.metrics["trades"] == 1
    assert result.metrics["total_return_pct"] == pytest.approx(result.metrics["buy_hold_return_pct"], abs=0.05)


async def test_fees_and_slippage_always_cost_money():
    def once_long(df, i):
        return 1.0 if i == 61 else 0.0

    async def go(fee, slip):
        return await run_backtest(
            symbol="BTCUSDT", interval="1m", bars=400, strategy=once_long, fee_bps=fee, slippage_bps=slip,
            max_position_pct=1.0, risk_per_trade=1e6, atr_sl_mult=1e6, atr_tp_mult=1e6,
        )

    free = await go(0.0, 0.0)
    costly = await go(20.0, 20.0)
    assert costly.end_equity < free.end_equity
    assert costly.metrics["fees_paid"] > 0


def _crash_bars(n: int = 220, start: float = 100.0, drop: float = 0.01) -> list[dict]:
    """Monotonic 1%/bar crash - ideal for stop-loss behaviour tests."""
    out, price = [], start
    for i in range(n):
        o = price
        price = o * (1 - drop)
        out.append(
            {
                "open_time": 1_700_000_000_000 + i * 60_000,
                "open": o, "high": o * 1.0005, "low": price * 0.9995, "close": price,
                "volume": 10.0, "quote_volume": price * 10.0, "trades": 5, "taker_buy_volume": 5.0, "closed": True,
            }
        )
    return out


async def test_stop_loss_caps_the_downside(monkeypatch):
    """A tight ATR stop must lose far less than a position held through the crash."""
    bars = _crash_bars()

    async def fake_history(gateway, symbol, interval, limit=500, *, end_ms=None, **kw):
        return list(bars)

    import app.ai.dataset as dataset

    monkeypatch.setattr(dataset, "fetch_history", fake_history)

    async def go(mult):
        return await run_backtest(
            symbol="BTCUSDT", interval="1m", bars=len(bars), strategy=lambda df, i: 1.0,
            fee_bps=0.0, slippage_bps=0.0, max_position_pct=1.0, risk_per_trade=1e6,
            atr_sl_mult=mult, atr_tp_mult=1e6,
        )

    tight = await go(0.5)
    loose = await go(1e6)
    assert tight.metrics["max_drawdown_usd"] < loose.metrics["max_drawdown_usd"]
    assert tight.metrics["total_return_pct"] > loose.metrics["total_return_pct"]
    assert tight.trades and tight.trades[0]["reason"] == "stop_loss"


async def test_metrics_are_well_defined_on_zero_trades():
    async def go():
        return await run_backtest(symbol="BTCUSDT", interval="1m", bars=350, strategy=lambda df, i: 0.0, fee_bps=1.0)

    res = await go()
    assert res.metrics["trades"] == 0
    assert res.metrics["win_rate_pct"] == 0.0
    assert res.metrics["max_drawdown_pct"] == 0.0
    assert res.end_equity == pytest.approx(res.start_equity)
    assert res.equity_curve, "curve must still be produced for the UI"


async def test_result_serialisable():
    async def go():
        return await run_backtest(symbol="BTCUSDT", interval="1m", bars=350, strategy="rsi_reversion")

    payload = (await go()).as_dict(include_curve=True)
    import json

    blob = json.dumps(payload, default=str)
    for key in ("metrics", "trades", "equity_curve", "config", "monthly"):
        assert key in payload, key
    assert len(blob) > 100


async def test_short_disabled_by_default_and_enabled_on_request():
    """A permanent -1 signal must never open a trade unless allow_short=True."""

    def short_only(df, i):
        return -1.0

    blocked = await run_backtest(symbol="BTCUSDT", interval="1m", bars=350, strategy=short_only, allow_short=False)
    allowed = await run_backtest(symbol="BTCUSDT", interval="1m", bars=350, strategy=short_only, allow_short=True)
    assert blocked.metrics["trades"] == 0
    assert allowed.metrics["trades"] >= 1
    assert all(t["side"] == "SHORT" for t in allowed.trades)
