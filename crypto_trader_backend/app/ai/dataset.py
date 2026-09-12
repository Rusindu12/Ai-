"""Dataset assembly for training and backtesting.

Works against any :class:`~app.binance.base.ExchangeGateway`:

* live mode  - pages ``/api/v3/klines`` backwards in 1000-bar chunks
* demo mode  - synthesises arbitrarily long history from the simulator process

The result is a chronological list of candle dicts ready for
:func:`app.ai.features.build_frame`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.errors import ValidationError_

log = logging.getLogger(__name__)

MAX_PAGE = 1000


async def fetch_history(
    gateway: Any,
    symbol: str,
    interval: str,
    bars: int = 5000,
    *,
    end_ms: int | None = None,
    pause_s: float = 0.05,
) -> list[dict[str, Any]]:
    """Collect ``bars`` candles as fast as the exchange allows (chronological)."""
    if bars < 200:
        raise ValidationError_("bars must be >= 200")
    if getattr(gateway, "is_simulated", False):
        from app.binance.simulator import generate_history

        return generate_history(symbol, interval=interval, bars=bars, start_ms=end_ms or _now_ms())
    symbol = symbol.upper()
    collected: list[dict[str, Any]] = []
    cursor = int(end_ms or _now_ms())
    guard = 0
    while len(collected) < bars and guard < 60:
        guard += 1
        want = min(MAX_PAGE, bars - len(collected) + 5)
        start = max(0, cursor - _interval_ms(interval) * want)
        try:
            page = await gateway.klines(symbol, interval, want, start_ms=start, end_ms=cursor)
        except Exception as exc:
            log.warning("history page failed (%s) - stopping with %d bars", exc, len(collected))
            break
        if not page:
            break
        collected = page + collected
        cursor = int(page[0]["open_time"]) - 1
        await asyncio.sleep(pause_s)
    if len(collected) < 200:
        raise ValidationError_(f"only fetched {len(collected)} candles for {symbol}/{interval}")
    return collected[-bars:]


def _interval_ms(interval: str) -> int:
    from app.binance.simulator import INTERVAL_SECONDS

    return INTERVAL_SECONDS.get(interval, 60) * 1000


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


def split_chronometric(rows: list[dict[str, Any]], train_frac: float = 0.8) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Time-ordered split - never shuffle candles before splitting (look-ahead)."""
    n = int(len(rows) * train_frac)
    return rows[:n], rows[n:]
