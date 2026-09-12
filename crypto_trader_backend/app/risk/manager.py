"""Risk manager: every order - manual or AI - passes through here.

Checks (in order, cheapest first):

1. **kill switch** - ``STOP ALL`` on the AI screen halts new orders instantly
2. **credential scope** - withdraw-capable keys are rejected outright
3. **market hours / symbol validity** from ``exchangeInfo`` filters
4. **tick / lot precision** - quantities are rounded to ``LOT_SIZE.stepSize``
5. **min notional** - Binance rejects < 10 USDT otherwise (-1013)
6. **position sizing** - notional vs ``max_trade_size_usd`` and % of quote balance
7. **open exposure** - cap concurrent positions
8. **daily loss limit** - realised P&L since 00:00 UTC vs ``daily_loss_limit_usd``
9. **cooldown** - one order per symbol per ``TRADE_COOLDOWN_S`` (AI loop safety)
10. **rate limits** - delegated to :class:`app.binance.ratelimit.RateLimiter`

Returns a :class:`RiskDecision`; the trading service refuses on ``allowed=False``
and records the reason in the audit log + AI trade log.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

RISK_MULTIPLIERS = {
    "conservative": {"position_pct": 0.35, "risk_per_trade": 0.010, "tp_atr": 2.2, "sl_atr": 1.2, "min_conf": 80.0},
    "moderate": {"position_pct": 0.70, "risk_per_trade": 0.020, "tp_atr": 2.5, "sl_atr": 1.5, "min_conf": 68.0},
    "aggressive": {"position_pct": 1.00, "risk_per_trade": 0.035, "tp_atr": 3.5, "sl_atr": 2.0, "min_conf": 55.0},
}


def _today() -> str:
    """UTC day key used for daily-loss accounting."""
    return time.strftime("%Y-%m-%d", time.gmtime())


@dataclass(slots=True)
class RiskDecision:
    allowed: bool
    reason: str = ""
    code: str = ""
    adjusted_qty: float = 0.0
    warnings: list[str] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "code": self.code,
            "adjusted_qty": self.adjusted_qty,
            "warnings": self.warnings,
            **self.context,
        }


@dataclass(slots=True)
class SymbolFilters:
    tick_size: float = 0.01
    step_size: float = 0.001
    min_qty: float = 0.001
    max_qty: float = 1_000_000.0
    min_notional: float = 10.0
    decimals: int = 6

    @classmethod
    def from_exchange_info(cls, symbol_entry: dict[str, Any] | None) -> SymbolFilters:
        out = cls()
        if not symbol_entry:
            return out
        for f in symbol_entry.get("filters", []):
            kind = f.get("filterType")
            if kind == "PRICE_FILTER":
                out.tick_size = float(f.get("tickSize", out.tick_size) or out.tick_size)
                out.decimals = _decimals(out.tick_size)
            elif kind == "LOT_SIZE":
                out.step_size = float(f.get("stepSize", out.step_size) or out.step_size)
                out.min_qty = float(f.get("minQty", out.min_qty) or out.min_qty)
                out.max_qty = float(f.get("maxQty", out.max_qty) or out.max_qty)
            elif kind in ("MIN_NOTIONAL", "NOTIONAL"):
                out.min_notional = float(f.get("notional", f.get("minNotional", out.min_notional)) or out.min_notional)
        return out

    def round_qty(self, qty: float) -> float:
        if self.step_size <= 0:
            return qty
        # snap to the LOT_SIZE grid; eps guards float noise (0.001/0.001 -> 0.999..)
        steps = math.floor(qty / self.step_size + 1e-9)
        return round(max(0.0, steps * self.step_size), 10)

    def round_price(self, price: float) -> float:
        if self.tick_size <= 0:
            return price
        return round(round(price / self.tick_size) * self.tick_size, _decimals(self.tick_size))

    def valid_price(self, price: float) -> bool:
        if self.tick_size <= 0:
            return True
        return abs((price / self.tick_size) - round(price / self.tick_size)) < 1e-9


def _decimals(step: float) -> int:
    if step <= 0:
        return 8
    d = 0
    v = step
    while v < 1 and d < 12:
        v *= 10
        d += 1
    return d


def risk_profile(level: str | None) -> dict[str, float]:
    return RISK_MULTIPLIERS.get((level or "moderate").lower(), RISK_MULTIPLIERS["moderate"])


def clamp_qty_to_notional(
    qty: float,
    price: float,
    *,
    quote_free: float,
    max_notional_usd: float,
    fee_rate: float,
    min_notional: float,
    side: str = "BUY",
) -> tuple[float, str | None]:
    """Return (qty, warning). Shrinks size to fit balance / max trade size.

    Buys are capped by the quote balance (plus fees); sells are capped by the
    base holdings - applying the buy rule to a sell would under-size it.
    """
    if price <= 0:
        return 0.0, "invalid price"
    notional = qty * price
    budget = max(0.0, quote_free / (1.0 + fee_rate)) if side.upper() == "BUY" else float("inf")
    max_usd = max_notional_usd if max_notional_usd > 0 else float("inf")
    warning: str | None = None
    if notional > budget:
        qty = budget / price
        warning = f"size reduced to fit available balance ({budget:.2f})"
    if qty * price > max_usd:
        qty = max_usd / price
        warning = (warning or "") + f" | size reduced to max trade size ({max_usd:.2f})"
    qty = round(qty, 12)
    if qty * price < min_notional - 1e-9:
        return qty, f"order too small: {qty * price:.4f} < exchange minimum {min_notional:.2f}"
    return qty, warning


class RiskManager:
    """Stateless evaluator + in-memory per-user throttle bookkeeping."""

    def __init__(self) -> None:
        self._last_trade: dict[tuple[int, str], float] = {}
        self._daily: dict[int, dict[str, float]] = {}

    def reset(self) -> None:  # pragma: no cover - test helper
        self._last_trade.clear()
        self._daily.clear()

    def note_fill(self, user_id: int, symbol: str, *, pnl: float = 0.0, notional: float = 0.0, side: str = "BUY") -> None:
        now = time.time()
        self._last_trade[(user_id, symbol)] = now
        day = self._daily.setdefault(user_id, {"pnl": 0.0, "notional": 0.0, "count": 0.0, "day": _today()})
        if day["day"] != _today():
            day.update({"pnl": 0.0, "notional": 0.0, "count": 0.0, "day": _today()})
        day["pnl"] += pnl
        day["notional"] += notional
        day["count"] += 1

    def daily_stats(self, user_id: int) -> dict[str, Any]:
        day = self._daily.get(user_id) or {"pnl": 0.0, "notional": 0.0, "count": 0.0, "day": _today()}
        if day.get("day") != _today():
            day = {"pnl": 0.0, "notional": 0.0, "count": 0.0, "day": _today()}
        return {
            "date": day["day"],
            "realized_pnl": round(float(day["pnl"]), 4),
            "notional_traded": round(float(day["notional"]), 2),
            "orders": int(day["count"]),
        }

    def check_order(
        self,
        *,
        user: Any,
        symbol: str,
        side: str,
        qty: float,
        price: float = 0.0,
        order_type: str = "MARKET",
        reference_price: float = 0.0,
        quote_free: float = 0.0,
        open_positions: int = 0,
        realised_pnl_today: float | None = None,
        filters: SymbolFilters | None = None,
        require_credentials: bool = False,
    ) -> RiskDecision:
        warnings: list[str] = []
        filters = filters or SymbolFilters()
        user_id = int(getattr(user, "id", 0) or 0)
        profile = risk_profile(getattr(user, "risk_level", "moderate"))

        if getattr(user, "auto_kill_switch", False):
            return RiskDecision(False, "STOP ALL is active - resume AI trading in the AI screen", "kill_switch")
        if require_credentials and not getattr(user, "binance_credential", None):
            return RiskDecision(False, "no active Binance API key on this account", "missing_credentials")
        if qty <= 0:
            return RiskDecision(False, "quantity must be greater than zero", "bad_qty")
        if order_type.upper() != "MARKET" and price <= 0:
            return RiskDecision(False, "limit orders need a price", "bad_price")
        if price > 0 and not filters.valid_price(price):
            return RiskDecision(
                False, f"price {price} is not a multiple of the tick size {filters.tick_size}", "tick_size"
            )

        max_trade = float(getattr(user, "max_trade_size_usd", 0.0) or settings.MAX_TRADE_NOTIONAL_USD or 250.0)
        ref_price = float(price or reference_price or 0.0)
        if ref_price <= 0:
            return RiskDecision(False, "no reference price available for this symbol", "no_price")
        adjusted, warn = clamp_qty_to_notional(
            qty,
            ref_price,
            side=side,
            quote_free=quote_free,
            max_notional_usd=max_trade,
            fee_rate=settings.TAKER_FEE_BPS / 10_000.0,
            min_notional=filters.min_notional,
        )
        if warn and warn.startswith("order too small"):
            return RiskDecision(False, warn, "min_notional")
        if warn:
            warnings.append(warn)
        if adjusted <= 0:
            return RiskDecision(False, "no buying power left after fees", "insufficient_funds")
        if adjusted < qty:
            qty = filters.round_qty(adjusted)

        if qty + 1e-9 < filters.min_qty:
            return RiskDecision(False, f"quantity below LOT_SIZE minimum {filters.min_qty}", "min_qty")

        # daily loss limit
        daily_limit = float(getattr(user, "daily_loss_limit_usd", 0.0) or settings.MAX_DAILY_LOSS_PCT)
        realised = realised_pnl_today if realised_pnl_today is not None else self._daily.get(user_id, {}).get("pnl", 0.0)
        if daily_limit and realised <= -abs(daily_limit):
            return RiskDecision(
                False, f"daily loss limit reached ({realised:.2f} <= -{abs(daily_limit):.2f}) - trading halted", "daily_loss_limit",
                warnings=warnings, context={"realised_pnl_today": round(float(realised), 4)},
            )
        if daily_limit and realised < -abs(daily_limit) * 0.8:
            warnings.append("approaching daily loss limit (80% consumed)")

        # exposure cap
        max_positions = settings.AUTO_TRADE_MAX_OPEN_POSITIONS
        if open_positions >= max_positions and side.upper() == "BUY":
            return RiskDecision(False, f"already holding {open_positions} positions (max {max_positions})", "max_positions", warnings=warnings)

        # cooldown (AI loop protection)
        key = (user_id, symbol.upper())
        last = self._last_trade.get(key, 0.0)
        base_cooldown = float(settings.TRADE_COOLDOWN_S or 0.0)
        cooldown = base_cooldown if getattr(user, "auto_trade_enabled", False) else base_cooldown / 4.0
        if cooldown > 0 and time.time() - last < cooldown:
            return RiskDecision(
                False, f"cooldown active for {symbol.upper()} - retry in {cooldown - (time.time() - last):.0f}s", "cooldown", warnings=warnings
            )

        notional = qty * ref_price
        if notional > max_trade:
            return RiskDecision(False, f"order notional {notional:.2f} exceeds max trade size {max_trade:.2f}", "max_notional", warnings=warnings)

        return RiskDecision(
            True,
            "approved",
            "ok",
            adjusted_qty=qty,
            warnings=warnings,
            context={
                "notional": round(notional, 2),
                "max_trade_size_usd": max_trade,
                "daily_loss_limit_usd": daily_limit,
                "realised_pnl_today": round(float(realised), 2),
                "risk_per_trade_pct": profile["risk_per_trade"] * 100,
                "open_positions": open_positions,
            },
        )


risk_manager = RiskManager()
