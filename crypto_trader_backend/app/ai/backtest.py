"""Vectorised backtesting engine.

    python -m app.ai.backtest --symbol BTCUSDT --interval 1h --bars 4000 --strategy ai

Engine details
--------------
* Long-only spot semantics by default (crypto spot accounts cannot short);
  ``--allow-short`` adds a symmetric short leg for research.
* Fees and slippage are charged on **every** fill (bps from settings).
* Exits are evaluated intrabar: a bar whose high touches the take-profit and
  whose low touches the stop-loss is treated as a **stop-first** fill (the
  pessimistic assumption) unless ``--optimistic`` is passed.
* Position sizing follows the same risk-per-trade maths the live AI trader uses,
  so backtest numbers and live behaviour are comparable.
* Metrics: total return, CAGR-ish annualised return, max drawdown, Sharpe,
  Sortino, Calmar, win rate, profit factor, avg trade, exposure, trade count.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from app.config import settings

log = logging.getLogger(__name__)

StrategyFn = Callable[[pd.DataFrame, int], float]  # (df, i) -> desired position in [-1, 1]


@dataclass(slots=True)
class BacktestTrade:
    entry_time: int
    exit_time: int
    side: str
    entry: float
    exit: float
    qty: float
    pnl: float
    pnl_pct: float
    fees: float
    bars: int
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class BacktestResult:
    symbol: str
    interval: str
    start_ms: int
    end_ms: int
    bars: int
    start_equity: float
    end_equity: float
    metrics: dict[str, Any] = field(default_factory=dict)
    trades: list[dict[str, Any]] = field(default_factory=list)
    equity_curve: list[dict[str, Any]] = field(default_factory=list)
    drawdown_curve: list[float] = field(default_factory=list)
    monthly: dict[str, float] = field(default_factory=dict)
    config: dict[str, Any] = field(default_factory=dict)

    def as_dict(self, *, include_curve: bool = True, max_trades: int = 400) -> dict[str, Any]:
        out = {
            "symbol": self.symbol,
            "interval": self.interval,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "bars": self.bars,
            "start_equity": self.start_equity,
            "end_equity": round(self.end_equity, 2),
            "metrics": self.metrics,
            "trade_count": len(self.trades),
            "trades": self.trades[:max_trades],
            "monthly": self.monthly,
            "config": self.config,
        }
        if include_curve:
            out["equity_curve"] = self.equity_curve
            out["drawdown_curve"] = self.drawdown_curve
        return out


def position_size(equity: float, price: float, stop_distance: float, risk_per_trade: float, max_pct: float) -> float:
    if price <= 0 or equity <= 0:
        return 0.0
    by_risk = (equity * risk_per_trade) / stop_distance if stop_distance > 0 else equity * max_pct / price
    by_cap = equity * max_pct / price
    return max(0.0, min(by_risk, by_cap))


async def run_backtest(
    *,
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    bars: int = 4000,
    strategy: str | StrategyFn = "ai",
    start_equity: float = 10_000.0,
    risk_per_trade: float = 0.02,
    max_position_pct: float = 0.5,
    atr_sl_mult: float = 1.5,
    atr_tp_mult: float = 2.5,
    fee_bps: float | None = None,
    slippage_bps: float | None = None,
    allow_short: bool = False,
    optimistic: bool = False,
    end_ms: int | None = None,
    extra: dict[str, Any] | None = None,
) -> BacktestResult:
    """Run a full backtest.  ``strategy`` may be a name or an (df, i) -> pos fn."""
    from app.ai.dataset import fetch_history
    from app.ai.signals import build_signal  # noqa: F401  (kept for parity with live path)
    from app.services.gateway import get_gateway

    gateway = await get_gateway()
    rows = await fetch_history(gateway, symbol, interval, bars, end_ms=end_ms)
    df = pd.DataFrame(rows)
    if len(df) < 200:
        raise ValueError(f"not enough candles ({len(df)}) for a backtest")

    # Precompute indicator matrices once (fast: vectorised pandas/numpy)
    from app.ai import indicators as ind

    close, high, low, vol = df["close"], df["high"], df["low"], df["volume"]
    df["atr"] = ind.atr(high, low, close, 14)
    df["rsi"] = ind.rsi(close, 14)
    macd = ind.macd(close)
    df["macd_hist"] = macd["hist"]
    bb = ind.bollinger(close, 20, 2.0)
    df["bb_pctb"] = bb["percent_b"]
    df["ema20"] = ind.ema(close, 20)
    df["ema50"] = ind.ema(close, 50)
    df["vol_ma"] = vol.rolling(20).mean()
    df["ret1"] = close.pct_change()
    df = df.fillna(0.0)

    signal_fn = _resolve_strategy(strategy) if isinstance(strategy, str) else strategy

    fee_rate = (fee_bps if fee_bps is not None else settings.TAKER_FEE_BPS) / 10_000.0
    slip = (slippage_bps if slippage_bps is not None else settings.SLIPPAGE_BPS) / 10_000.0

    equity = start_equity
    peak = equity
    max_dd = 0.0
    pos_qty = 0.0
    pos_side = ""
    entry_price = 0.0
    entry_idx = 0
    entry_time = 0
    stop = 0.0
    target = 0.0
    trades: list[BacktestTrade] = []
    curve: list[dict[str, Any]] = []
    dd_curve: list[float] = []
    returns: list[float] = []
    exposure_bars = 0
    n = len(df)

    for i in range(60, n):
        row = df.iloc[i]
        price = float(row["close"])
        low_row = float(row["low"])
        ts = int(row["open_time"])

        if pos_qty > 0:
            hit_stop = (low_row <= stop) if pos_side == "LONG" else (float(row["high"]) >= stop)
            hit_target = (float(row["high"]) >= target) if pos_side == "LONG" else (low_row <= target)
            exit_price: float | None = None
            reason = ""
            if optimistic and hit_target:
                exit_price, reason = target, "take_profit"
            elif hit_stop:
                exit_price, reason = stop, "stop_loss"
            elif hit_target:
                exit_price, reason = target, "take_profit"
            else:
                want = signal_fn(df, i)
                flip = (pos_side == "LONG" and want <= -0.15) or (pos_side == "SHORT" and want >= 0.15)
                if flip:
                    exit_price, reason = price, "signal_flip"
            if exit_price is not None:
                fill = exit_price * (1 - slip) if pos_side == "LONG" else exit_price * (1 + slip)
                gross = (fill - entry_price) * pos_qty if pos_side == "LONG" else (entry_price - fill) * pos_qty
                fees = (entry_price + fill) * pos_qty * fee_rate
                pnl = gross - fees
                equity += pnl
                trades.append(
                    BacktestTrade(
                        entry_time=entry_time,
                        exit_time=ts,
                        side=pos_side,
                        entry=round(entry_price, 8),
                        exit=round(fill, 8),
                        qty=round(pos_qty, 8),
                        pnl=round(pnl, 4),
                        pnl_pct=round(100.0 * pnl / max(1e-9, entry_price * pos_qty), 3),
                        fees=round(fees, 6),
                        bars=i - entry_idx,
                        reason=reason,
                    )
                )
                pos_qty = 0.0
                pos_side = ""

        want = signal_fn(df, i)
        if pos_qty == 0.0 and abs(want) > 0.2:
            side = "LONG" if want > 0 else "SHORT"
            if side == "SHORT" and not allow_short:
                want = 0.0
            else:
                atr = max(float(row["atr"]) or price * 0.005, price * 0.0008)
                entry = price * (1 + slip) if side == "LONG" else price * (1 - slip)
                stop_dist = atr_sl_mult * atr
                stop = entry - stop_dist if side == "LONG" else entry + stop_dist
                target = entry + atr_tp_mult * atr if side == "LONG" else entry - atr_tp_mult * atr
                qty = position_size(equity, entry, stop_dist, risk_per_trade, max_position_pct)
                if qty * entry >= settings.MIN_ORDER_NOTIONAL_USD and qty > 0:
                    pos_qty = qty
                    pos_side = side
                    entry_price = entry
                    entry_idx = i
                    entry_time = ts

        if pos_qty > 0:
            exposure_bars += 1
            unrealised = (price - entry_price) * pos_qty if pos_side == "LONG" else (entry_price - price) * pos_qty
            curve.append({"t": ts, "equity": round(equity + unrealised, 2), "price": price, "position": pos_side})
        else:
            curve.append({"t": ts, "equity": round(equity, 2), "price": price, "position": "FLAT"})
        mark = curve[-1]["equity"]
        returns.append(mark / max(1e-9, curve[-2]["equity"] if len(curve) > 1 else mark) - 1.0)
        peak = max(peak, mark)
        max_dd = max(max_dd, peak - mark)
        dd_curve.append(round(100.0 * (mark - peak) / peak, 3) if peak else 0.0)

    # liquidate any open position at the end so metrics are honest
    if pos_qty > 0:
        last = df.iloc[-1]
        fill = float(last["close"])
        gross = (fill - entry_price) * pos_qty if pos_side == "LONG" else (entry_price - fill) * pos_qty
        fees = (entry_price + fill) * pos_qty * fee_rate
        equity += gross - fees
        trades.append(
            BacktestTrade(
                entry_time=entry_time,
                exit_time=int(last["open_time"]),
                side=pos_side,
                entry=round(entry_price, 8),
                exit=round(fill, 8),
                qty=round(pos_qty, 8),
                pnl=round(gross - fees, 4),
                pnl_pct=round(100.0 * (gross - fees) / max(1e-9, entry_price * pos_qty), 3),
                fees=round(fees, 6),
                bars=n - 1 - entry_idx,
                reason="end_of_test",
            )
        )

    pnls = np.array([t.pnl for t in trades], dtype=float)
    rets = np.array(returns, dtype=float)
    period_seconds = _interval_seconds(interval)
    periods_per_year = 365 * 86400 / period_seconds
    sharpe = float(np.mean(rets) / np.std(rets) * math.sqrt(periods_per_year)) if len(rets) > 2 and np.std(rets) > 1e-12 else 0.0
    downside = rets[rets < 0]
    sortino = float(np.mean(rets) / np.std(downside) * math.sqrt(periods_per_year)) if len(downside) > 2 and np.std(downside) > 1e-12 else 0.0
    years = max(1e-6, (df.iloc[-1]["open_time"] - df.iloc[0]["open_time"]) / 1000.0 / (365 * 86400))
    total_ret = equity / start_equity - 1.0
    annualised = (1.0 + total_ret) ** (1.0 / years) - 1.0 if years > 0 else total_ret
    wins = pnls[pnls > 0]
    losses = pnls[pnls < 0]
    buy_hold = float(df.iloc[-1]["close"] / df.iloc[60]["close"] - 1.0)
    monthly = _monthly(curve)

    metrics = {
        "total_return_pct": round(100 * total_ret, 2),
        "annualised_return_pct": round(100 * annualised, 2),
        "buy_hold_return_pct": round(100 * buy_hold, 2),
        "alpha_vs_buy_hold_pct": round(100 * (total_ret - buy_hold), 2),
        "max_drawdown_usd": round(max_dd, 2),
        "max_drawdown_pct": round(100.0 * max_dd / max(1e-9, peak), 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "calmar": round(annualised / (100.0 * max_dd / max(1e-9, peak)), 2) if max_dd > 0 else None,
        "trades": int(len(trades)),
        "wins": int(len(wins)),
        "losses": int(len(losses)),
        "win_rate_pct": round(100.0 * len(wins) / max(1, len(trades)), 2),
        "profit_factor": round(float(wins.sum()) / abs(float(losses.sum())), 2) if len(losses) and losses.sum() != 0 else None,
        "avg_trade_pnl": round(float(np.mean(pnls)), 4) if len(pnls) else 0.0,
        "avg_win": round(float(np.mean(wins)), 4) if len(wins) else 0.0,
        "avg_loss": round(float(np.mean(losses)), 4) if len(losses) else 0.0,
        "avg_bars_in_trade": round(float(np.mean([t.bars for t in trades])), 1) if trades else 0.0,
        "exposure_pct": round(100.0 * exposure_bars / max(1, n - 60), 1),
        "fees_paid": round(float(sum(t.fees for t in trades)), 2),
        "periods_per_year": round(periods_per_year, 1),
    }
    return BacktestResult(
        symbol=symbol.upper(),
        interval=interval,
        start_ms=int(df.iloc[0]["open_time"]),
        end_ms=int(df.iloc[-1]["open_time"]),
        bars=int(n),
        start_equity=start_equity,
        end_equity=round(equity, 2),
        metrics=metrics,
        trades=[t.as_dict() for t in trades],
        equity_curve=curve[:: max(1, len(curve) // 500)],
        drawdown_curve=dd_curve[:: max(1, len(dd_curve) // 500)],
        monthly=monthly,
        config={
            "risk_per_trade": risk_per_trade,
            "max_position_pct": max_position_pct,
            "atr_sl_mult": atr_sl_mult,
            "atr_tp_mult": atr_tp_mult,
            "fee_bps": fee_rate * 10_000.0,
            "slippage_bps": slip * 10_000.0,
            "allow_short": allow_short,
            "optimistic": optimistic,
            "strategy": strategy if isinstance(strategy, str) else "custom",
            **(extra or {}),
        },
    )


def _monthly(curve: list[dict[str, Any]]) -> dict[str, float]:
    if not curve:
        return {}
    idx = pd.to_datetime([c["t"] for c in curve], unit="ms", utc=True)
    s = pd.Series([c["equity"] for c in curve], index=idx)
    out = {}
    prev = None
    for key, value in s.resample("ME").last().items():
        if prev is not None and prev:
            out[str(key)[:7]] = round(100.0 * (float(value) / float(prev) - 1.0), 2)
        prev = value
    return out


def _interval_seconds(interval: str) -> float:
    from app.binance.simulator import INTERVAL_SECONDS

    return float(INTERVAL_SECONDS.get(interval, 3600))


# --------------------------------------------------------------------------- #
# Strategies
# --------------------------------------------------------------------------- #
def _resolve_strategy(name: str) -> StrategyFn:
    from app.strategies import REGISTRY

    return REGISTRY.get(name, REGISTRY["momentum_trend"])


def rsi_mean_reversion(*, oversold: float = 32.0, overbought: float = 68.0, confirm_volume: bool = True) -> StrategyFn:
    def fn(df: pd.DataFrame, i: int) -> float:
        r = float(df.iloc[i]["rsi"])
        vol_ok = True
        if confirm_volume:
            vma = float(df.iloc[i]["vol_ma"]) or 1.0
            vol_ok = float(df.iloc[i]["volume"]) >= 0.65 * vma
        if r <= oversold and vol_ok:
            return 1.0
        if r >= overbought:
            return -1.0
        return 0.0

    return fn


def macd_trend(*, ema_fast: str = "ema20", ema_slow: str = "ema50") -> StrategyFn:
    def fn(df: pd.DataFrame, i: int) -> float:
        row = df.iloc[i]
        hist = float(row["macd_hist"])
        up = float(row[ema_fast]) > float(row[ema_slow])
        if hist > 0 and up:
            return 1.0
        if hist < 0 and not up:
            return -1.0
        return 0.0

    return fn


def bollinger_breakout(*, width_min: float = 0.02) -> StrategyFn:
    def fn(df: pd.DataFrame, i: int) -> float:
        row = df.iloc[i]
        pctb = float(row["bb_pctb"])
        if pctb >= 0.97 and abs(float(row["ret1"])) > 0.0005:
            return 1.0
        if pctb <= 0.03 and abs(float(row["ret1"])) > 0.0005:
            return -1.0
        return 0.0

    return fn


def ai_hybrid(*, min_agreement: float = 0.5) -> StrategyFn:
    """Rule ensemble that mirrors app.ai.signals without the neural nets."""

    def fn(df: pd.DataFrame, i: int) -> float:
        row = df.iloc[i]
        score = 0.0
        r = float(row["rsi"])
        score += 0.30 if r < 30 else (-0.30 if r > 70 else 0.0)
        score += 0.25 if float(row["macd_hist"]) > 0 else -0.25
        score += 0.20 if float(row["ema20"]) > float(row["ema50"]) else -0.20
        pctb = float(row["bb_pctb"])
        score += 0.15 if pctb < 0.15 else (-0.15 if pctb > 0.85 else 0.0)
        score += 0.10 if float(row["close"]) > float(row["vwap"] if "vwap" in row else row["close"]) else 0.0
        return score if abs(score) >= min_agreement else 0.0

    return fn


# --------------------------------------------------------------------------- #
def main() -> None:  # pragma: no cover
    from app.errors import configure_logging

    configure_logging("INFO")
    parser = argparse.ArgumentParser(description="Backtest an AI strategy on historical candles")
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--bars", type=int, default=4000)
    parser.add_argument("--strategy", default="ai", choices=["ai", "momentum_trend", "rsi_reversion", "macd_trend", "bollinger_breakout", "buy_hold"])
    parser.add_argument("--equity", type=float, default=10_000.0)
    parser.add_argument("--risk", type=float, default=0.02)
    parser.add_argument("--allow-short", action="store_true")
    parser.add_argument("--optimistic", action="store_true")
    parser.add_argument("--json", action="store_true", help="dump full result json")
    args = parser.parse_args()

    res = asyncio.run(
        run_backtest(
            symbol=args.symbol,
            interval=args.interval,
            bars=args.bars,
            strategy=args.strategy,
            start_equity=args.equity,
            risk_per_trade=args.risk,
            allow_short=args.allow_short,
            optimistic=args.optimistic,
        )
    )
    if args.json:
        print(json.dumps(res.as_dict(include_curve=False), indent=2, default=str))
    else:
        print(f"\nBacktest {res.symbol} [{res.interval}] {res.bars} bars  {time.strftime('%Y-%m-%d', time.gmtime(res.start_ms/1000))} -> {time.strftime('%Y-%m-%d', time.gmtime(res.end_ms/1000))}")
        print(f"  equity      {res.start_equity:,.2f} -> {res.end_equity:,.2f}")
        for k, v in res.metrics.items():
            print(f"  {k:<24} {v}")
        print(f"  last trades: {json.dumps(res.trades[-3:], default=str)}")


if __name__ == "__main__":  # pragma: no cover
    main()
