"""TOTP (RFC 6238) for optional 2-factor login.

Implemented directly on ``hmac``/``hashlib`` so no extra dependency is needed;
codes are valid for one 30-second window with a +/-1 step skew and are
single-use per window (replay protected).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time

STEP_S = 30
DIGITS = 6
_SKEW = 1
_used: dict[tuple[int, str], float] = {}


def new_secret(length: int = 20) -> str:
    return base64.b32encode(secrets.token_bytes(length)).decode().rstrip("=")


_B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def _key(secret: str) -> bytes:
    """Padding-insensitive base32 decode (users paste secrets without '=')."""
    bits = "".join(format(_B32_ALPHABET.index(ch), "05b") for ch in secret.upper() if ch in _B32_ALPHABET)
    if not bits:
        raise ValueError("secret is not valid base32")
    return bytes(int(bits[i : i + 8], 2) for i in range(0, len(bits) - (len(bits) % 8), 8))


def code_at(secret: str, when_ms: int) -> str:
    counter = when_ms // 1000 // STEP_S
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = ((digest[offset] & 0x7F) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
    return str(binary % (10**DIGITS)).zfill(DIGITS)


def now_code(secret: str) -> str:
    return code_at(secret, int(time.time() * 1000))


def verify_code(secret: str, code: str, *, skew: int = _SKEW) -> bool:
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit():
        return False
    now_ms = int(time.time() * 1000)
    window = now_ms // 1000 // STEP_S
    for delta in range(-skew, skew + 1):
        expected = code_at(secret, (window + delta) * STEP_S * 1000)
        if hmac.compare_digest(expected, code):
            key = (secret.upper(), window + delta, code)
            if key in _used and now_ms - _used[key] < STEP_S * 1000:
                return False  # replay within the same window
            _used[key] = now_ms
            if len(_used) > 4096:
                for k in sorted(_used, key=lambda k: _used[k])[:2048]:
                    _used.pop(k, None)
            return True
    return False


def provisioning_uri(secret: str, account: str, *, issuer: str = "CryptoTrader") -> str:
    from urllib.parse import quote

    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&digits={DIGITS}&period={STEP_S}"
