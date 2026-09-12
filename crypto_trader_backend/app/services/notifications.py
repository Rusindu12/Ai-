"""Push / in-app notification delivery.

Channels
--------
* **FCM** (``firebase-admin``) when ``FCM_ENABLED`` + a service account file are
  configured - used for price alerts, AI signals and trade confirmations.
* **Firestore mirror** so the app can render history even when offline.
* **WebSocket** fan-out for the connected app (instant, no push permission needed).
* **DB log** - always written; powers the "Alerts & Notifications" screen.

If Firebase is not configured the service degrades to WS + DB and logs a single
startup warning, which keeps CI/dev runs dependency free.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.config import settings
from app.db import repo
from app.db.base import session_scope

log = logging.getLogger(__name__)

_firebase_ready = False
_firebase_tried = False
_lock = asyncio.Lock()


def _init_firebase() -> bool:
    global _firebase_ready, _firebase_tried
    if _firebase_tried:
        return _firebase_ready
    _firebase_tried = True
    path = settings.FIREBASE_CREDENTIALS_PATH
    if not (settings.FCM_ENABLED or settings.FIRESTORE_ENABLED) or not path:
        log.info("firebase disabled (set FIREBASE_CREDENTIALS_PATH + FCM_ENABLED=true to enable push)")
        return False
    try:  # pragma: no cover - requires credentials
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(path))
        _firebase_ready = True
        log.info("firebase admin initialised (FCM=%s Firestore=%s)", settings.FCM_ENABLED, settings.FIRESTORE_ENABLED)
    except Exception as exc:
        log.warning("firebase init failed (%s) - falling back to websocket-only notifications", exc)
        _firebase_ready = False
    return _firebase_ready


class NotificationService:
    def __init__(self) -> None:
        self.hub: Any = None
        self.sent = 0
        self.failed = 0
        self.last_error: str = ""

    def attach_hub(self, hub: Any) -> None:
        self.hub = hub

    # ----------------------------------------------------------------- sending
    async def push(
        self,
        *,
        user_id: int,
        kind: str,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
        session_needed: bool = False,
        store: bool = True,
        session: Any = None,
    ) -> dict[str, Any]:
        """Log + deliver a notification.  Never raises (called from hot paths)."""
        payload = {"kind": kind, "title": title, "body": body, "data": data or {}}
        result: dict[str, Any] = {"logged": False, "fcm": "skipped", "ws": False}

        async def _deliver(session: Any) -> None:
            if store:
                await repo.log_notification(
                    session, user_id=user_id, kind=kind, title=title, body=body, data=payload["data"], channel="log"
                )
                result["logged"] = True
                if _firebase_ready and settings.FIRESTORE_ENABLED:
                    await asyncio.to_thread(_firestore_mirror, user_id, payload)
            devices = list(await repo.list_devices(session, user_id)) if store else []
            tokens = [d.fcm_token for d in devices if d.fcm_token]
            if tokens and settings.FCM_ENABLED and _init_firebase():
                result["fcm"] = await asyncio.to_thread(_send_fcm, tokens, title, body, payload["data"])
            if self.hub is not None:
                await self.hub.broadcast_to_user({"type": "notification", "data": {"user_id": user_id, **payload}}, user_id)
                result["ws"] = True

        try:
            if session is not None:
                # join the caller's transaction: avoids a second writer on SQLite
                await _deliver(session)
            else:
                async with session_scope() as own:
                    await _deliver(own)
            self.sent += 1
        except Exception as exc:  # pragma: no cover - depends on db/firebase
            self.failed += 1
            self.last_error = f"{type(exc).__name__}: {exc}"
            log.warning("notification delivery failed: %s", self.last_error)
        return result

    async def broadcast_market(self, *, kind: str, title: str, body: str, data: dict[str, Any]) -> None:
        if self.hub is None:
            return
        for uid in self.hub.connected_user_ids():
            await self.push(user_id=uid, kind=kind, title=title, body=body, data=data, store=False)

    def status(self) -> dict[str, Any]:
        return {
            "fcm_enabled": bool(settings.FCM_ENABLED and _firebase_ready),
            "firestore_enabled": bool(settings.FIRESTORE_ENABLED and _firebase_ready),
            "websocket_enabled": self.hub is not None,
            "sent": self.sent,
            "failed": self.failed,
            "last_error": self.last_error,
        }


def _send_fcm(tokens: list[str], title: str, body: str, data: dict[str, Any]) -> str:  # pragma: no cover
    try:
        from firebase_admin import messaging

        msgs = [
            messaging.Message(
                notification=messaging.Notification(title=title, body=body),
                data={k: str(v) for k, v in data.items()},
                android=messaging.AndroidConfig(
                    priority="high",
                    notification=messaging.AndroidNotification(channel_id="cryptotrader_alerts", importance=messaging.NotificationImportance.HIGH),
                ),
                token=t,
            )
            for t in tokens
        ]
        resp = messaging.send_each(msgs, validate_only=False)
        return f"sent={resp.success_count} failed={len(resp.errors)}"
    except Exception as exc:
        log.warning("FCM send failed: %s", exc)
        return f"error:{type(exc).__name__}"


def _firestore_mirror(user_id: int, payload: dict[str, Any]) -> None:  # pragma: no cover
    try:
        import firebase_admin
        from firebase_admin import firestore

        db = firestore.client() if firebase_admin._apps else None
        if db is None:
            return
        db.collection("users").document(str(user_id)).collection("notifications").add(
            {**payload, "created_at_ms": _now_ms()}
        )
    except Exception as exc:
        log.debug("firestore mirror failed: %s", exc)


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


notification_service = NotificationService()

