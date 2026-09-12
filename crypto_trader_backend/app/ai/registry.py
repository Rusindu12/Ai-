"""Model registry: locate, load, version and hot-swap AI artifacts.

Layout of ``settings.AI_MODEL_DIR``::

    model_manifest.json        # active versions + feature stats + metrics
    lstm.npz (+ .meta.json)    # numpy LSTM weights
    classifier.npz (+ .json)   # softmax MLP weights

The registry never raises on a missing artifact: it falls back to an
*untrained but deterministic* model plus the rule engine, so a fresh deploy
still answers ``GET /api/ai/signal/{symbol}`` immediately.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from app.ai.features import FEATURE_NAMES
from app.config import settings

log = logging.getLogger(__name__)

MANIFEST_NAME = "model_manifest.json"


@dataclass(slots=True)
class ModelBundle:
    """Everything the inference path needs for one model generation."""

    version: str = "untrained-0"
    trained_at: int = 0
    n_features: int = len(FEATURE_NAMES)
    hidden: int = 24
    look_back: int = 60
    lstm: Any = None
    classifier: Any = None
    feature_stats: dict[str, dict[str, float]] = field(default_factory=dict)
    return_scale: float = 1.0
    metrics: dict[str, Any] = field(default_factory=dict)
    source: str = "fallback"

    @property
    def has_models(self) -> bool:
        return self.lstm is not None and self.classifier is not None

    def manifest_entry(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "trained_at": self.trained_at,
            "n_features": self.n_features,
            "hidden": self.hidden,
            "look_back": self.look_back,
            "return_scale": self.return_scale,
            "metrics": self.metrics,
            "source": self.source,
        }


class ModelRegistry:
    def __init__(self, directory: str | Path | None = None) -> None:
        self.dir = Path(directory or settings.AI_MODEL_DIR)
        self.lock = threading.RLock()
        self.bundle: ModelBundle = ModelBundle()
        self._loaded_from: str | None = None

    # ------------------------------------------------------------------- paths
    @property
    def manifest_path(self) -> Path:
        return self.dir / MANIFEST_NAME

    @property
    def lstm_path(self) -> Path:
        return self.dir / "lstm.npz"

    @property
    def classifier_path(self) -> Path:
        return self.dir / "classifier.npz"

    def read_manifest(self) -> dict[str, Any]:
        if self.manifest_path.exists():
            try:
                return json.loads(self.manifest_path.read_text())
            except json.JSONDecodeError:
                log.warning("model manifest is corrupt, ignoring: %s", self.manifest_path)
        return {}

    def write_manifest(self, extra: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = {
            "updated_at": int(time.time()),
            "active": self.bundle.manifest_entry(),
            "artifacts": {
                "lstm": self.lstm_path.name if self.lstm_path.exists() else None,
                "classifier": self.classifier_path.name if self.classifier_path.exists() else None,
            },
            "history": self.read_manifest().get("history", [])[-24:],
        }
        if extra:
            payload.update(extra)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path.write_text(json.dumps(payload, indent=2, default=str))
        return payload

    # -------------------------------------------------------------------- load
    def ensure_loaded(self, *, force: bool = False) -> ModelBundle:
        with self.lock:
            if self.bundle.source != "fallback" and not force:
                return self.bundle
            manifest = self.read_manifest()
            active = manifest.get("active") or {}
            if self.lstm_path.exists() and self.classifier_path.exists():
                try:
                    from app.ai.models.classifier import SignalClassifier
                    from app.ai.models.numpy_lstm import NumpyLSTM

                    meta = {
                        "n_features": int(active.get("n_features", len(FEATURE_NAMES))),
                        "hidden": int(active.get("hidden", 24)),
                        "look_back": int(active.get("look_back", 60)),
                    }
                    bundle = ModelBundle(
                        version=str(active.get("version", "unknown")),
                        trained_at=int(active.get("trained_at", 0)),
                        n_features=meta["n_features"],
                        hidden=meta["hidden"],
                        look_back=meta["look_back"],
                        lstm=NumpyLSTM.load(self.lstm_path, meta=meta),
                        classifier=SignalClassifier.load(self.classifier_path, meta=meta),
                        feature_stats=manifest.get("feature_stats", {}) or {},
                        return_scale=float(active.get("return_scale", 1.0) or 1.0),
                        metrics=active.get("metrics", {}) or {},
                        source="disk",
                    )
                    self.bundle = bundle
                    self._loaded_from = str(self.dir)
                    log.info("loaded AI models version=%s (features=%d)", bundle.version, bundle.n_features)
                    return bundle
                except Exception:
                    log.exception("failed to load model artifacts - using fallback model")
            self.bundle = self._fallback(active)
            return self.bundle

    def _fallback(self, active: dict[str, Any] | None = None) -> ModelBundle:
        from app.ai.models.classifier import SignalClassifier
        from app.ai.models.numpy_lstm import NumpyLSTM

        active = active or {}
        n = int(active.get("n_features", len(FEATURE_NAMES)))
        h = int(active.get("hidden", 24))
        lb = int(active.get("look_back", 60))
        return ModelBundle(
            version="untrained-0",
            trained_at=0,
            n_features=n,
            hidden=h,
            look_back=lb,
            lstm=NumpyLSTM(n_features=n, hidden=h, look_back=lb, seed=7),
            classifier=SignalClassifier(n_features=n, hidden=h),
            feature_stats=active.get("feature_stats", {}) if isinstance(active.get("feature_stats"), dict) else {},
            return_scale=float(active.get("return_scale", 1.0) or 1.0),
            metrics=active.get("metrics", {}) or {},
            source="fallback",
        )

    # ------------------------------------------------------------------- swap
    def publish(self, bundle: ModelBundle) -> None:
        with self.lock:
            self.bundle = bundle
            self.write_manifest()
            log.info("published AI model version %s", bundle.version)

    def status(self) -> dict[str, Any]:
        b = self.bundle
        return {
            "version": b.version,
            "source": b.source,
            "has_models": b.has_models,
            "trained_at": b.trained_at,
            "trained_ago_s": int(time.time() - b.trained_at) if b.trained_at else None,
            "look_back": b.look_back,
            "hidden": b.hidden,
            "n_features": b.n_features,
            "features": FEATURE_NAMES,
            "metrics": b.metrics,
            "dir": str(self.dir),
            "artifacts": {
                "lstm": self.lstm_path.exists(),
                "classifier": self.classifier_path.exists(),
            },
            "retrain_after_s": max(
                0, int(settings.AI_RETRAIN_DAYS * 86400 - (time.time() - b.trained_at))
            )
            if b.trained_at
            else 0,
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self.status())


registry = ModelRegistry()
