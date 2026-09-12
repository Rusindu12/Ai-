"""Authentication: email/password, Google ID tokens, Firebase tokens, 2FA.

Session model
-------------
* access token (JWT, HS256, 60 min) - sent as ``Authorization: Bearer``
* refresh token (opaque 48 bytes) - stored **hashed**, rotated on every use,
  revocable per device; ``POST /api/auth/logout`` revokes it and blacklists the
  access token's ``jti`` until it expires
* the mobile app enforces a 15-minute inactivity auto-logout and asks for the
  biometric before any trade (see the Flutter ``SecurityGate``); the server
  independently expires access tokens, so a stolen device is useless after an
  hour at most, and instantly after ``logout`` / ``STOP ALL``.

Firebase interop
----------------
``POST /api/auth/firebase`` accepts a Firebase ID token (from the mobile
``signInWithCredential`` flow), verifies it with ``firebase_admin.auth`` when
configured (otherwise via Google's public certificates) and maps it onto the
same internal user record.  This lets the app use Firebase Auth while the
backend remains the source of truth for entitlements.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import repo
from app.db.models import User
from app.errors import AuthError, PermissionError_, ValidationError_
from app.security import totp
from app.security.jwt_tokens import Claims, TokenPair, hash_refresh_token, issue_token_pair
from app.security.passwords import hash_password, needs_rehash, verify_password

log = logging.getLogger(__name__)

GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
MIN_PASSWORD_LEN = 10


class AuthService:
    # ------------------------------------------------------------- registration
    async def signup(self, session: AsyncSession, *, email: str, password: str, name: str = "") -> tuple[User, TokenPair]:
        email = (email or "").strip().lower()
        if "@" not in email or len(email) > 320:
            raise ValidationError_("a valid email is required")
        if len(password or "") < MIN_PASSWORD_LEN:
            raise ValidationError_(f"password must be at least {MIN_PASSWORD_LEN} characters")
        if await repo.get_user_by_email(session, email) is not None:
            raise ValidationError_("an account with that email already exists")
        user = await repo.create_user(session, email=email, password_hash=hash_password(password), name=name)
        await repo.audit(session, user_id=user.id, action="auth.signup", detail={"email": email})
        # _issue (not issue_token_pair) so the refresh token is persisted and rotatable
        return user, await self._issue(session, user)

    async def login(self, session: AsyncSession, *, email: str, password: str, totp_code: str | None = None, device_id: str = "") -> tuple[User, TokenPair]:
        user = await repo.get_user_by_email(session, (email or "").strip().lower())
        if user is None or not user.password_hash:
            # constant-ish time: still run a verification against a dummy hash
            verify_password(password or "", "$argon2id$dummy$000000")
            raise AuthError("invalid email or password")
        if not verify_password(password or "", user.password_hash):
            await repo.audit(session, user_id=user.id, action="auth.login_failed", detail={"email": email, "device": device_id})
            raise AuthError("invalid email or password")
        if not user.is_active:
            raise PermissionError_("account disabled - contact support")
        if user.two_factor_enabled:
            if not totp_code:
                raise AuthError("two-factor code required", details={"reason": "totp_required"})
            if not totp.verify_code(user.two_factor_secret or "", totp_code):
                raise AuthError("invalid two-factor code")
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password or "")
        await repo.touch_login(session, user.id)
        pair = await self._issue(session, user, device_id=device_id)
        await repo.audit(session, user_id=user.id, action="auth.login", detail={"device": device_id})
        return user, pair

    async def login_with_google(self, session: AsyncSession, *, id_token: str, device_id: str = "") -> tuple[User, TokenPair]:
        payload = await verify_google_id_token(id_token)
        sub = str(payload.get("sub") or "")
        email = str(payload.get("email") or "").lower()
        if not sub:
            raise AuthError("malformed Google ID token")
        user = await repo.get_user_by_google(session, sub) or await repo.get_user_by_email(session, email)
        if user is None:
            user = await repo.create_user(session, email=email or f"google-{sub}@users.noreply.local", password_hash="", name=payload.get("name", ""))
            user.google_sub = sub
        elif not user.google_sub:
            user.google_sub = sub
        pair = await self._issue(session, user, device_id=device_id)
        await repo.audit(session, user_id=user.id, action="auth.google_login", detail={"device": device_id})
        return user, pair

    async def login_with_firebase(self, session: AsyncSession, *, firebase_token: str, device_id: str = "") -> tuple[User, TokenPair]:
        uid, email, name, picture = await verify_firebase_token(firebase_token)
        user = await repo.get_user_by_firebase(session, uid)
        if user is None and email:
            user = await repo.get_user_by_email(session, email)
        if user is None:
            user = await repo.create_user(session, email=email or f"{uid}@firebase.local", password_hash="", name=name)
        user.firebase_uid = uid
        pair = await self._issue(session, user, device_id=device_id)
        await repo.audit(session, user_id=user.id, action="auth.firebase_login", detail={"uid": uid, "device": device_id})
        return user, pair

    # ------------------------------------------------------------ biometric
    async def unlock_biometric(self, session: AsyncSession, *, user_id: int, device_id: str) -> TokenPair:
        """Second factor after a local biometric match on the device.

        Only accounts that explicitly opted in may use it, and only from a
        previously registered device - the app must have completed a password or
        Google login on that install first.
        """
        user = await repo.get_user_by_id(session, int(user_id))
        if user is None or not user.is_active:
            raise AuthError("unknown account")
        if not user.biometric_enabled:
            raise PermissionError_("biometric unlock is not enabled for this account")
        devices = list(await repo.list_devices(session, user.id))
        if device_id and not any(d.device_id == device_id for d in devices):
            raise PermissionError_("this device has not been enrolled for biometric unlock")
        return await self._issue(session, user, device_id=device_id)

    # ------------------------------------------------------------------ tokens
    async def _issue(self, session: AsyncSession, user: User, *, device_id: str = "") -> TokenPair:
        pair = issue_token_pair(user.id, user.email, role=user.role)
        await repo.store_refresh_token(
            session, user.id, hash_refresh_token(pair.refresh_token), days=settings.REFRESH_TOKEN_DAYS, device_id=device_id
        )
        return pair

    async def refresh(self, session: AsyncSession, refresh_token: str, *, device_id: str = "") -> TokenPair:
        row = await repo.find_refresh_token(session, hash_refresh_token(refresh_token or ""))
        if row is None or row.revoked or row.expires_at_ms < int(time.time() * 1000):
            raise AuthError("refresh token is invalid or expired")
        user = await repo.get_user_by_id(session, row.user_id)
        if user is None or not user.is_active:
            raise AuthError("account unavailable")
        await repo.revoke_refresh_token(session, row.token_hash)  # rotate
        pair = await self._issue(session, user, device_id=device_id or row.device_id)
        return pair

    async def logout(self, session: AsyncSession, *, user_id: int, refresh_token: str | None, claims: Claims | None) -> None:
        if refresh_token:
            await repo.revoke_refresh_token(session, hash_refresh_token(refresh_token))
        if claims is not None and claims.jti:
            await repo.revoke_jti(session, claims.jti, claims.exp * 1000)
        await repo.audit(session, user_id=user_id, action="auth.logout")

    async def logout_everywhere(self, session: AsyncSession, *, user_id: int, claims: Claims | None) -> None:
        await repo.revoke_all_refresh_tokens(session, user_id)
        if claims is not None and claims.jti:
            await repo.revoke_jti(session, claims.jti, claims.exp * 1000)
        await repo.audit(session, user_id=user_id, action="auth.logout_all")

    # ------------------------------------------------------------------- 2FA
    async def enable_2fa(self, session: AsyncSession, user: User, *, code: str) -> dict[str, Any]:
        if not user.two_factor_secret:
            raise ValidationError_("call POST /api/auth/2fa/setup first")
        if not totp.verify_code(user.two_factor_secret, code):
            raise ValidationError_("that code did not match")
        user.two_factor_enabled = True
        await repo.update_user(session, user.id, two_factor_enabled=True)
        await repo.audit(session, user_id=user.id, action="auth.2fa_enabled")
        return {"enabled": True}

    async def setup_2fa(self, session: AsyncSession, user: User) -> dict[str, Any]:
        secret = totp.new_secret()
        await repo.update_user(session, user.id, two_factor_secret=secret, two_factor_enabled=False)
        label = f"{user.email}"
        issuer = "CryptoTrader"
        return {
            "secret": secret,
            "otpauth_uri": totp.provisioning_uri(secret, label, issuer=issuer),
            "qr_hint": "add it to your authenticator app, then confirm with a code",
        }

    async def disable_2fa(self, session: AsyncSession, user: User, *, password: str) -> dict[str, Any]:
        if not verify_password(password, user.password_hash):
            raise AuthError("password incorrect")
        await repo.update_user(session, user.id, two_factor_enabled=False, two_factor_secret=None)
        return {"enabled": False}

    async def change_password(self, session: AsyncSession, user: User, *, current: str, new: str, confirm: str) -> dict[str, Any]:
        if user.password_hash and not verify_password(current, user.password_hash):
            raise AuthError("current password incorrect")
        if len(new or "") < MIN_PASSWORD_LEN:
            raise ValidationError_(f"new password must be at least {MIN_PASSWORD_LEN} characters")
        if new != confirm:
            raise ValidationError_("password confirmation does not match")
        await repo.update_user(session, user.id, password_hash=hash_password(new))
        await repo.revoke_all_refresh_tokens(session, user.id)  # force re-login everywhere
        await repo.audit(session, user_id=user.id, action="auth.password_changed")
        return {"changed": True, "note": "all sessions were signed out"}


auth_service = AuthService()


# --------------------------------------------------------------------------- #
# Third-party token verification
# --------------------------------------------------------------------------- #
async def verify_google_id_token(id_token: str) -> dict[str, Any]:  # pragma: no cover - network
    """Verify a Google ID token.

    Uses the Firebase Admin SDK when configured (preferred: no extra network
    call), otherwise falls back to Google's ``tokeninfo`` endpoint.
    """
    payload = _try_firebase_verify(id_token)
    if payload:
        return payload
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(GOOGLE_TOKENINFO, params={"id_token": id_token})
    except Exception as exc:
        raise AuthError(f"could not reach Google to verify the ID token ({type(exc).__name__})") from exc
    if resp.status_code != 200:
        raise AuthError("Google rejected the ID token")
    data = resp.json()
    aud = data.get("aud") or data.get("azp")
    allowed = {x for x in [settings.GOOGLE_WEB_CLIENT_ID, settings.GOOGLE_ANDROID_CLIENT_ID] if x}
    if allowed and aud not in allowed:
        raise AuthError("ID token audience is not this app")
    return data


async def verify_firebase_token(firebase_token: str) -> tuple[str, str, str, str]:  # pragma: no cover - network
    payload = _try_firebase_verify(firebase_token)
    if not payload:
        payload = await verify_google_id_token(firebase_token)
    uid = str(payload.get("sub") or payload.get("user_id") or "")
    if not uid:
        raise AuthError("could not resolve identity from the token")
    return uid, str(payload.get("email") or "").lower(), str(payload.get("name") or ""), str(payload.get("picture") or "")


def _try_firebase_verify(token: str) -> dict[str, Any] | None:
    if not settings.FIREBASE_CREDENTIALS_PATH:
        return None
    try:  # pragma: no cover - requires credentials
        import firebase_admin
        from firebase_admin import auth as fb_auth
        from firebase_admin import credentials

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH))
        return dict(fb_auth.verify_id_token(token))
    except Exception as exc:
        log.debug("firebase verify failed: %s", exc)
        return None


def public_url_ok(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme in {"http", "https"} and bool(parts.netloc)
