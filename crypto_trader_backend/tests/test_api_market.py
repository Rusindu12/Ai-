"""Market-data endpoints: prices, candles on every timeframe, book, symbols."""

from __future__ import annotations


async def test_health_and_status_endpoints(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    r = await client.get("/health/ready")
    assert r.status_code == 200 and r.json()["ready"] is True
    assert r.json()["checks"]["database"] == "ok"
    r = await client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    for key in ("market", "websocket", "ai", "limits"):
        assert key in body, key
    assert body["market"]["symbols"] >= 1
    r = await client.get("/metrics")
    assert r.status_code == 200 and "cryptotrader_requests_total" in r.text
    r = await client.get("/")
    assert r.status_code == 200 and r.json()["docs"] == "/docs"


async def test_prices_endpoints(client):
    r = await client.get("/api/prices")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == len(body["prices"]) >= 4
    for row in body["prices"]:
        assert row["price"] > 0
        assert {"symbol", "change_percent_24h", "high_24h", "low_24h", "volume_24h", "bid", "ask"} <= set(row)
        assert row["high_24h"] >= row["low_24h"]
    assert set(body["as_json"]) == {p["symbol"] for p in body["prices"]}

    r = await client.get("/api/prices", params={"symbols": "BTCUSDT,ETHUSDT"})
    assert r.status_code == 200 and {p["symbol"] for p in r.json()["prices"]} == {"BTCUSDT", "ETHUSDT"}

    r = await client.get("/api/prices/BTCUSDT")
    assert r.status_code == 200 and r.json()["symbol"] == "BTCUSDT"

    r = await client.get("/api/prices/NOTACOIN")
    assert r.status_code in (200, 422), "unknown symbols are either added or rejected, never 500"


async def test_klines_all_timeframes(client):
    for interval, step in (("1m", 60_000), ("5m", 300_000), ("15m", 900_000), ("1h", 3_600_000), ("4h", 14_400_000), ("1d", 86_400_000)):
        r = await client.get(f"/api/klines/BTCUSDT/{interval}", params={"limit": 120})
        assert r.status_code == 200, interval
        body = r.json()
        candles = body["candles"]
        assert len(candles) >= 100, f"{interval} returned {len(candles)}"
        assert body["count"] == len(candles)
        times = [c["open_time"] for c in candles]
        assert all(times[i] + step == times[i + 1] for i in range(len(times) - 1)), f"{interval} spacing"
        assert body["close"][-1] == candles[-1]["close"]
        assert body["last_close"] == candles[-1]["close"]
        assert all(c["high"] >= c["low"] for c in candles)
        assert isinstance(candles[-1]["closed"], bool)


async def test_klines_validation(client):
    r = await client.get("/api/klines/BTCUSDT/7m")
    assert r.status_code == 422
    r = await client.get("/api/klines/BTCUSDT/1m", params={"limit": 2})
    assert r.status_code == 422, "limit must be >= 5"
    r = await client.get("/api/klines/BTCUSDT/1m", params={"limit": 99999})
    assert r.status_code == 422


async def test_klines_with_indicators(client):
    r = await client.get("/api/klines/ETHUSDT/1h", params={"limit": 250, "with_indicators": "true"})
    assert r.status_code == 200
    ind = r.json()["indicators"]
    assert 0 <= ind["rsi"] <= 100
    assert ind["ema_20"] > 0 and ind["atr"] > 0
    assert len(ind["series"]["rsi"]) == len(ind["series"]["bb_mid"])


async def test_orderbook_shape(client):
    r = await client.get("/api/orderbook/BTCUSDT", params={"depth": 20})
    assert r.status_code == 200
    body = r.json()
    assert len(body["bids"]) == len(body["asks"]) == 20
    assert body["best_bid"] < body["best_ask"]
    assert body["mid_price"] > 0
    assert body["spread"] > 0 and body["spread_bps"] < 100
    assert -1 <= body["imbalance"] <= 1
    assert body["bid_depth"] > 0


async def test_symbols_market_summary_and_sparklines(client):
    r = await client.get("/api/symbols")
    body = r.json()
    assert r.status_code == 200 and body["tracked"]
    entry = body["tracked"][0]
    assert {"symbol", "base", "quote", "name", "filters"} <= set(entry)
    assert any(f["filterType"] == "LOT_SIZE" for f in entry["filters"])

    r = await client.get("/api/market/summary")
    assert r.status_code == 200
    summary = r.json()
    assert summary["advancers"] + summary["decliners"] <= summary["tracked"]
    assert len(summary["gainers"]) == 5 and len(summary["losers"]) == 5
    assert summary["gainers"][0]["change_percent_24h"] >= summary["losers"][0]["change_percent_24h"]

    r = await client.get("/api/sparklines", params={"points": 20})
    assert r.status_code == 200
    series = r.json()["series"]["BTCUSDT"]
    assert len(series) == 20 and all(p > 0 for p in series)


async def test_watchlist_crud(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.post("/api/watchlist", json={"symbol": "solusdt", "note": "l2"}, headers=headers)
    assert r.status_code == 201 and r.json()["symbol"] == "SOLUSDT"
    r = await client.post("/api/watchlist", json={"symbol": "SOLUSDT"}, headers=headers)
    assert r.status_code == 201, "adding twice must be idempotent"
    r = await client.get("/api/watchlist", headers=headers)
    assert len([w for w in r.json()["watchlist"] if w["symbol"] == "SOLUSDT"]) == 1
    r = await client.delete("/api/watchlist/SOLUSDT", headers=headers)
    assert r.status_code == 200 and r.json()["removed"] is True
    r = await client.get("/api/watchlist")
    assert r.status_code == 200 and r.json()["watchlist"] == []


async def test_hub_and_realtime_reflect_live_state(client, hub):
    before = hub.price("BTCUSDT")
    assert before > 0
    await asyncio_sleep(0.5)
    after = hub.price("BTCUSDT")
    assert after != before, "the hub must keep ticking without any HTTP poll"
    r = await client.get("/api/realtime/stats")
    assert r.status_code == 200 and r.json()["max_clients"] > 0


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)
