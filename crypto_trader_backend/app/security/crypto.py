"""Key material handling for Binance API secrets.

Threat model
------------
The mobile app must never keep Binance secrets in plaintext, and the database
must never store them at all.  Therefore:

1. **Transit** - the Flutter app wraps a random AES-256 session key with the
   backend RSA public key (OAEP-SHA256) and encrypts the payload with
   AES-256-GCM.  TLS is still required; this is defence in depth against
   proxies/loggers and satisfies the "encrypt before sending" requirement.
2. **At rest** - the plaintext secret is immediately re-encrypted with a
   KMS/Vault managed key and *only* the ciphertext lives in PostgreSQL.
   Firestore mirrors get the ciphertext as well (never plaintext).

Key providers
-------------
``local``    AES-256-GCM with ``ENCRYPTION_KEY`` (base64, 32 bytes).
``vault``    HashiCorp Vault Transit engine (``/transit/encrypt/<key>``).
``aws_kms``  AWS KMS ``Encrypt``/``Decrypt`` (needs ``boto3``).
"""

from __future__ import annotations

import base64
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings
from app.errors import BackendError

_NONCE = 12  # AES-GCM standard nonce length
_TAG = 16


class CryptoError(BackendError):
    status_code = 400
    error_code = "crypto_error"


# --------------------------------------------------------------------------- #
# Master key providers
# --------------------------------------------------------------------------- #
class KeyProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def encrypt(self, plaintext: bytes, aad: bytes = b"") -> bytes: ...

    @abstractmethod
    def decrypt(self, blob: bytes, aad: bytes = b"") -> bytes: ...


class LocalAESGCMProvider(KeyProvider):
    """AES-256-GCM using a 32 byte master key from configuration/env."""

    name = "local"

    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise CryptoError("ENCRYPTION_KEY must decode to exactly 32 bytes")
        self._aes = AESGCM(key)

    @classmethod
    def from_settings(cls) -> LocalAESGCMProvider:
        raw = settings.ENCRYPTION_KEY.strip()
        if not raw:
            # Dev convenience: derive a stable-but-secret key from SECRET_KEY,
            # or a random one that dies with the process.
            if settings.SECRET_KEY.startswith("dev-only"):
                raw = base64.urlsafe_b64encode(os.urandom(32)).decode()
            else:
                import hashlib

                raw = base64.urlsafe_b64encode(
                    hashlib.sha256(settings.SECRET_KEY.encode()).digest()
                ).decode()
        try:
            key = base64.urlsafe_b64decode(raw.encode())
        except Exception as exc:  # pragma: no cover
            raise CryptoError(f"ENCRYPTION_KEY is not valid base64: {exc}") from exc
        return cls(key)

    def encrypt(self, plaintext: bytes, aad: bytes = b"") -> bytes:
        nonce = os.urandom(_NONCE)
        ct = self._aes.encrypt(nonce, plaintext, aad or None)
        return b"v1" + nonce + ct

    def decrypt(self, blob: bytes, aad: bytes = b"") -> bytes:
        if not blob.startswith(b"v1"):
            raise CryptoError("unsupported ciphertext version")
        body = blob[2:]
        nonce, ct = body[:_NONCE], body[_NONCE:]
        try:
            return self._aes.decrypt(nonce, ct, aad or None)
        except InvalidTag as exc:
            raise CryptoError("ciphertext failed authentication (wrong key or tampered)") from exc


class RemoteEnvelopeProvider(KeyProvider):
    """Base class for HTTP-based KMS providers (Vault Transit style)."""

    def __init__(self, timeout: float = 5.0) -> None:
        self.timeout = timeout

    @abstractmethod
    def _remote_encrypt(self, plaintext_b64: str) -> str: ...

    @abstractmethod
    def _remote_decrypt(self, ciphertext_b64: str) -> str: ...

    def encrypt(self, plaintext: bytes, aad: bytes = b"") -> bytes:
        payload = base64.b64encode(plaintext).decode()
        out = self._remote_encrypt(payload)
        return b"r1" + base64.b64encode(out.encode())

    def decrypt(self, blob: bytes, aad: bytes = b"") -> bytes:
        if not blob.startswith(b"r1"):
            raise CryptoError("unsupported ciphertext version")
        token = base64.b64decode(blob[2:]).decode()
        return base64.b64decode(self._remote_decrypt(token))


