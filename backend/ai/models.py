"""
Model definitions.

Two model families live here:

1. `LSTMPredictor` — a PyTorch LSTM sequence model that predicts the next
   close price from a window of candles. Used for price prediction.
2. `EnsemblePredictor` — a scikit-learn RandomForest classifier that maps the
   engineered feature matrix to {BUY, SELL, HOLD}. Used for trade decisions.

Both degrade gracefully when their optional dependency is unavailable: the
service falls back to the heuristic predictor in that case.
"""
from __future__ import annotations

import os
from typing import Optional

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")


# ---------------------------------------------------------------- PyTorch LSTM
class LSTMPredictor:
    """Wrapper around a PyTorch LSTM for next-close price prediction."""

    def __init__(self, input_size: int = 5, hidden_size: int = 64, num_layers: int = 2,
                 sequence_length: int = 60):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.sequence_length = sequence_length
        self._torch = None
        self._model = None

    @property
    def available(self) -> bool:
        return self._load_torch() is not None

    def _load_torch(self):
        if self._torch is not None:
            return self._torch or None
        try:
            import torch  # type: ignore
            self._torch = torch
        except Exception:
            self._torch = False
        return self._torch or None

    def _build(self, torch):
        import torch.nn as nn

        class Model(nn.Module):
            def __init__(self, input_size, hidden_size, num_layers):
                super().__init__()
                self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
                self.fc = nn.Linear(hidden_size, 1)

            def forward(self, x):
                out, _ = self.lstm(x)
                return self.fc(out[:, -1, :]).squeeze(-1)

        return Model(self.input_size, self.hidden_size, self.num_layers)

    def load(self, path: Optional[str] = None) -> bool:
        torch = self._load_torch()
        if torch is None:
            return False
        p = path or os.path.join(MODEL_DIR, "sample_lstm.pt")
        if not os.path.exists(p):
            return False
        try:
            self._model = self._build(torch)
            self._model.load_state_dict(torch.load(p, map_location="cpu", weights_only=True))
            self._model.eval()
            return True
        except Exception:
            return False

    def predict_next(self, window: list[list[float]]) -> Optional[float]:
        """window: shape (sequence_length, input_size) — [o,h,l,c,v] rows."""
        torch = self._load_torch()
        if torch is None or self._model is None or len(window) < self.sequence_length:
            return None
        import numpy as np

        x = np.asarray(window[-self.sequence_length:], dtype=np.float32)
        if x.ndim == 1:
            x = x.reshape(-1, 1)
        tensor = torch.tensor(x, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            pred = self._model(tensor)
        return float(pred.item())


# ----------------------------------------------------- scikit-learn ensemble
class EnsemblePredictor:
    """RandomForest {BUY, SELL, HOLD} classifier over the feature matrix."""

    def __init__(self):
        self._model = None

    @property
    def available(self) -> bool:
        try:
            import sklearn  # noqa: F401
            return True
        except Exception:
            return False

    def load(self, path: Optional[str] = None) -> bool:
        try:
            import joblib  # type: ignore
        except Exception:
            return False
        p = path or os.path.join(MODEL_DIR, "sample_ensemble.joblib")
        if not os.path.exists(p):
            return False
        try:
            obj = joblib.load(p)
            # We persist {"model": clf, "features": names}; accept both shapes.
            self._model = obj["model"] if isinstance(obj, dict) and "model" in obj else obj
            return True
        except Exception:
            return False

    def predict_proba(self, X):
        """Return class probabilities for the last row of X (aligned rows)."""
        if self._model is None:
            return None
        probs = self._model.predict_proba(X)
        return probs[-1]  # last (most recent) row

    @property
    def classes(self):
        return list(self._model.classes_) if self._model is not None else []
