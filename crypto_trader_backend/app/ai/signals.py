"""AI signal generation - the fusion of technical rules + neural models.

Pipeline for ``GET /api/ai/signal/{symbol}``::

    candles -> indicators -> features -> [LSTM pred, classifier probs, rule votes]
                 -> weighted score in [-1, 1] -> action + confidence + reasons
                 -> trade plan (entry / TP / SL / size / R:R) via the risk manager

Every component is explainable: the response carries the exact indicator values
that fired, each rule vote with its weight, and the model probabilities, so the
app can render "why" (green BUY badge + "RSI oversold + MACD crossover") instead
of a black-box number.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from app.ai import features as feat
from app.ai import indicators as ind
from app.ai.registry import ModelBundle, registry
from app.config import settings
from app.errors import ValidationError_

log = logging.getLogger(__name__)

RULE_WEIGHTS = {
    "rsi": 0.16,
    "macd": 0.16,
    "bollinger": 0.10,
    "trend": 0.14,
    "volume": 0.10,
    "levels": 0.12,
    "vwap": 0.06,
    "momentum": 0.05,
}


@dataclass(slots=True)
class RuleVote:
    name: str
    vote: float  # -1 .. 1
    weight: float
    detail: str

    @property
    def contribution(self) -> float:
        return round(float(self.vote) * self.weight, 4)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "vote": round(float(self.vote), 3),
            "weight": self.weight,
            "detail": self.detail,
            "contribution": self.contribution,
        }


@dataclass(slots=True)
class TradePlan:
    entry: float
    take_profit: float
    stop_loss: float
    risk_per_unit: float
    reward_risk: float
    suggested_qty: float
    suggested_notional: float
    position_pct: float
    leverage_note: str = "spot, no leverage"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SignalResult:
    symbol: str
    interval: str
    action: str
    confidence: float
    reason: str
    score: float
    price: float
    indicators: dict[str, Any] = field(default_factory=dict)
    models: dict[str, Any] = field(default_factory=dict)
    rules: list[dict[str, Any]] = field(default_factory=list)
    plan: dict[str, Any] = field(default_factory=dict)
    model_version: str = ""
    signal_id: str = field(default_factory=lambda: f"sig_{uuid.uuid4().hex[:12]}")
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "signal_id": self.signal_id,
            "symbol": self.symbol,
            "interval": self.interval,
            "action": self.action,
            "confidence": round(self.confidence, 2),
            "confidence_pct": round(self.confidence, 2),
            "reason": self.reason,
            "score": round(self.score, 4),
            "price": self.price,
            "indicators": self.indicators,
            "models": self.models,
            "rules": self.rules,
            "trade_plan": self.plan,
            "model_version": self.model_version,
            "created_at_ms": self.created_at_ms,
            "warnings": self.warnings,
        }


# --------------------------------------------------------------------------- #
# Individual rules
# --------------------------------------------------------------------------- #
def _rule_rsi(s: ind.IndicatorSnapshot) -> RuleVote:
    r = s.rsi
    if r <= 25:
        return RuleVote("rsi", 1.0, RULE_WEIGHTS["rsi"], f"RSI deeply oversold at {r:.1f}")
    if r <= 32:
        return RuleVote("rsi", 0.72, RULE_WEIGHTS["rsi"], f"RSI oversold at {r:.1f}")
    if r < 42:
        return RuleVote("rsi", 0.3, RULE_WEIGHTS["rsi"], f"RSI low ({r:.1f}), mean-reversion bid")
    if r >= 78:
        return RuleVote("rsi", -1.0, RULE_WEIGHTS["rsi"], f"RSI deeply overbought at {r:.1f}")
    if r >= 68:
        return RuleVote("rsi", -0.72, RULE_WEIGHTS["rsi"], f"RSI overbought at {r:.1f}")
    if r > 58:
        return RuleVote("rsi", -0.28, RULE_WEIGHTS["rsi"], f"RSI elevated ({r:.1f}), momentum stretched")
    return RuleVote("rsi", 0.0, RULE_WEIGHTS["rsi"], f"RSI neutral at {r:.1f}")


def _rule_macd(s: ind.IndicatorSnapshot) -> RuleVote:
    h, m, sig = s.macd_hist, s.macd, s.macd_signal
    scale = max(abs(m) + abs(sig) + abs(h), 1e-9)
    strength = max(-1.0, min(1.0, h / (scale * 0.35)))
    above = m > sig
    if above and h > 0:
        return RuleVote("macd", min(1.0, 0.55 + strength * 0.45), RULE_WEIGHTS["macd"], "MACD bullish crossover above signal")
    if above:
        return RuleVote("macd", 0.28, RULE_WEIGHTS["macd"], "MACD histogram contracting below zero")
    if not above and h < 0:
        return RuleVote("macd", max(-1.0, -0.55 + strength * 0.45), RULE_WEIGHTS["macd"], "MACD bearish crossover below signal")
    return RuleVote("macd", -0.25, RULE_WEIGHTS["macd"], "MACD histogram fading above zero")


def _rule_bollinger(s: ind.IndicatorSnapshot) -> RuleVote:
    pb, w = s.bb_percent_b, s.bb_width
    if w and w < 0.018:
        return RuleVote("bollinger", 0.15 if pb > 0.5 else -0.15, RULE_WEIGHTS["bollinger"], f"Bollinger squeeze (width {w:.3f}) - breakout pending")
    if pb <= 0.02:
        return RuleVote("bollinger", 0.85, RULE_WEIGHTS["bollinger"], "Price riding the lower band - stretched downside")
    if pb >= 0.98:
        return RuleVote("bollinger", -0.85, RULE_WEIGHTS["bollinger"], "Price riding the upper band - stretched upside")
    if pb < 0.28:
        return RuleVote("bollinger", 0.35, RULE_WEIGHTS["bollinger"], f"Price in lower band (%B {pb:.2f})")
    if pb > 0.72:
        return RuleVote("bollinger", -0.35, RULE_WEIGHTS["bollinger"], f"Price in upper band (%B {pb:.2f})")
    return RuleVote("bollinger", 0.0, RULE_WEIGHTS["bollinger"], "Price mid-band, no edge")


def _rule_trend(s: ind.IndicatorSnapshot) -> RuleVote:
    e20, e50, e200, price = s.ema_20, s.ema_50, s.ema_200, s.price
    stack_up = e20 > e50 > e200
    stack_dn = e20 < e50 < e200
    adx_boost = 0.25 if s.adx >= 25 else 0.0
    if stack_up and price > e20:
        return RuleVote("trend", min(1.0, 0.62 + adx_boost), RULE_WEIGHTS["trend"], f"Bullish EMA stack (20>50>200) with ADX {s.adx:.0f}")
    if stack_dn and price < e20:
        return RuleVote("trend", max(-1.0, -0.62 - adx_boost), RULE_WEIGHTS["trend"], f"Bearish EMA stack (20<50<200) with ADX {s.adx:.0f}")
    if price > e50 > e200:
        return RuleVote("trend", 0.35, RULE_WEIGHTS["trend"], "Price reclaimed EMA-50")
    if price < e50 < e200:
        return RuleVote("trend", -0.35, RULE_WEIGHTS["trend"], "Price rejected at EMA-50")
    return RuleVote("trend", 0.0, RULE_WEIGHTS["trend"], "Moving averages tangled (range)")


def _rule_volume(s: ind.IndicatorSnapshot) -> RuleVote:
    rel, taker, _z = s.relative_volume, s.taker_ratio, s.vol_z
    if rel >= 1.6:
        if taker >= 0.56:
            return RuleVote("volume", 0.8, RULE_WEIGHTS["volume"], f"Volume surge {rel:.1f}x with {taker * 100:.0f}% taker-buy flow")
        if taker <= 0.44:
            return RuleVote("volume", -0.8, RULE_WEIGHTS["volume"], f"Volume surge {rel:.1f}x driven by {100 - taker * 100:.0f}% taker-sell flow")
        return RuleVote("volume", 0.1 * np.sign(s.macd_hist), RULE_WEIGHTS["volume"], f"High volume ({rel:.1f}x) but balanced flow (churn)")
    if rel <= 0.6:
        return RuleVote("volume", 0.0, RULE_WEIGHTS["volume"], "Below-average volume - moves unconfirmed")
    return RuleVote("volume", 0.25 * (taker - 0.5) * 4, RULE_WEIGHTS["volume"], f"Flow skew {(taker - 0.5) * 100:+.1f}% taker-buy")


def _rule_levels(s: ind.IndicatorSnapshot) -> RuleVote:
    price = s.price
    nearest_sup = max([lvl for lvl in s.supports if lvl < price], default=None)
    nearest_res = min([lvl for lvl in s.resistances if lvl > price], default=None)
    atr_ref = max(s.atr, price * 0.0005)
    if nearest_sup is not None and (price - nearest_sup) <= atr_ref * 0.8:
        return RuleVote("levels", 0.75, RULE_WEIGHTS["levels"], f"Sitting on support {nearest_sup:g} (within 0.8 ATR)")
    if nearest_res is not None and (nearest_res - price) <= atr_ref * 0.8:
        return RuleVote("levels", -0.75, RULE_WEIGHTS["levels"], f"Hitting resistance {nearest_res:g} (within 0.8 ATR)")
    if s.value_area_low and price < s.value_area_low:
        return RuleVote("levels", 0.4, RULE_WEIGHTS["levels"], "Below volume value area (VA low)")
    if s.value_area_high and price > s.value_area_high:
        return RuleVote("levels", -0.4, RULE_WEIGHTS["levels"], "Above volume value area (VA high)")
    return RuleVote("levels", 0.0, RULE_WEIGHTS["levels"], "Mid-range between support and resistance")


def _rule_vwap(s: ind.IndicatorSnapshot) -> RuleVote:
    dev = (s.price / s.vwap - 1.0) * 100 if s.vwap else 0.0
    if dev <= -0.9:
        return RuleVote("vwap", 0.55, RULE_WEIGHTS["vwap"], f"Price {abs(dev):.1f}% under VWAP (discount)")
    if dev >= 0.9:
        return RuleVote("vwap", -0.55, RULE_WEIGHTS["vwap"], f"Price {dev:.1f}% over VWAP (premium)")
    return RuleVote("vwap", 0.12 * -np.sign(dev), RULE_WEIGHTS["vwap"], f"Price near VWAP ({dev:+.2f}%)")


def _rule_momentum(s: ind.IndicatorSnapshot) -> RuleVote:
    roc_, stoch, wr = s.roc, s.stoch_k, s.williams_r
    score = 0.0
    detail = []
    if roc_ > 1.2:
        score -= 0.25
        detail.append("3-bar rate of change stretched high")
    elif roc_ < -1.2:
        score += 0.25
        detail.append("3-bar rate of change washed out")
    if stoch > 85 and wr > -12:
        score -= 0.35
        detail.append(f"stochastic exhausted at {stoch:.0f}")
    elif stoch < 15 and wr < -88:
        score += 0.35
        detail.append(f"stochastic washed out at {stoch:.0f}")
    if not detail:
        return RuleVote("momentum", 0.0, RULE_WEIGHTS["momentum"], "Short-term momentum balanced")
    return RuleVote("momentum", max(-1.0, min(1.0, score)), RULE_WEIGHTS["momentum"], "; ".join(detail))


# --------------------------------------------------------------------------- #
# Main entry points
# --------------------------------------------------------------------------- #
def model_predictions(bundle: ModelBundle, bars: list[dict[str, Any]]) -> dict[str, Any]:
    """Run LSTM + classifier over the feature matrix."""
    out: dict[str, Any] = {
        "lstm_pred_return": None,
        "lstm_direction_prob": None,
        "classifier_probs": None,
        "classifier_action": "HOLD",
        "classifier_confidence": 0.0,
        "status": "ok",
    }
    if bundle.source == "fallback":
        # No trained artifacts on disk: refuse to emit random-number "AI" output
        # and let the (fully explainable) rule engine carry the signal.
        out["status"] = "untrained"
        out["note"] = "run `python -m app.ai.train` (or POST /api/ai/train) to fit the LSTM + classifier"
        if len(bars) < bundle.look_back + 5:
            return out
    if len(bars) < bundle.look_back + 5:
        out["status"] = f"insufficient_history({len(bars)}<{bundle.look_back + 5})"
        return out
    trained = bundle.source != "fallback"
    try:
        frame = feat.build_frame(bars)
        x, _stats = feat.standardise(frame, bundle.feature_stats or None)
        seqs = x[-bundle.look_back :, :]
        if trained and bundle.lstm is not None:
            z = float(bundle.lstm.predict(seqs[None, :, :])[0])
            out["lstm_pred_return"] = round(z * bundle.return_scale * 100, 4)  # % over next bar
            out["lstm_direction_prob"] = round(float(0.5 * (1 + np.tanh(1.6 * z))), 4)
        if trained and bundle.classifier is not None:
            probs = bundle.classifier.predict_proba(x[-1:, :])[0]
            idx = int(np.argmax(probs))
            out["classifier_probs"] = {
                "HOLD": round(float(probs[0]), 4),
                "BUY": round(float(probs[1]), 4),
                "SELL": round(float(probs[2]), 4),
            }
            out["classifier_action"] = ("HOLD", "BUY", "SELL")[idx]
            out["classifier_confidence"] = round(float(probs[idx] * 100), 2)
    except Exception as exc:  # pragma: no cover - defensive
        log.exception("model inference failed")
        out["status"] = f"error:{type(exc).__name__}"
    return out


def score_signal(
    snapshot: ind.IndicatorSnapshot,
    models: dict[str, Any],
    *,
    bias: float = 0.0,
) -> tuple[float, list[RuleVote], str]:
    """Fuse rule votes and model outputs into a single score in [-1, 1]."""
    votes = [
        _rule_rsi(snapshot),
        _rule_macd(snapshot),
        _rule_bollinger(snapshot),
        _rule_trend(snapshot),
        _rule_volume(snapshot),
        _rule_levels(snapshot),
        _rule_vwap(snapshot),
        _rule_momentum(snapshot),
    ]
    rule_score = sum(v.contribution for v in votes) / sum(v.weight for v in votes)

    parts: list[tuple[float, float]] = [(rule_score, 0.55)]
    if models.get("lstm_direction_prob") is not None:
        parts.append((float(models["lstm_direction_prob"]) * 2 - 1, 0.25))
    cprobs = models.get("classifier_probs")
    if cprobs:
        c_score = float(cprobs.get("BUY", 0) - cprobs.get("SELL", 0))
        parts.append((c_score, 0.20))
    weight_total = sum(w for _, w in parts)
    score = sum(v * w for v, w in parts) / weight_total if weight_total else rule_score
    score = float(np.clip(score + bias, -1.0, 1.0))

    drivers = [v for v in votes if abs(v.vote) >= 0.3]
    drivers.sort(key=lambda v: -abs(v.contribution))
    phrases = [v.detail for v in drivers[:3]]
    if cprobs and abs(cprobs.get("BUY", 0) - cprobs.get("SELL", 0)) > 0.18:
        winner = "BUY" if cprobs["BUY"] > cprobs["SELL"] else "SELL"
        phrases.append(f"ML classifier {winner} at {max(cprobs.values()) * 100:.0f}%")
    if models.get("lstm_pred_return") is not None and abs(models["lstm_pred_return"]) > 0.05:
        phrases.append(f"LSTM projects {models['lstm_pred_return']:+.2f}% next bar")
    reason = " + ".join(phrases) if phrases else "No confluence - flat/inconclusive tape"
    return score, votes, reason


def confidence_from_score(score: float, votes: list[RuleVote], models: dict[str, Any]) -> float:
    """Confidence = |score| amplified by agreement between rules and models."""
    base = abs(score)
    same_sign = [v for v in votes if abs(v.vote) >= 0.3 and np.sign(v.vote) == np.sign(score)]
    agreement = len(same_sign) / max(1, len([v for v in votes if abs(v.vote) >= 0.3]))
    agree = 0.0 if not any(abs(v.vote) >= 0.3 for v in votes) else agreement
    model_boost = 0.0
    if models.get("classifier_confidence"):
        model_boost = 0.10 * min(1.0, (float(models["classifier_confidence"]) - 50.0) / 35.0)
    vol_penalty = 0.0
    if models.get("status", "ok") != "ok":
        vol_penalty = 0.12
    conf = 100.0 * (0.55 * base + 0.30 * agree * (0.4 + 0.6 * base) + 0.18 * base * agree + model_boost)
    return float(np.clip(conf * (1 - vol_penalty), 5.0, 97.5))


def build_signal(
    bars: list[dict[str, Any]],
    symbol: str,
    *,
    interval: str = "1m",
    bundle: ModelBundle | None = None,
    balance_hint: float | None = None,
    risk_level: str | None = None,
    min_confidence: float | None = None,
    bias: float = 0.0,
) -> SignalResult:
    """Compute a full AI signal from a candle list (>= 120 bars recommended)."""
    if not bars or len(bars) < 60:
        raise ValidationError_("need at least 60 candles for a signal", details={"got": len(bars or [])})
    bundle = bundle or registry.ensure_loaded()
    snapshot = ind.compute(bars, symbol, interval)
    models = model_predictions(bundle, bars)
    score, votes, reason = score_signal(snapshot, models, bias=bias)

    min_conf = settings.AI_MIN_CONFIDENCE_PCT if min_confidence is None else min_confidence
    if score > 0.06:
        action = "BUY"
    elif score < -0.06:
        action = "SELL"
    else:
        action = "HOLD"
    confidence = confidence_from_score(score, votes, models)
    warnings: list[str] = []
    if confidence < min_conf and action != "HOLD":
        warnings.append(f"confidence {confidence:.1f}% below threshold {min_conf:.1f}% - downgraded to HOLD for auto-trading")
        action = "HOLD"
        reason = f"{reason}; held back by confidence floor"
    if models.get("status") not in ("ok", None):
        warnings.append(f"models unavailable ({models['status']}); rules-only signal")

    plan = trade_plan(snapshot, action, balance_hint=balance_hint, risk_level=risk_level or "moderate")
    indicators = snapshot.as_dict()
    indicators.pop("series", None)
    indicators["indicator_series"] = snapshot.series_only()
    return SignalResult(
        symbol=symbol.upper(),
        interval=interval,
        action=action,
        confidence=confidence,
        reason=reason,
        score=score,
        price=snapshot.price,
        indicators=indicators,
        models=models,
        rules=[v.as_dict() for v in votes],
        plan=plan.as_dict() if plan else {},
        model_version=bundle.version,
        warnings=warnings,
    )


def trade_plan(
    s: ind.IndicatorSnapshot,
    action: str,
    *,
    balance_hint: float | None = None,
    risk_level: str = "moderate",
) -> TradePlan | None:
    """ATR-based TP/SL + sizing suggestion shown next to the AI badge."""
    if action == "HOLD" or not s.price:
        return None
    atr = max(s.atr, s.price * 0.0015)
    mult = {"conservative": (1.2, 2.2), "moderate": (1.5, 2.5), "aggressive": (2.0, 3.5)}.get(risk_level, (1.5, 2.5))
    sl_mult, tp_mult = mult
    if action == "BUY":
        stop = max([x for x in s.supports if x < s.price], default=s.price - sl_mult * atr)
        stop = min(stop, s.price - 0.6 * atr)
        target = min([x for x in s.resistances if x > s.price], default=s.price + tp_mult * atr)
        target = max(target, s.price + 1.2 * atr)
    else:
        stop = min([x for x in s.resistances if x > s.price], default=s.price + sl_mult * atr)
        stop = max(stop, s.price + 0.6 * atr)
        target = max([x for x in s.supports if x < s.price], default=s.price - tp_mult * atr)
        target = min(target, s.price - 1.2 * atr)
    risk_per_unit = abs(s.price - stop)
    reward = abs(target - s.price)
    rr = reward / risk_per_unit if risk_per_unit > 0 else 0.0
    risk_pct = {"conservative": 0.01, "moderate": 0.02, "aggressive": 0.035}.get(risk_level, 0.02)
    equity = float(balance_hint) if balance_hint and balance_hint > 0 else 1000.0
    notional_budget = equity * settings.MAX_POSITION_PCT / 100.0
    qty = (equity * risk_pct) / risk_per_unit if risk_per_unit > 0 else 0.0
    qty = min(qty, notional_budget / max(s.price, 1e-9))
    return TradePlan(
        entry=round(s.price, 8),
        take_profit=round(target, 8),
        stop_loss=round(stop, 8),
        risk_per_unit=round(risk_per_unit, 8),
        reward_risk=round(rr, 2),
        suggested_qty=round(qty, 8),
        suggested_notional=round(qty * s.price, 2),
        position_pct=round(min(100.0, (qty * s.price / notional_budget * 100) if notional_budget else 0.0), 1),
    )


def summarise_market(rows: list[dict[str, Any]], signals: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Market-wide sentiment used by the dashboard badge."""
    if not rows:
        return {"state": "NEUTRAL", "score": 0.0, "label": "Neutral", "breadth": {}, "signals": {}}
    ups = sum(1 for r in rows if (r.get("change_percent_24h") or 0) > 0)
    downs = sum(1 for r in rows if (r.get("change_percent_24h") or 0) < 0)
    avg_chg = float(np.mean([r.get("change_percent_24h") or 0.0 for r in rows]))
    actions = [s.get("action") for s in signals.values()]
    buy_ratio = actions.count("BUY") / len(actions) if actions else 0.0
    sell_ratio = actions.count("SELL") / len(actions) if actions else 0.0
    score = max(-1.0, min(1.0, 0.5 * np.tanh(avg_chg / 2.2) + 0.35 * (buy_ratio - sell_ratio) + 0.15 * ((ups - downs) / max(1, len(rows)))))
    state = "BULLISH" if score > 0.12 else "BEARISH" if score < -0.12 else "NEUTRAL"
    return {
        "state": state,
        "label": {"BULLISH": "Bullish", "BEARISH": "Bearish", "NEUTRAL": "Neutral"}[state],
        "score": round(float(score), 3),
        "avg_change_24h_pct": round(avg_chg, 3),
        "advancers": ups,
        "decliners": downs,
        "buy_signals": actions.count("BUY"),
        "sell_signals": actions.count("SELL"),
        "hold_signals": actions.count("HOLD"),
        "breadth": {"total": len(rows), "advancers": ups, "decliners": downs},
        "updated_at_ms": int(time.time() * 1000),
    }


def frame_from_bars(bars: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame(bars)
