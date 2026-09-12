"""Process-wide exchange gateway + shared services wiring.

One :class:`BinanceRestClient` (or :class:`MarketSimulator` in demo mode) is
shared by every request handler so connection pooling, rate limiting and caches
stay effective.  Per-user credentials are passed *per call* and never stored on
the client.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

_gateway: Any | None = None
_lock = asyncio.Lock()


async def get_gateway() -> Any:
    """Return the active gateway (simulator in DEMO_MODE, else signed REST)."""
    global _gateway
    async with _lock:
        if _gateway is None:
            if settings.DEMO_MODE:
                from app.binance.simulator import MarketSimulator

                _gateway = MarketSimulator()
                log.warning("DEMO_MODE=true - using the market simulator, Binance is NOT contacted")
            else:
                from app.binance.rest import BinanceRestClient

                _gateway = BinanceRestClient(api_key=settings.BINANCE_API_KEY, api_secret=settings.BINANCE_API_SECRET)
                log.info("live Binance gateway ready (%s)", _gateway.base_url)
        return _gateway


def set_gateway(gateway: Any) -> None:
    """Test hook - inject a fake gateway."""
    global _gateway
    _gateway = gateway


async def close_gateway() -> None:
    global _gateway
    if _gateway is not None:
        try:
            await _gateway.close()
        except Exception:  # pragma: no cover
            log.debug("gateway close raised", exc_info=True)
    _gateway = None


def gateway_lock() -> asyncio.Lock:
    return _lock
