"""App settings (Screen 7): theme, locale, security, trading defaults.

Also exposes the "server info" the settings/about page shows and a full
account-deletion endpoint (GDPR style) that cascades to trades/positions.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app import APP_VERSION
from app.api.deps import current_user, rate_limit
from app.api.schemas import SettingsUpdate
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import AiSignal, AutoTradeLog, PriceAlert, Trade, User, Watchlist
from app.security import integrity

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(rate_limit)])

DEFAULT_PREFS = {
    "price_alerts": True,
    "ai_signals": True,
    "trade_confirmations": True,
    "portfolio_updates": False,
    "market_summary_daily": True,
    "sound": True,
    "ai_min_confidence": settings.AI_MIN_CONFIDENCE_PCT,
}


@router.get("")
async def get_settings(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return {
        "user": {
            "name": user.name,
            "email": user.email,
            "locale": user.locale,
            "theme": user.theme,
        },
        "trading": {
            "paper_trading": user.paper_trading,
            "risk_level": user.risk_level,
            "max_trade_size_usd": user.max_trade_size_usd,
            "daily_loss_limit_usd": user.daily_loss_limit_usd,
        },
        "security": {
            "two_factor_enabled": user.two_factor_enabled,
            "biometric_enabled": user.biometric_enabled,
            "auto_logout_minutes": 15,
            "keys_on_device": False,
            "key_provider": settings.KEY_PROVIDER,
            "integrity_mode": integrity.mode(),
        },
        "notifications": {**DEFAULT_PREFS, **(user.notification_prefs or {})},
        "exchange_credentials": await repo.count_credentials(session, user.id),
        "app": {
            "environment": settings.ENV,
            "demo_mode": settings.DEMO_MODE,
            "backend_version": APP_VERSION,
            "markets": settings.MARKETS,
            "min_order_notional_usd": settings.MIN_ORDER_NOTIONAL_USD,
            "websocket_heartbeat_s": settings.WS_HEARTBEAT_S,
        },
        "legal": {
            "disclaimer": (
                "Trading cryptocurrencies involves substantial risk. The AI signals are statistical "
                "estimates, not advice. Never trade money you cannot afford to lose."
            ),
            "not_insured": True,
        },
    }


@router.put("")
async def update_settings(
    body: SettingsUpdate,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    prefs = fields.pop("notification_prefs", None)
    if prefs is not None:
        fields["notification_prefs"] = {**DEFAULT_PREFS, **(user.notification_prefs or {}), **prefs}
    if not fields and prefs is None:
        return {"updated": False, "changed": []}
    await repo.update_user(session, user.id, **fields)
    await repo.audit(session, user_id=user.id, action="settings.update", detail={"fields": sorted(fields)})
    await session.commit()
    request.app.state.metrics.inc("settings.update")
    updated = await repo.get_user_by_id(session, user.id)
    return {"updated": True, "changed": sorted(fields), "settings": _public(updated)}


@router.get("/security")
async def security_state(user: User = Depends(current_user)) -> dict[str, Any]:
    return {
        "two_factor_enabled": user.two_factor_enabled,
        "biometric_enabled": user.biometric_enabled,
        "jwt_algorithm": settings.JWT_ALGORITHM,
        "access_token_minutes": settings.ACCESS_TOKEN_MINUTES,
        "refresh_token_days": settings.REFRESH_TOKEN_DAYS,
        "key_provider": settings.KEY_PROVIDER,
        "integrity_mode": integrity.mode(),
        "withdrawals_possible": False,
        "ssl_pinning_required_in_release": True,
        "notes": [
            "Binance secrets are stored encrypted at rest (KMS/Vault or AES-256-GCM)",
            "the app never stores exchange keys in plaintext (flutter_secure_storage)",
            "trade-only API keys are enforced; withdraw-capable keys are rejected",
        ],
    }


@router.post("/biometric")
async def toggle_biometric(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    new_value = not user.biometric_enabled
    await repo.update_user(session, user.id, biometric_enabled=new_value)
    await repo.audit(session, user_id=user.id, action="settings.biometric", detail={"enabled": new_value})
    await session.commit()
    return {"biometric_enabled": new_value}


@router.post("/paper-toggle")
async def toggle_paper(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    new_value = not user.paper_trading
    await repo.update_user(session, user.id, paper_trading=new_value)
    await session.commit()
    return {"paper_trading": new_value, "warning": None if new_value else "orders will now hit the real exchange"}


@router.delete("/account")
async def delete_account(
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Erase the account and all derived data (credentials are ciphertext-only,
    but they are deleted too).  Exchange-side trade history is immutable."""
    for model in (Trade, PriceAlert, Watchlist, AiSignal, AutoTradeLog):
        await session.execute(delete(model).where(model.user_id == user.id))
    await session.delete(user)
    await repo.audit(session, user_id=None, action="account.deleted", detail={"email": user.email})
    await session.commit()
    request.app.state.metrics.inc("account.deleted")
    return {"deleted": True}


def _public(user: User | None) -> dict[str, Any]:
    if user is None:
        return {}
    return {
        "name": user.name,
        "theme": user.theme,
        "locale": user.locale,
        "paper_trading": user.paper_trading,
        "risk_level": user.risk_level,
        "max_trade_size_usd": user.max_trade_size_usd,
        "daily_loss_limit_usd": user.daily_loss_limit_usd,
        "two_factor_enabled": user.two_factor_enabled,
        "biometric_enabled": user.biometric_enabled,
        "notification_prefs": {**DEFAULT_PREFS, **(user.notification_prefs or {})},
    }
