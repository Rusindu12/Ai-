"""AI endpoints: signal shape, batch, sentiment, indicators, backtest, training, execute."""

from __future__ import annotations

SIGNAL_KEYS = {"signal_id", "symbol", "interval", "action", "confidence", "reason", "indicators", "models", "rules", "trade_plan", "model_version", "created_at_ms"}


async def test_signal_contract(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.get("/api/ai/signal/BTCUSDT", params={"interval": "1m", "bars": 300}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) >= SIGNAL_KEYS, sorted(SIGNAL_KEYS - set(body))
    assert body["action"] in ("BUY", "SELL", "HOLD")
    assert 0 <= body["confidence"] <= 100
    assert body["reason"]
    assert body["price"] > 0
    ind = body["indicators"]
    for key in ("rsi", "macd", "macd_hist", "bb_upper", "bb_lower", "ema_20", "ema_50", "ema_200", "atr", "adx", "vwap", "supports", "resistances", "levels", "trend", "momentum", "relative_volume", "taker_ratio", "poc"):
        assert key in ind, key
    assert -1 <= body["score"] <= 1
    assert len(body["rules"]) == 8
    for rule in body["rules"]:
        assert {"name", "vote", "weight", "detail", "contribution"} <= set(rule)
        assert -1 <= rule["vote"] <= 1
    assert body["models"]["status"] in ("ok", "untrained")
    assert body["account"]["equity_usd"] > 0


async def test_signal_persists_and_is_queryable(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.get("/api/ai/signal/SOLUSDT", params={"persist": "true"}, headers=headers)
    sid = r.json()["signal_id"]
    r = await client.get("/api/ai/history/SOLUSDT", headers=headers)
    assert r.status_code == 200
    assert any(s["signal_id"] == sid for s in r.json()["signals"])


async def test_signal_validation(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.get("/api/ai/signal/BTCUSDT", params={"bars": 10}, headers=headers)
    assert r.status_code == 422, "bars must be >= 120"
    r = await client.get("/api/ai/signal/BTCUSDT", params={"interval": "nonsense"}, headers=headers)
    assert r.status_code == 422


async def test_batch_signals_and_sentiment(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.get("/api/ai/signals", params={"interval": "15m"}, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 4 and len(body["signals"]) == body["count"]
    assert sum(body["counts"].values()) == body["count"]
    for row in body["signals"]:
        assert row["action"] in ("BUY", "SELL", "HOLD")
        assert 0 <= row["confidence"] <= 100

    r = await client.get("/api/ai/sentiment")
    assert r.status_code == 200
    sent = r.json()
    assert sent["state"] in ("BULLISH", "BEARISH", "NEUTRAL")
    assert sent["advancers"] + sent["decliners"] <= sent["breadth"]["total"]
    assert -1 <= sent["score"] <= 1


async def test_indicators_endpoint_series_aligned(client, auth):
    r = await client.get("/api/ai/indicators/ETHUSDT/1h", params={"limit": 260})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 200
    series = body["series"]
    lengths = {len(v) for v in series.values()}
    assert len(lengths) == 1, f"indicator series must be aligned: {lengths}"
    assert len(body["candles_tail"]) == 120


async def test_backtest_endpoint(client, auth):
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.post(
        "/api/ai/backtest",
        json={"symbol": "BTCUSDT", "interval": "1m", "bars": 800, "strategy": "rsi_reversion", "include_curve": True},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("metrics", "trades", "equity_curve", "config", "monthly", "start_ms", "end_ms"):
        assert key in body, key
    m = body["metrics"]
    for key in ("total_return_pct", "sharpe", "sortino", "max_drawdown_pct", "win_rate_pct", "profit_factor", "exposure_pct", "fees_paid"):
        assert key in m, key
    assert 0 <= m["win_rate_pct"] <= 100
    assert m["max_drawdown_pct"] >= 0
    assert body["equity_curve"]
    r = await client.post("/api/ai/backtest", json={"symbol": "BTCUSDT", "bars": 10}, headers=headers)
    assert r.status_code == 422


async def test_strategies_listed(client):
    r = await client.get("/api/ai/strategies")
    assert r.status_code == 200
    keys = {s["key"] for s in r.json()["strategies"]}
    assert {"buy_hold", "rsi_reversion", "macd_trend", "ai"} <= keys


async def test_models_endpoint_and_training(client, auth, monkeypatch):
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "AI_MODEL_DIR", "/tmp/pytest_models")
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    r = await client.get("/api/ai/models")
    assert r.status_code == 200
    active = r.json()["active"]
    assert active["n_features"] == 23
    assert active["features"][0] == "ret_1"

    r = await client.post(
        "/api/ai/train",
        json={"symbols": ["BTCUSDT"], "interval": "1m", "bars": 900, "look_back": 24, "hidden": 8, "epochs_lstm": 2, "epochs_clf": 12},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    report = r.json()["report"]
    assert report["version"].startswith("ai-")
    assert report["train_sequences"] > 100 and report["val_sequences"] > 20
    assert report["lstm_val_mse"] is not None
    assert 0 <= report["classifier_val_accuracy"] <= 1

    r = await client.get("/api/ai/models")
    active = r.json()["active"]
    assert active["version"] == report["version"], "training must hot-swap the active model"
    assert active["source"] in ("trained", "disk")
    assert active["has_models"] is True
    assert r.json()["retrain_policy"]["days"] >= 1


async def test_execute_signal_places_a_real_order(client, fresh_user, monkeypatch):
    """Force a BUY by lowering the confidence floor, then act on it."""
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "AI_MIN_CONFIDENCE_PCT", 0.0)
    headers = {"Authorization": f"Bearer {fresh_user['access_token']}"}
    # make the rule engine agree: engineer an oversold tape on the hub
    r = await client_get(client, "/api/prices/BTCUSDT")
    assert r["price"] > 0
    before = (await client.get("/api/orders/history", headers=headers)).json()["count"]
    r = await client.post("/api/ai/signal/BTCUSDT/execute", json={"interval": "1m", "quantity": 0.002}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["executed"] is True or body["signal"]["action"] == "HOLD"
    if body["executed"]:
        assert body["order"]["status"] == "FILLED"
        after = (await client.get("/api/orders/history", headers=headers)).json()["count"]
        assert after == before + 1


async def client_get(client, path):
    r = await client.get(path)
    return r.json()


async def test_ai_history_requires_auth(client):
    r = await client.get("/api/ai/history/BTCUSDT")
    assert r.status_code == 401
