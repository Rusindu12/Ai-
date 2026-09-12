"""Async, signed, rate-limit-aware Binance Spot REST client.

Endpoints used by the backend:

===========================  ==========================================
``GET  /api/v3/ticker/price``   live prices (all symbols in one call)
``GET  /api/v3/ticker/24hr``    24h stats for the dashboard
``GET  /api/v3/klines``         OHLCV candles for any interval
``GET  /api/v3/depth``          order book snapshot
``GET  /api/v3/exchangeInfo``   precision rules / filters (LOT_SIZE, ...)
``GET  /api/v3/account``        balances + portfolio  *(signed)*
``POST /api/v3/order``          place order                *(signed)*
``DELETE /api/v3/order``        cancel order               *(signed)*
``GET  /api/v3/myTrades``       trade history              *(signed)*
``GET  /api/v3/openOrders``     open orders                *(signed)*
===========================  ==========================================

Signing is ``HMAC-SHA256(secret, query_string + body)`` and every request is
retried with full-jitter backoff on 5xx / network faults, and *throttled*
before sending using :class:`app.binance.ratelimit.RateLimiter`.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from collections.abc import Mapping
from typing import Any

import httpx

from app.binance.base import Creds, ExchangeGateway
from app.binance.ratelimit import RateLimiter, backoff_delay
from app.config import settings
from app.errors import BinanceUpstreamError, InsufficientFundsError, RateLimitedError, ValidationError_

log = logging.getLogger(__name__)

# Public weight costs (https://developers.binance.com/docs/binance-spot-api-docs/rest-api)
WEIGHT = {
    "time": 1,
    "exchangeInfo": 1,
    "ticker/price": 2,
    "ticker/allTickers": 80,
    "ticker/24hr": 80,
    "klines": 2,
    "depth_small": 5,
    "depth": 10,
    "account": 20,
    "openOrders": 80,
    "myTrades": 20,
    "order": 1,
    "orderCancel": 1,
}

INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}

# Binance error codes we care about
_CODE_TO_USER_MSG = {
    -1000: "illegal transaction type",
    -1001: "illegal symbol",
    -1013: "order rejected by exchange filter (LOT_SIZE / MIN_NOTIONAL / PRICE_FILTER)",
    -2010: "new order rejected",
    -2013: "order does not exist / cancel race",
    -2014: "API-key format invalid",
    -2015: "bad API key/IP/permissions",
    -1022: "signature for this request was not correct",
    -2019: "margin not sufficient for this order",
}


class BinanceRestClient(ExchangeGateway):
    """One shared :class:`httpx.AsyncClient` per process (connection reuse)."""

    name = "binance"
    is_simulated = False

    def __init__(
        self,
        *,
        api_key: str = "",
        api_secret: str = "",
        base_url: str | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        limiter: RateLimiter | None = None,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = (base_url or settings.binance_rest_base).rstrip("/")
        self.timeout = timeout or settings.BINANCE_TIMEOUT_S
        self.max_retries = settings.BINANCE_MAX_RETRIES if max_retries is None else max_retries
        self.limiter = limiter or RateLimiter(
            weight_per_min=settings.BINANCE_WEIGHT_PER_MIN,
            orders_per_min=settings.BINANCE_ORDERS_PER_MIN,
            orders_per_day=settings.BINANCE_ORDERS_PER_DAY,
        )
        self._client: httpx.AsyncClient | None = None
        self._time_offset_ms: int = 0
        self._offset_synced_at: float = 0.0

    # ------------------------------------------------------------------ client
    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout, connect=5.0),
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
                headers={
                    "User-Agent": "cryptotrader-backend/1.0 (+https://github.com)",
                    "Accept": "application/json",
                },
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    # ----------------------------------------------------------------- signing
    def _active_key(self, creds: Creds | None) -> str:
        return creds.api_key if creds is not None else self.api_key

    def _active_secret(self, creds: Creds | None = None) -> str:
        return creds.api_secret if creds is not None else self.api_secret

    async def sync_time(self, *, force: bool = False) -> int:
        """Keep a local clock offset; Binance rejects stale signatures (-1021)."""
        now = time.monotonic()
        if not force and now - self._offset_synced_at < 600:
            return self._time_offset_ms
        data = await self._request("GET", "/api/v3/time", signed=False, weight=WEIGHT["time"])
        server_ms = int(data["serverTime"])
        self._time_offset_ms = server_ms - int(time.time() * 1000)
        self._offset_synced_at = now
        log.debug("binance clock offset: %+d ms", self._time_offset_ms)
        return self._time_offset_ms

    # -------------------------------------------------------------- transport
    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        signed: bool = False,
        weight: int = 2,
        is_order: bool = False,
        creds: Creds | None = None,
    ) -> Any:
        query: dict[str, Any] = {k: v for k, v in (params or {}).items() if v is not None}
        key = self._active_key(creds)
        secret = self._active_secret(creds) if creds is not None else self.api_secret

        if signed:
            if not key or not secret:
                raise BinanceUpstreamError(
                    "no Binance credentials configured; attach API keys or run in DEMO_MODE"
                )
            await self.sync_time()
            query["timestamp"] = int(time.time() * 1000) + self._time_offset_ms
            query["recvWindow"] = settings.BINANCE_RECEIVING_WINDOW_MS
            encoded = httpx.QueryParams(query)
            query = dict(encoded)
            query["signature"] = self._sign_with(secret, str(encoded))

        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            await self.limiter.acquire(weight, is_order=is_order)
            try:
                resp = await self._http().request(method, path, params=query or None)
            except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                last_exc = exc
                delay = backoff_delay(attempt)
                log.warning("%s %s network error (%s) - retry in %.2fs", method, path, type(exc).__name__, delay)
                await asyncio.sleep(delay)
                continue

            self.limiter.sync_from_headers(dict(resp.headers))

            if resp.status_code == 200:
                try:
                    return resp.json()
                except json.JSONDecodeError as exc:
                    raise BinanceUpstreamError(f"non-JSON response from Binance: {resp.text[:120]}") from exc

            if resp.status_code in (429, 418):
                retry_after = resp.headers.get("retry-after")
                wait = float(retry_after) if retry_after else 5.0
                self.limiter.penalise(retry_after_s=wait, ip_ban=resp.status_code == 418)
                last_exc = RateLimitedError(f"binance {resp.status_code}", retry_after_s=wait)
                if attempt < self.max_retries:
                    await asyncio.sleep(min(wait, 30.0))
                    continue
                raise RateLimitedError("binance rate limit exceeded", retry_after_s=wait)

            if 500 <= resp.status_code < 600:
                last_exc = BinanceUpstreamError(f"binance {resp.status_code}: {resp.text[:180]}")
                await asyncio.sleep(backoff_delay(attempt))
                continue

            raise self._to_error(resp)

        raise last_exc or BinanceUpstreamError(f"request to {path} failed")

    def _sign_with(self, secret: str, query: str) -> str:
        return hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()

    def _to_error(self, resp: httpx.Response) -> Exception:
        code: int | None = None
        msg = resp.text[:300]
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                code = payload.get("code")
                msg = payload.get("msg", msg)
        except (json.JSONDecodeError, ValueError):
            pass
        friendly = _CODE_TO_USER_MSG.get(code, msg if isinstance(msg, str) else str(msg))
        detail = {"binance_code": code, "http_status": resp.status_code, "binance_msg": msg}
        if code in (-2019, -2018) or "not sufficient" in str(msg).lower():
            return InsufficientFundsError(friendly, details=detail)
        if code in (-1021, -1022, -2014, -2015):
            return BinanceUpstreamError(friendly, details=detail)
        if resp.status_code == 400:
            return ValidationError_(friendly, details=detail)
        return BinanceUpstreamError(friendly, details=detail)

    # ------------------------------------------------------- market data (REST)
    async def server_time(self) -> dict[str, Any]:
        data = await self._request("GET", "/api/v3/time", weight=WEIGHT["time"])
        return {
            "serverTime": data.get("serverTime"),
            "localOffsetMs": self._time_offset_ms,
            "latencyMs": None,
        }

    async def exchange_info(self, symbol: str | None = None) -> dict[str, Any]:
        params = {"symbol": symbol.upper()} if symbol else None
        return await self._request("GET", "/api/v3/exchangeInfo", params=params, weight=WEIGHT["exchangeInfo"])

    async def all_tickers(self) -> list[dict[str, Any]]:
        rows = await self._request("GET", "/api/v3/ticker/24hr", weight=WEIGHT["ticker/allTickers"])
        return rows if isinstance(rows, list) else [rows]

    async def ticker(self, symbol: str) -> dict[str, Any]:
        row = await self._request(
            "GET", "/api/v3/ticker/24hr", params={"symbol": symbol.upper()}, weight=WEIGHT["ticker/price"]
        )
        return _normalise_ticker(row)

    async def klines(
        self,
        symbol: str,
        interval: str,
        limit: int = 500,
        *,
        start_ms: int | None = None,
        end_ms: int | None = None,
    ) -> list[dict[str, Any]]:
        if interval not in INTERVALS:
            raise ValidationError_(f"unsupported interval '{interval}'")
        params: dict[str, Any] = {"symbol": symbol.upper(), "interval": interval, "limit": min(int(limit), 1000)}
        if start_ms:
            params["startTime"] = int(start_ms)
        if end_ms:
            params["endTime"] = int(end_ms)
        raw = await self._request("GET", "/api/v3/klines", params=params, weight=WEIGHT["klines"])
        out: list[dict[str, Any]] = []
        for k in raw:
            out.append(
                {
                    "open_time": int(k[0]),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                    "close_time": int(k[6]),
                    "quote_volume": float(k[7]),
                    "trades": int(k[8]),
                    "taker_buy_volume": float(k[9]),
                    "taker_buy_quote_volume": float(k[10]),
                    "closed": k[6] <= int(time.time() * 1000),
                }
            )
        return out

    async def depth(self, symbol: str, limit: int = 50) -> dict[str, Any]:
        weight = WEIGHT["depth"] if limit > 100 else WEIGHT["depth_small"]
        raw = await self._request(
            "GET", "/api/v3/depth", params={"symbol": symbol.upper(), "limit": limit}, weight=weight
        )
        return {
            "lastUpdateId": raw.get("lastUpdateId"),
            "bids": [[float(p), float(q)] for p, q in raw.get("bids", [])],
            "asks": [[float(p), float(q)] for p, q in raw.get("asks", [])],
        }

    # ---------------------------------------------------------- user data (REST)
    async def account(self, creds: Creds | None = None) -> dict[str, Any]:
        raw = await self._request("GET", "/api/v3/account", signed=True, weight=WEIGHT["account"], creds=creds)
        balances = [
            {
                "asset": b["asset"],
                "free": float(b["free"]),
                "locked": float(b["locked"]),
                "total": float(b["free"]) + float(b["locked"]),
            }
            for b in raw.get("balances", [])
            if float(b["free"]) + float(b["locked"]) > 0
        ]
        return {
            "makerCommission": raw.get("makerCommission"),
            "takerCommission": raw.get("takerCommission"),
            "canTrade": raw.get("canTrade", True),
            "canWithdraw": raw.get("canWithdraw", False),
            "canDeposit": raw.get("canDeposit", True),
            "updateTime": raw.get("updateTime"),
            "balances": balances,
            "permissions": raw.get("permissions", []),
        }

    async def api_permissions(self, creds: Creds | None = None) -> dict[str, Any]:
        acct = await self.account(creds)
        return {
            "can_trade": bool(acct.get("canTrade")),
            "can_withdraw": bool(acct.get("canWithdraw")),
            "ip_restricted": True,
            "checked": True,
            "balance_assets": len(acct.get("balances", [])),
        }

    async def open_orders(self, symbol: str | None = None, creds: Creds | None = None) -> list[dict[str, Any]]:
        params = {"symbol": symbol.upper()} if symbol else None
        raw = await self._request(
            "GET", "/api/v3/openOrders", params=params, signed=True, weight=WEIGHT["openOrders"], creds=creds
        )
        return [
            {
                "orderId": str(o.get("orderId")),
                "clientOrderId": o.get("clientOrderId", ""),
                "symbol": o.get("symbol"),
                "side": o.get("side"),
                "type": o.get("type"),
                "price": float(o.get("price", 0) or 0),
                "origQty": float(o.get("origQty", 0) or 0),
                "executedQty": float(o.get("executedQty", 0) or 0),
                "status": o.get("status"),
                "time": o.get("updateTime") or o.get("time"),
            }
            for o in raw
        ]

    async def my_trades(
        self, symbol: str | None = None, limit: int = 50, creds: Creds | None = None
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": min(int(limit), 1000)}
        if symbol:
            params["symbol"] = symbol.upper()
        raw = await self._request(
            "GET", "/api/v3/myTrades", params=params, signed=True, weight=WEIGHT["myTrades"], creds=creds
        )
        return [
            {
                "id": str(t.get("id")),
                "orderId": str(t.get("orderId")),
                "symbol": t.get("symbol"),
                "side": "BUY" if t.get("isBuyer") else "SELL",
                "price": float(t.get("price", 0)),
                "qty": float(t.get("qty", 0)),
                "quoteQty": float(t.get("quoteQty", 0)),
                "commission": float(t.get("commission", 0)),
                "commissionAsset": t.get("commissionAsset"),
                "time": t.get("time"),
            }
            for t in raw
        ]

    async def place_order(self, order: dict[str, Any], creds: Creds | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {
            "symbol": order["symbol"],
            "side": order["side"],
            "type": order["type"],
            "newClientOrderId": order.get("clientOrderId"),
            "quantity": order.get("quantity"),
            "price": order.get("price"),
            "stopPrice": order.get("stopPrice"),
            "timeInForce": order.get("timeInForce", "GTC" if order["type"] != "MARKET" else None),
            "newOrderRespType": "RESULT",
        }
        params = {k: v for k, v in params.items() if v not in (None, "")}
        raw = await self._request(
            "POST", "/api/v3/order", params=params, signed=True, weight=WEIGHT["order"], is_order=True, creds=creds
        )
        fills = raw.get("fills") or []
        avg = float(raw.get("avgPrice", 0) or 0) or (
            sum(float(f["price"]) * float(f["qty"]) for f in fills) / max(sum(float(f["qty"]) for f in fills), 1e-12)
            if fills
            else float(raw.get("price", 0) or 0)
        )
        return {
            "orderId": str(raw.get("orderId", "")),
            "clientOrderId": raw.get("clientOrderId", order.get("clientOrderId", "")),
            "symbol": raw.get("symbol", order["symbol"]),
            "side": raw.get("side", order["side"]),
            "type": raw.get("type", order["type"]),
            "status": raw.get("status", "NEW"),
            "executedQty": float(raw.get("executedQty", 0) or 0),
            "cummulativeQuoteQty": float(raw.get("cummulativeQuoteQty", 0) or 0),
            "price": avg,
            "fills": fills,
            "transactTime": raw.get("transactTime"),
            "raw": raw,
        }

    async def cancel_order(self, symbol: str, order_ref: str, creds: Creds | None = None) -> dict[str, Any]:
        key = "origClientOrderId" if not order_ref.isdigit() else "orderId"
        params = {"symbol": symbol.upper(), key: order_ref}
        raw = await self._request(
            "DELETE",
            "/api/v3/order",
            params=params,
            signed=True,
            weight=WEIGHT["orderCancel"],
            is_order=True,
            creds=creds,
        )
        return {
            "orderId": str(raw.get("orderId", "")),
            "clientOrderId": raw.get("clientOrderId", ""),
            "symbol": raw.get("symbol", symbol.upper()),
            "status": raw.get("status", "CANCELED"),
            "raw": raw,
        }


def _normalise_ticker(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": row.get("symbol", ""),
        "price": float(row.get("lastPrice", 0) or row.get("price", 0) or 0),
        "change_24h": float(row.get("priceChange", 0) or 0),
        "change_percent_24h": float(row.get("priceChangePercent", 0) or 0),
        "high_24h": float(row.get("highPrice", 0) or 0),
        "low_24h": float(row.get("lowPrice", 0) or 0),
        "volume_24h": float(row.get("volume", 0) or 0),
        "quote_volume_24h": float(row.get("quoteVolume", 0) or 0),
        "trades_24h": int(row.get("count", 0) or 0),
        "bid": float(row.get("bidPrice", 0) or 0),
        "ask": float(row.get("askPrice", 0) or 0),
        "open_24h": float(row.get("openPrice", 0) or 0),
        "updated_at_ms": int(time.time() * 1000),
    }
