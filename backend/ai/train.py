"""
Model training pipeline.

Trains the RandomForest ensemble (and, when PyTorch is installed, the LSTM)
from historical candle data. Data can be supplied as a CSV file or pulled from
the Binance klines endpoint.

Usage:
    python train.py --csv candles.csv --symbol BTCUSDT --interval 1m
    python train.py --binance --symbol BTCUSDT --interval 1h
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd

from indicators import build_features
from models import EnsemblePredictor, MODEL_DIR

SIGNAL_MAP = {0: "HOLD", 1: "BUY", 2: "SELL"}


def load_candles_csv(path: str) -> list[dict]:
    df = pd.read_csv(path)
    candles = []
    for _, row in df.iterrows():
        candles.append({
            "open": float(row["open"]), "high": float(row["high"]),
            "low": float(row["low"]), "close": float(row["close"]),
            "volume": float(row["volume"]),
        })
    return candles


def load_candles_binance(symbol: str, interval: str = "1m", limit: int = 1000) -> list[dict]:
    import urllib.request
    import json

    url = f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}"
    with urllib.request.urlopen(url, timeout=15) as resp:
        rows = json.loads(resp.read())
    return [
        {
            "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
            "close": float(r[4]), "volume": float(r[5]),
        }
        for r in rows
    ]


def build_labels(candles: list[dict], horizon: int = 3, threshold: float = 0.002) -> np.ndarray:
    """Label each bar by the return over the next `horizon` bars."""
    closes = np.array([c["close"] for c in candles], dtype=float)
    labels = np.zeros(len(candles), dtype=int)
    for i in range(len(candles) - horizon):
        fwd = (closes[i + horizon] - closes[i]) / closes[i]
        if fwd > threshold:
            labels[i] = 1  # BUY
        elif fwd < -threshold:
            labels[i] = 2  # SELL
        else:
            labels[i] = 0  # HOLD
    return labels


def train_ensemble(candles: list[dict], n_estimators: int = 200, max_depth: int = 12) -> tuple[object, np.ndarray]:
    from sklearn.ensemble import RandomForestClassifier

    X, names = build_features(candles)
    y = build_labels(candles)
    mask = ~np.isnan(X).any(axis=1)
    X, y = X[mask], y[mask]

    clf = RandomForestClassifier(
        n_estimators=n_estimators, max_depth=max_depth, min_samples_leaf=5, random_state=42, n_jobs=-1,
    )
    clf.fit(X, y)
    return clf, names


def train_lstm(candles: list[dict]) -> bool:
    """Train the LSTM when torch is available. Returns success."""
    try:
        import torch  # type: ignore
        import torch.nn as nn  # type: ignore
    except Exception:
        print("torch not installed — skipping LSTM training")
        return False

    from models import LSTMPredictor

    seq_len = 60
    feats = []
    for c in candles:
        feats.append([c["open"], c["high"], c["low"], c["close"], c["volume"]])
    data = np.asarray(feats, dtype=np.float32)
    data = (data - data.mean(axis=0)) / (data.std(axis=0) + 1e-9)

    closes = data[:, 3]
    X, y = [], []
    for i in range(seq_len, len(data) - 1):
        X.append(data[i - seq_len:i])
        y.append(closes[i + 1])
    if len(X) < 50:
        print("not enough data to train LSTM")
        return False
    Xt = torch.tensor(np.asarray(X), dtype=torch.float32)
    yt = torch.tensor(np.asarray(y), dtype=torch.float32)

    pred = LSTMPredictor(sequence_length=seq_len)
    model = pred._build(torch)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    for epoch in range(10):
        opt.zero_grad()
        out = model(Xt)
        loss = loss_fn(out, yt)
        loss.backward()
        opt.step()
        if epoch % 2 == 0:
            print(f"  epoch {epoch}: loss={loss.item():.6f}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    torch.save(model.state_dict(), os.path.join(MODEL_DIR, "lstm.pt"))
    print("saved lstm.pt")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="path to OHLCV CSV")
    ap.add_argument("--binance", action="store_true", help="pull data from Binance")
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--interval", default="1m")
    ap.add_argument("--limit", type=int, default=1000)
    args = ap.parse_args()

    if args.csv:
        candles = load_candles_csv(args.csv)
    elif args.binance:
        candles = load_candles_binance(args.symbol, args.interval, args.limit)
    else:
        ap.error("provide --csv or --binance")

    print(f"training ensemble on {len(candles)} candles")
    clf, names = train_ensemble(candles)

    os.makedirs(MODEL_DIR, exist_ok=True)
    import joblib

    joblib.dump({"model": clf, "features": names}, os.path.join(MODEL_DIR, "sample_ensemble.joblib"))
    print("saved sample_ensemble.joblib")

    train_lstm(candles)
    print("training complete")


if __name__ == "__main__":
    main()
