"""Strategy base types + a couple of always-available strategies."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pandas as pd

StrategyFn = Callable[[pd.DataFrame, int], float]


@dataclass(slots=True)
class StrategySpec:
    key: str
    name: str
    description: str
    tags: tuple[str, ...] = ("rule",)

    def as_dict(self) -> dict[str, Any]:
        return {"key": self.key, "name": self.name, "description": self.description, "tags": list(self.tags)}


def buy_hold(df: pd.DataFrame, i: int) -> float:
    return 1.0


def momentum_trend(df: pd.DataFrame, i: int) -> float:
    row = df.iloc[i]
    up = float(row["ema20"]) > float(row["ema50"])
    ret = float(row["ret1"])
    if up and ret > 0:
        return 1.0
    if not up and ret < 0:
        return -0.5
    return 0.0


def scale(fn: StrategyFn, *, size: float = 1.0, max_abs: float = 1.0) -> StrategyFn:
    """Wrap a strategy, scaling its desired position (used for risk levels)."""

    def wrapped(df: pd.DataFrame, i: int) -> float:
        v = fn(df, i) * size
        return max(-max_abs, min(max_abs, v))

    return wrapped


class BaseStrategy:
    """Class-style wrapper for users who prefer OOP strategies."""

    key = "base"
    name = "Base"
    description = "Abstract strategy"

    def position(self, df: pd.DataFrame, i: int) -> float:  # pragma: no cover - interface
        raise NotImplementedError

    def as_fn(self) -> StrategyFn:
        return self.position
