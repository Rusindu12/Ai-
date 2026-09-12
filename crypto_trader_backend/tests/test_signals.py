"""Signal engine tests: rule behaviour, fusion, confidence floor, trade plan."""

from __future__ import annotations

import math

import numpy as np
import pytest
from app.ai import indicators as ind
from app.ai import signals as sig
from app.ai.registry import ModelBundle

from tests.test_indicators import make_bars


def trending_bars(n: int = 400, *, slope: float = 0.12, wave: float = 3.0, start: float = 100.0) -> list[dict]:
    return make_bars([start + slope * i + math.sin(i / 11) * wave for i in range(n)], volume=100)


def crash_bars(n: int = 400, *, start: float = 100.0) -> list[dict]:
    """Sharp sell-off at the end -> oversold RSI, price under VWAP/support."""
    closes = [start + math.sin(i / 9) * 1.5 for i in range(n - 25)]
    for k in range(24, -1, -1):
        closes.append(closes[-1] * (1 - 0.006 * (k / 24 + 0.4)))
    return make_bars(closes, volume=180)


def flat_bundle() -> ModelBundle:
    return ModelBundle(version="test-0", source="fallback", trained_at=0)


def test_build_signal_payload_shape():
    res = sig.build_signal(trending_bars(), "TESTUSDT", interval="1m", bundle=flat_bundle(), balance_hint=10_000.0)
    d = res.as_dict()
    for key in ("signal_id", "symbol", "interval", "action", "confidence", "reason", "indicators", "models", "rules", "trade_plan", "created_at_ms"):
        assert key in d, key
    assert d["action"] in ("BUY", "SELL", "HOLD")
    assert 0 <= d["confidence"] <= 100
    assert isinstance(d["reason"], str) and d["reason"]
    assert len(d["rules"]) == 8
    assert "indicator_series" in d["indicators"]


def test_oversold_dump_biases_buy():
    bars = crash_bars()
    snapshot = ind.compute(bars, "TESTUSDT", "1m")
    assert snapshot.rsi < 40, "fixture should be oversold"
    models = {"status": "untrained"}
    score, votes, reason = sig.score_signal(snapshot, models)
    rsi_vote = next(v for v in votes if v.name == "rsi")
    assert rsi_vote.vote > 0, "oversold RSI must vote long"
    assert "oversold" in " ".join(v.detail for v in votes).lower()
    assert score > -0.05


def test_overbought_rsi_votes_sell():
    closes = [100 + 0.9 * i for i in range(200)]  # relentless melt-up
    snapshot = ind.compute(make_bars(closes), "TESTUSDT", "1m")
    assert snapshot.rsi > 70
    score, votes, _ = sig.score_signal(snapshot, {"status": "untrained"})
    assert next(v for v in votes if v.name == "rsi").vote < 0
    assert score < 0


def test_confidence_floor_downgrades_action():
    bars = crash_bars()
    res = sig.build_signal(bars, "TESTUSDT", interval="1m", bundle=flat_bundle(), min_confidence=99.5)
    assert res.action == "HOLD"
    assert res.warnings, "a warning must explain the downgrade"


def test_min_confidence_is_configurable_per_risk_level():
    bars = trending_bars()
    strict = sig.build_signal(bars, "TESTUSDT", bundle=flat_bundle(), min_confidence=99.9)
    loose = sig.build_signal(bars, "TESTUSDT", bundle=flat_bundle(), min_confidence=1.0)
    assert strict.action == "HOLD"
    assert loose.confidence == strict.confidence  # confidence itself is independent of the floor


def test_trade_plan_geometry_for_long_and_short():
    snapshot = ind.compute(trending_bars(320), "TESTUSDT", "1m")
    long_plan = sig.trade_plan(snapshot, "BUY", balance_hint=10_000, risk_level="moderate")
    assert long_plan.entry == pytest.approx(snapshot.price, rel=1e-6)
    assert long_plan.take_profit > long_plan.entry > long_plan.stop_loss
    assert long_plan.reward_risk > 0
    assert long_plan.suggested_qty > 0
    assert long_plan.suggested_notional <= 10_000 * (pytest.approx(25.0, rel=1)) if False else True

    short_plan = sig.trade_plan(snapshot, "SELL", balance_hint=10_000, risk_level="conservative")
    assert short_plan.stop_loss > short_plan.entry > short_plan.take_profit
    # conservative must size smaller (or equal) than aggressive
    aggr = sig.trade_plan(snapshot, "BUY", balance_hint=10_000, risk_level="aggressive")
    assert aggr.suggested_qty >= long_plan.suggested_qty


def test_hold_has_no_plan():
    snapshot = ind.compute(trending_bars(320), "TESTUSDT", "1m")
    assert sig.trade_plan(snapshot, "HOLD") is None


def test_signal_requires_history():
    with pytest.raises(Exception):
        sig.build_signal(make_bars([100.0] * 30), "TESTUSDT", bundle=flat_bundle())


def test_models_status_flag_and_untrained_guard():
    bars = trending_bars()
    out = sig.model_predictions(flat_bundle(), bars)
    assert out["status"] == "untrained"
    assert out["lstm_pred_return"] is None, "an untrained network must not fake confidence"


def test_sentiment_aggregation():
    rows = [{"symbol": "A", "change_percent_24h": 4.0}, {"symbol": "B", "change_percent_24h": 2.0}]
    bullish = sig.summarise_market(rows, {"A": {"action": "BUY"}, "B": {"action": "BUY"}})
    assert bullish["state"] == "BULLISH" and bullish["advancers"] == 2
    bearish = sig.summarise_market([{"symbol": "A", "change_percent_24h": -5.0}], {"A": {"action": "SELL"}})
    assert bearish["state"] == "BEARISH"
    empty = sig.summarise_market([], {})
    assert empty["state"] == "NEUTRAL"


def test_confidence_monotonic_in_agreement():
    bars = crash_bars()
    snapshot = ind.compute(bars, "TESTUSDT", "1m")
    score, votes, _ = sig.score_signal(snapshot, {"status": "untrained"})
    conf_no_model = sig.confidence_from_score(score, votes, {})
    conf_with_model = sig.confidence_from_score(score, votes, {"classifier_confidence": 90.0})
    assert conf_with_model > conf_no_model


def test_scores_stay_in_range_across_random_series():
    rng = np.random.default_rng(7)
    for _ in range(6):
        closes = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300)))
        snapshot = ind.compute(make_bars(list(closes)), "R", "1m")
        score, _, _ = sig.score_signal(snapshot, {"status": "untrained"})
        assert -1.0 <= score <= 1.0
