"""Binance rate-limit accounting and backoff.

Binance publishes two budgets:

* request **weight** (6000/min per IP on Spot) - ``X-MBX-USED-WEIGHT-1M``
* **orders** (50/min, 100000/day)              - ``X-MBX-ORDER-COUNT-10M``

This module keeps a local mirror of both so we throttle *before* being
rejected, and exposes the ``Retry-After`` semantics that 429/418 responses
carry.  418 means "you ignored a 429" and triggers a hard breaker window.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass(slots=True)
class _Window:
    limit: float
    used: float = 0.0
    reset_at: float = field(default_factory=lambda: time.monotonic() + 60.0)
    window_s: float = 60.0

    def tick(self, now: float) -> None:
        if now >= self.reset_at:
            self.used = 0.0
            self.reset_at = now + self.window_s

    def headroom(self, now: float) -> float:
        self.tick(now)
        return self.limit - self.used

    def wait_time(self, cost: float, now: float) -> float:
        self.tick(now)
        if self.used + cost <= self.limit:
            return 0.0
        return max(0.05, self.reset_at - now)


class RateLimiter:
    """Async-safe weight/order budget tracker with a shared throttle lock."""

    def __init__(self, *, weight_per_min: float, orders_per_min: float, orders_per_day: float) -> None:
        self.weight = _Window(limit=weight_per_min)
        self.orders = _Window(limit=orders_per_min, window_s=60.0)
        self.orders_day = _Window(limit=orders_per_day, window_s=86_400.0)
        self._lock = asyncio.Lock()
        self._blocked_until = 0.0
        self._seen_weight: float | None = None
        self._seen_orders: float | None = None

    # ---------------------------------------------------------------- headers
    def sync_from_headers(self, headers: dict[str, str]) -> None:
        """Adopt the server's authoritative counters when present."""
        now = time.monotonic()
        w = headers.get("x-mbx-used-weight-1m") or headers.get("X-MBX-USED-WEIGHT-1M")
        o = headers.get("x-mbx-order-count-10m") or headers.get("X-MBX-ORDER-COUNT-10M")
        try:
            if w is not None:
                self._seen_weight = float(w)
                # Conservatively keep whichever counter is higher.
                self.weight.used = max(self.weight.used, self._seen_weight)
                self.weight.reset_at = now + 60.0
            if o is not None:
                self._seen_orders = float(o)
                self.orders.used = max(self.orders.used, self._seen_orders)
        except (TypeError, ValueError):  # pragma: no cover - defensive
            log.debug("could not parse binance rate-limit headers")

    async def acquire(self, weight: float = 1.0, *, is_order: bool = False) -> None:
        """Block until the request fits inside the remaining budget."""
        async with self._lock:
            for _ in range(200):
                now = time.monotonic()
                if now < self._blocked_until:
                    await asyncio.sleep(self._blocked_until - now)
                    continue
                waits = [self.weight.wait_time(weight, now)]
                if is_order:
                    waits.append(self.orders.wait_time(1, now))
                    waits.append(self.orders_day.wait_time(1, now))
                wait = max(waits)
                if wait <= 0:
                    self.weight.used += weight
                    if is_order:
                        self.orders.used += 1
                        self.orders_day.used += 1
                    return
                await asyncio.sleep(min(wait, 5.0))
        raise RuntimeError("unreachable")

    def penalise(self, *, retry_after_s: float | None, ip_ban: bool) -> float:
        """Called on 429/418 - returns how long callers will now back off."""
        if ip_ban:
            self._blocked_until = time.monotonic() + max(retry_after_s or 120.0, 120.0)
            log.error("binance 418 received - IP banned, pausing outbound calls")
        else:
            self._blocked_until = time.monotonic() + max(retry_after_s or 2.0, 1.0)
            log.warning("binance 429 received - backing off %.1fs", max(retry_after_s or 2.0, 1.0))
        return self._blocked_until - time.monotonic()

    def snapshot(self) -> dict[str, float]:
        now = time.monotonic()
        return {
            "weight_used_1m": round(self.weight.used, 1),
            "weight_limit_1m": self.weight.limit,
            "weight_headroom": round(self.weight.headroom(now), 1),
            "orders_used_1m": round(self.orders.used, 1),
            "orders_used_1d": round(self.orders_day.used, 1),
            "blocked_for_s": round(max(0.0, self._blocked_until - now), 2),
        }


def backoff_delay(attempt: int, *, base: float = 0.35, cap: float = 12.0) -> float:
    """Full jitter exponential backoff."""
    raw = min(cap, base * (2**attempt))
    return random.uniform(raw / 2, raw)
