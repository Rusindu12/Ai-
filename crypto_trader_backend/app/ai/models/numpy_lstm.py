"""A dependency-free LSTM written in NumPy (forward **and** backward pass).

Why this exists
---------------
Production deployments normally serve a ``.tflite`` / TorchScript artifact, but
those runtimes add ~200 MB to the container for an inference workload of one
60x8 sequence per signal request.  This module ships a *real* trainable LSTM -
Adam optimiser, BPTT through time, gradient clipping, weight persistence - so
the backend can train, evaluate, save and serve the model with nothing but
NumPy.  When TensorFlow *is* installed, ``app.ai.export`` converts these same
weights into a ``.tflite`` graph for on-device-style inference.

    x (B, T, n_features) -> LSTM(hidden) -> dense(hidden -> 1) -> tanh()
                                               predicted 1-bar return (z-scaled)
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))


def _dsigmoid(s: np.ndarray) -> np.ndarray:
    return s * (1.0 - s)


class NumpyLSTM:
    """Single-layer LSTM + linear head trained on z-scored forward returns."""

    def __init__(self, n_features: int, hidden: int = 24, look_back: int = 60, seed: int = 7) -> None:
        self.n_features = int(n_features)
        self.hidden = int(hidden)
        self.look_back = int(look_back)
        rng = np.random.default_rng(seed)
        h, f = self.hidden, self.n_features
        self.Wxh = rng.normal(0.0, 1.0 / math.sqrt(f), (4 * h, f))
        self.Whh = rng.normal(0.0, 1.0 / math.sqrt(h), (4 * h, h))
        # forget gate biased to 1 so early gradients survive (Gers et al. 2000)
        self.b = np.concatenate([np.zeros(h), np.ones(h), np.zeros(h), np.zeros(h)])
        self.Wy = rng.normal(0.0, 1.0 / math.sqrt(h), (h, 1))
        self.by = np.zeros((1, 1))
        self.train_loss: list[float] = []
        self.val_loss: list[float] = []

    # ------------------------------------------------------------------ forward
    def _forward(self, x: np.ndarray, store: bool) -> tuple[np.ndarray, dict[str, np.ndarray] | None]:
        B, T, F = x.shape
        if self.n_features != F:
            raise ValueError(f"expected {self.n_features} features, got {F}")
        H = self.hidden
        h = np.zeros((B, H))
        c = np.zeros((B, H))
        cache: dict[str, np.ndarray] | None = None
        if store:
            cache = {
                "gates": np.zeros((B, T, 4 * H)),
                "c": np.zeros((B, T, H)),
                "h": np.zeros((B, T, H)),
            }
        for t in range(T):
            a = x[:, t, :] @ self.Wxh.T + h @ self.Whh.T + self.b
            i = _sigmoid(a[:, :H])
            f = _sigmoid(a[:, H : 2 * H])
            g = np.tanh(a[:, 2 * H : 3 * H])
            o = _sigmoid(a[:, 3 * H :])
            c = f * c + i * g
            h = o * np.tanh(c)
            if cache is not None:
                cache["gates"][:, t, :] = a
                cache["c"][:, t, :] = c
                cache["h"][:, t, :] = h
        return h, cache

    def predict(self, x: np.ndarray) -> np.ndarray:
        """Predicted z-scored return for each (T, F) or (B, T, F) sequence."""
        arr = np.asarray(x, dtype=np.float64)
        if arr.ndim == 2:
            arr = arr[None, :, :]
        h, _ = self._forward(arr, store=False)
        return np.tanh((h @ self.Wy + self.by)[:, 0])

    # ---------------------------------------------------------------- backward
    def _backward(self, x: np.ndarray, cache: dict[str, np.ndarray], dh_last: np.ndarray) -> dict[str, np.ndarray]:
        """BPTT through time. ``dh_last`` = dL/d(h_T), shape (B, H)."""
        B, T, _ = x.shape
        H = self.hidden
        grads = {
            "Wxh": np.zeros_like(self.Wxh),
            "Whh": np.zeros_like(self.Whh),
            "b": np.zeros_like(self.b),
        }
        dh = dh_last
        dc = np.zeros((B, H))
        for t in reversed(range(T)):
            a = cache["gates"][:, t, :]
            c = cache["c"][:, t, :]
            c_prev = cache["c"][:, t - 1, :] if t > 0 else np.zeros((B, H))
            h_prev = cache["h"][:, t - 1, :] if t > 0 else np.zeros((B, H))

            i = _sigmoid(a[:, :H])
            f = _sigmoid(a[:, H : 2 * H])
            g = np.tanh(a[:, 2 * H : 3 * H])
            o = _sigmoid(a[:, 3 * H :])
            tanh_c = np.tanh(c)

            dc = dc + dh * o * (1.0 - tanh_c**2)
            do = dh * tanh_c
            di = dc * g
            df = dc * c_prev
            dg = dc * i
            da = np.concatenate([di * _dsigmoid(i), df * _dsigmoid(f), dg * (1.0 - g**2), do * _dsigmoid(o)], axis=1)

            grads["Wxh"] += da.T @ x[:, t, :]
            grads["Whh"] += da.T @ h_prev
            grads["b"] += da.sum(axis=0)
            dh = da @ self.Whh
            dc = dc * f
        return grads

    # --------------------------------------------------------------- training
    def fit(
        self,
        x_train: np.ndarray,
        y_train: np.ndarray,
        *,
        x_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        epochs: int = 24,
        batch_size: int = 32,
        lr: float = 3e-3,
        l2: float = 1e-5,
        clip: float = 5.0,
        verbose: bool = False,
    ) -> dict[str, Any]:
        """Adam + BPTT on MSE of z-scored returns. Returns a training report."""
        x_train = np.asarray(x_train, dtype=np.float64)
        y_train = np.asarray(y_train, dtype=np.float64)
        n = x_train.shape[0]
        if n < 8:
            raise ValueError("not enough training sequences (need >= 8)")

        names = ("Wxh", "Whh", "b", "Wy", "by")
        mom = {p: np.zeros_like(getattr(self, p)) for p in names}
        vel = {p: np.zeros_like(getattr(self, p)) for p in names}
        b1, b2, eps = 0.9, 0.999, 1e-8
        step = 0
        rng = np.random.default_rng(11)

        for epoch in range(epochs):
            order = rng.permutation(n)
            seen = 0
            total = 0.0
            for start in range(0, n, batch_size):
                sel = order[start : start + batch_size]
                xb, yb = x_train[sel], y_train[sel]
                h_last, cache = self._forward(xb, store=True)
                assert cache is not None
                pred = np.tanh(h_last @ self.Wy + self.by)[:, 0]
                err = pred - yb
                total += float(np.sum(err**2))
                seen += len(sel)
                dpred = (2.0 / len(sel)) * err[:, None] * (1.0 - pred[:, None] ** 2)
                dh_last = dpred @ self.Wy.T
                grads = self._backward(xb, cache, dh_last)
                # dense head grads (computed outside BPTT - it is a single matmul)
                grads["Wy"] = h_last.T @ dpred
                grads["by"] = dpred.sum(axis=0, keepdims=True)
                for p in names:
                    gp = grads[p] + l2 * getattr(self, p)
                    gp = np.clip(gp, -clip, clip)
                    step += 1
                    mom[p] = b1 * mom[p] + (1 - b1) * gp
                    vel[p] = b2 * vel[p] + (1 - b2) * (gp**2)
                    m_hat = mom[p] / (1 - b1**step)
                    v_hat = vel[p] / (1 - b2**step)
                    setattr(self, p, getattr(self, p) - lr * m_hat / (np.sqrt(v_hat) + eps))
            self.train_loss.append(round(total / max(1, seen), 6))
            if x_val is not None and y_val is not None and len(x_val):
                self.val_loss.append(round(float(np.mean((self.predict(x_val) - np.asarray(y_val)) ** 2)), 6))
            if verbose:
                extra = f" val_mse={self.val_loss[-1]:.5f}" if self.val_loss else ""
                print(f"  epoch {epoch + 1:02d}  train_mse={self.train_loss[-1]:.5f}{extra}")

        return {
            "epochs": epochs,
            "samples": int(n),
            "train_loss": self.train_loss,
            "val_loss": self.val_loss,
            "final_train_mse": self.train_loss[-1] if self.train_loss else None,
            "final_val_mse": self.val_loss[-1] if self.val_loss else None,
        }

    # -------------------------------------------------------------------- eval
    def directional_accuracy(self, x: np.ndarray, y: np.ndarray, *, dead_band: float = 0.05) -> float:
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        if not len(x):
            return 0.5
        pred = self.predict(x)
        mask = np.abs(y) > dead_band
        if mask.sum() == 0:
            return 0.5
        return float(np.mean(np.sign(pred[mask]) == np.sign(y[mask])))

    def gradient_check(self, eps: float = 1e-4, samples: int = 8) -> float:
        """Relative error between numeric and analytic gradients (used by tests)."""
        rng = np.random.default_rng(3)
        x = rng.normal(size=(2, 4, self.n_features))
        y = rng.normal(size=(2,))

        def loss() -> float:
            pred = np.tanh(self._forward(x, False)[0] @ self.Wy + self.by)[:, 0]
            return float(np.mean((pred - y) ** 2))

        h_last, cache = self._forward(x, store=True)
        assert cache is not None
        pred = np.tanh(h_last @ self.Wy + self.by)[:, 0]
        dpred = (2.0 / len(y)) * (pred - y)[:, None] * (1.0 - pred[:, None] ** 2)
        grads = self._backward(x, cache, dpred @ self.Wy.T)

        pairs = [(i, j) for i in range(self.Whh.shape[0]) for j in range(self.Whh.shape[1])][:samples]
        num, ana = [], []
        for i, j in pairs:
            orig = float(self.Whh[i, j])
            self.Whh[i, j] = orig + eps
            lp = loss()
            self.Whh[i, j] = orig - eps
            lm = loss()
            self.Whh[i, j] = orig
            num.append((lp - lm) / (2 * eps))
            ana.append(float(grads["Whh"][i, j]))
        num_a, ana_a = np.asarray(num), np.asarray(ana)
        return float(np.linalg.norm(num_a - ana_a) / max(1e-12, np.linalg.norm(num_a) + np.linalg.norm(ana_a)))

    # ------------------------------------------------------------- persistence
    def state(self) -> dict[str, np.ndarray]:
        return {"Wxh": self.Wxh, "Whh": self.Whh, "b": self.b, "Wy": self.Wy, "by": self.by}

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, **self.state())
        return path

    @classmethod
    def load(cls, path: str | Path, *, meta: dict[str, Any] | None = None) -> NumpyLSTM:
        meta = meta or {}
        with np.load(Path(path), allow_pickle=False) as z:
            obj = cls(
                n_features=int(meta.get("n_features", z["Wxh"].shape[1])),
                hidden=int(meta.get("hidden", z["Wxh"].shape[0] // 4)),
                look_back=int(meta.get("look_back", 60)),
            )
            for k in ("Wxh", "Whh", "b", "Wy", "by"):
                setattr(obj, k, np.asarray(z[k], dtype=np.float64))
        return obj

    def __repr__(self) -> str:
        return f"<NumpyLSTM features={self.n_features} hidden={self.hidden} look_back={self.look_back}>"


