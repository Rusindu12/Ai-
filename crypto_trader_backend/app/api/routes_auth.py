"""Authentication + device registration endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_claims, current_user, rate_limit
from app.api.schemas import (
    BiometricUnlockRequest,
    ChangePasswordRequest,
    DeviceRegister,
    FirebaseLoginRequest,
    GoogleLoginRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SignupRequest,
    TwoFactorConfirm,
    TwoFactorDisable,
)
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import ValidationError_
from app.security import integrity
from app.security.jwt_tokens import Claims
from app.services.auth_service import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _user_payload(user: User, session: AsyncSession | None = None) -> dict[str, Any]:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "paper_trading": user.paper_trading,
        "risk_level": user.risk_level,
        "max_trade_size_usd": user.max_trade_size_usd,
        "daily_loss_limit_usd": user.daily_loss_limit_usd,
        "biometric_enabled": user.biometric_enabled,
        "two_factor_enabled": user.two_factor_enabled,
        "theme": user.theme,
        "locale": user.locale,
        "notification_prefs": user.notification_prefs or {},
        "auto_trade": {
            "enabled": user.auto_trade_enabled,
            "symbols": user.auto_trade_symbols or [],
            "kill_switch": user.auto_kill_switch,
        },
        "has_exchange_key": await repo.count_credentials(session, user.id) if session is not None else False,
        "created_at": int(user.created_at.timestamp() * 1000) if user.created_at else None,
    }


async def _register_device(session: AsyncSession, user_id: int, payload: DeviceRegister | None) -> None:
    if payload is None or not payload.device_id:
        return
    await repo.upsert_device(
        session,
        user_id,
        device_id=payload.device_id,
        platform=payload.platform,
        fcm_token=payload.fcm_token,
        app_version=payload.app_version,
    )
    if payload.integrity_token:
        result = integrity.verify(payload.integrity_token, nonce=payload.integrity_nonce or "", user_id=user_id)
        await repo.audit(session, user_id=user_id, action="integrity.verify", detail=dict(result))


@router.post("/signup", status_code=201, dependencies=[Depends(rate_limit)])
async def signup(body: SignupRequest, request: Request, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user, pair = await auth_service.signup(session, email=body.email, password=body.password, name=body.name)
    await session.commit()
    request.app.state.metrics.inc("signup")
    return {"user": await _user_payload(user, session), **pair.as_dict()}


@router.post("/login", dependencies=[Depends(rate_limit)])
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    user, pair = await auth_service.login(
        session, email=body.email, password=body.password, totp_code=body.totp_code, device_id=body.device_id
    )
    if body.device_id:
        # register the install so push notifications + biometric unlock work
        await repo.upsert_device(
            session, user.id, device_id=body.device_id, platform="android", fcm_token=None, app_version=""
        )
    await session.commit()
    response.headers["Cache-Control"] = "no-store"
    request.app.state.metrics.inc("login")
    return {"user": await _user_payload(user, session), **pair.as_dict()}


@router.post("/google", dependencies=[Depends(rate_limit)])
async def login_google(body: GoogleLoginRequest, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user, pair = await auth_service.login_with_google(session, id_token=body.id_token, device_id=body.device_id)
    await _register_device(session, user.id, DeviceRegister(device_id=body.device_id or f"google-{user.id}", platform=body.platform, app_version=body.app_version))
    await session.commit()
    return {"user": await _user_payload(user, session), **pair.as_dict()}


@router.post("/firebase", dependencies=[Depends(rate_limit)])
async def login_firebase(body: FirebaseLoginRequest, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    user, pair = await auth_service.login_with_firebase(session, firebase_token=body.firebase_token, device_id=body.device_id)
    if body.device_id:
        await repo.upsert_device(
            session, user.id, device_id=body.device_id, platform=body.platform, fcm_token=body.fcm_token, app_version=body.app_version
        )
    await session.commit()
    return {"user": await _user_payload(user, session), **pair.as_dict()}


@router.post("/biometric/unlock", dependencies=[Depends(rate_limit)])
async def biometric_unlock(body: BiometricUnlockRequest, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    pair = await auth_service.unlock_biometric(session, user_id=body.user_id, device_id=body.device_id)
    await session.commit()
    return pair.as_dict()


@router.post("/refresh")
async def refresh(body: RefreshRequest, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    pair = await auth_service.refresh(session, body.refresh_token, device_id=body.device_id)
    await session.commit()
    return pair.as_dict()


@router.post("/logout")
async def logout(
    body: LogoutRequest | None = None,
    user: User = Depends(current_user),
    claims: Claims = Depends(current_claims),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    await auth_service.logout(session, user_id=user.id, refresh_token=body.refresh_token if body else None, claims=claims)
    await session.commit()
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(
    user: User = Depends(current_user), claims: Claims = Depends(current_claims), session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    await auth_service.logout_everywhere(session, user_id=user.id, claims=claims)
    await session.commit()
    return {"ok": True, "note": "all refresh tokens revoked"}


@router.get("/me")
async def me(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return await _user_payload(user, session)


@router.post("/password")
async def change_password(
    body: ChangePasswordRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    result = await auth_service.change_password(
        session, user, current=body.current_password, new=body.new_password, confirm=body.confirm_password
    )
    await session.commit()
    return result


@router.post("/2fa/setup")
async def setup_2fa(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    payload = await auth_service.setup_2fa(session, user)
    await session.commit()
    return payload


@router.post("/2fa/enable")
async def enable_2fa(body: TwoFactorConfirm, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    result = await auth_service.enable_2fa(session, user, code=body.code)
    await session.commit()
    return result


@router.post("/2fa/disable")
async def disable_2fa(body: TwoFactorDisable, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    result = await auth_service.disable_2fa(session, user, password=body.password)
    await session.commit()
    return result


@router.post("/devices")
async def register_device(body: DeviceRegister, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await _register_device(session, user.id, body)
    if body.integrity_token and integrity.mode() != "disabled":
        result = integrity.verify(body.integrity_token, nonce=body.integrity_nonce, user_id=user.id)
        if not result.ok:
            raise ValidationError_(f"device integrity check failed: {result.get('reason')}")
        await repo.update_user(session, user.id)
    await session.commit()
    return {"registered": True, "device_id": body.device_id, "integrity_mode": integrity.mode()}


@router.post("/integrity/nonce")
async def integrity_nonce(user: User = Depends(current_user)) -> dict[str, Any]:
    """Fetch a single-use nonce for the Play Integrity request on the device."""
    return {"nonce": integrity.issue_nonce(user.id), "ttl_s": 300, "mode": integrity.mode()}


@router.get("/config")
async def auth_config() -> dict[str, Any]:
    """Public boot config the app needs before it can log in."""
    return {
        "app": settings.APP_NAME,
        "environment": settings.ENV,
        "demo_mode": settings.DEMO_MODE,
        "paper_trading_default": settings.PAPER_TRADING_DEFAULT,
        "markets": settings.MARKETS,
        "intervals": ["1m", "5m", "15m", "1h", "4h", "1d"],
        "access_token_minutes": settings.ACCESS_TOKEN_MINUTES,
        "refresh_token_days": settings.REFRESH_TOKEN_DAYS,
        "auto_logout_minutes": 15,
        "min_notional_usd": settings.MIN_ORDER_NOTIONAL_USD,
        "google_web_client_id": settings.GOOGLE_WEB_CLIENT_ID or None,
        "firebase_enabled": bool(settings.FIREBASE_CREDENTIALS_PATH),
        "integrity_mode": integrity.mode(),
        "key_provider": settings.KEY_PROVIDER,
        "features": {
            "websocket": True,
            "socketio": settings.ENABLE_SOCKETIO,
            "push": settings.FCM_ENABLED,
            "biometric": True,
            "csv_export": True,
        },
    }
