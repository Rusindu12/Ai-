"""Alerts + notifications (Screen 8).

    GET    /api/alerts                 all alerts + live "distance to trigger"
    POST   /api/alerts                 create ("alert me when BTC > 70000")
    PATCH  /api/alerts/{id}            update / re-arm
    DELETE /api/alerts/{id}            remove
    POST   /api/alerts/{id}/test       fire a test notification now
    GET    /api/notifications          in-app notification history
    POST   /api/notifications/read     mark read
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, get_alert_engine, get_hub, rate_limit
from app.api.schemas import AlertCreate, AlertUpdate
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import ValidationError_
from app.services.notifications import notification_service

router = APIRouter(tags=["alerts"], dependencies=[Depends(rate_limit)])


@router.get("/api/alerts")
async def list_alerts(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    hub: Any = Depends(get_hub),
    active_only: bool = Query(default=False),
) -> dict[str, Any]:
    rows = list(await repo.list_alerts(session, user.id, active_only=active_only))
    out = []
    for a in rows:
        ticker = hub.ticker(a.symbol) or {}
        price = float(ticker.get("price") or 0.0)
        value = price if a.direction == "price" else float(ticker.get("change_percent_24h") or 0.0)
        distance = (a.threshold - value) if value else None
        out.append(
            {
                "id": a.id,
                "symbol": a.symbol,
                "operator": a.operator,
                "threshold": a.threshold,
                "direction": a.direction,
                "active": a.active,
                "triggered_once": a.triggered_once,
                "cooldown_s": a.cooldown_s,
                "last_triggered_at_ms": a.last_triggered_at_ms,
                "created_at": int(a.created_at.timestamp() * 1000) if a.created_at else None,
                "current_price": price,
                "current_value": round(value, 6),
                "distance": round(distance, 6) if distance is not None else None,
                "pct_24h": float(ticker.get("change_percent_24h") or 0.0),
                "would_trigger_now": bool(value and _cmp(value, a.operator, a.threshold)),
            }
        )
    return {"count": len(out), "alerts": out}


@router.post("/api/alerts", status_code=201)
async def create_alert(
    body: AlertCreate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await repo.create_alert(
        session,
        user_id=user.id,
        symbol=body.symbol.upper(),
        operator=body.operator,
        threshold=float(body.threshold),
        direction=body.direction,
        cooldown_s=int(body.cooldown_s),
        active=True,
        triggered_once=bool(body.one_shot),
    )
    await repo.audit(session, user_id=user.id, action="alert.create", detail={"symbol": row.symbol, "op": row.operator, "threshold": row.threshold})
    await session.commit()
    return {
        "created": True,
        "alert": {
            "id": row.id,
            "symbol": row.symbol,
            "operator": row.operator,
            "threshold": row.threshold,
            "direction": row.direction,
            "active": row.active,
            "cooldown_s": row.cooldown_s,
        },
        "note": "alerts are evaluated every few seconds against the live price cache",
    }


@router.patch("/api/alerts/{alert_id}")
async def update_alert(
    alert_id: int,
    body: AlertUpdate,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    row = await repo.alert_by_id(session, alert_id, user.id)
    if row is None:
        raise ValidationError_("alert not found")
    fields: dict[str, Any] = {}
    if body.active is not None:
        fields["active"] = body.active
        if body.active:
            fields["triggered_once"] = False
    if body.threshold is not None:
        fields["threshold"] = float(body.threshold)
    if body.operator is not None:
        fields["operator"] = body.operator
    if body.cooldown_s is not None:
        fields["cooldown_s"] = int(body.cooldown_s)
    if fields:
        await repo.update_alert(session, alert_id, user.id, **fields)
    await session.commit()
    return {"updated": True, "fields": list(fields)}


@router.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    removed = await repo.delete_alert(session, alert_id, user.id)
    await session.commit()
    return {"deleted": removed, "id": alert_id}


@router.post("/api/alerts/{alert_id}/test")
async def test_alert(alert_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    row = await repo.alert_by_id(session, alert_id, user.id)
    if row is None:
        raise ValidationError_("alert not found")
    result = await notification_service.push(
        user_id=user.id,
        kind="alert",
        title=f"Test alert: {row.symbol} {row.operator} {row.threshold:g}",
        body="This is a test notification from your trading backend.",
        data={"alert_id": row.id, "symbol": row.symbol, "test": True},
    )
    await session.commit()
    return {"sent": True, "delivery": result}


@router.get("/api/notifications")
async def notifications(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    rows = list(await repo.list_notifications(session, user.id, limit=limit))
    return {
        "count": len(rows),
        "notifications": [
            {
                "id": r.id,
                "kind": r.kind,
                "title": r.title,
                "body": r.body,
                "data": r.data,
                "channel": r.channel,
                "delivered": r.delivered,
                "created_at_ms": r.created_at_ms,
            }
            for r in rows
        ],
        "delivery": notification_service.status(),
    }


@router.post("/api/notifications/scan")
async def scan_now(request: Request, user: User = Depends(current_user), alerts: Any = Depends(get_alert_engine)) -> dict[str, Any]:
    """Force an immediate alert evaluation pass (used by the "check now" button)."""
    if alerts is None:
        return {"ok": False, "error": "alert engine not running"}
    fired = await alerts.scan_once()
    request.app.state.metrics.inc("alert.scan_manual")
    return {"ok": True, "triggered": fired, "at_ms": int(time.time() * 1000)}


def _cmp(value: float, operator: str, threshold: float) -> bool:
    from app.services.alerts import _cmp as cmp_fn

    return cmp_fn(value, operator, threshold)