class VaultTransitProvider(RemoteEnvelopeProvider):
    """HashiCorp Vault Transit engine (encrypt/decrypt data-in-transit)."""

    name = "vault"

    def __init__(self, addr: str, token: str, key_name: str, timeout: float = 5.0) -> None:
        super().__init__(timeout)
        if not addr or not token:
            raise CryptoError("VAULT_ADDR / VAULT_TOKEN are required for KEY_PROVIDER=vault")
        self.addr = addr.rstrip("/")
        self.token = token
        self.key_name = key_name

    def _call(self, path: str, body: dict) -> dict:
        import httpx

        try:
            resp = httpx.post(
                f"{self.addr}/v1/{path}",
                json=body,
                headers={"X-Vault-Token": self.token},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()["data"]
        except Exception as exc:  # pragma: no cover - needs vault
            raise CryptoError(f"vault request failed: {exc}") from exc

    def _remote_encrypt(self, plaintext_b64: str) -> str:
        return self._call(f"transit/encrypt/{self.key_name}", {"plaintext": plaintext_b64})["ciphertext"]

    def _remote_decrypt(self, ciphertext_b64: str) -> str:
        return self._call(
            f"transit/decrypt/{self.key_name}", {"ciphertext": ciphertext_b64}
        )["plaintext"]


class AwsKmsProvider(RemoteEnvelopeProvider):
    """AWS KMS symmetric envelope encryption."""

    name = "aws_kms"

    def __init__(self, key_id: str, region: str = "us-east-1") -> None:
        super().__init__()
        if not key_id:
            raise CryptoError("AWS_KMS_KEY_ID is required for KEY_PROVIDER=aws_kms")
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover
            raise CryptoError("boto3 is not installed; pip install boto3") from exc
        self._client = boto3.client("kms", region_name=region)
        self.key_id = key_id

    def _remote_encrypt(self, plaintext_b64: str) -> str:  # pragma: no cover
        out = self._client.encrypt(KeyId=self.key_id, Plaintext=base64.b64decode(plaintext_b64))
        return base64.b64encode(out["CiphertextBlob"]).decode()

    def _remote_decrypt(self, ciphertext_b64: str) -> str:  # pragma: no cover
        out = self._client.decrypt(CiphertextBlob=base64.b64decode(ciphertext_b64))
        return base64.b64encode(out["Plaintext"]).decode()


_provider: KeyProvider | None = None


def get_key_provider() -> KeyProvider:
    global _provider
    if _provider is None:
        which = settings.KEY_PROVIDER.lower()
        if which == "vault":
            _provider = VaultTransitProvider(
                settings.VAULT_ADDR, settings.VAULT_TOKEN, settings.VAULT_TRANSIT_KEY_NAME
            )
        elif which == "aws_kms":
            _provider = AwsKmsProvider(settings.AWS_KMS_KEY_ID, settings.AWS_REGION)
        else:
            _provider = LocalAESGCMProvider.from_settings()
    return _provider


def set_key_provider(provider: KeyProvider | None) -> None:
    """Test hook."""
    global _provider
    _provider = provider


def fingerprint_of(api_key: str) -> str:
    """Short, non-reversible identifier for UI display + dedupe."""
    import hashlib

    return hashlib.sha256(api_key.encode()).hexdigest()[:12]


def encrypt_secret(plaintext: str, aad: bytes = b"") -> bytes:
    return get_key_provider().encrypt(plaintext.encode(), aad)


def decrypt_secret(blob: bytes, aad: bytes = b"") -> str:
    return get_key_provider().decrypt(blob, aad).decode()


# --------------------------------------------------------------------------- #
# Mobile handshake: RSA-OAEP wrapped AES-GCM envelope
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class HandshakeKeys:
    private_pem: bytes
    public_pem: bytes

    def public_pem_str(self) -> str:
        return self.public_pem.decode()


_keys: HandshakeKeys | None = None


def _new_rsa() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=3072)


