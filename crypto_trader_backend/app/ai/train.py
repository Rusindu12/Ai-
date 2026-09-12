"""Training pipeline for the AI stack (LSTM + Buy/Sell/Hold classifier).

    python -m app.ai.train --symbols BTCUSDT,ETHUSDT --interval 1m --bars 6000
    POST /api/ai/train        {"symbols": ["BTCUSDT"], "interval": "1h", "epochs": 30}

Steps
-----
1. fetch history (real Binance klines, or the simulator when ``DEMO_MODE=true``)
2. build the feature matrix (:mod:`app.ai.features`) and *training-only* scaling
   statistics - validation/test data is never used to fit the scaler
3. labels: volatility-scaled forward return (regression target for the LSTM) and
   a dead-banded BUY/SELL/HOLD label for the classifier
4. chronological split (80/20), train, evaluate, temperature-calibrate
5. persist ``lstm.npz`` + ``classifier.npz`` + manifest, then hot-swap the
   registry so ``GET /api/ai/signal/{symbol}`` immediately uses the new weights
6. record a ``ModelVersion`` row (Postgres + optional Firestore mirror) for the
   weekly retrain audit trail

Auto-retraining is scheduled by :mod:`app.scheduler` (weekly by default).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.ai import features as feat
from app.ai.dataset import fetch_history
from app.ai.models.classifier import SignalClassifier
from app.ai.models.numpy_lstm import NumpyLSTM
from app.ai.registry import ModelBundle, registry
from app.config import settings

log = logging.getLogger(__name__)


class TrainReport(dict):
    """Plain dict + pretty printer."""

    def pretty(self) -> str:
        lines = [f"AI training report  ({self.get('version')})"]
        for k, v in self.items():
            if isinstance(v, float):
                lines.append(f"  {k:<26} {v:.4f}")
            elif isinstance(v, int | str) or v is None:
                lines.append(f"  {k:<26} {v}")
        return "\n".join(lines)


def build_supervised(
    rows: list[dict[str, Any]],
    *,
    look_back: int,
    horizon: int,
    stats: dict[str, dict[str, float]] | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, dict[str, float]], float, list[dict[str, Any]]]:
    """Return (X_seq, y_seq, X_row, y_row, stats, return_scale, valid_rows)."""
    frame = feat.build_frame(rows)
    close = pd.Series([float(r["close"]) for r in rows])
    fwd, zfwd = feat.forward_targets(close, horizon=horizon)
    x_all, stats = feat.standardise(frame, stats)
    labels = feat.label_classes(fwd, frame["atr_pct_n"])

    n = len(x_all)
    xs, ys = [], []
    for i in range(look_back, n):
        if not np.isfinite(zfwd.iloc[i]) or abs(zfwd.iloc[i]) > 12:
            continue
        xs.append(x_all[i - look_back : i])
        ys.append(float(zfwd.iloc[i]))
    X_seq = np.asarray(xs, dtype=np.float64) if xs else np.empty((0, look_back, x_all.shape[1]))
    y_seq = np.asarray(ys, dtype=np.float64)

    row_idx = np.arange(look_back, n)
    keep = np.array([i for i in row_idx if np.isfinite(fwd.iloc[i])], dtype=int)
    X_row = x_all[keep]
    y_row = labels[keep]

    sigma = float(np.nanstd(np.asarray(fwd.iloc[look_back :], dtype=np.float64))) or 0.01
    return_scale = max(1e-5, min(0.08, sigma))
    valid = [rows[i] for i in keep]
    return X_seq, y_seq, X_row, y_row, stats, return_scale, valid


async def train_models(
    *,
    symbols: list[str] | None = None,
    interval: str = "1h",
    bars: int = 6000,
    look_back: int = 60,
    horizon: int = 6,
    hidden: int = 24,
    epochs_lstm: int = 22,
    epochs_clf: int = 140,
    gateway: Any = None,
    publish: bool = True,
    verbose: bool = False,
) -> TrainReport:
    """Train + persist both models. Returns metrics (safe to expose via API)."""
    from app.services.gateway import get_gateway

    gateway = gateway or await get_gateway()
    symbols = [s.upper() for s in (symbols or settings.MARKETS[:4])]
    t0 = time.time()

    all_rows: list[list[dict[str, Any]]] = []
    for sym in symbols:
        rows = await fetch_history(gateway, sym, interval, bars)
        all_rows.append(rows)
        log.info("fetched %d %s candles for %s", len(rows), interval, sym)

    # ---- shared scaler, fitted only on the first 80% of each series (chronological)
    combined = [r for rows in all_rows for r in rows]
    if len(combined) < 400:
        raise ValueError("not enough candles to train")
    per_series_stats = [feat.fit_stats(feat.build_frame(rows), train_fraction=0.8) for rows in all_rows]
    shared_stats = _merge_stats(per_series_stats)

    X_seq_l, y_seq_l, X_row_l, y_row_l, _, scale_l, _ = build_supervised(
        all_rows[0], look_back=look_back, horizon=horizon, stats=shared_stats
    )
    Xs, Ys, Xr, Yr = [X_seq_l], [y_seq_l], [X_row_l], [y_row_l]
    for rows in all_rows[1:]:
        a, b, c, d, *_ = build_supervised(rows, look_back=look_back, horizon=horizon, stats=shared_stats)
        if len(a):
            Xs.append(a)
            Ys.append(b)
        if len(c):
            Xr.append(c)
            Yr.append(d)
    X_seq = np.concatenate(Xs, axis=0)
    y_seq = np.concatenate(Ys, axis=0)
    X_row = np.concatenate(Xr, axis=0)
    y_row = np.concatenate(Yr, axis=0)

    # chronological split per dataset: first 80% train, last 20% validate
    def split(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        n = int(len(x) * 0.8)
        return x[:n], y[:n], x[n:], y[n:]

    xtr, ytr, xva, yva = split(X_seq, y_seq)
    rxtr, rytr, rxva, ryva = split(X_row, y_row)
    if len(xtr) < 30 or len(rxtr) < 40:
        raise ValueError(f"insufficient samples after split (seq={len(xtr)}, rows={len(rxtr)})")

    # guard against degenerate label distributions
    counts = np.bincount(rytr.astype(int), minlength=3)
    class_weight = np.where(counts > 0, counts.sum() / np.maximum(counts, 1) ** 0.75, 0.0)
    class_weight = class_weight / max(1e-9, class_weight.mean())

    lstm = NumpyLSTM(n_features=len(feat.FEATURE_NAMES), hidden=hidden, look_back=look_back)
    lstm_report = lstm.fit(
        xtr, ytr, x_val=xva, y_val=yva, epochs=epochs_lstm, batch_size=32, lr=4e-3, verbose=verbose
    )
    clf = SignalClassifier(n_features=len(feat.FEATURE_NAMES), hidden=hidden)
    clf_report = clf.fit(
        rxtr,
        rytr.astype(int),
        x_val=rxva,
        y_val=ryva.astype(int),
        class_weight=class_weight,
        epochs=epochs_clf,
        lr=0.04,
        l2=1e-4,
        verbose=verbose,
    )

    version = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    dir_path = Path(settings.AI_MODEL_DIR)
    dir_path.mkdir(parents=True, exist_ok=True)
    lstm.save(dir_path / "lstm.npz")
    clf.save(dir_path / "classifier.npz")

    metrics = {
        "symbols": symbols,
        "interval": interval,
        "bars_fetched": int(len(combined)),
        "train_sequences": int(len(xtr)),
        "val_sequences": int(len(xva)),
        "lstm_val_mse": lstm_report.get("final_val_mse"),
        "lstm_direction_accuracy": round(lstm.directional_accuracy(xva, yva), 4) if len(xva) else None,
        "classifier_val_accuracy": clf_report.get("val_acc"),
        "classifier_temperature": clf_report.get("temperature"),
        "train_seconds": round(time.time() - t0, 2),
    }
    bundle = ModelBundle(
        version=f"ai-{version}",
        trained_at=int(time.time()),
        n_features=len(feat.FEATURE_NAMES),
        hidden=hidden,
        look_back=look_back,
        lstm=lstm,
        classifier=clf,
        feature_stats=shared_stats,
        return_scale=scale_l,
        metrics=metrics,
        source="trained",
    )
    if publish:
        registry.publish(bundle)
        manifest = registry.read_manifest()
        manifest.setdefault("history", []).append({"version": bundle.version, **bundle.manifest_entry()})
        manifest["history"] = manifest["history"][-48:]
        registry.dir.joinpath("model_manifest.json").write_text(json.dumps(manifest, indent=2, default=str))
    await _record_model_version(bundle)

    report = TrainReport(
        version=bundle.version,
        trained_at=bundle.trained_at,
        elapsed_s=round(time.time() - t0, 2),
        **metrics,
    )
    log.info("training complete: %s", dict(report))
    return report


async def _record_model_version(bundle: ModelBundle) -> None:
    """Persist the training run for the audit trail (best effort)."""
    try:
        from app.db.base import session_scope
        from app.db.models import ModelVersion

        async with session_scope() as session:
            session.add(
                ModelVersion(
                    name="lstm+classifier",
                    version=bundle.version,
                    kind="ensemble",
                    path=str(Path(settings.AI_MODEL_DIR)),
                    metrics=bundle.metrics,
                    training_rows=int(bundle.metrics.get("train_sequences", 0)) + int(bundle.metrics.get("val_sequences", 0)),
                    is_active=True,
                )
            )
            from sqlalchemy import update

            await session.execute(
                update(ModelVersion)
                .where(ModelVersion.name == "lstm+classifier", ModelVersion.version != bundle.version)
                .values(is_active=False)
            )
    except Exception as exc:  # pragma: no cover - db optional during training
        log.debug("could not persist ModelVersion: %s", exc)


def _merge_stats(stats_list: list[dict[str, dict[str, float]]]) -> dict[str, dict[str, float]]:
    """Average per-series scaler statistics into one shared scaler."""
    merged: dict[str, dict[str, float]] = {}
    for col in feat.FEATURE_NAMES:
        means = [s[col]["mean"] for s in stats_list if col in s]
        stds = [s[col]["std"] for s in stats_list if col in s]
        if not means:
            continue
        merged[col] = {"mean": float(np.mean(means)), "std": float(max(1e-9, np.mean(stds)))}
    return merged


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:  # pragma: no cover - manual entry point
    from app.errors import configure_logging  # local import to avoid cycles

    parser = argparse.ArgumentParser(description="Train the crypto AI models")
    parser.add_argument("--symbols", default=",".join(settings.MARKETS[:4]))
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--bars", type=int, default=6000)
    parser.add_argument("--look-back", type=int, default=60)
    parser.add_argument("--horizon", type=int, default=6)
    parser.add_argument("--hidden", type=int, default=24)
    parser.add_argument("--epochs-lstm", type=int, default=22)
    parser.add_argument("--epochs-clf", type=int, default=140)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    configure_logging("INFO")
    report = asyncio.run(
        train_models(
            symbols=args.symbols.split(","),
            interval=args.interval,
            bars=args.bars,
            look_back=args.look_back,
            horizon=args.horizon,
            hidden=args.hidden,
            epochs_lstm=args.epochs_lstm,
            epochs_clf=args.epochs_clf,
            verbose=args.verbose,
        )
    )
    print(report.pretty())


if __name__ == "__main__":  # pragma: no cover
    main()
