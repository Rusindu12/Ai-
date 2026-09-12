"""Indicator math is verified against hand-computed / property based checks."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from app.ai import indicators as ind


def make_bars(closes: list[float], *, spread: float = 0.01, volume: float = 100.0, start_ts: int = 1_700_000_000_000, step_ms: int = 60_000) -> list[dict]:
    bars = []
    for i, close in enumerate(closes):
        prev = closes[i - 1] if i else close
        o = prev
        h = max(o, close) * (1 + spread)
        l = min(o, close) * (1 - spread)
        bars.append(
            {
                "open_time": start_ts + i * step_ms,
                "open": o,
                "high": h,
                "low": l,
                "close": close,
                "volume": volume,
                "quote_volume": volume * close,
                "trades": 10 + i,
                "taker_buy_volume": volume * 0.5,
                "closed": True,
            }
        )
    return bars


def test_sma_matches_manual_mean():
    s = pd.Series([1, 2, 3, 4, 5, 6], dtype=float)
    out = ind.sma(s, 3)
    assert out.iloc[-1] == pytest.approx(5.0)
    assert out.iloc[2] == pytest.approx(2.0)
    assert math.isnan(out.iloc[0])


def test_ema_warms_up_then_tracks_the_price():
    s = pd.Series([10.0] * 5 + [20.0] * 40)
    out = ind.ema(s, 5)
    assert math.isnan(out.iloc[0]), "EMA needs min_periods before it is defined"
    assert out.dropna().iloc[0] == pytest.approx(10.0, rel=1e-6)
    assert out.iloc[-1] > 19.5, "a long run at 20 must converge to 20"
    assert out.iloc[-1] <= 20.0
    assert out.iloc[6] < 20 and out.iloc[6] > 10, "must move monotonically toward the new level"


def test_rsi_extremes_and_bounds():
    up = ind.rsi(pd.Series(np.linspace(10, 60, 60))).iloc[-1]
    down = ind.rsi(pd.Series(np.linspace(60, 10, 60))).iloc[-1]
    assert up > 95
    assert down < 5
    flat = ind.rsi(pd.Series([50.0] * 80)).dropna()
    assert ((flat >= 0) & (flat <= 100)).all()


def test_macd_hist_is_line_minus_signal():
    close = pd.Series(np.cumsum(np.random.default_rng(1).normal(0, 1, 200)) + 100)
    m = ind.macd(close)
    tail = m.dropna().tail(50)
    assert np.allclose(tail["macd"] - tail["signal"], tail["hist"])


def test_bollinger_bands_order_and_percent_b():
    close = pd.Series(np.linspace(100, 120, 100))
    bb = ind.bollinger(close, 20, 2.0)
    valid = bb.dropna()
    assert (valid["upper"] >= valid["mid"]).all()
    assert (valid["mid"] >= valid["lower"]).all()
    assert valid["std"].iloc[-1] == pytest.approx(close.rolling(20).std(ddof=0).iloc[-1], rel=1e-9)
    # a rising series finishing at the top of the band -> %B near 1
    assert valid["percent_b"].iloc[-1] > 0.9


def test_atr_is_positive_and_scales_with_range():
    calm = make_bars([100 + 0.01 * i for i in range(100)], spread=0.0005)
    wild = make_bars([100 + 0.01 * i for i in range(100)], spread=0.05)
    a_calm = ind.atr(pd.Series([b["high"] for b in calm]), pd.Series([b["low"] for b in calm]), pd.Series([b["close"] for b in calm]))
    a_wild = ind.atr(pd.Series([b["high"] for b in wild]), pd.Series([b["low"] for b in wild]), pd.Series([b["close"] for b in wild]))
    assert a_calm.iloc[-1] > 0
    assert a_wild.iloc[-1] > a_calm.iloc[-1]


def test_vwap_sits_inside_high_low_range():
    bars = make_bars([100 + math.sin(i / 6) * 4 for i in range(200)], volume=50)
    df = pd.DataFrame(bars)
    v = ind.vwap(df["high"], df["low"], df["close"], df["volume"]).dropna()
    assert len(v) > 10
    assert v.iloc[-1] >= df["low"].min() and v.iloc[-1] <= df["high"].max()


def test_obv_direction():
    close = pd.Series([10, 11, 12, 11, 13])
    vol = pd.Series([100, 100, 100, 100, 100], dtype=float)
    obv = ind.obv(close, vol)
    assert obv.iloc[1] > obv.iloc[0]      # up bar adds volume
    assert obv.iloc[3] < obv.iloc[2]      # down bar subtracts
    assert obv.iloc[0] == pytest.approx(0.0)


def test_support_resistance_levels_are_sane():
    prices = [100, 105, 100, 110, 100, 108, 101, 99, 104, 100] * 12
    bars = make_bars(prices)
    df = pd.DataFrame(bars)
    sr = ind.support_resistance(df["high"], df["low"], df["close"])
    price = sr["price"]
    assert all(x < price for x in sr["supports"])
    assert all(x > price for x in sr["resistances"])
    for lvl in sr["levels"]:
        assert lvl["strength"] > 0
        assert lvl["role"] in ("support", "resistance")


def test_volume_profile_poc_within_range():
    bars = make_bars([100 + math.sin(i / 5) * 8 for i in range(300)], volume=25)
    df = pd.DataFrame(bars)
    prof = ind.volume_profile_poc(df["high"], df["low"], df["close"], df["volume"], bins=20)
    assert df["low"].min() <= prof["poc"] <= df["high"].max()
    assert prof["val"] <= prof["poc"] <= prof["vah"]
    assert len(prof["hist"]) == 20


def test_compute_snapshot_and_series():
    closes = [100 + i * 0.1 + math.sin(i / 7) * 3 for i in range(400)]
    bars = make_bars(closes)
    snap = ind.compute(bars, "TESTUSDT", "1m")
    assert snap.symbol == "TESTUSDT"
    assert snap.price == pytest.approx(closes[-1], rel=1e-6)
    assert 0 <= snap.rsi <= 100
    assert snap.bb_upper >= snap.bb_mid >= snap.bb_lower
    assert snap.atr > 0
    assert snap.adx >= 0
    assert snap.trend in ("uptrend", "downtrend", "weak-uptrend", "weak-downtrend")
    assert snap.volatility_state in ("high", "normal", "squeeze")
    series = snap.raw["series"]
    assert len(series["rsi"]) == len(series["ema_fast"]) == len(series["volume"])
    payload = snap.as_dict()
    assert {"rsi", "macd", "bb_upper", "vwap", "supports", "levels", "series"} <= set(payload)


def test_compute_requires_enough_history():
    with pytest.raises(ValueError):
        ind.compute(make_bars([100.0] * 10))


def test_buy_sell_pressure_bounds():
    bars = make_bars([100 + (i % 7) for i in range(120)])
    df = pd.DataFrame(bars)
    df["taker_buy_volume"] = df["volume"] * 0.5
    out = ind.buy_sell_pressure(df)
    assert ((out["taker_ratio"] >= 0) & (out["taker_ratio"] <= 1)).all()
    assert out["rel_volume"].iloc[-1] > 0
