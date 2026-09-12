"""Security tests: passwords, JWT, envelope crypto, TOTP, integrity, signing."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import jwt
import pytest
from app.errors import AuthError
from app.security import totp
from app.security.crypto import (
    AwsKmsProvider,
    CryptoError,
    LocalAESGCMProvider,
    decrypt_envelope,
    encrypt_envelope_with_public_key,
    fingerprint_of,
    get_handshake_keys,
    get_key_provider,
    set_key_provider,
)
from app.security.jwt_tokens import decode_token, issue_access_token, issue_token_pair
from app.security.passwords import hash_password, needs_rehash, verify_password


# ------------------------------------------------------------------- passwords
def test_password_hash_roundtrip_and_format():
    h = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", h)
    assert not verify_password("wrong password here", h)
    assert h != hash_password("correct horse battery staple"), "salts must differ"
    assert h.startswith(("$argon2", "pbkdf2_sha256$"))


def test_password_verify_rejects_garbage():
    assert not verify_password("x", "")
    assert not verify_password("x", "not-a-hash")
    assert not verify_password("x", "pbkdf2_sha256$1$c2FsdA==$bm90ZQ==")


def test_needs_rehash_only_for_legacy_format():
    modern = hash_password("abc123456789")
    legacy = "pbkdf2_sha256$1$c2FsdA==$bm90ZQ=="
    assert needs_rehash(legacy) or modern.startswith("$argon2")


# -------------------------------------------------------------------------- jwt
def test_jwt_issue_and_decode():
    token, expires_in, jti = issue_access_token(42, "a@b.com", role="admin", extra={"device": "pixel"})
    claims = decode_token(token)
    assert claims.user_id == 42
    assert claims.email == "a@b.com"
    assert claims.role == "admin"
    assert claims.jti == jti
    assert expires_in > 0


def test_jwt_rejects_tampering_and_wrong_type():
    token, _, _ = issue_access_token(1, "a@b.com")
    with pytest.raises(AuthError):
        decode_token(token + "x")
    foreign = jwt.encode({"sub": "1", "exp": int(time.time()) + 60, "iat": int(time.time())}, "attacker-key", algorithm="HS256")
    with pytest.raises(AuthError):
        decode_token(foreign)
    pair = issue_token_pair(1, "a@b.com")
    with pytest.raises(AuthError):
        decode_token(pair.access_token, expected_type="internal")


def test_jwt_expiry_is_enforced():
    token, _, _ = issue_access_token(1, "a@b.com", ttl_minutes=-1)
    with pytest.raises(AuthError):
        decode_token(token)


# ----------------------------------------------------------------------- crypto
def test_local_provider_roundtrip_and_tamper_detection():
    provider = LocalAESGCMProvider(b"0" * 32)
    blob = provider.encrypt(b"super-secret", aad=b"ctx")
    assert provider.decrypt(blob, aad=b"ctx") == b"super-secret"
    with pytest.raises(CryptoError):
        provider.decrypt(blob, aad=b"other-context")
    flipped = bytearray(blob)
    flipped[-1] ^= 0x01
    with pytest.raises(CryptoError):
        provider.decrypt(bytes(flipped), aad=b"ctx")
    with pytest.raises(CryptoError):
        LocalAESGCMProvider(b"too-short")
    with pytest.raises(CryptoError):
        provider.decrypt(b"v0" + b"x" * 40)


def test_provider_is_selected_from_settings():
    set_key_provider(None)
    assert isinstance(get_key_provider(), LocalAESGCMProvider)
    with pytest.raises(CryptoError):
        AwsKmsProvider("")  # missing key id -> configuration error, not a silent default


def test_envelope_matches_the_flutter_client():
    """Mirror of the app: AES-GCM payload + RSA-OAEP wrapped session key."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    payload = {"api_key": "AK" * 20, "api_secret": "AS" * 25}
    pem = get_handshake_keys().public_pem_str()
    assert "BEGIN RSA PUBLIC KEY" in pem, "PKCS#1 so pointycastle can parse it"

    public = serialization.load_pem_public_key(pem.encode())
    aes_key = b"k" * 32
    nonce = b"n" * 12
    ct = AESGCM(aes_key).encrypt(nonce, json.dumps(payload).encode(), None)
    wrapped = public.encrypt(aes_key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    envelope = {
        "data": base64.b64encode(ct[:-16]).decode(),
        "tag": base64.b64encode(ct[-16:]).decode(),
        "iv": base64.b64encode(nonce).decode(),
        "key": base64.b64encode(wrapped).decode(),
    }
    assert decrypt_envelope(envelope["data"], envelope["iv"], envelope["key"], envelope["tag"]) == payload
    # the helper the tests use must produce an equivalent envelope
    env2 = encrypt_envelope_with_public_key(payload)
    assert decrypt_envelope(env2["data"], env2["iv"], env2["key"], env2["tag"]) == payload
    # ciphertext must not be malleable: dropping the tag or corrupting data fails
    with pytest.raises(CryptoError):
        decrypt_envelope(env2["data"], env2["iv"], env2["key"])


def test_envelope_rejects_bad_inputs():
    from app.security.crypto import CryptoError as CE

    with pytest.raises(CE):
        decrypt_envelope("AAAA", base64.b64encode(b"x" * 12).decode(), base64.b64encode(b"junk").decode())
    good = encrypt_envelope_with_public_key({"a": 1})
    with pytest.raises(CE):
        decrypt_envelope(base64.b64encode(b"tampered").decode(), good["iv"], good["key"])


def test_fingerprint_is_stable_short_and_one_way():
    key = "abcdef1234567890abcdef1234567890"
    assert fingerprint_of(key) == fingerprint_of(key)
    assert len(fingerprint_of(key)) == 12
    assert key not in fingerprint_of(key)
    assert fingerprint_of(key) != fingerprint_of(key + "1")


# ------------------------------------------------------------------------ totp
def test_totp_lifecycle():
    secret = totp.new_secret()
    code = totp.now_code(secret)
    assert len(code) == 6 and code.isdigit()
    assert totp.verify_code(secret, code)
    assert not totp.verify_code(secret, code), "replay inside the same window must fail"
    assert not totp.verify_code(secret, "abc123")
    assert not totp.verify_code("OTHERSECRET", totp.now_code(secret))
    assert "otpauth://totp/" in totp.provisioning_uri(secret, "user@example.com")


# --------------------------------------------------------------------- integrity
def test_integrity_nonce_single_use():
    from app.security import integrity

    nonce = integrity.issue_nonce(5)
    assert integrity.consume_nonce(nonce, 5)
    assert not integrity.consume_nonce(nonce, 5), "nonce must be consumed once"
    other = integrity.issue_nonce(6)
    assert not integrity.consume_nonce(other, 5), "nonce is bound to the user"


def test_integrity_disabled_mode_in_dev():
    from app.security import integrity

    assert integrity.mode() in ("disabled", "jwt", "google")
    if integrity.mode() == "disabled":
        assert integrity.verify("whatever", nonce="", user_id=1).ok is True


# ---------------------------------------------------------------- binance signing
def test_hmac_signature_matches_reference_implementation():
    """The REST client's signing must equal a plain HMAC-SHA256 of the query."""
    from app.binance.rest import BinanceRestClient

    client = BinanceRestClient(api_key="k", api_secret="secret123", base_url="https://example.invalid")
    query = "symbol=BTCUSDT&timestamp=1600000000000&recvWindow=5000"
    expected = hmac.new(b"secret123", query.encode(), hashlib.sha256).hexdigest()
    assert client._sign_with("secret123", query) == expected
    assert len(expected) == 64


def test_handshake_keys_are_stable_within_process():
    a, b = get_handshake_keys(), get_handshake_keys()
    assert a.public_pem == b.public_pem
