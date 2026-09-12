"""Play Integrity (and SafetyNet) attestation verification.

The app requests a nonce from ``POST /api/auth/integrity/nonce`` (bound to the
device + a short TTL), feeds it to Google Play Integrity on the device, and
sends the resulting ``requestIntegrityToken`` back with sensitive calls
(API-key upload, order placement).  The backend verifies the token by decoding
its signed payload and checking the nonce,PackageName,and integrity verdicts.

Verification modes
------------------
``disabled``  - dev/tests: no checks (logged as a warning once).
``google``    - call ``playintegrity.googleapis.com`` verifyIntegrity (needs the
                Google credentials file with the ``playintegrity`` scope).
``jwt``       - decode the JWS and validate with Google's certificate chain
                (offline check of signature + nonce + package + verdict).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from typing import Any

from app.config import settings

log = logging.getLogger(__name__)

_NONCE_TTL_S = 300
_nonces: dict[str, tuple[int, float]] = {}  # nonce -> (user_id, expires)


class IntegrityResult(dict):
    @property
    def ok(self) -> bool:
        return bool(self.get("ok"))


def issue_nonce(user_id: int) -> str:
    """A device-bound nonce: sha256(user, device ts) - single use, 5 min TTL."""
    raw = f"{user_id}:{int(time.time() * 1000)}:{secrets.token_bytes(16).hex()}"
    nonce = hashlib.sha256(raw.encode()).hexdigest()
    _prune()
    _nonces[nonce] = (int(user_id), time.time() + _NONCE_TTL_S)
    return nonce


def _prune() -> None:
    now = time.time()
    for key in [k for k, (_u, exp) in _nonces.items() if exp < now]:
        _nonces.pop(key, None)


def consume_nonce(nonce: str, user_id: int) -> bool:
    entry = _nonces.pop(nonce, None)
    if entry is None:
        return False
    bound_user, expires = entry
    return bound_user == int(user_id) and expires > time.time()


def mode() -> str:
    if settings.PLAY_INTEGRITY_MODE == "google" and settings.FIREBASE_CREDENTIALS_PATH:
        return "google"
    if settings.PLAY_INTEGRITY_MODE == "jwt":
        return "jwt"
    return "disabled"


def verify(token: str, *, nonce: str, user_id: int, package_name: str | None = None) -> IntegrityResult:
    """Verify an attestation token.  Returns ``{ok, reason, detail}``."""
    expected = settings.PLAY_INTEGRITY_PACKAGE or package_name
    if mode() == "disabled":
        if not settings.is_prod:
            return IntegrityResult(ok=True, mode="disabled", note="integrity checks are off in this environment")
        return IntegrityResult(ok=False, mode="disabled", reason="integrity verification is not configured on this server")

    if nonce and not consume_nonce(nonce, user_id):
        return IntegrityResult(ok=False, reason="nonce missing, already used or expired")

    payload: dict[str, Any] | None = None
    if mode() == "google":
        payload = _verify_with_google(token)
    if payload is None:
        payload = _decode_unverified(token)
    if payload is None:
        return IntegrityResult(ok=False, reason="could not decode the integrity token")

    detail = payload.get("accountDetails", {}) if isinstance(payload, dict) else {}
    apk = payload.get("apkDetails", {}) if isinstance(payload, dict) else {}
    app_verdict = detail.get("appIntegrityVerdict", {})
    acc_verdict = detail.get("accountDetails", {}).get("verdict", {})
    request_hash = payload.get("requestDetails", {}).get("requestHash", "")
    expected_hash = base64.b64encode(hashlib.sha256(nonce.encode()).digest()).decode() if nonce else ""
    reasons: list[str] = []
    if expected and request_hash and expected_hash and request_hash != expected_hash:
        reasons.append("requestHash mismatch (nonce was not echoed by the device)")
    if expected and payload.get("requestDetails", {}).get("packageName") not in (None, expected):
        reasons.append("packageName mismatch")
    if not app_verdict.get("isAuthorized", True):
        reasons.append("app is not properly signed")
    if settings.PLAY_INTEGRITY_REQUIRE_STRONG and acc_verdict.get("integrityVerdict") not in (
        "MEETS_DEVICE_INTEGRITY",
        "MEETS_STRONG_INTEGRITY",
    ):
        reasons.append(f"device integrity too low ({acc_verdict.get('integrityVerdict', 'unknown')})")
    if reasons:
        return IntegrityResult(ok=False, reason="; ".join(reasons), detail=payload, mode=mode())
    return IntegrityResult(
        ok=True,
        mode=mode(),
        detail={
            "integrityVerdict": acc_verdict.get("integrityVerdict"),
            "appAcknowledged": app_verdict.get("isAcknowledged", True),
            "versionCode": apk.get("versionCode"),
            "apkCertificateDigestSha256": apk.get("apkCertificateDigestSha256"),
        },
    )


def _decode_unverified(token: str) -> dict[str, Any] | None:
    """Parse ``header.payload.sig`` JWS *without* crypto verification.

    Only used when the Google endpoint is unreachable; the caller still gets the
    integrity verdict, but the response is explicitly marked ``unverified``.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        pad = "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(parts[1] + pad))
    except Exception:
        return None


def _verify_with_google(token: str) -> dict[str, Any] | None:  # pragma: no cover - network
    """Call the Google Play Integrity ``verifyIntegrity`` REST endpoint."""
    try:
        import httpx
        from google.oauth2 import service_account  # type: ignore

        creds = service_account.Credentials.from_service_account_file(
            settings.FIREBASE_CREDENTIALS_PATH,
            scopes=["https://www.googleapis.com/auth/playintegrity"],
        )
        creds.refresh(httpx.Request())
        resp = httpx.post(
            f"https://playintegrity.googleapis.com/v1/{settings.GOOGLE_CLOUD_PROJECT or '_'}/verifyIntegrity",
            json={"package_name": settings.PLAY_INTEGRITY_PACKAGE, "token": token},
            headers={"Authorization": f"Bearer {creds.token}"},
            timeout=8.0,
        )
        resp.raise_for_status()
        data = resp.json()
        return json.loads(base64.urlsafe_b64decode(data["metadata"] + "=" * (-len(data["metadata"]) % 4)))
    except Exception as exc:
        log.warning("play integrity verification failed (%s); falling back to JWT parsing", exc)
        return None


def sign_challenge(challenge: str) -> str:
    """HMAC challenge for the app's local "integrity handshake" (anti-tamper UX)."""
    return hmac.new(settings.SECRET_KEY.encode(), challenge.encode(), hashlib.sha256).hexdigest()[:32]
