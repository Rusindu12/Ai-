"""Password hashing helpers.

Prefers Argon2id (``argon2-cffi``) and transparently falls back to
PBKDF2-HMAC-SHA256 (240k iterations) if the native argon2 shared library is
unavailable, so the backend never fails to boot because of a missing system
package.  Both formats are verifiable, and hashes are self-describing.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

try:  # pragma: no cover - environment dependent
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

    _ARGON2: PasswordHasher | None = PasswordHasher(
        time_cost=3, memory_cost=65536, parallelism=2, hash_len=32, salt_len=16
    )
except Exception:  # pragma: no cover
    _ARGON2 = None
    InvalidHashError = VerificationError = VerifyMismatchError = type(  # type: ignore[assignment]
        "_ArgonErrors", (Exception,), {}
    )

_PBKDF2_ITERATIONS = 240_000
_PBKDF2_PREFIX = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    if _ARGON2 is not None:
        return _ARGON2.hash(password)
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS, 32)
    return f"{_PBKDF2_PREFIX}${_PBKDF2_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    if hashed.startswith("$argon2"):
        if _ARGON2 is None:  # pragma: no cover
            raise RuntimeError("argon2-cffi is required to verify this hash")
        try:
            _ARGON2.verify(hashed, password)
            return True
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    try:
        scheme, iters, salt_b64, hash_b64 = hashed.split("$")
        if scheme != _PBKDF2_PREFIX:
            return False
        salt = base64.b64decode(salt_b64.encode())
        expected = base64.b64decode(hash_b64.encode())
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters), len(expected))
        return hmac.compare_digest(dk, expected)
    except (ValueError, TypeError):
        return False


def needs_rehash(hashed: str) -> bool:
    if _ARGON2 is not None and hashed.startswith("$argon2"):
        try:
            return _ARGON2.check_needs_rehash(hashed)
        except Exception:  # pragma: no cover
            return False
    return not hashed.startswith("$argon2") and _ARGON2 is not None


def random_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def timing_safe_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
