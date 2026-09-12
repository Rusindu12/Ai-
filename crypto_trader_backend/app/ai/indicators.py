"""Technical indicator library (pure pandas/numpy - no TA-Lib binary needed).

Every function takes pandas Series/DataFrames aligned on candle order (oldest
first) and returns Series aligned to the same index, so they can be overlaid on
a chart or fed to the ML feature builder without reindexing headaches.

Implemented: SMA, EMA, WMA, RSI (Wilder), MACD, Bollinger Bands + %B +
bandwidth, ATR, ADX/+DI/-DI, Stochastic %K/%D, Williams %R, ROC, CCI, OBV,
MFI, VWAP (session-anchored), Fibonacci-free S/R detection via pivot clustering,
volume-profile POC, and a volume-imbalance / buy-pressure block.
"""

from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any

import numpy as np
import pandas as pd


# --------------------------------------------------------------------------- #
# Moving averages
# --------------------------------------------------------------------------- #
def sma(values: pd.Series, period: int = 20) -> pd.Series:
    return values.rolling(period, min_periods=max(2, period // 2)).mean()


def ema(values: pd.Series, period: int = 20) -> pd.Series:
    return values.ewm(span=period, adjust=False, min_periods=max(2, period // 3)).mean()


def wma(values: pd.Series, period: int = 20) -> pd.Series:
    weights = np.arange(1, period + 1, dtype=float)
    out = values.rolling(period).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)
    return out


def hma(values: pd.Series, period: int = 20) -> pd.Series:
    half = wma(values, max(1, period // 2))
    full = wma(values, period)
    return wma(2 * half - full, max(1, int(round(np.sqrt(period)))))


# --------------------------------------------------------------------------- #
# Momentum
# --------------------------------------------------------------------------- #
def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100 - (100 / (1 + rs))
    return out.fillna(100.0).where(avg_loss != 0, 100.0).where(avg_gain.notna(), np.nan)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame(
        {
            "macd": macd_line,
            "signal": signal_line,
            "hist": macd_line - signal_line,
        }
    )


def bollinger(close: pd.Series, period: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    mid = sma(close, period)
    std = close.rolling(period, min_periods=max(2, period // 2)).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    width = (upper - lower) / mid.replace(0.0, np.nan)
    pct_b = (close - lower) / (upper - lower).replace(0.0, np.nan)
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "width": width, "percent_b": pct_b, "std": std})


def stochastic(high: pd.Series, low: pd.Series, close: pd.Series, k: int = 14, d: int = 3) -> pd.DataFrame:
    ll = low.rolling(k).min()
    hh = high.rolling(k).max()
    raw_k = 100 * (close - ll) / (hh - ll).replace(0.0, np.nan)
    return pd.DataFrame({"k": raw_k, "d": raw_k.rolling(d).mean()})


def williams_r(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    hh = high.rolling(period).max()
    ll = low.rolling(period).min()
    return -100 * (hh - close) / (hh - ll).replace(0.0, np.nan)


def roc(close: pd.Series, period: int = 9) -> pd.Series:
    return close.pct_change(period) * 100


def cci(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 20) -> pd.Series:
    tp = (high + low + close) / 3
    ma = sma(tp, period)
    md = (tp - ma).abs().rolling(period).mean()
    return (tp - ma) / (0.015 * md.replace(0.0, np.nan))


# --------------------------------------------------------------------------- #
# Volatility / trend
# --------------------------------------------------------------------------- #
def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev_close = close.shift(1)
    return pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.DataFrame:
    up = high.diff()
    down = -low.diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    tr = true_range(high, low, close)
    atr_ = tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    plus_di = 100 * pd.Series(plus_dm, index=high.index).ewm(alpha=1 / period, adjust=False).mean() / atr_
    minus_di = 100 * pd.Series(minus_dm, index=high.index).ewm(alpha=1 / period, adjust=False).mean() / atr_
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return pd.DataFrame({"adx": dx.ewm(alpha=1 / period, adjust=False).mean(), "plus_di": plus_di, "minus_di": minus_di, "atr": atr_})


def natr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    return 100 * atr(high, low, close, period) / close


# --------------------------------------------------------------------------- #
# Volume
# --------------------------------------------------------------------------- #
def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff()).fillna(0.0)
    return (direction * volume).cumsum()


def vwap(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, anchor: str = "D") -> pd.Series:
    """Session-anchored VWAP (resets each UTC day; ``anchor="h"`` for hourly)."""
    tp = (high + low + close) / 3
    raw_index = pd.Series(np.asarray(close.index), index=close.index)
    if np.issubdtype(raw_index.dtype, np.number):
        idx = pd.to_datetime(raw_index.astype("int64"), unit="ms", utc=True).to_numpy()
    else:
        idx = pd.to_datetime(raw_index, utc=True).to_numpy()
    freq = "1D" if anchor.upper() == "D" else "1h"
    stamps = pd.DatetimeIndex(idx.astype("datetime64[ms]") if idx.dtype.kind == "M" else idx)
    if stamps.tz is None:
        stamps = stamps.tz_localize("UTC")
    keys = pd.Series(stamps.floor(freq), index=close.index)
    pv = (tp * volume).groupby(keys.to_numpy()).cumsum()
    vv = volume.groupby(keys.to_numpy()).cumsum()
    return (pv / vv.replace(0.0, np.nan)).ffill()


def volume_profile_poc(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, bins: int = 24) -> dict[str, Any]:
    """Price-clustered volume profile: point of control + value area."""
    lo = float(min(high.min(), low.min()))
    hi = float(max(high.max(), low.max()))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        return {"poc": float(close.iloc[-1]), "vah": float(close.iloc[-1]), "val": float(close.iloc[-1]), "hist": []}
    edges = np.linspace(lo, hi, bins + 1)
    centres = (edges[:-1] + edges[1:]) / 2
    hist = np.zeros(bins)
    mid = ((high + low) / 2).to_numpy()
    vol = volume.to_numpy()
    idx = np.clip(np.searchsorted(edges, mid) - 1, 0, bins - 1)
    np.add.at(hist, idx, vol)
    poc_i = int(np.argmax(hist))
    total = hist.sum() or 1.0
    # value area = contiguous bins around POC covering 70% of volume
    lo_i = hi_i = poc_i
    covered = hist[poc_i]
    while covered / total < 0.7 and (lo_i > 0 or hi_i < bins - 1):
        left = hist[lo_i - 1] if lo_i > 0 else -1.0
        right = hist[hi_i + 1] if hi_i < bins - 1 else -1.0
        if right >= left:
            hi_i += 1
            covered += hist[hi_i]
        else:
            lo_i -= 1
            covered += hist[lo_i]
    return {
        "poc": float(centres[poc_i]),
        "vah": float(edges[hi_i + 1]),
        "val": float(edges[lo_i]),
        "hist": [[float(centres[i]), float(hist[i])] for i in range(bins)],
    }


def buy_sell_pressure(bars: pd.DataFrame) -> pd.DataFrame:
    """Taker-buy ratio + volume z-score + relative volume vs 20 bars."""
    out = pd.DataFrame(index=bars.index)
    base = bars["volume"].replace(0.0, np.nan)
    out["taker_ratio"] = (bars.get("taker_buy_volume", bars["volume"] * 0.5) / base).clip(0, 1).fillna(0.5)
    out["vol_z"] = (bars["volume"] - bars["volume"].rolling(20).mean()) / bars["volume"].rolling(20).std(ddof=0).replace(0.0, np.nan)
    out["rel_volume"] = (bars["volume"] / bars["volume"].rolling(20).mean().replace(0.0, np.nan)).fillna(1.0)
    return out


# --------------------------------------------------------------------------- #
# Support / resistance
# --------------------------------------------------------------------------- #
def pivots(high: pd.Series, low: pd.Series, left: int = 3, right: int = 3) -> tuple[pd.Series, pd.Series]:
    swing_high = high.rolling(2 * left + 1, center=True).max() == high
    swing_low = low.rolling(2 * right + 1, center=True).min() == low
    return swing_high, swing_low


def support_resistance(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    *,
    lookback: int = 300,
    tolerance: float = 0.0035,
    max_levels: int = 4,
) -> dict[str, Any]:
    """Cluster swing pivots into S/R levels weighted by touch count.

    Returns levels strictly below/above price (nearest first) plus the raw
    cluster list so the UI can draw horizontal zones.
    """
    n = min(lookback, len(close))
    h, lo_series, c = high.iloc[-n:], low.iloc[-n:], close.iloc[-n:]
    ph, pl = pivots(h, lo_series)
    price = float(c.iloc[-1])
    levels: list[dict[str, Any]] = []
    highs = h[ph.fillna(False)]
    lows = lo_series[pl.fillna(False)]
    raw = [(float(v), "R") for v in highs.to_numpy()] + [(float(v), "S") for v in lows.to_numpy()]
    for value, kind in sorted(raw, key=lambda x: x[0]):
        placed = False
        for lvl in levels:
            if abs(lvl["price"] - value) / max(lvl["price"], 1e-9) <= tolerance:
                lvl["touches"] += 1
                lvl["price"] = (lvl["price"] * (lvl["touches"] - 1) + value) / lvl["touches"]
                lvl["kinds"].append(kind)
                placed = True
                break
        if not placed:
            levels.append({"price": value, "touches": 1, "kinds": [kind]})
    for lvl in levels:
        r_count, s_count = lvl["kinds"].count("R"), lvl["kinds"].count("S")
        lvl["role"] = "resistance" if r_count >= s_count else "support"
        lvl["strength"] = min(100.0, 12.0 * lvl["touches"] + 4.0 * abs(r_count - s_count))
        lvl["distance_pct"] = (lvl["price"] / price - 1.0) * 100
    resistances = sorted([x for x in levels if x["price"] > price and x["role"] == "resistance"], key=lambda x: x["price"])
    supports = sorted([x for x in levels if x["price"] < price], key=lambda x: -x["price"])
    return {
        "price": price,
        "supports": [round(s["price"], 8) for s in supports[:max_levels]],
        "resistances": [round(r["price"], 8) for r in resistances[:max_levels]],
        "levels": [
            {
                "price": round(x["price"], 8),
                "role": x["role"],
                "touches": x["touches"],
                "strength": round(x["strength"], 1),
                "distance_pct": round(x["distance_pct"], 3),
            }
            for x in sorted(levels, key=lambda z: abs(z["price"] / price - 1))[:10]
        ],
    }


# --------------------------------------------------------------------------- #
# One-shot computation used by the API + AI engine
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class IndicatorSnapshot:
    symbol: str
    interval: str
    price: float
    rsi: float
    macd: float
    macd_signal: float
    macd_hist: float
    ema_20: float
    ema_50: float
    ema_200: float
    sma_20: float
    bb_upper: float
    bb_lower: float
    bb_mid: float
    bb_percent_b: float
    bb_width: float
    atr: float
    atr_pct: float
    adx: float
    plus_di: float
    minus_di: float
    vwap: float
    stoch_k: float
    stoch_d: float
    williams_r: float
    roc: float
    cci: float
    obv: float
    obv_slope: float
    mfi: float
    volume: float
    relative_volume: float
    vol_z: float
    taker_ratio: float
    supports: list[float]
    resistances: list[float]
    levels: list[dict[str, Any]]
    poc: float
    value_area_high: float
    value_area_low: float
    trend: str
    momentum: str
    volatility_state: str
    raw: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        d = {f.name: getattr(self, f.name) for f in fields(self) if f.name != "raw"}
        d["series"] = self.raw.get("series", {})
        return d

    def series_only(self) -> dict[str, list[float]]:
        return self.raw.get("series", {})


def compute(bars: list[dict[str, Any]] | pd.DataFrame, symbol: str = "", interval: str = "1m") -> IndicatorSnapshot:
    """Compute the full indicator snapshot for one symbol/interval."""
    df = bars if isinstance(bars, pd.DataFrame) else pd.DataFrame(bars)
    if df.empty or len(df) < 30:
        raise ValueError("need at least 30 candles to compute indicators")
    df = df.copy().reset_index(drop=True)
    for col, default in (("open", 0.0), ("high", 0.0), ("low", 0.0), ("close", 0.0), ("volume", 0.0), ("taker_buy_volume", 0.0)):
        if col not in df.columns:
            df[col] = default
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(default)
    if "open_time" in df.columns:
        df.index = pd.Index(pd.to_numeric(df["open_time"], errors="coerce").fillna(0).astype("int64"))
    close, high, low, vol = df["close"], df["high"], df["low"], df["volume"]

    rsi_s = rsi(close, 14)
    macd_df = macd(close)
    bb = bollinger(close, 20, 2.0)
    adx_df = adx(high, low, close, 14)
    atr_s = atr(high, low, close, 14)
    st = stochastic(high, low, close)
    wr = williams_r(high, low, close)
    roc_s = roc(close, 9)
    cci_s = cci(high, low, close)
    obv_s = obv(close, vol)
    pressure = buy_sell_pressure(df)
    sr = support_resistance(high, low, close)
    prof = volume_profile_poc(high, low, close, vol)
    try:
        vwap_s = vwap(high, low, close, vol)
    except Exception:  # pragma: no cover - index edge cases
        vwap_s = pd.Series(np.nan, index=close.index)

    last = -1
    price = float(close.iloc[last])
    ema50 = ema(close, 50)
    ema200 = ema(close, 200) if len(close) >= 200 else pd.Series(np.nan, index=close.index)
    ema20s = ema(close, 20)
    mfi_s = _mfi(high, low, close, vol)
    atr_last = float(_val(atr_s, last))
    adx_last = float(_val(adx_df["adx"], last))
    bb_width_last = float(_val(bb["width"], last))
    obv_slope = float((obv_s.iloc[last] - obv_s.iloc[max(0, last - 10)]) / max(1.0, abs(obv_s.iloc[max(0, last - 10)])) * 100)

    e20, e50 = float(_val(ema20s, last)), float(_val(ema50, last))
    e200 = float(_val(ema200, last)) if np.isfinite(_val(ema200, last)) else e50
    if e50 > e200 and price > e50:
        trend = "uptrend"
    elif e50 < e200 and price < e50:
        trend = "downtrend"
    elif price > e50:
        trend = "weak-uptrend"
    else:
        trend = "weak-downtrend"

    rsi_last = float(_val(rsi_s, last))
    macd_hist_last = float(_val(macd_df["hist"], last))
    if rsi_last < 30 or (rsi_last < 45 and macd_hist_last > 0):
        momentum = "oversold-bounce"
    elif rsi_last > 70 or (rsi_last > 55 and macd_hist_last < 0):
        momentum = "overbought-fade"
    else:
        momentum = "neutral"

    vol_atr_pct = (atr_last / price * 100) if price else 0.0
    if vol_atr_pct > 1.6 or bb_width_last > 0.09:
        volatility = "high"
    elif vol_atr_pct < 0.35 or bb_width_last < 0.02:
        volatility = "squeeze"
    else:
        volatility = "normal"

    series = {
        "ema_fast": _tail(ema20s, 180),
        "ema_slow": _tail(ema50, 180),
        "bb_upper": _tail(bb["upper"], 180),
        "bb_lower": _tail(bb["lower"], 180),
        "bb_mid": _tail(bb["mid"], 180),
        "rsi": _tail(rsi_s, 180),
        "macd": _tail(macd_df["macd"], 180),
        "macd_signal": _tail(macd_df["signal"], 180),
        "macd_hist": _tail(macd_df["hist"], 180),
        "volume": _tail(vol, 180),
        "vwap": _tail(vwap_s, 180),
        "atr": _tail(atr_s, 180),
    }

    return IndicatorSnapshot(
        symbol=symbol,
        interval=interval,
        price=price,
        rsi=round(rsi_last, 2),
        macd=round(float(_val(macd_df["macd"], last)), 8),
        macd_signal=round(float(_val(macd_df["signal"], last)), 8),
        macd_hist=round(macd_hist_last, 8),
        ema_20=round(e20, 8),
        ema_50=round(e50, 8),
        ema_200=round(e200, 8),
        sma_20=round(float(_val(sma(close, 20), last)), 8),
        bb_upper=round(float(_val(bb["upper"], last)), 8),
        bb_lower=round(float(_val(bb["lower"], last)), 8),
        bb_mid=round(float(_val(bb["mid"], last)), 8),
        bb_percent_b=round(float(_val(bb["percent_b"], last)), 4),
        bb_width=round(bb_width_last, 5),
        atr=round(atr_last, 8),
        atr_pct=round(vol_atr_pct, 4),
        adx=round(adx_last, 2),
        plus_di=round(float(_val(adx_df["plus_di"], last)), 2),
        minus_di=round(float(_val(adx_df["minus_di"], last)), 2),
        vwap=round(float(_val(vwap_s, last)) if np.isfinite(_val(vwap_s, last)) else price, 8),
        stoch_k=round(float(_val(st["k"], last)), 2),
        stoch_d=round(float(_val(st["d"], last)), 2),
        williams_r=round(float(_val(wr, last)), 2),
        roc=round(float(_val(roc_s, last)), 3),
        cci=round(float(_val(cci_s, last)), 2),
        obv=round(float(_val(obv_s, last)), 2),
        obv_slope=round(obv_slope, 3),
        mfi=round(float(_val(mfi_s, last)), 2),
        volume=float(vol.iloc[last]),
        relative_volume=round(float(_val(pressure["rel_volume"], last)), 3),
        vol_z=round(float(_val(pressure["vol_z"], last)), 3),
        taker_ratio=round(float(_val(pressure["taker_ratio"], last)), 4),
        supports=sr["supports"],
        resistances=sr["resistances"],
        levels=sr["levels"],
        poc=round(prof["poc"], 8),
        value_area_high=round(prof["vah"], 8),
        value_area_low=round(prof["val"], 8),
        trend=trend,
        momentum=momentum,
        volatility_state=volatility,
        raw={"series": series, "levels": sr["levels"]},
    )


def _val(s: pd.Series, i: int) -> float:
    try:
        v = s.iloc[i]
    except (IndexError, KeyError):  # pragma: no cover
        return float("nan")
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float("nan")
    return f if np.isfinite(f) else 0.0


def _tail(s: pd.Series, n: int) -> list[float]:
    vals = [float(x) if np.isfinite(x) else 0.0 for x in s.to_numpy()[-n:]]
    return [round(v, 8) for v in vals]


def _mfi(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, period: int = 14) -> pd.Series:
    tp = (high + low + close) / 3
    raw = tp * volume
    delta = tp.diff()
    pos = raw.where(delta > 0, 0.0).rolling(period).sum()
    neg = raw.where(delta < 0, 0.0).rolling(period).sum()
    ratio = pos / neg.replace(0.0, np.nan)
    return (100 - 100 / (1 + ratio)).fillna(50.0)
