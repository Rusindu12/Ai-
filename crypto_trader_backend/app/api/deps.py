"""Shared FastAPI dependencies: auth, rate limiting, service access."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

from fastapi import Depends, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import AuthError, PermissionError_, RateLimitedError
from app.security.jwt_tokens import Claims, decode_token

# ---------------------------------------------------------------- rate limits
_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def _sliding_window(key: str, limit: int, window_s: float = 60.0) -> None:
    now = time.monotonic()
    bucket = _BUCKETS[key]
    while bucket and now - bucket[0] > window_s:
        bucket.popleft()
    if len(bucket) >= limit:
        raise RateLimitedError(f"rate limit exceeded ({limit}/min)", retry_after_s=max(0.2, window_s - (now - bucket[0])))
    bucket.append(now)


def reset_rate_limits() -> None:  # pragma: no cover - test helper
    _BUCKETS.clear()


async def rate_limit(request: Request) -> None:
    key = f"{request.client.host if request.client else 'anon'}|{request.method}"
    _sliding_window(key, settings.RATE_LIMIT_PER_MIN)


async def rate_limit_orders(request: Request) -> None:
    key = f"orders|{(request.headers.get('authorization') or '')[-16:]}"
    _sliding_window(key, settings.ORDER_RATE_LIMIT_PER_MIN)


# ----------------------------------------------------------------------- auth
def _extract_token(authorization: str | None, access_token: str | None = None) -> str:
    if authorization:
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
        if len(parts) == 1:
            return parts[0]
    if access_token:
        return access_token
    raise AuthError("missing bearer token")


async def current_claims(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_token: str | None = Header(default=None, alias="X-Token"),
    access_token: str | None = Query(default=None, alias="access_token"),
    session: AsyncSession = Depends(get_session),
) -> Claims:
    claims = decode_token(_extract_token(authorization or x_token, access_token))
    if claims.jti and await repo.is_jti_revoked(session, claims.jti):
        raise AuthError("token revoked")
    return claims


async def current_user(
    claims: Claims = Depends(current_claims), session: AsyncSession = Depends(get_session)
) -> User:
    user = await repo.get_user_by_id(session, claims.user_id)
    if user is None:
        raise AuthError("account not found")
    if not user.is_active:
        raise PermissionError_("account disabled")
    user.token_claims = claims  # type: ignore[attr-defined]
    return user


async def optional_user(
    authorization: str | None = Header(default=None, alias="Authorization"),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    if not authorization:
        return None
    try:
        claims = decode_token(_extract_token(authorization))
    except AuthError:
        return None
    if claims.jti and await repo.is_jti_revoked(session, claims.jti):
        return None
    return await repo.get_user_by_id(session, claims.user_id)


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise PermissionError_("admin role required")
    return user


async def get_hub(request: Request) -> Any:
    return request.app.state.hub


async def get_realtime(request: Request) -> Any:
    return request.app.state.realtime


async def get_trading(request: Request) -> Any:
    return request.app.state.trading


async def get_portfolio(request: Request) -> Any:
    return request.app.state.portfolio


async def get_auto_trader(request: Request) -> Any:
    return request.app.state.auto_trader


async def get_alert_engine(request: Request) -> Any:
    return request.app.state.alerts
