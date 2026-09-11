"""
Feature engineering for the AI trading engine.

Computes the technical-indicator feature matrix that both the scikit-learn
ensemble and the PyTorch LSTM consume: RSI, MACD, Bollinger Bands, EMA/SMA,
VWAP, momentum, trend, ATR, volatility, volume profile, and order-book
imbalance. Pure NumPy — no external data sources.
"""
from __future__ import annotations

import numpy as np


def sma(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(values.shape, np.nan)
    if len(values) >= period:
        csum = np.cumsum(np.insert(values, 0, 0.0))
        out[period - 1:] = (csum[period:] - csum[:-period]) / period
    return out


def ema(values: np.ndarray, period: int) -> np.ndarray:
    out = np.full(values.shape, np.nan)
    if len(values) < period:
        return out
    alpha = 2.0 / (period + 1)
    out[period - 1] = values[:period].mean()
    for i in range(period, len(values)):
        out[i] = values[i] * alpha + out[i - 1] * (1 - alpha)
    return out


def rsi(values: np.ndarray, period: int = 14) -> np.ndarray:
    out = np.full(values.shape, np.nan)
    if len(values) <= period:
        return out
    delta = np.diff(values)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.full_like(values, np.nan, dtype=float)
    avg_loss = np.full_like(values, np.nan, dtype=float)
    avg_gain[period] = gain[:period].mean()
    avg_loss[period] = loss[:period].mean()
    for i in range(period + 1, len(values)):
        avg_gain[i] = (avg_gain[i - 1] * (period - 1) + gain[i - 1]) / period
        avg_loss[i] = (avg_loss[i - 1] * (period - 1) + loss[i - 1]) / period
    rs = np.divide(avg_gain, avg_loss, out=np.full_like(avg_gain, np.inf), where=avg_loss != 0)
    out = 100 - 100 / (1 + rs)
    out[avg_loss == 0] = 100.0
    return out


def macd(values: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    ema_fast = ema(values, fast)
    ema_slow = ema(values, slow)
    line = ema_fast - ema_slow
    # signal over the line (ignoring leading NaNs)
    valid = line[~np.isnan(line)]
    sig_valid = ema(valid, signal)
    sig = np.full(line.shape, np.nan)
    start = np.argmax(~np.isnan(line))
    sig[start:start + len(sig_valid)] = sig_valid
    return {"line": line, "signal": sig, "histogram": line - sig}


def bollinger_bands(values: np.ndarray, period: int = 20, mult: float = 2.0) -> dict:
    mid = sma(values, period)
    std = np.full(values.shape, np.nan)
    for i in range(period - 1, len(values)):
        std[i] = values[i - period + 1:i + 1].std()
    return {"upper": mid + mult * std, "middle": mid, "lower": mid - mult * std}


def vwap(closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
    out = np.full(closes.shape, np.nan)
    cum_pv = np.cumsum(closes * volumes)
    cum_v = np.cumsum(volumes)
    out[cum_v > 0] = cum_pv[cum_v > 0] / cum_v[cum_v > 0]
    return out


def momentum(values: np.ndarray, period: int = 10) -> np.ndarray:
    out = np.full(values.shape, np.nan)
    if len(values) > period:
        out[period:] = (values[period:] - values[:-period]) / np.where(values[:-period] != 0, values[:-period], np.nan)
    return out


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    out = np.full(closes.shape, np.nan)
    n = len(closes)
    if n < period + 1:
        return out
    prev_close = np.roll(closes, 1)
    prev_close[0] = closes[0]
    tr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_close), np.abs(lows - prev_close)))
    out[period] = tr[1:period + 1].mean()
    for i in range(period + 1, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def log_returns(closes: np.ndarray) -> np.ndarray:
    out = np.full(closes.shape, np.nan)
    valid = (closes[1:] > 0) & (closes[:-1] > 0)
    out[1:] = np.where(valid, np.log(closes[1:] / np.where(closes[:-1] > 0, closes[:-1], np.nan)), np.nan)
    return out


def realized_volatility(closes: np.ndarray, period: int = 20) -> np.ndarray:
    out = np.full(closes.shape, np.nan)
    rets = log_returns(closes)
    for i in range(period, len(closes)):
        out[i] = np.nanstd(rets[i - period + 1:i + 1])
    return out


def order_book_imbalance(bids: list, asks: list, depth: int = 20) -> float:
    bid_vol = sum(float(q) for _, q in bids[:depth])
    ask_vol = sum(float(q) for _, q in asks[:depth])
    total = bid_vol + ask_vol
    return (bid_vol - ask_vol) / total if total > 0 else 0.0


def volume_profile(closes: np.ndarray, volumes: np.ndarray, bins: int = 10) -> np.ndarray:
    """Fraction of volume concentrated near the last price (0..1)."""
    out = np.full(closes.shape, np.nan)
    for i in range(bins, len(closes)):
        window_closes = closes[i - bins + 1:i + 1]
        window_vols = volumes[i - bins + 1:i + 1]
        total = window_vols.sum()
        if total <= 0:
            continue
        hist, edges = np.histogram(window_closes, bins=bins, weights=window_vols)
        last = closes[i]
        idx = int(np.clip(np.searchsorted(edges, last) - 1, 0, bins - 1))
        out[i] = hist[idx] / total
    return out


def build_features(candles: list[dict], order_book: dict | None = None) -> tuple[np.ndarray, list[str]]:
    """
    Convert a list of OHLCV candles into a feature matrix.

    candles: [{open, high, low, close, volume}, ...] (chronological order)
    Returns (X, feature_names). Rows with NaN (warm-up) are dropped.
    """
    closes = np.array([c["close"] for c in candles], dtype=float)
    highs = np.array([c["high"] for c in candles], dtype=float)
    lows = np.array([c["low"] for c in candles], dtype=float)
    volumes = np.array([c["volume"] for c in candles], dtype=float)

    r = rsi(closes, 14)
    m = macd(closes)
    bb = bollinger_bands(closes)
    ema20 = ema(closes, 20)
    sma50 = sma(closes, 50)
    vw = vwap(closes, volumes)
    mom = momentum(closes, 10)
    tr = atr(highs, lows, closes, 14)
    vol = realized_volatility(closes, 20)
    vp = volume_profile(closes, volumes)
    ret1 = np.diff(closes, prepend=np.nan) / np.where(closes != 0, closes, np.nan)

    obi = 0.0
    if order_book:
        obi = order_book_imbalance(order_book.get("bids", []), order_book.get("asks", []))

    columns = {
        "rsi": r, "macd": m["line"], "macd_signal": m["signal"], "macd_hist": m["histogram"],
        "bb_upper": bb["upper"], "bb_middle": bb["middle"], "bb_lower": bb["lower"],
        "bb_width": bb["upper"] - bb["lower"],
        "ema20": ema20, "sma50": sma50,
        "price_vs_ema20": (closes - ema20) / np.where(ema20 != 0, ema20, np.nan),
        "vwap": vw, "price_vs_vwap": (closes - vw) / np.where(vw != 0, vw, np.nan),
        "momentum10": mom, "atr": tr, "atr_pct": tr / np.where(closes != 0, closes, np.nan),
        "volatility20": vol, "volume_profile": vp, "return1": ret1,
        "obi": np.full(closes.shape, obi),
    }
    names = list(columns.keys())
    X = np.column_stack([columns[n] for n in names])
    return X, names
