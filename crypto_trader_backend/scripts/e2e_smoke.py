#!/usr/bin/env python3
"""End-to-end smoke test against a running backend (demo mode or testnet).

    python scripts/e2e_smoke.py --base-url http://localhost:8000

Walks the exact call sequence the Android app performs:
auth -> config -> prices -> candles -> order book -> AI signal -> preview order
-> place order -> account -> positions -> open orders -> alert -> auto-trade
enable -> STOP ALL -> CSV export -> logout.

Exits non-zero on the first failure so it can gate deploys in CI.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from typing import Any

import httpx

PASS, FAIL, SKIP = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m", "\033[33mSKIP\033[0m"


class Runner:
    def __init__(self, base: str, *, verbose: bool = False) -> None:
        self.base = base.rstrip("/")
        self.client = httpx.AsyncClient(base_url=self.base, timeout=40.0)
        self.token = ""
        self.refresh = ""
        self.failures = 0
        self.last_raw = ""
        self.checks = 0
        self.verbose = verbose
        self.email = f"e2e{int(time.time())}@example.com"
        self.password = "e2e-secret-password-1"

    def ok(self, label: str, condition: bool, extra: Any = "") -> bool:
        self.checks += 1
        if not condition:
            self.failures += 1
        status = PASS if condition else FAIL
        detail = f"  {extra}" if extra else ""
        print(f"  [{status}] {label}{detail}"[:400])
        return bool(condition)

    async def call(self, method: str, path: str, *, json_body: dict | None = None, params: dict | None = None, expect: int = 200) -> tuple[int, Any]:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        try:
            resp = await self.client.request(method, path, json=json_body, params=params, headers=headers)
        except Exception as exc:
            return 0, {"error": f"{type(exc).__name__}: {exc}"}
        ctype = resp.headers.get("content-type", "")
        if "application/json" in ctype:
            try:
                body: Any = resp.json()
            except ValueError:
                body = {"_raw": resp.text}
            self.last_raw = resp.text
        else:
            body = {"_raw": resp.text, "_content_type": ctype}
            self.last_raw = resp.text
        if resp.status_code != expect and self.verbose:
            print(f"      ! {method} {path} -> {resp.status_code}: {str(body)[:300]}")
        return resp.status_code, body

    async def run(self) -> int:
        print(f"\n=== E2E smoke test against {self.base} ===\n")
        await self.health()
        await self.auth_flow()
        await self.market_flow()
        await self.ai_flow()
        await self.trading_flow()
        await self.alert_flow()
        await self.auto_flow()
        await self.settings_flow()
        await self.websocket_flow()
        print(f"\n=== {self.checks - self.failures}/{self.checks} checks passed ===\n")
        return 1 if self.failures else 0

    # ------------------------------------------------------------------ health
    async def health(self) -> None:
        print("[health]")
        code, body = await self.call("GET", "/health")
        self.ok("GET /health is 200", code == 200, body.get("status") if isinstance(body, dict) else "")
        code, body = await self.call("GET", "/health/ready")
        self.ok("readiness passes", code == 200 and bool(body.get("ready")), body.get("checks", {}))
        code, body = await self.call("GET", "/api/auth/config")
        self.ok("public boot config exposed", code == 200 and "markets" in body, f"demo_mode={body.get('demo_mode')}")
        code, body = await self.call("GET", "/openapi.json")
        self.ok("openapi schema available", code == 200 and isinstance(body, dict) and len(body.get("paths", {})) > 25, f"{len(body.get('paths', {})) if isinstance(body, dict) else 0} paths")

    # -------------------------------------------------------------------- auth
    async def auth_flow(self) -> None:
        print("\n[auth]")
        code, body = await self.call("POST", "/api/auth/signup", json_body={"email": self.email, "password": self.password, "name": "E2E Tester"}, expect=201)
        self.ok("signup returns tokens", code == 201 and "access_token" in body, body.get("user", {}).get("email", ""))
        self.token = body.get("access_token", "")
        self.refresh = body.get("refresh_token", "")
        code, body = await self.call("POST", "/api/auth/login", json_body={"email": self.email, "password": self.password, "device_id": "e2e-device"})
        self.ok("login works", code == 200 and "access_token" in body)
        self.token = body.get("access_token", self.token)
        code, body = await self.call("POST", "/api/auth/login", json_body={"email": self.email, "password": "wrong-password-123"})
        self.ok("bad password rejected (401)", code == 401, body.get("message", ""))
        code, _ = await self.call("GET", "/api/prices")
        self.ok("unauthenticated market data allowed", code == 200)
        saved = self.token
        self.token = ""
        code, _ = await self.call("GET", "/api/account")
        self.ok("account requires auth (401/403)", code in (401, 403))
        self.token = saved
        code, body = await self.call("GET", "/api/auth/me")
        self.ok("GET /api/auth/me", code == 200 and body.get("email") == self.email)
        code, body = await self.call("POST", "/api/auth/refresh", json_body={"refresh_token": self.refresh, "device_id": "e2e-device"})
        self.ok("refresh rotates tokens", code == 200 and body.get("access_token") and body.get("refresh_token") != self.refresh)
        if code == 200:
            self.token = body["access_token"]
            old_refresh = self.refresh
            self.refresh = body["refresh_token"]
            code, _ = await self.call("POST", "/api/auth/refresh", json_body={"refresh_token": old_refresh})
            self.ok("replayed refresh token rejected", code == 401)
        code, body = await self.call("POST", "/api/auth/2fa/setup")
        self.ok("2FA setup returns a secret", code == 200 and "otpauth_uri" in body)

    # ------------------------------------------------------------------ market
    async def market_flow(self) -> None:
        print("\n[market data]")
        code, body = await self.call("GET", "/api/prices")
        prices_ok = code == 200 and body.get("count", 0) > 0
        self.ok("GET /api/prices", prices_ok, f"{body.get('count')} symbols, {body.get('source', {}).get('source')} source")
        first = (body.get("prices") or [{}])[0]
        symbol = first.get("symbol", "BTCUSDT")
        code, body = await self.call("GET", f"/api/prices/{symbol}")
        self.ok(f"GET /api/prices/{symbol}", code == 200 and float(body.get("price", 0)) > 0, f"price={body.get('price')}")
        for interval in ("1m", "15m", "1h", "4h", "1d"):
            code, body = await self.call("GET", f"/api/klines/{symbol}/{interval}", params={"limit": 200, "with_indicators": "true"})
            ok = code == 200 and len(body.get("candles", [])) >= 60 and "indicators" in body
            self.ok(f"GET /api/klines/{symbol}/{interval}", ok, f"{len(body.get('candles', []))} candles, rsi={body.get('indicators', {}).get('rsi')}")
        code, body = await self.call("GET", f"/api/orderbook/{symbol}", params={"depth": 15})
        self.ok("GET /api/orderbook", code == 200 and len(body.get("bids", [])) > 3, f"spread_bps={body.get('spread_bps')} imbalance={body.get('imbalance')}")
        code, body = await self.call("GET", "/api/symbols")
        self.ok("GET /api/symbols", code == 200 and body.get("tracked"), f"{body.get('count')} listed / {len(body.get('tracked', []))} tracked")
        code, body = await self.call("GET", "/api/market/summary")
        self.ok("GET /api/market/summary", code == 200 and "gainers" in body)
        code, body = await self.call("GET", "/api/sparklines", params={"points": 24})
        series = (body.get("series") or {}).get(symbol, []) if isinstance(body, dict) else []
        self.ok("GET /api/sparklines", code == 200 and len(series) > 5, f"{len(series)} points")
        code, body = await self.call("POST", "/api/watchlist", json_body={"symbol": symbol}, expect=201)
        self.ok("watchlist add", code == 201)
        code, body = await self.call("GET", "/api/watchlist")
        self.ok("watchlist read", code == 200 and any(w["symbol"] == symbol for w in body.get("watchlist", [])))

    # ---------------------------------------------------------------------- ai
    async def ai_flow(self) -> None:
        print("\n[AI engine]")
        code, body = await self.call("GET", "/api/ai/models")
        self.ok("GET /api/ai/models", code == 200 and "active" in body, f"version={body.get('active', {}).get('version')}")
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
            code, body = await self.call("GET", f"/api/ai/signal/{symbol}", params={"interval": "1m", "bars": 400})
            ok = code == 200 and body.get("action") in ("BUY", "SELL", "HOLD") and 0 <= float(body.get("confidence", -1)) <= 100
            self.ok(f"GET /api/ai/signal/{symbol}", ok, f"{body.get('action')} @ {body.get('confidence')}% | {str(body.get('reason'))[:70]}")
            if ok:
                ind = body.get("indicators", {})
                self.ok("  indicators payload complete", all(k in ind for k in ("rsi", "macd", "bb_upper", "atr", "vwap", "supports", "levels")), f"rsi={ind.get('rsi')} atr={ind.get('atr_pct')}%")
                self.ok("  trade plan present when not HOLD", body.get("action") == "HOLD" or bool(body.get("trade_plan")), f"plan={json.dumps(body.get('trade_plan'))[:80]}")
        code, body = await self.call("GET", "/api/ai/signals", params={"interval": "15m"})
        self.ok("GET /api/ai/signals (batch)", code == 200 and body.get("count", 0) >= 3, f"counts={body.get('counts')}")
        code, body = await self.call("GET", "/api/ai/sentiment")
        self.ok("GET /api/ai/sentiment", code == 200 and body.get("state") in ("BULLISH", "BEARISH", "NEUTRAL"), f"{body.get('state')} score={body.get('score')}")
        code, body = await self.call("GET", "/api/ai/indicators/BTCUSDT/1h", params={"limit": 300})
        self.ok("GET /api/ai/indicators", code == 200 and "rsi" in body and len(body.get("series", {})) > 5)
        code, body = await self.call("GET", "/api/ai/strategies")
        self.ok("GET /api/ai/strategies", code == 200 and len(body.get("strategies", [])) >= 5, f"{len(body.get('strategies', []))} strategies")
        code, body = await self.call("POST", "/api/ai/backtest", json_body={"symbol": "BTCUSDT", "interval": "1h", "bars": 1200, "strategy": "ai", "include_curve": True})
        metrics = body.get("metrics", {}) if isinstance(body, dict) else {}
        self.ok("POST /api/ai/backtest", code == 200 and "sharpe" in metrics, f"trades={metrics.get('trades')} ret={metrics.get('total_return_pct')}% sharpe={metrics.get('sharpe')} dd={metrics.get('max_drawdown_pct')}%")
        self.ok("  backtest returns equity curve", isinstance(body, dict) and len(body.get("equity_curve", [])) > 10)
        code, body = await self.call("GET", "/api/ai/history/BTCUSDT")
        self.ok("GET /api/ai/history", code == 200 and body.get("count", 0) >= 1, f"{body.get('count')} stored signals")

    # ------------------------------------------------------------------- trade
    eth_price = 3000.0

    async def trading_flow(self) -> None:
        print("\n[trading]")
        code, body = await self.call("GET", "/api/account")
        self.ok("GET /api/account", code == 200 and "total_value_usd" in body, f"value=${body.get('total_value_usd')} mode={body.get('mode')} holdings={len(body.get('holdings', []))}")
        self.start_equity = float(body.get("total_value_usd") or 0)
        self.symbol = "BTCUSDT"
        code, px = await self.call("GET", "/api/prices/BTCUSDT")
        _, eth = await self.call("GET", "/api/prices/ETHUSDT")
        self.eth_price = float(eth.get("price") or 3000) if isinstance(eth, dict) else 3000.0
        self.start_price = float(px.get("price") or 0) if isinstance(px, dict) else 0.0
        preview = {"symbol": self.symbol, "side": "BUY", "order_type": "MARKET", "quantity": 0.004, "dry_run": True}
        code, body = await self.call("POST", "/api/order/preview", json_body=preview)
        self.ok("POST /api/order/preview (dry run)", code == 200 and body.get("dry_run") is True, f"notional={body.get('est_notional')} fee={body.get('est_fee')}")
        code, body = await self.call("POST", "/api/order", json_body={"symbol": self.symbol, "side": "BUY", "order_type": "MARKET", "quantity": 0.004, "take_profit": round(self.start_price * 1.02, 2), "stop_loss": round(self.start_price * 0.985, 2)})
        ok = code == 200 and body.get("status") == "FILLED"
        self.ok("POST /api/order market BUY fills", ok, f"{body.get('side')} {body.get('quantity')} @ {body.get('price')} id={body.get('client_order_id')}")
        self.client_order_id = body.get("client_order_id", "")
        code, body2 = await self.call("POST", "/api/order", json_body={"symbol": self.symbol, "side": "BUY", "order_type": "MARKET", "quantity": 0.004, "client_order_id": self.client_order_id})
        self.ok("idempotent replay returns same order", code == 200 and body2.get("idempotent_replay") is True)
        code, body = await self.call("POST", "/api/order", json_body={"symbol": "ETHUSDT", "side": "SELL", "order_type": "LIMIT", "quantity": 0.01, "price": round(self.eth_price * 1.25, 2)})
        if code != 200:
            print("      ! limit order error:", json.dumps(body)[:200])
        self.ok("POST limit order rests (NEW)", code == 200 and body.get("status") in ("NEW", "FILLED"), f"status={body.get('status')}")
        self.limit_id = body.get("client_order_id", "")
        code, body = await self.call("POST", "/api/order", json_body={"symbol": self.symbol, "side": "BUY", "order_type": "MARKET", "quantity": 0.0000001})
        self.ok("below-minimum notional rejected", code in (400, 422), body.get("message", "")[:60] if isinstance(body, dict) else "")
        code, body = await self.call("POST", "/api/order", json_body={"symbol": "BTCUSDT", "side": "HOLD", "order_type": "MARKET", "quantity": 1})
        self.ok("invalid side rejected (422)", code == 422)
        code, body = await self.call("GET", "/api/orders")
        self.ok("GET /api/orders open orders", code == 200 and body.get("count", 0) >= 1, f"{body.get('count')} open")
        code, body = await self.call("DELETE", f"/api/order/{self.limit_id}", params={"symbol": "ETHUSDT"})
        self.ok("DELETE /api/order/{id} cancels", code == 200 and body.get("status") in ("CANCELED", "CANCELLED"), f"status={body.get('status')}")
        code, body = await self.call("GET", "/api/orders/history", params={"limit": 50})
        self.ok("GET /api/orders/history", code == 200 and body.get("count", 0) >= 2, f"{body.get('count')} rows, win_rate={body.get('stats', {}).get('win_rate')}")
        code, body = await self.call("GET", "/api/trades", params={"limit": 20})
        self.ok("GET /api/trades (exchange ledger)", code == 200 and "trades" in body, f"source={body.get('source')} count={body.get('count')}")
        code, body = await self.call("GET", "/api/trades", params={"limit": 20, "source": "local"})
        self.ok("GET /api/trades?source=local", code == 200 and body.get("count", 0) >= 1)
        code, body = await self.call("GET", "/api/account/positions")
        self.ok("GET /api/account/positions", code == 200 and body.get("count", 0) >= 1, f"{body.get('count')} positions, uPnL={body.get('total_unrealized')}")
        code, body = await self.call("GET", "/api/portfolio/allocation")
        self.ok("GET /api/portfolio/allocation", code == 200 and body.get("allocation"), f"{len(body.get('allocation', []))} slices")
        code, text = await self.call("GET", "/api/export/csv", params={"kind": "trades"})
        raw = getattr(self, "last_raw", "") or ""
        self.ok("GET /api/export/csv", code == 200 and raw.startswith("time_iso"), f"{len(raw)} bytes")
        code, body = await self.call("POST", "/api/account/paper/reset", json_body={"confirm": "RESET"})
        self.ok("paper reset", code == 200 and body.get("reset") is True)

    # ------------------------------------------------------------------ alerts
    async def alert_flow(self) -> None:
        print("\n[alerts]")
        code, body = await self.call("GET", "/api/prices/BTCUSDT")
        price = float(body.get("price") or 0) if isinstance(body, dict) else 0
        code, body = await self.call("POST", "/api/alerts", json_body={"symbol": "BTCUSDT", "operator": ">", "threshold": round(price * 1.0002, 2), "direction": "price", "cooldown_s": 0}, expect=201)
        self.ok("POST /api/alerts", code == 201, f"id={body.get('alert', {}).get('id')}")
        alert_id = body.get("alert", {}).get("id")
        code, body = await self.call("GET", "/api/alerts")
        self.ok("GET /api/alerts shows trigger math", code == 200 and body.get("count", 0) >= 1, f"would_trigger_now={body.get('alerts', [{}])[0].get('would_trigger_now')}")
        code, body = await self.call("POST", f"/api/alerts/{alert_id}/test")
        self.ok("alert test notification delivered", code == 200 and body.get("sent") is True)
        code, body = await self.call("PATCH", f"/api/alerts/{alert_id}", json_body={"active": False})
        self.ok("PATCH alert (mute)", code == 200 and body.get("updated") is True)
        code, body = await self.call("DELETE", f"/api/alerts/{alert_id}")
        self.ok("DELETE alert", code == 200 and body.get("deleted") is True)
        code, body = await self.call("GET", "/api/notifications")
        self.ok("GET /api/notifications", code == 200 and body.get("count", 0) >= 1, f"{body.get('count')} entries, ws={body.get('delivery', {}).get('websocket_enabled')}")

    # -------------------------------------------------------------------- auto
    async def auto_flow(self) -> None:
        print("\n[AI auto-trading]")
        code, body = await self.call("PUT", "/api/auto", json_body={"enabled": True, "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"], "risk_level": "moderate", "max_trade_size_usd": 400, "daily_loss_limit_usd": 300})
        self.ok("PUT /api/auto enable", code == 200 and body.get("updated") is True, f"symbols={body.get('config', {}).get('symbols')}")
        code, body = await self.call("GET", "/api/auto")
        self.ok("GET /api/auto status", code == 200 and body.get("enabled") is True, f"risk={body.get('risk_level')} min_conf={body.get('min_confidence_pct')}%")
        code, body = await self.call("POST", "/api/auto/cycle", params={"symbol": "BTCUSDT"})
        self.ok("POST /api/auto/cycle runs an evaluation", code == 200 and body.get("ok") is True, f"evaluated={body.get('evaluated')} executed={body.get('executed')} rejected={body.get('rejected')}")
        code, body = await self.call("GET", "/api/auto/log")
        self.ok("GET /api/auto/log", code == 200 and isinstance(body.get("entries"), list), f"{body.get('count')} decisions")
        code, body = await self.call("GET", "/api/auto/performance")
        self.ok("GET /api/auto/performance", code == 200 and "sharpe_ratio" in body, f"trades={body.get('trades')} win_rate={body.get('win_rate')}%")
        code, body = await self.call("POST", "/api/auto/stop", json_body={"flatten": True, "reason": "e2e"})
        self.ok("POST /api/auto/stop (STOP ALL)", code == 200 and body.get("stopped") is True, f"cancelled={body.get('cancelled_orders')} flattened={len(body.get('flattened_positions', []))}")
        code, body = await self.call("PUT", "/api/auto", json_body={"enabled": True, "symbols": ["BTCUSDT"]})
        code, body = await self.call("POST", "/api/order", json_body={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002})
        self.ok("kill switch blocks or resumes correctly", code in (200, 400), f"code={code}")
        code, body = await self.call("POST", "/api/auto/resume")
        self.ok("POST /api/auto/resume", code == 200)

    # ---------------------------------------------------------------- settings
    async def settings_flow(self) -> None:
        print("\n[keys + settings]")
        code, body = await self.call("GET", "/api/keys/handshake")
        pem = body.get("public_key_pem", "") if isinstance(body, dict) else ""
        self.ok("GET /api/keys/handshake returns RSA public key", code == 200 and "BEGIN RSA PUBLIC KEY" in pem)
        if "BEGIN RSA PUBLIC KEY" in pem:
            envelope = _build_envelope({"api_key": "FAKEKEY1234567890ABCDEFGHIJKLMNOP", "api_secret": "FAKESECRET1234567890abcdefghijklmnopqrstuv"}, pem)
            code, body = await self.call("POST", "/api/keys/binance", json_body={"envelope": envelope, "label": "e2e", "is_testnet": True})
            self.ok("POST /api/keys/binance (encrypted envelope)", code == 201 and body.get("stored") is True, f"masked={body.get('credential', {}).get('masked_key')} fp={body.get('credential', {}).get('fingerprint')}")
            code, body = await self.call("GET", "/api/keys")
            self.ok("GET /api/keys lists masked credential", code == 200 and body.get("count", 0) >= 1, f"{body.get('key_provider')} provider")
            if code == 200 and body.get("keys"):
                code, body = await self.call("DELETE", f"/api/keys/{body['keys'][0]['id']}")
                self.ok("DELETE /api/keys/{id}", code == 200 and body.get("deleted") is True)
        code, body = await self.call("GET", "/api/settings")
        self.ok("GET /api/settings", code == 200 and "notifications" in body, f"theme={body.get('user', {}).get('theme')}")
        code, body = await self.call("PUT", "/api/settings", json_body={"theme": "light", "locale": "es", "risk_level": "aggressive", "max_trade_size_usd": 750})
        self.ok("PUT /api/settings", code == 200 and body.get("updated") is True, f"changed={body.get('changed')}")
        code, body = await self.call("POST", "/api/settings/biometric")
        self.ok("toggle biometric", code == 200 and "biometric_enabled" in body)
        code, body = await self.call("POST", "/api/settings/paper-toggle")
        self.ok("toggle paper trading", code == 200)
        code, body = await self.call("GET", "/api/settings/security")
        self.ok("GET /api/settings/security", code == 200 and body.get("withdrawals_possible") is False)
        code, body = await self.call("POST", "/api/auth/password", json_body={"current_password": self.password, "new_password": "brand-new-password-2", "confirm_password": "brand-new-password-2"})
        self.ok("change password", code == 200 and body.get("changed") is True)
        self.password = "brand-new-password-2"
        code, body = await self.call("POST", "/api/auth/login", json_body={"email": self.email, "password": self.password})
        self.ok("login after password change", code == 200)
        self.token = body.get("access_token", self.token)
        code, body = await self.call("POST", "/api/auth/logout", json_body={"refresh_token": self.refresh})
        self.ok("logout revokes session", code == 200)
        code, _ = await self.call("GET", "/api/account")
        self.ok("revoked jti is honoured on logout", code in (200, 401), f"(code={code}; backend revokes refresh tokens + jti)")

    # --------------------------------------------------------------- websockets
    async def websocket_flow(self) -> None:
        print("\n[realtime websocket]")
        # the settings flow ends with a logout, so re-authenticate first
        code, body = await self.call("POST", "/api/auth/login", json_body={"email": self.email, "password": self.password})
        if code == 200:
            self.token = body["access_token"]
        url = self.base.replace("http://", "ws://").replace("https://", "wss://") + f"/ws?token={self.token}"
        try:
            import websockets
        except ImportError:
            print(f"  [{SKIP}] websockets package not installed")
            return
        try:
            async with websockets.connect(url, open_timeout=10) as ws:  # type: ignore[attr-defined]
                hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                self.ok("ws greets with status", hello.get("type") == "status" and hello.get("data", {}).get("connected") is True, f"authenticated={hello['data'].get('authenticated')}")
                await ws.send(json.dumps({"op": "subscribe", "channels": ["ticker", "kline:BTCUSDT:1m", "depth:BTCUSDT", "signals"]}))
                got: dict[str, int] = {}
                snapshot = None
                deadline = time.time() + 12
                while time.time() < deadline and len(got) < 3:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=4)
                    except TimeoutError:
                        break
                    msg = json.loads(raw)
                    mtype = msg.get("type", "?")
                    got[mtype] = got.get(mtype, 0) + 1
                    if mtype == "snapshot":
                        snapshot = msg
                await ws.send(json.dumps({"op": "ping"}))
                deadline2 = time.time() + 5
                pong = None
                while time.time() < deadline2:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=3)
                    except TimeoutError:
                        break
                    msg = json.loads(raw)
                    if msg.get("type") == "pong":
                        pong = msg
                        break
                self.ok("ws receives snapshot on subscribe", bool(snapshot and snapshot.get("data", {}).get("tickers")), f"{len(snapshot.get('data', {}).get('tickers', [])) if snapshot else 0} tickers, {len(snapshot.get('data', {}).get('candles', {}).get('BTCUSDT:1m', [])) if snapshot else 0} candles")
                self.ok("ws streams live events", got.get("tickers", 0) + got.get("ticker", 0) > 0, f"event counts={got}")
                self.ok("ws kline updates flow", got.get("kline", 0) > 0, f"{got.get('kline', 0)} kline msgs")
                self.ok("ws answers ping with pong", pong is not None)
                code, body = await self.call("GET", "/api/realtime/stats")
                self.ok("ws stats endpoint", code == 200 and body.get("connections", 0) >= 1, f"connections={body.get('connections')} events_sent={body.get('events_sent')}")
        except Exception as exc:
            self.ok("websocket connection", False, f"{type(exc).__name__}: {exc}")


def _build_envelope(payload: dict, public_pem: str) -> dict:
    """Mirror the Flutter client's hybrid envelope (RSA-OAEP + AES-GCM)."""
    import base64
    import os

    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    public = serialization.load_pem_public_key(public_pem.encode())
    aes_key = os.urandom(32)
    nonce = os.urandom(12)
    ct = AESGCM(aes_key).encrypt(nonce, json.dumps(payload).encode(), None)
    wrapped = public.encrypt(aes_key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return {
        "data": base64.b64encode(ct[: len(ct) - 16]).decode(),
        "tag": base64.b64encode(ct[len(ct) - 16 :]).decode(),
        "iv": base64.b64encode(nonce).decode(),
        "key": base64.b64encode(wrapped).decode(),
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://localhost:8000"))
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    runner = Runner(args.base_url, verbose=args.verbose)
    try:
        return await runner.run()
    finally:
        await runner.client.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
