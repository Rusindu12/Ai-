"""JWT access / refresh token issuing and verification.

Access tokens are short lived (default 60 min) and carry ``sub`` (user id),
``email``, ``role`` and a ``jti`` used for revocation.  Refresh tokens are long
lived, stored (hashed) server side and rotated on use.
"""

from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import jwt

from app.config import settings
from app.errors import AuthError


@dataclass(slots=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "Bearer"

    def as_dict(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_in": self.expires_in,
            "token_type": self.token_type,
        }


@dataclass(slots=True)
class Claims:
    sub: str
    email: str
    role: str
    jti: str
    exp: int
    iat: int
    type: str = "access"
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def user_id(self) -> int:
        try:
            return int(self.sub)
        except (TypeError, ValueError):
            raise AuthError("malformed subject claim") from None


def _sign(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def issue_access_token(
    user_id: int | str,
    email: str,
    *,
    role: str = "user",
    ttl_minutes: int | None = None,
    extra: dict[str, Any] | None = None,
) -> tuple[str, int, str]:
    ttl = int(ttl_minutes if ttl_minutes is not None else settings.ACCESS_TOKEN_MINUTES)
    now = int(time.time())
    jti = uuid.uuid4().hex
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "jti": jti,
        "iss": settings.ISSUER,
        "aud": settings.AUDIENCE,
        "iat": now,
        "exp": now + ttl * 60,
        "typ": "access",
    }
    if extra:
        payload.update(extra)
    return _sign(payload), ttl * 60, jti


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token_pair(
    user_id: int | str, email: str, *, role: str = "user", extra: dict[str, Any] | None = None
) -> TokenPair:
    access, expires_in, _jti = issue_access_token(user_id, email, role=role, extra=extra)
    return TokenPair(access_token=access, refresh_token=new_refresh_token(), expires_in=expires_in)


def decode_token(token: str, *, expected_type: str = "access") -> Claims:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            audience=settings.AUDIENCE,
            issuer=settings.ISSUER,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError("invalid token") from exc
    if payload.get("typ", expected_type) != expected_type:
        raise AuthError(f"wrong token type (expected {expected_type})")
    return Claims(
        sub=str(payload["sub"]),
        email=payload.get("email", ""),
        role=payload.get("role", "user"),
        jti=payload.get("jti", ""),
        exp=int(payload.get("exp", 0)),
        iat=int(payload.get("iat", 0)),
        type=expected_type,
        extra={k: v for k, v in payload.items() if k not in {
            "sub", "email", "role", "jti", "exp", "iat", "typ", "iss", "aud"
        }},
    )


def verify_internal_token(token: str) -> dict[str, Any]:
    """Verify a token minted for machine-to-machine calls (health/metrics)."""
    return decode_token(token, expected_type="internal").__dict__
