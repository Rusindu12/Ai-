"""User <-> exchange plumbing: credentials, filters, balances.

Credential lifecycle
--------------------
``POST /api/keys/binance`` receives an *encrypted envelope* from the app,
decrypts it in memory, immediately re-encrypts each field with the KMS/Vault
master key, and stores only ciphertext in PostgreSQL.  The plaintext key pair
lives for the duration of a single request (or a few seconds inside the
optional in-memory cache) and is never logged.
"""

from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.binance.base import Creds
from app.config import settings
from app.db import repo
from app.db.models import ExchangeCredential
from app.errors import PermissionError_, ValidationError_
from app.security.crypto import decrypt_secret

log = logging.getLogger(__name__)

DEFAULT_PAPER_CASH = {"USDT": 10_000.0, "BUSD": 1_000.0}


class UserCreds(Creds):
    """Creds + user id so the simulator can key per-user virtual accounts."""

    __slots__ = ("credential_id", "label", "paper", "user_id")

    def __init__(self, api_key: str, api_secret: str, *, user_id: int, credential_id: int | None = None, label: str = "default", testnet: bool = False, paper: bool = False) -> None:
        super().__init__(api_key, api_secret, testnet=testnet)
        self.user_id = int(user_id)
        self.credential_id = credential_id
        self.label = label
        self.paper = paper

    def __repr__(self) -> str:
        return f"UserCreds(user={self.user_id}, label={self.label}, paper={self.paper})"


@dataclass(slots=True)
class SymbolRule:
    symbol: str
    base: str
    quote: str
    tick_size: float
    step_size: float
    min_qty: float
    min_notional: float
    price_decimals: int
    qty_decimals: int

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def _decimals_of(step: float) -> int:
    text = f"{step:.10f}".rstrip("0")
    return len(text.split(".")[-1]) if "." in text else 0


_filter_cache: dict[str, tuple[float, SymbolRule]] = {}
_FILTER_TTL_S = 3600.0


async def get_symbol_rule(gateway: Any, symbol: str, *, refresh: bool = False) -> SymbolRule:
    """LOT_SIZE / PRICE_FILTER / MIN_NOTIONAL rules, cached for an hour."""
    key = symbol.upper()
    hit = _filter_cache.get(key)
    if hit and not refresh and time.time() < hit[0]:
        return hit[1]
    try:
        info = await gateway.exchange_info(key)
        entries = info.get("symbols") or []
        entry = entries[0] if entries else {}
    except Exception as exc:
        log.warning("exchangeInfo failed for %s (%s) - using defaults", key, exc)
        entry = {}
    from app.risk.manager import SymbolFilters

    f = SymbolFilters.from_exchange_info(entry)
    rule = SymbolRule(
        symbol=key,
        base=(entry.get("baseAsset") or key[:-4] or key).upper(),
        quote=(entry.get("quoteAsset") or "USDT").upper(),
        tick_size=f.tick_size,
        step_size=f.step_size,
        min_qty=f.min_qty,
        min_notional=f.min_notional,
        price_decimals=_decimals_of(f.tick_size),
        qty_decimals=_decimals_of(f.step_size),
    )
    _filter_cache[key] = (time.time() + _FILTER_TTL_S, rule)
    return rule


def invalidate_symbol_rules(symbol: str | None = None) -> None:
    if symbol:
        _filter_cache.pop(symbol.upper(), None)
    else:
        _filter_cache.clear()


async def resolve_creds(session: AsyncSession, user: Any, *, require_live: bool = False, label: str | None = None) -> UserCreds:
    """Return the credential set to use for this request.

    * DEMO_MODE -> synthetic creds (the simulator keys accounts by user id)
    * user paper-trading on -> synthetic creds marked paper
    * otherwise -> decrypt the stored credential
    """
    if settings.DEMO_MODE:
        return UserCreds(f"demo-{user.id}", f"demo-secret-{user.id}", user_id=user.id, paper=True)
    cred = await repo.get_active_credential(session, user.id, label=label)
    if cred is None:
        if require_live:
            raise ValidationError_("no active Binance API key on this account - add one in Settings", details={"endpoint": "/api/keys/binance"})
        return UserCreds(f"paper-{user.id}", f"paper-secret-{user.id}", user_id=user.id, paper=True)
    if cred.can_withdraw:
        raise PermissionError_(
            "this Binance key has WITHDRAW permission - revoke it and create a trade-only key",
            details={"credential_id": cred.id},
        )
    api_key = decrypt_secret(cred.api_key_enc, aad=str(cred.user_id).encode())
    api_secret = decrypt_secret(cred.secret_enc, aad=str(cred.user_id).encode())
    return UserCreds(
        api_key,
        api_secret,
        user_id=user.id,
        credential_id=cred.id,
        label=cred.label,
        testnet=bool(cred.is_testnet),
        paper=bool(getattr(user, "paper_trading", True)),
    )


def fingerprint(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()[:12]


def credential_public_view(cred: ExchangeCredential) -> dict[str, Any]:
    masked = ""
    try:
        key = decrypt_secret(cred.api_key_enc, aad=str(cred.user_id).encode())
        masked = f"{key[:4]}{'*' * max(0, min(16, len(key) - 8))}{key[-4:]}" if len(key) > 8 else "*" * len(key)
    except Exception:  # pragma: no cover - key rotation etc.
        masked = "********"
    return {
        "id": cred.id,
        "exchange": cred.exchange,
        "label": cred.label,
        "masked_key": masked,
        "fingerprint": cred.key_fp,
        "can_trade": cred.can_trade,
        "can_withdraw": cred.can_withdraw,
        "ip_restricted": cred.ip_restricted,
        "is_testnet": cred.is_testnet,
        "is_active": cred.is_active,
        "last_checked_at": cred.last_checked_at,
        "last_error": cred.last_error,
        "created_at": int(cred.created_at.timestamp() * 1000) if cred.created_at else None,
    }


async def paper_state(user: Any) -> dict[str, float]:
    balances = dict(getattr(user, "paper_balances", None) or {})
    if not balances:
        balances = dict(DEFAULT_PAPER_CASH)
    return balances


async def save_paper_state(session: AsyncSession, user_id: int, balances: dict[str, float]) -> None:
    await repo.update_user(session, user_id, paper_balances={k: round(float(v), 8) for k, v in balances.items() if v > -1e9})
