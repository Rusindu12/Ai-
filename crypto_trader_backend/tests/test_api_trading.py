"""Order lifecycle through the HTTP API: preview, fill, idempotency, cancel, exports."""

from __future__ import annotations

import time

import pytest


def _headers(account: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {account['access_token']}"}


async def test_account_snapshot(client, fresh_user):
    r = await client.get("/api/account", headers=_headers(fresh_user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "demo" and body["paper_trading"] is True
    assert body["total_value_usd"] > 0
    assert len(body["holdings"]) >= 3
    h = body["holdings"][0]
    for key in ("asset", "amount", "price", "value_usd", "change_24h_pct", "allocation_pct", "sparkline"):
        assert key in h, key
    assert body["exchange"]["can_withdraw"] is False
    total_from_holdings = sum(x["value_usd"] for x in body["holdings"]) + body["cash_usd"]
    assert total_from_holdings == pytest.approx(body["total_value_usd"], abs=1.0)
    assert 0 < sum(a["pct"] for a in body["allocation"]) <= 101


async def test_dry_run_preview_does_not_trade(client, fresh_user):
    headers = _headers(fresh_user)
    before = (await client.get("/api/orders/history", headers=headers)).json()["count"]
    r = await client.post(
        "/api/order/preview",
        json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] is True and body["est_notional"] > 0 and "risk" in body
    assert body["risk"]["allowed"] is True
    after = (await client.get("/api/orders/history", headers=headers)).json()["count"]
    assert after == before, "a preview must never create an order"


async def test_market_buy_updates_position_and_history(client, fresh_user):
    headers = _headers(fresh_user)
    price = (await client.get("/api/prices/BTCUSDT")).json()["price"]
    r = await client.post(
        "/api/order",
        json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.002,
            "take_profit": round(price * 1.05, 1),
            "stop_loss": round(price * 0.97, 1),
            "client_order_id": f"t{int(time.time() * 1000)}",
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    order = r.json()
    assert order["status"] == "FILLED"
    assert order["quantity"] == pytest.approx(0.002)
    assert order["price"] > 0 and order["fee_usd"] > 0
    assert order["paper"] is True
    assert order["position"]["qty"] >= 0.002
    assert order["position"]["take_profit"] == pytest.approx(price * 1.05, rel=0.01)

    r = await client.get("/api/account/positions", headers=headers)
    rows = [p for p in r.json()["positions"] if p["symbol"] == "BTCUSDT"]
    assert rows, "position must exist after a fill"
    assert rows[0]["qty"] >= 0.002 and rows[0]["avg_price"] > 0

    r = await client.get("/api/orders/history", params={"symbol": "BTCUSDT"}, headers=headers)
    assert r.status_code == 200 and r.json()["count"] >= 1
    assert any(t["client_order_id"] == order["client_order_id"] for t in r.json()["trades"])

    r = await client.get(f"/api/order/{order['client_order_id']}", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "FILLED"

    r = await client.get("/api/trades", params={"source": "local"}, headers=headers)
    assert r.status_code == 200 and r.json()["count"] >= 1

    r = await client.get("/api/export/csv", params={"kind": "trades"}, headers=headers)
    assert r.status_code == 200
    assert r.text.splitlines()[0].startswith("time_iso")
    assert order["client_order_id"] in r.text


async def test_duplicate_client_order_id_is_idempotent(client, fresh_user):
    cid = f"idem{int(time.time() * 1000)}"
    payload = {"symbol": "ETHUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.05, "client_order_id": cid}
    first = await client.post("/api/order", json=payload, headers=_headers(fresh_user))
    second = await client.post("/api/order", json=payload, headers=_headers(fresh_user))
    assert first.status_code == second.status_code == 200
    assert second.json()["idempotent_replay"] is True
    assert first.json()["quantity"] == pytest.approx(second.json()["quantity"])
    history = await client.get("/api/orders/history", params={"symbol": "ETHUSDT"}, headers=_headers(fresh_user))
    assert len([t for t in history.json()["trades"] if t["client_order_id"] == cid]) == 1, "no double fill"


async def test_limit_order_rests_then_cancels(client, fresh_user):
    headers = _headers(fresh_user)
    price = (await client.get("/api/prices/BNBUSDT")).json()["price"]
    r = await client.post(
        "/api/order",
        json={"symbol": "BNBUSDT", "side": "BUY", "order_type": "LIMIT", "quantity": 0.5, "price": round(price * 0.5, 2)},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    placed = r.json()
    assert placed["status"] == "NEW" and placed["quantity"] > 0

    r = await client.get("/api/orders", params={"symbol": "BNBUSDT"}, headers=headers)
    open_rows = r.json()["orders"]
    assert any(o["clientOrderId"] == placed["client_order_id"] for o in open_rows)

    r = await client.delete(f"/api/order/{placed['client_order_id']}", params={"symbol": "BNBUSDT"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] in ("CANCELED", "CANCELLED")

    r = await client.get("/api/orders", params={"symbol": "BNBUSDT"}, headers=headers)
    assert all(o["clientOrderId"] != placed["client_order_id"] for o in r.json()["orders"])

    r = await client.delete(f"/api/order/{placed['client_order_id']}", params={"symbol": "BNBUSDT"}, headers=headers)
    assert r.status_code == 409, "cancelling twice must conflict, not silently succeed"


async def test_risk_and_validation_guards(client, fresh_user):
    headers = _headers(fresh_user)
    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.0000001}, headers=headers)
    assert r.status_code in (400, 422) and r.json()["details"]["code"] in ("min_notional", "min_qty")

    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "LIMIT", "quantity": 1}, headers=headers)
    assert r.status_code == 422, "LIMIT without price must be rejected by the schema"

    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "HOLD", "order_type": "MARKET", "quantity": 1}, headers=headers)
    assert r.status_code == 422

    r = await client.post("/api/order", json={"symbol": "NOSUCHPAIR", "side": "BUY", "order_type": "MARKET", "quantity": 1}, headers=headers)
    assert r.status_code in (400, 422, 502), "unknown symbols must produce a clean error"

    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "SELL", "order_type": "MARKET", "quantity": 900_000}, headers=headers)
    assert r.status_code == 400 and r.json()["error"] in ("risk_limit_breached", "insufficient_funds"), r.text


