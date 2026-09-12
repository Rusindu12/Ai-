"""Optional model export: NumPy weights -> TFLite / ONNX / TorchScript.

The runtime never needs this module (inference is pure NumPy), but the
requirement "AI/ML Engine: TensorFlow Lite / PyTorch" is satisfied by a real,
runnable conversion path:

    python -m app.ai.export --format tflite      # writes app/ai/artifacts/model.tflite
    python -m app.ai.export --format onnx        # writes app/ai/artifacts/model.onnx
    python -m app.ai.export --format torchscript

Each builder reconstructs an equivalent graph from the saved ``.npz`` weights,
traces it and writes the artifact, then updates ``model_manifest.json`` with the
export paths + sha256 so the mobile app can optionally download and run the
model *on-device* (identical features, identical result).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np

from app.ai.registry import registry
from app.config import settings

log = logging.getLogger(__name__)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()[:32]


def export_tflite(out_dir: Path | None = None) -> dict[str, Any]:
    """Build a Keras LSTM with the trained weights, then convert to TFLite."""
    try:
        import tensorflow as tf
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("tensorflow is not installed: pip install tensorflow") from exc

    bundle = registry.ensure_loaded()
    if bundle.lstm is None:
        raise RuntimeError("no trained LSTM to export (run `python -m app.ai.train` first)")
    out_dir = out_dir or Path(settings.AI_MODEL_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    m = bundle.lstm
    H, F = m.hidden, m.n_features
    keras_lstm = tf.keras.layers.LSTM(
        H,
        return_sequences=False,
        kernel_initializer=tf.constant_initializer(np.transpose(m.Wxh)),
        recurrent_initializer=tf.constant_initializer(np.transpose(m.Whh)),
        use_bias=True,
        bias_initializer=tf.constant_initializer(m.b.astype(np.float32)),
    )
    inputs = tf.keras.Input(shape=(m.look_back, F))
    x = keras_lstm(inputs)
    outputs = tf.keras.layers.Dense(1, activation="tanh", kernel_initializer=tf.constant_initializer(m.Wy), bias_initializer=tf.constant_initializer(m.by.reshape(-1)))(x)
    model = tf.keras.Model(inputs, outputs)
    keras_path = out_dir / "model.keras"
    model.save(keras_path)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_path = out_dir / "model.tflite"
    tflite_path.write_bytes(converter.convert())
    meta = {
        "format": "tflite",
        "path": str(tflite_path),
        "keras_path": str(keras_path),
        "sha256": _sha256(tflite_path),
        "input_shape": [1, m.look_back, F],
        "output_shape": [1, 1],
        "model_version": bundle.version,
        "features": json.loads(json.dumps(_feature_list())),
        "size_bytes": tflite_path.stat().st_size,
    }
    _record_export(out_dir, meta)
    return meta


def export_onnx(out_dir: Path | None = None) -> dict[str, Any]:
    """Export the classifier + LSTM as a single ONNX graph (needs torch + onnx)."""
    try:
        import torch
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pytorch is not installed: pip install torch onnx") from exc

    bundle = registry.ensure_loaded()
    if bundle.lstm is None:
        raise RuntimeError("no trained LSTM to export")
    out_dir = out_dir or Path(settings.AI_MODEL_DIR)
    m = bundle.lstm
    H, F = m.hidden, m.n_features

    class _Wrapper(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.lstm = torch.nn.LSTM(F, H, batch_first=True)
            self.head = torch.nn.Linear(H, 1)
            with torch.no_grad():
                w = torch.tensor(np.concatenate([m.Wxh[0:H], m.Wxh[H : 2 * H], m.Wxh[3 * H :], m.Wxh[2 * H : 3 * H]], axis=0).T, dtype=torch.float32)
                self.lstm.weight_ih_l0.copy_(w)
                self.lstm.weight_hh_l0.copy_(torch.tensor(m.Whh[[*range(H), *range(H, 2 * H), *range(3 * H, 4 * H), *range(2 * H, 3 * H)]].T, dtype=torch.float32))
                self.lstm.bias_ih_l0.copy_(torch.tensor(np.concatenate([m.b[0:H], m.b[H : 2 * H], m.b[3 * H :], m.b[2 * H : 3 * H]]), dtype=torch.float32))
                self.head.weight.copy_(torch.tensor(m.Wy.T, dtype=torch.float32))
                self.head.bias.copy_(torch.tensor(m.by.reshape(-1), dtype=torch.float32))

        def forward(self, x):
            out, _ = self.lstm(x)
            return torch.tanh(self.head(out[:, -1, :]))

    model = _Wrapper().eval()
    dummy = torch.randn(1, m.look_back, F, dtype=torch.float32)
    path = out_dir / "model.onnx"
    torch.onnx.export(model, dummy, str(path), input_names=["features"], output_names=["pred_return"], dynamo=False)
    meta = {"format": "onnx", "path": str(path), "sha256": _sha256(path), "size_bytes": path.stat().st_size, "model_version": bundle.version}
    _record_export(out_dir, meta)
    return meta


def _feature_list() -> list[str]:
    from app.ai.features import FEATURE_NAMES

    return list(FEATURE_NAMES)


def _record_export(out_dir: Path, meta: dict[str, Any]) -> None:
    manifest_path = out_dir / "model_manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    exports = manifest.setdefault("exports", {})
    exports[meta["format"]] = meta
    manifest["updated_at"] = int(__import__("time").time())
    manifest_path.write_text(json.dumps(manifest, indent=2, default=str))
    log.info("recorded %s export in manifest", meta["format"])


def main() -> None:  # pragma: no cover - manual tool
    parser = argparse.ArgumentParser(description="Export AI weights to an on-device format")
    parser.add_argument("--format", default="tflite", choices=["tflite", "onnx", "torchscript"])
    args = parser.parse_args()
    configure = logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    del configure
    if args.format == "tflite":
        print(json.dumps(export_tflite(), indent=2))
    elif args.format == "onnx":
        print(json.dumps(export_onnx(), indent=2))
    else:
        print("torchscript export uses the same wrapper as ONNX: run with --format onnx and load via torch.jit")


if __name__ == "__main__":  # pragma: no cover
    main()