def get_handshake_keys() -> HandshakeKeys:
    """Backend RSA pair used to unwrap AES session keys from the app.

    The *public* key is served to the app at ``GET /api/keys/handshake`` and
    must be pinned to the deployed instance (see README, security section).
    """
    global _keys
    if _keys is None:
        pem = settings.HANDSHAKE_PRIVATE_KEY_PEM.replace("\\n", "\n")
        if pem.strip():
            private = serialization.load_pem_private_key(pem.encode(), password=None)
        else:
            private = _new_rsa()
            if settings.is_prod:
                raise CryptoError(
                    "HANDSHAKE_PRIVATE_KEY_PEM must be configured in production"
                )
        public_pem = private.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.PKCS1,  # "BEGIN RSA PUBLIC KEY" (pointycastle friendly)
        )
        _keys = HandshakeKeys(
            private_pem=private.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ),
            public_pem=public_pem,
        )
    return _keys


def set_handshake_keys(keys: HandshakeKeys | None) -> None:
    global _keys
    _keys = keys


def unwrap_session_key(rsa_b64: str) -> bytes:
    private = serialization.load_pem_private_key(get_handshake_keys().private_pem, password=None)
    try:
        return private.decrypt(
            base64.b64decode(rsa_b64),
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
    except Exception as exc:
        raise CryptoError(f"unable to unwrap session key: {exc}") from exc


def encrypt_envelope_with_public_key(obj: dict, public_pem: str | None = None) -> dict[str, str]:
    """Mirror of the Flutter client's request envelope (used by tests + CLI).

    Steps: random AES-256 key -> AES-GCM(payload) -> RSA-OAEP(key).
    """
    public_pem = public_pem or get_handshake_keys().public_pem_str()
    public = serialization.load_pem_public_key(public_pem.encode())
    aes_key = os.urandom(32)
    nonce = os.urandom(_NONCE)
    ct = AESGCM(aes_key).encrypt(nonce, json.dumps(obj).encode(), None)
    wrapped = public.encrypt(
        aes_key,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "data": base64.b64encode(ct[: len(ct) - _TAG]).decode(),
        "tag": base64.b64encode(ct[len(ct) - _TAG :]).decode(),
        "iv": base64.b64encode(nonce).decode(),
        "key": base64.b64encode(wrapped).decode(),
    }


def decrypt_envelope(payload_b64: str, iv_b64: str, session_key_b64_rsa: str, tag_b64: str = "") -> dict:
    """Decrypt an ``{data, iv, key[, tag]}`` envelope produced by the mobile app.

    ``package:encrypt`` (Dart) appends the GCM tag to the ciphertext; if the
    client sends it separately we concatenate it back before authenticating.
    """
    aes_key = unwrap_session_key(session_key_b64_rsa)
    nonce = base64.b64decode(iv_b64)
    ct = base64.b64decode(payload_b64)
    if tag_b64:
        ct = ct + base64.b64decode(tag_b64)
    if len(nonce) != _NONCE:
        raise CryptoError(f"expected a {_NONCE} byte IV")
    if len(aes_key) not in (16, 24, 32):
        raise CryptoError("session key must be 16/24/32 bytes")
    try:
        plaintext = AESGCM(aes_key).decrypt(nonce, ct, None)
    except InvalidTag as exc:
        raise CryptoError("envelope authentication failed") from exc
    try:
        return json.loads(plaintext.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CryptoError(f"envelope payload is not valid JSON: {exc}") from exc


def encrypt_envelope_for_client(obj: dict, shared_key: bytes) -> dict[str, str]:
    """Optional response encryption (used when ``X-Encrypt: 1`` is sent)."""
    nonce = os.urandom(_NONCE)
    ct = AESGCM(shared_key).encrypt(nonce, json.dumps(obj).encode(), None)
    return {
        "data": base64.b64encode(ct[: len(ct) - _TAG]).decode(),
        "tag": base64.b64encode(ct[len(ct) - _TAG :]).decode(),
        "iv": base64.b64encode(nonce).decode(),
    }


def generate_master_key_b64() -> str:
    """CLI helper: ``python -m app.security.crypto``."""
    return base64.urlsafe_b64encode(os.urandom(32)).decode()


if __name__ == "__main__":  # pragma: no cover
    print(generate_master_key_b64())
