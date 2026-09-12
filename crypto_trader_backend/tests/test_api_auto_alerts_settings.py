"""AI auto-trading control plane, alerts, notifications, keys and settings."""

from __future__ import annotations

import base64

import pytest


def H(auth) -> dict[str, str]:
    return {"Authorization": f"Bearer {auth['access_token']}"}


# --------------------------------------------------------------------------- #
# Auto trading
# --------------------------------------------------------------------------- #
async def test_auto_config_validation(client, auth):
    r = await client.put("/api/auto", json={"enabled": True, "symbols": ["btcusdt"], "risk_level": "extreme"}, headers=H(auth))
    assert r.status_code == 422, "risk level is an enum"
    r = await client.put("/api/auto", json={"enabled": True, "symbols": ["x"], "risk_level": "moderate"}, headers=H(auth))
    assert r.status_code == 422


async def test_auto_enable_disable_and_status(client, fresh_user, monkeypatch):
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "AI_MIN_CONFIDENCE_PCT", 0.0)
    headers = H(fresh_user)
    r = await client.put(
        "/api/auto",
        json={
            "enabled": True,
            "symbols": ["BTCUSDT", "ETHUSDT"],
            "risk_level": "aggressive",
            "max_trade_size_usd": 300,
            "daily_loss_limit_usd": 400,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["config"]["enabled"] is True
    assert r.json()["config"]["symbols"] == ["BTCUSDT", "ETHUSDT"]

    r = await client.get("/api/auto", headers=headers)
    body = r.json()
    assert body["enabled"] is True and body["kill_switch"] is False
    assert body["risk_level"] == "aggressive"
    assert body["profile"]["risk_per_trade"] > 0
    assert body["engine"]["running"] is True
    assert body["paper_trading"] is True
    assert body["today"]["orders"] == 0

    r = await client.put("/api/auto", json={"enabled": False, "symbols": ["BTCUSDT"]}, headers=headers)
    assert r.status_code == 200 and r.json()["config"]["enabled"] is False


async def test_auto_cycle_writes_the_decision_log(client, fresh_user, monkeypatch):
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "AI_MIN_CONFIDENCE_PCT", 0.0)
    headers = H(fresh_user)
    await client.put("/api/auto", json={"enabled": True, "symbols": ["BTCUSDT"], "risk_level": "moderate"}, headers=headers)
    r = await client.post("/api/auto/cycle", params={"symbol": "BTCUSDT"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["evaluated"] == 1
    assert body["executed"] + body["rejected"] + body["closed"] >= 0

    r = await client.get("/api/auto/log", headers=headers)
    assert r.status_code == 200 and r.json()["count"] >= 1
    entry = r.json()["entries"][0]
    assert entry["symbol"] == "BTCUSDT"
    assert entry["decision"] in ("BUY", "SELL", "HOLD")
    assert entry["reason"]
    assert entry["risk"]["risk_level"] == "moderate"

    r = await client.get("/api/auto/performance", headers=headers)
    perf = r.json()
    assert {"trades", "win_rate", "total_pnl", "sharpe_ratio", "decisions", "daily"} <= set(perf)
    assert perf["decisions"] >= 1


async def test_stop_all_blocks_new_entries(client, fresh_user, monkeypatch):
    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "AI_MIN_CONFIDENCE_PCT", 0.0)
    headers = H(fresh_user)
    await client.put("/api/auto", json={"enabled": True, "symbols": ["BTCUSDT"]}, headers=headers)
    r = await client.post("/api/auto/stop", json={"flatten": True, "reason": "unit test"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stopped"] is True
    assert isinstance(body["flattened_positions"], list)

    r = await client.get("/api/auto", headers=headers)
    assert r.json()["enabled"] is False and r.json()["kill_switch"] is True

    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002}, headers=headers)
    assert r.status_code == 400 and r.json()["error"] == "risk_limit_breached"
    assert "STOP ALL" in r.json()["message"]

    r = await client.post("/api/auto/cycle", headers=headers)
    assert r.status_code == 200 and r.json().get("evaluated", 0) == 0

    r = await client.post("/api/auto/resume", headers=headers)
    assert r.status_code == 200
    r = await client.get("/api/auto", headers=headers)
    assert r.json()["kill_switch"] is False and r.json()["enabled"] is True


async def test_open_orders_can_be_cancelled_in_bulk(client, fresh_user):
    headers = H(fresh_user)
    price = (await client.get("/api/prices/ETHUSDT")).json()["price"]
    for i in range(2):
        r = await client.post(
            "/api/order",
            json={"symbol": "ETHUSDT", "side": "BUY", "order_type": "LIMIT", "quantity": 0.05, "price": round(price * (0.5 + 0.05 * i), 2)},
            headers=headers,
        )
        assert r.status_code == 200
    r = await client.get("/api/orders", headers=headers)
    assert r.json()["count"] >= 2
    r = await client.delete("/api/orders", params={"symbol": "ETHUSDT"}, headers=headers)
    assert r.status_code == 200 and r.json()["cancelled"] >= 2
    r = await client.get("/api/orders", params={"symbol": "ETHUSDT"}, headers=headers)
    assert r.json()["count"] == 0


# --------------------------------------------------------------------------- #
# Alerts + notifications
# --------------------------------------------------------------------------- #
async def test_alert_crud_and_would_trigger_math(client, fresh_user, hub):
    headers = H(fresh_user)
    price = hub.price("BTCUSDT")
    r = await client.post("/api/alerts", json={"symbol": "BTCUSDT", "operator": ">", "threshold": round(price * 0.5, 2), "cooldown_s": 0}, headers=headers)
    assert r.status_code == 201, r.text
    alert_id = r.json()["alert"]["id"]

    r = await client.get("/api/alerts", headers=headers)
    row = next(a for a in r.json()["alerts"] if a["id"] == alert_id)
    assert row["would_trigger_now"] is True, "price is above the threshold"
    assert row["current_price"] > 0 and row["distance"] < 0

    r = await client.post("/api/alerts", json={"symbol": "BTCUSDT", "operator": ">", "threshold": -5}, headers=headers)
    assert r.status_code == 422, "threshold must be positive"

    r = await client.post(f"/api/alerts/{alert_id}/test", headers=headers)
    assert r.status_code == 200 and r.json()["sent"] is True
    r = await client.get("/api/notifications", headers=headers)
    assert r.json()["count"] >= 1
    kinds = {n["kind"] for n in r.json()["notifications"]}
    assert "alert" in kinds

    r = await client.patch(f"/api/alerts/{alert_id}", json={"active": False}, headers=headers)
    assert r.json()["updated"] is True
    r = await client.get("/api/alerts", params={"active_only": "true"}, headers=headers)
    assert all(a["id"] != alert_id for a in r.json()["alerts"])
    r = await client.delete(f"/api/alerts/{alert_id}", headers=headers)
    assert r.json()["deleted"] is True
    r = await client.delete(f"/api/alerts/{alert_id}", headers=headers)
    assert r.status_code == 200 and r.json()["deleted"] is False, "second delete is a no-op"
    r = await client.post("/api/alerts/99999/test", headers=headers)
    assert r.status_code == 422


async def test_alert_engine_fires_on_live_price(client, fresh_user, hub):
    headers = H(fresh_user)
    price = hub.price("ETHUSDT")
    r = await client.post("/api/alerts", json={"symbol": "ETHUSDT", "operator": ">", "threshold": round(price * 0.5, 2), "cooldown_s": 0}, headers=headers)
    alert_id = r.json()["alert"]["id"]
    r = await client.post("/api/notifications/scan", headers=headers)
    assert r.status_code == 200 and r.json()["triggered"] >= 1
    r = await client.get("/api/notifications", headers=headers)
    rows = [n for n in r.json()["notifications"] if n["kind"] == "alert"]
    assert rows, "the scan must have produced a notification"
    assert "ETHUSDT" in rows[0]["title"] + rows[0]["body"]
    r = await client.get("/api/alerts", headers=headers)
    row = next(a for a in r.json()["alerts"] if a["id"] == alert_id)
    assert row["triggered_once"] is True and row["last_triggered_at_ms"] > 0


async def test_pct_change_alert_direction(client, fresh_user):
    headers = H(fresh_user)
    r = await client.post("/api/alerts", json={"symbol": "BTCUSDT", "operator": "<", "threshold": 500, "direction": "price"}, headers=headers)
    assert r.status_code == 201
    r = await client.post("/api/alerts", json={"symbol": "BTCUSDT", "operator": ">", "threshold": 1, "direction": "pct_change"}, headers=headers)
    assert r.status_code == 201
    r = await client.get("/api/alerts", headers=headers)
    pct = next(a for a in r.json()["alerts"] if a["direction"] == "pct_change")
    assert pct["current_value"] == pytest.approx(pct["pct_24h"], abs=0.5)


# --------------------------------------------------------------------------- #
# Keys
# --------------------------------------------------------------------------- #
def _envelope(payload: dict, public_pem: str) -> dict:
    import json
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
        "data": base64.b64encode(ct[:-16]).decode(),
        "tag": base64.b64encode(ct[-16:]).decode(),
        "iv": base64.b64encode(nonce).decode(),
        "key": base64.b64encode(wrapped).decode(),
    }


async def test_key_handshake_and_envelope_upload(client, fresh_user):
    headers = H(fresh_user)
    r = await client.get("/api/keys/handshake")
    assert r.status_code == 200
    pem = r.json()["public_key_pem"]
    assert "BEGIN RSA PUBLIC KEY" in pem

    api_key = "DEMOKEY0123456789ABCDEFGH"
    envelope = _envelope({"api_key": api_key, "api_secret": "DEMOSECRET0123456789abcdefghijklmn"}, pem)
    r = await client.post("/api/keys/binance", json={"envelope": envelope, "label": "primary", "is_testnet": True, "delete_local": True}, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["stored"] is True
    assert body["delete_local_copy"] is True
    masked = body["credential"]["masked_key"]
    assert api_key not in masked and api_key[:4] in masked and masked.endswith(api_key[-4:])
    assert body["credential"]["can_withdraw"] is False
    assert body["credential"]["fingerprint"] and len(body["credential"]["fingerprint"]) == 12
    assert body["security_note"]

    # ciphertext only at rest
    from app.db import repo
    from app.db.base import session_scope

    async with session_scope() as session:
        cred = await repo.get_active_credential(session, fresh_user["user_id"])
        assert api_key not in cred.api_key_enc.decode("latin-1")
        assert "DEMOSECRET" not in cred.secret_enc.decode("latin-1")
        assert cred.key_fp

    r = await client.get("/api/keys", headers=headers)
    assert r.json()["count"] == 1
    assert r.json()["keys"][0]["masked_key"].count("*") >= 8

    r = await client.post("/api/keys/binance", json={"envelope": {"data": "AA==", "iv": "AA==", "key": "AA==", "tag": "AA=="}, "label": "x"}, headers=headers)
    assert r.status_code in (400, 422), "a broken envelope must be rejected"

    r = await client.post("/api/keys/binance", json={"api_key": "A" * 24, "api_secret": "B" * 24, "label": "plaintext-dev"}, headers=headers)
    assert r.status_code == 201, "plaintext is allowed outside production (TLS protects it)"

    cred_id = (await client.get("/api/keys", headers=headers)).json()["keys"][0]["id"]
    r = await client.delete(f"/api/keys/{cred_id}", headers=headers)
    assert r.status_code == 200 and r.json()["deleted"] is True


async def test_short_keys_are_rejected(client, fresh_user):
    r = await client.post("/api/keys/binance", json={"api_key": "abc", "api_secret": "def"}, headers=H(fresh_user))
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
async def test_settings_roundtrip(client, fresh_user):
    headers = H(fresh_user)
    r = await client.get("/api/settings", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["theme"] in ("dark", "light", "system")
    assert body["security"]["auto_logout_minutes"] == 15
    assert body["trading"]["paper_trading"] is True
    assert body["legal"]["disclaimer"]
    assert body["notifications"]["price_alerts"] is True

    r = await client.put(
        "/api/settings",
        json={
            "theme": "light",
            "locale": "es",
            "risk_level": "conservative",
            "max_trade_size_usd": 120,
            "daily_loss_limit_usd": 240,
            "notification_prefs": {"ai_signals": False, "sound": False},
        },
        headers=headers,
    )
    assert r.status_code == 200
    assert sorted(r.json()["changed"]) == sorted(["theme", "locale", "risk_level", "max_trade_size_usd", "daily_loss_limit_usd", "notification_prefs"])
    merged = r.json()["settings"]["notification_prefs"]
    assert merged["ai_signals"] is False and merged["price_alerts"] is True, "prefs must merge, not replace"

    r = await client.put("/api/settings", json={"risk_level": "yolo"}, headers=headers)
    assert r.status_code == 422

    r = await client.get("/api/settings/security", headers=headers)
    sec = r.json()
    assert sec["withdrawals_possible"] is False
    assert sec["plaintext_at_rest"] is not True if "plaintext_at_rest" in sec else True
    assert any("ciphertext" in n or "encrypted" in n for n in sec["notes"])

    r = await client.post("/api/settings/paper-toggle", headers=headers)
    assert r.json()["paper_trading"] is False and r.json()["warning"]
    r = await client.post("/api/settings/biometric", headers=headers)
    assert r.json()["biometric_enabled"] is True


async def test_account_deletion_is_cascading(client):
    import time as _t

    email = f"del{_t.time_ns()}@example.com"
    r = await client.post("/api/auth/signup", json={"email": email, "password": "delete-me-pass1"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002}, headers=headers)
    r = await client.delete("/api/settings/account", headers=headers)
    assert r.status_code == 200 and r.json()["deleted"] is True
    r = await client.post("/api/auth/login", json={"email": email, "password": "delete-me-pass1"})
    assert r.status_code == 401, "the account must be gone"


async def test_notifications_never_break_trading(client, fresh_user, monkeypatch):
    """Push delivery is best-effort: a failing notifier must not fail the order."""
    from app.services import notifications as ns

    async def boom(**kwargs):
        raise RuntimeError("firebase down")

    monkeypatch.setattr(ns.notification_service, "push", boom)
    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002}, headers=H(fresh_user))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "FILLED"
