"""
Vectorised backtesting engine.

Given a series of prices and a sequence of signals (BUY/SELL/HOLD with
confidence), simulates trading with configurable fees and computes the equity
curve plus classic performance metrics: total return, Sharpe ratio, win rate,
and maximum drawdown.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class BacktestResult:
    equity_curve: list[float] = field(default_factory=list)
    trades: list[dict] = field(default_factory=list)
    total_return: float = 0.0
    sharpe_ratio: float = 0.0
    win_rate: float = 0.0
    max_drawdown: float = 0.0
    signal_count: int = 0

    def as_dict(self) -> dict:
        return {
            "totalReturn": self.total_return,
            "sharpeRatio": self.sharpe_ratio,
            "winRate": self.win_rate,
            "maxDrawdown": self.max_drawdown,
            "trades": len(self.trades),
            "signals": self.signal_count,
            "equityCurve": self.equity_curve,
        }


def run_backtest(
    closes: list[float],
    signals: list[dict],
    starting_balance: float = 10_000.0,
    fee: float = 0.001,
) -> BacktestResult:
    """
    closes:  chronological price series.
    signals: list aligned to closes of {signal, confidence}.
    A BUY opens a full position at that bar; a SELL closes it.
    """
    result = BacktestResult()
    cash = starting_balance
    position = 0.0  # units held
    equity = starting_balance
    peak = starting_balance
    entry_price = 0.0
    wins = 0
    losses = 0

    n = min(len(closes), len(signals))
    for i in range(n):
        price = closes[i]
        sig = (signals[i] or {}).get("signal", "HOLD")
        result.signal_count += 1 if sig in ("BUY", "SELL") else 0

        if sig == "BUY" and position == 0.0 and price > 0:
            position = cash * (1 - fee) / price
            entry_price = price
            cash = 0.0
        elif sig == "SELL" and position > 0:
            cash = position * price * (1 - fee)
            pnl = (price - entry_price) * position
            if pnl > 0:
                wins += 1
            elif pnl < 0:
                losses += 1
            result.trades.append({"entry": entry_price, "exit": price, "pnl": pnl})
            position = 0.0

        equity = cash + position * price
        result.equity_curve.append(equity)
        peak = max(peak, equity)
        result.max_drawdown = max(result.max_drawdown, (peak - equity) / peak if peak > 0 else 0.0)

    result.total_return = (equity / starting_balance) - 1

    # Sharpe from the equity-curve returns (annualised with sqrt(365)).
    if len(result.equity_curve) > 1:
        eq = np.asarray(result.equity_curve)
        rets = np.diff(eq) / eq[:-1]
        if rets.std() > 0:
            result.sharpe_ratio = float(rets.mean() / rets.std() * math.sqrt(365))

    total_closed = wins + losses
    result.win_rate = wins / total_closed if total_closed else 0.0
    return result
