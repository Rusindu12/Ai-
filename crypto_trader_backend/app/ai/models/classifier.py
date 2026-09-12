"""Buy / Sell / Hold classifier.

A 2-layer MLP with softmax output trained by mini-batch Adam on
volatility-adjusted forward-return labels (see :func:`app.ai.features.label_classes`).

Why not sklearn/XGBoost? The trading signal is computed on every request and the
container should stay slim; a 34x24x3 MLP is ~1k parameters, trains in seconds
on the CPU and reaches parity with gradient boosting on this (noisy, low
signal-to-noise) task while keeping the inference path numpy-only.

If ``torch`` or ``tensorflow`` is installed, :mod:`app.ai.export` can convert
these weights to TorchScript / TFLite without changing the API contract.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

CLASSES = ("HOLD", "BUY", "SELL")


def softmax(z: np.ndarray) -> np.ndarray:
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(np.clip(z, -50, 50))
    return e / e.sum(axis=1, keepdims=True)


class SignalClassifier:
    def __init__(self, n_features: int, hidden: int = 24, n_classes: int = 3, seed: int = 13) -> None:
        self.n_features = int(n_features)
        self.hidden = int(hidden)
        self.n_classes = int(n_classes)
        rng = np.random.default_rng(seed)
        f, h = self.n_features, self.hidden
        self.W1 = rng.normal(0.0, np.sqrt(2.0 / f), (f, h))
        self.b1 = np.zeros((1, h))
        self.W2 = rng.normal(0.0, np.sqrt(1.0 / h), (h, self.n_classes))
        self.b2 = np.zeros((1, self.n_classes))
        self.history: dict[str, list[float]] = {"loss": [], "acc": [], "val_loss": [], "val_acc": []}
        self.calibration: dict[str, float] = {"temperature": 1.0}

    # ------------------------------------------------------------------ forward
    def _forward(self, x: np.ndarray, store: bool = False) -> tuple[np.ndarray, dict[str, np.ndarray] | None]:
        z1 = x @ self.W1 + self.b1
        a1 = np.tanh(z1)
        logits = a1 @ self.W2 + self.b2
        probs = softmax(logits)
        if store:
            return probs, {"x": x, "z1": z1, "a1": a1, "logits": logits, "probs": probs}
        return probs, None

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        """Calibrated class probabilities (temperature-scaled logits)."""
        x = np.atleast_2d(np.asarray(x, dtype=np.float64))
        _, cache = self._forward(x, store=True)
        assert cache is not None
        temp = float(self.calibration.get("temperature", 1.0)) or 1.0
        return softmax(cache["logits"] / max(0.25, temp))

    def predict(self, x: np.ndarray) -> np.ndarray:
        return self.predict_proba(x).argmax(axis=1)

    # ---------------------------------------------------------------- training
    def fit(
        self,
        x: np.ndarray,
        y: np.ndarray,
        *,
        x_val: np.ndarray | None = None,
        y_val: np.ndarray | None = None,
        class_weight: np.ndarray | None = None,
        epochs: int = 120,
        lr: float = 0.03,
        l2: float = 1e-4,
        batch_size: int = 64,
        verbose: bool = False,
    ) -> dict[str, Any]:
        x = np.asarray(x, dtype=np.float64)
        y_idx = np.asarray(y, dtype=np.int64)
        n = x.shape[0]
        if n < 16:
            raise ValueError("not enough training rows")
        Y = np.zeros((n, self.n_classes))
        Y[np.arange(n), y_idx] = 1.0
        w = np.ones((1, self.n_classes)) if class_weight is None else np.asarray(class_weight, dtype=np.float64).reshape(1, -1)
        w = w / w.mean()

        names = ("W1", "b1", "W2", "b2")
        mom = {p: np.zeros_like(getattr(self, p)) for p in names}
        vel = {p: np.zeros_like(getattr(self, p)) for p in names}
        b1, b2, eps = 0.9, 0.999, 1e-8
        step = 0
        rng = np.random.default_rng(5)
        for epoch in range(epochs):
            order = rng.permutation(n)
            tot, seen, correct = 0.0, 0, 0
            for start in range(0, n, batch_size):
                sel = order[start : start + batch_size]
                xb, yb, wb = x[sel], Y[sel], w
                probs, cache = self._forward(xb, store=True)
                assert cache is not None
                m = len(sel)
                p = np.clip(probs, 1e-12, 1.0)
                loss = -np.sum(wb * yb * np.log(p)) / m
                tot += loss * m
                seen += m
                correct += int(np.sum(cache["logits"].argmax(axis=1) == y_idx[sel]))
                dlogits = (probs - yb) * wb / m
                gW2 = cache["a1"].T @ dlogits + l2 * self.W2
                gb2 = dlogits.sum(axis=0, keepdims=True)
                da1 = dlogits @ self.W2.T
                dz1 = da1 * (1.0 - cache["a1"] ** 2)
                gW1 = xb.T @ dz1 + l2 * self.W1
                gb1 = dz1.sum(axis=0, keepdims=True)
                step += 1
                for p_name, g in (("W1", gW1), ("b1", gb1), ("W2", gW2), ("b2", gb2)):
                    mom[p_name] = b1 * mom[p_name] + (1 - b1) * g
                    vel[p_name] = b2 * vel[p_name] + (1 - b2) * (g**2)
                    m_hat = mom[p_name] / (1 - b1**step)
                    v_hat = vel[p_name] / (1 - b2**step)
                    setattr(self, p_name, getattr(self, p_name) - lr * m_hat / (np.sqrt(v_hat) + eps))
            self.history["loss"].append(round(tot / max(1, seen), 5))
            self.history["acc"].append(round(correct / max(1, seen), 4))
            if x_val is not None and y_val is not None and len(x_val):
                pv, cv = self._forward(np.asarray(x_val, dtype=np.float64), store=True)
                yv = np.asarray(y_val, dtype=np.int64)
                assert cv is not None
                lv = -float(np.mean(np.log(np.clip(cv["probs"][np.arange(len(yv)), yv], 1e-12, 1.0))))
                self.history["val_loss"].append(round(lv, 5))
                self.history["val_acc"].append(round(float(np.mean(cv["logits"].argmax(axis=1) == yv)), 4))
            if verbose and (epoch % 20 == 0 or epoch == epochs - 1):
                va = f" val_acc={self.history['val_acc'][-1]:.3f}" if self.history["val_acc"] else ""
                print(f"  epoch {epoch + 1:03d} loss={self.history['loss'][-1]:.4f} acc={self.history['acc'][-1]:.3f}{va}")

        self._fit_temperature(x, y_idx) if x_val is None else self._fit_temperature(np.asarray(x_val), np.asarray(y_val, dtype=np.int64))
        return {
            "epochs": epochs,
            "train_loss": self.history["loss"][-1],
            "train_acc": self.history["acc"][-1],
            "val_loss": self.history["val_loss"][-1] if self.history["val_loss"] else None,
            "val_acc": self.history["val_acc"][-1] if self.history["val_acc"] else None,
            "temperature": self.calibration["temperature"],
        }

    def _fit_temperature(self, x: np.ndarray, y: np.ndarray, grid: np.ndarray | None = None) -> None:
        """Pick the temperature that minimises NLL -> honest confidence numbers."""
        grid = grid if grid is not None else np.linspace(0.6, 2.6, 21)
        probs, cache = self._forward(np.asarray(x, dtype=np.float64), store=True)
        assert cache is not None
        logits = cache["logits"]
        y_idx = np.asarray(y, dtype=np.int64)
        best, best_t = np.inf, 1.0
        for t in grid:
            p = softmax(logits / t)
            nll = -float(np.mean(np.log(np.clip(p[np.arange(len(y_idx)), y_idx], 1e-12, 1))))
            if nll < best:
                best, best_t = nll, float(t)
        self.calibration["temperature"] = round(best_t, 4)
        self.calibration["nll"] = round(best, 5)

    # ------------------------------------------------------------- persistence
    def state(self) -> dict[str, np.ndarray]:
        return {"W1": self.W1, "b1": self.b1, "W2": self.W2, "b2": self.b2}

    def save(self, path: str | Path) -> Path:
        """Weights in ``path.npz`` + metadata sidecar ``path.npz.json``."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, **self.state())
        path.with_suffix(path.suffix + ".json").write_text(json_dumps(self._meta()))
        return path

    def _meta(self) -> dict[str, Any]:
        return {
            "n_features": self.n_features,
            "hidden": self.hidden,
            "n_classes": self.n_classes,
            "classes": list(CLASSES),
            "calibration": self.calibration,
        }

    @classmethod
    def load(cls, path: str | Path, *, meta: dict[str, Any] | None = None) -> SignalClassifier:
        import json

        path = Path(path)
        sidecar = path.with_suffix(path.suffix + ".json")
        loaded: dict[str, Any] = json.loads(sidecar.read_text()) if sidecar.exists() else {}
        with np.load(path, allow_pickle=False) as z:
            obj = cls(
                n_features=int((meta or {}).get("n_features") or loaded.get("n_features") or z["W1"].shape[0]),
                hidden=int((meta or {}).get("hidden") or loaded.get("hidden") or z["W1"].shape[1]),
                n_classes=int((meta or {}).get("n_classes") or loaded.get("n_classes") or z["W2"].shape[1]),
            )
            for k in ("W1", "b1", "W2", "b2"):
                setattr(obj, k, np.asarray(z[k], dtype=np.float64))
            obj.calibration = dict(loaded.get("calibration") or {"temperature": 1.0})
        return obj


def json_dumps(obj: Any) -> str:
    import json

    return json.dumps(obj)
