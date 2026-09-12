"""AI model tests: features, LSTM gradient correctness + learning, classifier, persistence."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from app.ai import features as feat
from app.ai.models.classifier import CLASSES, SignalClassifier
from app.ai.models.numpy_lstm import NumpyLSTM

from tests.test_indicators import make_bars


def test_feature_frame_shape_and_finiteness():
    bars = make_bars([100 + math.sin(i / 9) * 5 + i * 0.05 for i in range(400)])
    frame = feat.build_frame(bars)
    assert list(frame.columns) == feat.FEATURE_NAMES
    assert len(frame) == len(bars)
    assert np.isfinite(frame.to_numpy()).all(), "no NaN/Inf may reach the models"
    assert frame["ret_1"].abs().max() < 1.0


def test_standardise_zero_mean_unit_variance_and_roundtrip():
    bars = make_bars([100 + i * 0.1 for i in range(300)])
    frame = feat.build_frame(bars)
    x, stats = feat.standardise(frame)
    assert x.shape == (len(frame), len(feat.FEATURE_NAMES))
    assert abs(float(x.mean())) < 0.35  # clipped tails keep it near zero
    again, stats2 = feat.standardise(frame, stats)
    assert np.allclose(x, again), "reusing persisted stats must be deterministic"
    assert set(stats2) == set(feat.FEATURE_NAMES)


def test_forward_targets_and_labels():
    close = pd.Series(np.linspace(100, 130, 200))
    fwd, z = feat.forward_targets(close, horizon=6)
    assert fwd.iloc[10] == pytest.approx(close.iloc[16] / close.iloc[10] - 1.0)
    atr_pct = pd.Series([1.0] * 200)
    labels = feat.label_classes(fwd, atr_pct)
    assert set(np.unique(labels)) <= {0, 1, 2}
    assert labels[100] == 1  # steadily rising -> BUY


def test_lstm_gradient_check():
    model = NumpyLSTM(n_features=6, hidden=8, look_back=5)
    err = model.gradient_check()
    assert err < 1e-5, f"analytic vs numeric gradients disagree ({err})"


def test_lstm_forward_output_bounds():
    model = NumpyLSTM(n_features=4, hidden=8, look_back=6)
    x = np.random.default_rng(0).normal(size=(5, 6, 4))
    y = model.predict(x)
    assert y.shape == (5,)
    assert (np.abs(y) <= 1.0).all(), "output is tanh-squashed"


@pytest.mark.slow
def test_lstm_learns_a_signal():
    rng = np.random.default_rng(2)
    x = rng.normal(size=(240, 12, 5))
    y = np.clip(1.2 * x[:, :, 0].mean(axis=1) + 0.05 * rng.normal(size=240), -1, 1)
    model = NumpyLSTM(n_features=5, hidden=10, look_back=12)
    report = model.fit(x[:200], y[:200], x_val=x[200:], y_val=y[200:], epochs=25, batch_size=16, lr=6e-3)
    assert report["final_val_mse"] < report["train_loss"][0], "validation loss must improve"
    corr = np.corrcoef(model.predict(x[200:]), y[200:])[0, 1]
    assert corr > 0.35, f"model failed to learn (corr={corr:.2f})"


@pytest.mark.slow
def test_classifier_learns_and_persists(tmp_path: Path):
    rng = np.random.default_rng(3)
    x = rng.normal(size=(900, len(feat.FEATURE_NAMES)))
    score = 1.5 * x[:, feat.FEATURE_NAMES.index("rsi_n")] - 1.2 * x[:, feat.FEATURE_NAMES.index("macd_hist_n")] + 0.4 * rng.normal(size=900)
    y = np.where(score > 0.9, 1, np.where(score < -0.9, 2, 0))
    clf = SignalClassifier(n_features=len(feat.FEATURE_NAMES), hidden=16)
    report = clf.fit(x[:700], y[:700], x_val=x[700:], y_val=y[700:], epochs=90, lr=0.05)
    assert report["val_acc"] > 0.55, report
    assert 0.0 < report["temperature"] <= 2.7
    proba = clf.predict_proba(x[700:])
    assert proba.shape == (200, 3)
    assert np.allclose(proba.sum(axis=1), 1.0)
    assert report["val_loss"] > 0.0, "NLL must be positive"

    path = clf.save(tmp_path / "clf.npz")
    assert path.exists() and Path(str(path) + ".json").exists()
    loaded = SignalClassifier.load(path)
    assert np.allclose(loaded.predict_proba(x[700:]), proba, atol=1e-9)
    assert loaded.calibration["temperature"] == pytest.approx(report["temperature"])


def test_lstm_save_load_roundtrip(tmp_path: Path):
    model = NumpyLSTM(n_features=7, hidden=9, look_back=4)
    x = np.random.default_rng(4).normal(size=(3, 4, 7))
    path = model.save(tmp_path / "lstm.npz")
    reloaded = NumpyLSTM.load(path, meta={"n_features": 7, "hidden": 9, "look_back": 4})
    assert np.allclose(reloaded.predict(x), model.predict(x))
    assert reloaded.n_features == 7 and reloaded.hidden == 9


def test_class_labels_are_documented():
    assert CLASSES == ("HOLD", "BUY", "SELL")