async def test_daily_loss_limit_stops_trading(client, fresh_user, monkeypatch):
    from app.config import settings as cfg
    from app.db import repo
    from app.db.base import session_scope

    monkeypatch.setattr(cfg, "MAX_TRADE_NOTIONAL_USD", 50.0)
    headers = _headers(fresh_user)
    async with session_scope() as session:
        await repo.update_user(session, fresh_user["user_id"], daily_loss_limit_usd=1.0, max_trade_size_usd=500.0)
        await repo.record_trade(session, user_id=fresh_user["user_id"], client_order_id=f"loss{int(time.time()*1000)}", symbol="BTCUSDT",
                                side="SELL", order_type="MARKET", qty=1, price=1, quote_qty=1, realized_pnl=-99_000.0, status="FILLED")
    r = await client.post("/api/order", json={"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.002}, headers=headers)
    assert r.status_code == 400, r.text
    assert "daily loss limit" in r.json()["message"]
    async with session_scope() as session:
        await repo.update_user(session, fresh_user["user_id"], daily_loss_limit_usd=500.0)


async def test_bulk_orders_report_per_item_outcomes(client, fresh_user):
    orders = [
        {"symbol": "BTCUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.001},
        {"symbol": "BTCUSDT", "side": "SELL", "order_type": "MARKET", "quantity": 1e6},
        {"symbol": "ETHUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 0.0000001},
    ]
    r = await client.post("/api/orders/bulk", json={"orders": orders}, headers=_headers(fresh_user))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 3
    assert body["succeeded"] >= 1
    assert any(item["ok"] is False for item in body["results"]), "failures must be reported per order"


async def test_paper_reset_rebalances(client, fresh_user):
    headers = _headers(fresh_user)
    await client.post("/api/order", json={"symbol": "SOLUSDT", "side": "BUY", "order_type": "MARKET", "quantity": 2}, headers=headers)
    r = await client.post("/api/account/paper/reset", json={"confirm": "RESET"}, headers=headers)
    assert r.status_code == 200
    r = await client.get("/api/account/positions", headers=headers)
    assert all(p["qty"] == 0 for p in r.json()["positions"])


async def test_trades_endpoint_never_500s_without_keys(client, fresh_user):
    r = await client.get("/api/trades", headers=_headers(fresh_user))
    assert r.status_code == 200 and "trades" in r.json()
