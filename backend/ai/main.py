"""
AI service — FastAPI application.

Serves the pre-trained models to the Node backend:

    POST /predict    -> { signal, confidence, predictedPrice, model, features }
    GET  /health     -> model availability
    POST /retrain    -> retrain the ensemble from recent candles
    POST /backtest   -> run the backtester over a signal series

If no model checkpoint or dependency is available the service degrades to a
deterministic technical heuristic so the platform keeps functioning.
"""
from __future__ import annotations

import os

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from indicators import build_features
from models import EnsemblePredictor, LSTMPredictor, MODEL_DIR
from backtest import run_backtest

app = FastAPI(title="AI Crypto Trading Engine", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ensemble = EnsemblePredictor()
lstm = LSTMPredictor()

ENSEMBLE_LOADED = ensemble.load()
LSTM_LOADED = lstm.load()

SIGNAL_MAP = {0: "HOLD", 1: "BUY", 2: "SELL"}
LABEL_TO_IDX = {"HOLD": 0, "BUY": 1, "SELL": 2}


# --------------------------------------------------------------------- schemas
class Candle(BaseModel):
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class OrderBook(BaseModel):
    bids: List[List[float]] = []
    asks: List[List[float]] = []


class PredictRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1m"
    candles: List[Candle]
    orderBook: Optional[OrderBook] = None


class BacktestRequest(BaseModel):
    candles: List[Candle]
    signals: List[dict] = []


# ----------------------------------------------------------- heuristic fallback
def heuristic_signal(candles: list) -> dict:
    """Deterministic technical heuristic used when no ML model is loaded."""
    if len(candles) < 30:
        return {"signal": "HOLD", "confidence": 0.0, "model": "heuristic", "predictedPrice": None}
    closes = [c["close"] for c in candles]
    ema_fast = sum(closes[-12:]) / 12
    ema_slow = sum(closes[-26:]) / 26
    momentum = (closes[-1] - closes[-10]) / closes[-10] if closes[-10] else 0.0
    rsi_est = _estimate_rsi(closes)

    if ema_fast > ema_slow and momentum > 0 and rsi_est < 70:
        signal, conf = "BUY", min(0.8, 0.5 + abs(momentum) * 4)
    elif ema_fast < ema_slow and momentum < 0 and rsi_est > 30:
        signal, conf = "SELL", min(0.8, 0.5 + abs(momentum) * 4)
    else:
        signal, conf = "HOLD", 0.2
    return {"signal": signal, "confidence": round(conf, 4), "model": "heuristic",
            "predictedPrice": round(closes[-1] * (1 + momentum * 0.5), 4)}


def _estimate_rsi(closes: list) -> float:
    gains, losses = [], []
    for i in range(1, min(len(closes), 15)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    ag = sum(gains) / len(gains)
    al = sum(losses) / len(losses)
    if al == 0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


# ---------------------------------------------------------------------- routes
@app.get("/health")
def health():
    return {
        "ok": True,
        "ensembleLoaded": ENSEMBLE_LOADED,
        "lstmLoaded": LSTM_LOADED,
        "torchAvailable": lstm.available,
        "sklearnAvailable": ensemble.available,
    }


@app.post("/predict")
def predict(req: PredictRequest):
    candles = [c.model_dump() for c in req.candles]
    order_book = req.orderBook.model_dump() if req.orderBook else None

    # 1) Ensemble classification (BUY/SELL/HOLD + confidence).
    ensemble_signal = None
    if ENSEMBLE_LOADED and len(candles) >= 30:
        try:
            X, names = build_features(candles, order_book)
            X = np.nan_to_num(X, nan=0.0)
            probs = ensemble.predict_proba(X)
            if probs is not None:
                classes = ensemble.classes
                idx = int(np.argmax(probs))
                label = int(classes[idx])
                ensemble_signal = {
                    "signal": SIGNAL_MAP.get(label, "HOLD"),
                    "confidence": round(float(probs[idx]), 4),
                    "model": "random-forest",
                }
        except Exception:
            ensemble_signal = None

    # 2) LSTM price prediction.
    predicted_price = None
    if LSTM_LOADED and len(candles) >= lstm.sequence_length:
        window = [[c["open"], c["high"], c["low"], c["close"], c["volume"]] for c in candles]
        predicted_price = lstm.predict_next(window)
        if predicted_price is not None:
            predicted_price = round(predicted_price, 4)

    # 3) Combine: prefer ML, fall back to heuristic.
    result = ensemble_signal
    if result is None:
        result = heuristic_signal(candles)

    if predicted_price is not None and len(candles):
        last_close = candles[-1]["close"]
        change = (predicted_price - last_close) / last_close if last_close else 0.0
        # Reinforce the direction when LSTM and ensemble disagree-free.
        if abs(change) > 0.002 and result["signal"] == "HOLD":
            result["signal"] = "BUY" if change > 0 else "SELL"
            result["confidence"] = min(0.7, abs(change) * 20)
            result["model"] = "lstm"

    result.update({
        "symbol": req.symbol,
        "interval": req.interval,
        "predictedPrice": predicted_price,
        "lastPrice": candles[-1]["close"] if candles else None,
    })
    return result


@app.post("/retrain")
def retrain(req: PredictRequest):
    """Retrain the ensemble from the supplied candles (used by the cron job)."""
    candles = [c.model_dump() for c in req.candles]
    if len(candles) < 60:
        return {"ok": False, "error": "need at least 60 candles"}
    from train import train_ensemble
    import joblib

    clf, names = train_ensemble(candles)
    joblib.dump({"model": clf, "features": names}, os.path.join(MODEL_DIR, "sample_ensemble.joblib"))
    global ENSEMBLE_LOADED
    ensemble._model = clf
    ENSEMBLE_LOADED = True
    return {"ok": True, "candles": len(candles), "features": len(names)}


@app.post("/backtest")
def backtest(req: BacktestRequest):
    candles = [c.model_dump() for c in req.candles]
    closes = [c["close"] for c in candles]
    signals = req.signals
    if not signals:
        # Generate signals from the ensemble over the series.
        X, _ = build_features(candles, None)
        X = np.nan_to_num(X, nan=0.0)
        signals = []
        if ENSEMBLE_LOADED:
            try:
                preds = ensemble._model.predict(X)
                probs = ensemble._model.predict_proba(X)
                for i, p in enumerate(preds):
                    signals.append({"signal": SIGNAL_MAP.get(int(p), "HOLD"),
                                    "confidence": float(probs[i].max())})
            except Exception:
                signals = []
    if len(signals) != len(closes):
        signals = signals[: len(closes)]
        while len(signals) < len(closes):
            signals.append({"signal": "HOLD", "confidence": 0.0})

    result = run_backtest(closes, signals)
    return result.as_dict()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
