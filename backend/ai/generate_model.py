"""
Generate a pre-trained sample model.

Produces a small, deterministic RandomForest ensemble trained on synthetic
multi-regime market data (trending / mean-reverting / choppy) so the platform
ships with working weights out of the box. When PyTorch is installed it also
produces a small LSTM checkpoint.

Run once:
    python generate_model.py
"""
from __future__ import annotations

import os

import numpy as np

from train import train_ensemble, train_lstm
from models import MODEL_DIR


def synthetic_candles(n: int = 2000, seed: int = 42) -> list[dict]:
    rng = np.random.default_rng(seed)
    candles: list[dict] = []
    price = 100.0
    regime = 0
    for i in range(n):
        if i % 400 == 0:
            regime = rng.integers(0, 3)
        if regime == 0:  # uptrend
            drift = 0.08
        elif regime == 1:  # downtrend
            drift = -0.08
        else:  # choppy mean-reversion
            drift = (100.0 - price) * 0.02
        shock = rng.normal(drift, 1.2)
        open_ = price
        close = max(1.0, price + shock)
        high = max(open_, close) + abs(rng.normal(0, 0.5))
        low = min(open_, close) - abs(rng.normal(0, 0.5))
        volume = abs(rng.normal(100, 30))
        candles.append({"open": open_, "high": high, "low": low, "close": close, "volume": volume})
        price = close
    return candles


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)
    candles = synthetic_candles()

    print(f"training ensemble on {len(candles)} synthetic candles")
    clf, names = train_ensemble(candles, n_estimators=60, max_depth=8)

    import joblib

    joblib.dump({"model": clf, "features": names}, os.path.join(MODEL_DIR, "sample_ensemble.joblib"))
    print("saved sample_ensemble.joblib")

    ok = train_lstm(candles)
    if not ok:
        print("note: torch not installed, LSTM checkpoint skipped (run with torch to generate lstm.pt)")
    print("done")


if __name__ == "__main__":
    main()
