"""Exchange gateway contract.

Both :class:`app.binance.rest.BinanceRestClient` (real money) and
:class:`app.binance.simulator.MarketSimulator` (demo/paper) implement this
interface, so every service in the app is agnostic about where prices and
fills come from.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ExchangeGateway(ABC):
    name: str = "abstract"
    is_simulated: bool = False

    # ------------------------------------------------------------- market data
    @abstractmethod
    async def server_time(self) -> dict[str, Any]: ...

    @abstractmethod
    async def exchange_info(self, symbol: str | None = None) -> dict[str, Any]: ...

    @abstractmethod
    async def all_tickers(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def ticker(self, symbol: str) -> dict[str, Any]: ...

    @abstractmethod
    async def klines(
        self, symbol: str, interval: str, limit: int = 500, *, start_ms: int | None = None, end_ms: int | None = None
    ) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def depth(self, symbol: str, limit: int = 50) -> dict[str, Any]: ...

    # --------------------------------------------------------------- user data
    @abstractmethod
    async def account(self, creds: Creds | None = None) -> dict[str, Any]: ...

    @abstractmethod
    async def open_orders(self, symbol: str | None = None, creds: Any = None) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def my_trades(self, symbol: str | None = None, limit: int = 50, creds: Any = None) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def place_order(self, order: dict[str, Any], creds: Any = None) -> dict[str, Any]: ...

    @abstractmethod
    async def cancel_order(self, symbol: str, order_ref: str, creds: Any = None) -> dict[str, Any]: ...

    # ------------------------------------------------------------------- admin
    async def api_permissions(self, creds: Any = None) -> dict[str, Any]:
        return {"can_trade": True, "can_withdraw": False, "ip_restricted": True, "checked": False}

    async def close(self) -> None:  # pragma: no cover - trivial
        return None


class Creds:
    """Decrypted Binance key pair held only in memory for the request."""

    __slots__ = ("api_key", "api_secret", "testnet")

    def __init__(self, api_key: str, api_secret: str, *, testnet: bool = False) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.testnet = testnet

    def __repr__(self) -> str:  # never leak secrets into logs
        return f"Creds(api_key={self.api_key[:4]}****, testnet={self.testnet})"

    @property
    def base_url(self) -> str:
        from app.config import settings

        return "https://testnet.binance.vision" if self.testnet else settings.binance_rest_base
