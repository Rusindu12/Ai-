"""Strategy registry.

Strategies are *pure functions* over an indicator-enriched DataFrame:
``fn(df, i) -> float`` where the return value is the desired position
(-1 short .. +1 long, 0 = flat).  That single contract powers:

* the backtester (:mod:`app.ai.backtest`)
* the live AI auto-trader (via :mod:`app.ai.signals`, which adds the models)
* the ``/api/ai/backtest`` endpoint, where users can compare strategies
"""

from __future__ import annotations

from app.ai.backtest import (
    ai_hybrid,
    bollinger_breakout,
    macd_trend,
    rsi_mean_reversion,
)
from app.strategies.base import StrategySpec, buy_hold, momentum_trend, scale

REGISTRY = {
    "buy_hold": buy_hold,
    "momentum_trend": momentum_trend,
    "rsi_reversion": rsi_mean_reversion(),
    "macd_trend": macd_trend(),
    "bollinger_breakout": bollinger_breakout(),
    "ai": ai_hybrid(),
    "ai_conservative": ai_hybrid(min_agreement=0.65),
}

SPECS = [
    StrategySpec("buy_hold", "Buy & Hold", "Always long; benchmark every other strategy against it."),
    StrategySpec("momentum_trend", "EMA Momentum Trend", "Long when EMA20 > EMA50 and 1-bar return is positive."),
    StrategySpec("rsi_reversion", "RSI Mean Reversion", "Buy RSI < 32 with volume confirmation, exit/short above 68."),
    StrategySpec("macd_trend", "MACD Trend", "Follows the MACD histogram relative to the signal line."),
    StrategySpec("bollinger_breakout", "Bollinger Breakout", "Trades band breaks when the candle range confirms."),
    StrategySpec("ai", "AI Hybrid (rules)", "Weighted confluence of RSI/MACD/trend/Bollinger, mirrors the live signal engine."),
    StrategySpec("ai_conservative", "AI Hybrid (strict)", "Same confluence, higher agreement threshold."),
]


def describe() -> list[dict]:
    from typing import Any

    out: list[dict[str, Any]] = []
    for spec in SPECS:
        out.append(spec.as_dict())
    return out


def get(name: str):
    return REGISTRY.get(name or "ai", REGISTRY["ai"])


__all__ = ["REGISTRY", "SPECS", "StrategySpec", "describe", "get", "scale"]
