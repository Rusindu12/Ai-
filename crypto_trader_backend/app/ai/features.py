"""Feature engineering shared by the LSTM, the classifier and the rules engine.

All features are *stationary* (returns, ratios, normalised oscillators) so the
models do not need re-fitting when the price level changes.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from app.ai import indicators as ind

FEATURE_NAMES = [
    "ret_1", "ret_3", "ret_6", "ret_12", "ret_24",
    "rsi_n", "rsi_slope", "macd_hist_n", "macd_cross",
    "bb_pctb", "bb_width_n", "atr_pct_n", "natr",
    "ema_ratio_20", "ema_ratio_50", "ema_cross",
    "vol_ratio", "taker_ratio", "obv_slope",
    "dist_support", "dist_resist", "hl_range", "close_pos",
]


def build_frame(bars: list[dict[str, Any]] | pd.DataFrame) -> pd.DataFrame:
    """Return a fully populated feature frame (same length as ``bars``)."""
    df = bars if isinstance(bars, pd.DataFrame) else pd.DataFrame(bars)
    if df.empty:
        raise ValueError("no candles supplied")
    df = df.reset_index(drop=True).copy()
    for col, default in (("open", 0.0), ("high", 0.0), ("low", 0.0), ("close", 0.0), ("volume", 0.0), ("taker_buy_volume", 0.0)):
        if col not in df.columns:
            df[col] = default
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(default)
    close, high, low, vol = df["close"], df["high"], df["low"], df["volume"]

    out = pd.DataFrame(index=df.index)
    for n in (1, 3, 6, 12, 24):
        out[f"ret_{n}"] = close.pct_change(n).fillna(0.0)
    rsi = ind.rsi(close, 14)
    out["rsi_n"] = (rsi - 50.0) / 50.0
    out["rsi_slope"] = (rsi - rsi.shift(5)) / 50.0
    m = ind.macd(close)
    price = close.replace(0.0, np.nan)
    out["macd_hist_n"] = (m["hist"] / price).fillna(0.0) * 1000
    out["macd_cross"] = np.sign(m["hist"]).diff().fillna(0.0)
    bb = ind.bollinger(close, 20, 2.0)
    out["bb_pctb"] = bb["percent_b"].clip(-0.5, 1.5).fillna(0.5)
    out["bb_width_n"] = (bb["width"] / bb["width"].rolling(50).std(ddof=0).replace(0.0, np.nan)).fillna(0.0).clip(-6, 6)
    atr = ind.atr(high, low, close, 14)
    out["atr_pct_n"] = ((atr / price) * 100).fillna(0.0)
    out["natr"] = out["atr_pct_n"]
    e20, e50 = ind.ema(close, 20), ind.ema(close, 50)
    e200 = ind.ema(close, 200)
    out["ema_ratio_20"] = (close / e20 - 1.0).fillna(0.0) * 100
    out["ema_ratio_50"] = (close / e50 - 1.0).fillna(0.0) * 100
    out["ema_cross"] = np.sign(e20 - e50).diff().fillna(0.0)
    vma = vol.rolling(20).mean().replace(0.0, np.nan)
    out["vol_ratio"] = (vol / vma).fillna(1.0).clip(0, 8)
    base = vol.replace(0.0, np.nan)
    out["taker_ratio"] = ((df["taker_buy_volume"] / base).fillna(0.5) * 2 - 1).clip(-1, 1)
    obv = ind.obv(close, vol)
    out["obv_slope"] = (obv.diff(6) / (vol.rolling(6).mean() * 6).replace(0.0, np.nan)).fillna(0.0).clip(-4, 4)
    rolling_sup = low.rolling(30).min()
    rolling_res = high.rolling(30).max()
    out["dist_support"] = ((close / rolling_sup - 1.0) * 100).fillna(0.0).clip(-20, 20)
    out["dist_resist"] = ((rolling_res / close - 1.0) * 100).fillna(0.0).clip(-20, 20)
    rng = (high - low).replace(0.0, np.nan)
    out["hl_range"] = (rng / price).fillna(0.0) * 100
    out["close_pos"] = ((close - low) / rng).fillna(0.5)
    _ = e200  # kept for API symmetry; long EMAs are used in the rules engine
    for name in FEATURE_NAMES:
        if name not in out.columns:
            out[name] = 0.0
    return out[FEATURE_NAMES].replace([np.inf, -np.inf], 0.0).fillna(0.0)


def fit_stats(frame: pd.DataFrame, *, train_fraction: float = 1.0) -> dict[str, dict[str, float]]:
    """Fit the scaler on (a prefix of) the frame - never on validation data."""
    n = max(1, int(len(frame) * train_fraction))
    sub = frame.iloc[:n]
    out: dict[str, dict[str, float]] = {}
    for col in sub.columns:
        mean = float(sub[col].mean()) if len(sub) else 0.0
        std = float(sub[col].std(ddof=0)) if len(sub) > 1 else 0.0
        if not np.isfinite(std) or std <= 1e-12:
            std = 1.0
        out[col] = {"mean": mean if np.isfinite(mean) else 0.0, "std": std}
    return out


def standardise(frame: pd.DataFrame, stats: dict[str, dict[str, float]] | None = None) -> tuple[np.ndarray, dict[str, dict[str, float]]]:
    """Zero-mean unit-variance scaling with persistable statistics."""
    if stats is None:
        mean = frame.mean().to_dict()
        std = frame.std(ddof=0).replace(0.0, 1.0).to_dict()
        stats = {c: {"mean": float(mean[c]), "std": float(std[c]) if np.isfinite(std[c]) and std[c] else 1.0} for c in frame.columns}
    arr = np.zeros((len(frame), len(FEATURE_NAMES)), dtype=np.float64)
    for j, col in enumerate(FEATURE_NAMES):
        s = stats.get(col, {"mean": 0.0, "std": 1.0})
        arr[:, j] = (frame[col].to_numpy(dtype=np.float64) - s["mean"]) / max(1e-9, s["std"])
    return np.clip(arr, -6.0, 6.0), stats


def make_sequences(x: np.ndarray, y: np.ndarray, look_back: int = 60, stride: int = 3) -> tuple[np.ndarray, np.ndarray]:
    n = x.shape[0] - look_back
    if n <= 0:
        return np.empty((0, look_back, x.shape[1])), np.empty((0,))
    xs, ys = [], []
    for i in range(look_back, x.shape[0], stride):
        xs.append(x[i - look_back : i])
        ys.append(y[i - 1])
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)


def forward_targets(close: pd.Series, horizon: int = 6) -> tuple[pd.Series, pd.Series]:
    """Next-``horizon``-bar return and its volatility-scaled z-score."""
    fwd = close.shift(-horizon) / close - 1.0
    sigma = fwd.rolling(60).std(ddof=0).replace(0.0, np.nan)
    return fwd, (fwd / sigma).fillna(0.0)


def label_classes(fwd_ret: pd.Series, atr_pct: pd.Series, *, threshold_mult: float = 0.55) -> np.ndarray:
    """0 = HOLD, 1 = BUY, 2 = SELL using a vol-adjusted dead band."""
    band = (atr_pct / 100.0).clip(lower=1e-4) * threshold_mult
    label = np.zeros(len(fwd_ret), dtype=np.int64)
    values = fwd_ret.to_numpy(dtype=np.float64)
    label[values > band.to_numpy()] = 1
    label[values < -band.to_numpy()] = 2
    return label
