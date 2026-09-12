"""Binance API key management.

The mobile app encrypts the key pair with a per-request AES-GCM session key
wrapped in the backend RSA public key (``GET /api/keys/handshake``) before
sending.  The backend decrypts it, validates the key against Binance (it MUST be
trade-only - withdraw-capable keys are refused), re-encrypts with the KMS/Vault
master key and stores ciphertext only.

Plaintext never touches the database, logs or Firestore.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.api.schemas import KeyRotateRequest, KeySubmitRequest
from app.config import settings
from app.db import repo
from app.db.base import get_session
from app.db.models import User
from app.errors import PermissionError_, ValidationError_
from app.security import integrity
from app.security.crypto import decrypt_envelope, decrypt_secret, encrypt_secret, fingerprint_of, get_handshake_keys
from app.services import accounts
from app.services.gateway import get_gateway

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/keys", tags=["keys"])


@router.get("/handshake")
async def handshake() -> dict[str, Any]:
    """Public RSA key for the app's hybrid envelope encryption."""
    keys = get_handshake_keys()
    return {
        "algorithm": "RSA-OAEP-256 + AES-256-GCM",
        "public_key_pem": keys.public_pem_str(),
        "key_format": "PKCS#1 (BEGIN RSA PUBLIC KEY)",
        "usage": "encrypt a random 32-byte AES key with this RSA key, AES-GCM the JSON payload, POST the envelope",
    }


@router.post("/binance", status_code=201)
async def submit_key(
    body: KeySubmitRequest,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    if settings.REQUIRE_INTEGRITY_FOR_KEYS and settings.is_prod:
        result = integrity.verify(
            request.headers.get("X-Integrity-Token", ""),
            nonce=request.headers.get("X-Integrity-Nonce", ""),
            user_id=user.id,
        )
        if not result.ok:
            raise PermissionError_(f"device integrity check failed: {result.get('reason', 'not verified')}")

    api_key, api_secret = _resolve_payload(body)
    if len(api_key) < 16 or len(api_secret) < 16:
        raise ValidationError_("Binance API keys look too short - copy them again from the exchange console")

    gateway = await get_gateway()
    warnings: list[str] = []
    perms: dict[str, Any] = {"can_trade": True, "can_withdraw": False, "ip_restricted": False, "checked": False}
    if getattr(gateway, "is_simulated", False):
        warnings.append("backend is in DEMO_MODE - keys are stored, but the simulator handles trading")
    else:
        creds = accounts.UserCreds(api_key, api_secret, user_id=user.id, label=body.label, testnet=body.is_testnet)
        try:
            perms = await gateway.api_permissions(creds)
        except Exception as exc:
            raise ValidationError_(f"could not validate these keys against Binance: {exc}") from exc
        if perms.get("can_withdraw"):
            raise PermissionError_(
                "this API key has WITHDRAW permission - revoke it and create a trade-only key (refused by policy)",
                details={"permissions": perms},
            )
        if not perms.get("can_trade", True):
            raise PermissionError_("this API key cannot place trades")
        if not perms.get("ip_restricted", True):
            warnings.append("key is not IP-restricted - add the server's egress IP in the Binance console")

    aad = str(user.id).encode()
    cred = await repo.save_credential(
        session,
        user.id,
        api_key_enc=encrypt_secret(api_key, aad=aad),
        secret_enc=encrypt_secret(api_secret, aad=aad),
        key_fp=fingerprint_of(api_key),
        label=body.label,
        can_trade=bool(perms.get("can_trade", True)),
        can_withdraw=bool(perms.get("can_withdraw", False)),
        ip_restricted=bool(perms.get("ip_restricted", True)),
        is_testnet=body.is_testnet,
    )
    await repo.mark_credential_checked(session, cred.id, ok=True, perms=perms)
    await repo.audit(session, user_id=user.id, action="keys.save", detail={"label": body.label, "fp": cred.key_fp, "testnet": body.is_testnet})
    await session.commit()

    return {
        "stored": True,
        "credential": accounts.credential_public_view(cred),
        "permissions": perms,
        "delete_local_copy": body.delete_local,
        "warnings": warnings,
        "security_note": "plaintext was held in memory for this request only; storage keeps ciphertext",
    }


@router.get("")
async def list_keys(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    creds = list(await repo.list_credentials(session, user.id))
    return {
        "count": len(creds),
        "keys": [accounts.credential_public_view(c) for c in creds],
        "demo_mode": settings.DEMO_MODE,
        "key_provider": settings.KEY_PROVIDER,
        "policy": {"withdraw_keys_rejected": True, "plaintext_at_rest": False},
    }


@router.patch("/{credential_id}")
async def rotate(
    credential_id: int, body: KeyRotateRequest, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> dict[str, Any]:
    creds = list(await repo.list_credentials(session, user.id))
    cred = next((c for c in creds if c.id == credential_id), None)
    if cred is None:
        raise ValidationError_("credential not found")
    if body.is_active is not None:
        cred.is_active = body.is_active
    if body.new_label:
        cred.label = body.new_label
    await session.flush()
    await session.commit()
    return {"updated": True, "credential": accounts.credential_public_view(cred)}


@router.delete("/{credential_id}")
async def delete(credential_id: int, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await repo.delete_credential(session, credential_id, user.id)
    await repo.audit(session, user_id=user.id, action="keys.delete", detail={"credential_id": credential_id})
    await session.commit()
    return {"deleted": True, "id": credential_id}


@router.post("/verify")
async def verify_existing(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Round-trip the stored credential against the exchange (read-only check)."""
    cred = await repo.get_active_credential(session, user.id)
    if cred is None:
        raise ValidationError_("no active credential to verify")
    gateway = await get_gateway()
    if getattr(gateway, "is_simulated", False):
        return {"ok": True, "simulated": True, "note": "DEMO_MODE - simulator account is used instead of Binance"}
    aad = str(cred.user_id).encode()
    creds = accounts.UserCreds(
        decrypt_secret(cred.api_key_enc, aad=aad),
        decrypt_secret(cred.secret_enc, aad=aad),
        user_id=user.id,
        credential_id=cred.id,
        testnet=bool(cred.is_testnet),
    )
    perms = await gateway.api_permissions(creds)
    await repo.mark_credential_checked(session, cred.id, ok=True, perms=perms)
    await session.commit()
    return {"ok": True, "permissions": perms, "checked_at": int(time.time() * 1000)}


def _resolve_payload(body: KeySubmitRequest) -> tuple[str, str]:
    """Envelope (production) or plaintext-over-TLS (dev only) -> (key, secret)."""
    if body.envelope is not None:
        payload = decrypt_envelope(body.envelope.data, body.envelope.iv, body.envelope.key, body.envelope.tag)
        if not isinstance(payload, dict):
            raise ValidationError_("envelope payload must be a JSON object")
        return str(payload.get("api_key", "")), str(payload.get("api_secret", ""))
    if settings.is_prod:
        raise ValidationError_("production requires envelope encryption (see GET /api/keys/handshake)")
    return str(body.api_key or ""), str(body.api_secret or "")
