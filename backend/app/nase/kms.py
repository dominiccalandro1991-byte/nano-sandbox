"""KMS / Software-TEE signing surface for φ_k(t) attestation material.

Evidence classification
-----------------------
- Interface (KeyProvider.sign / verify): Partially Verified design pattern.
- SoftwareTEEProvider: Partially Verified — seals a key in-process derived from
  kms_seed via HKDF; never exports raw key material through the public API.
  This is NOT a physical TEE, Secure Enclave, or cloud HSM (those remain
  Missing until a CloudKMSProvider is bound to a real KMS ARN).
- CloudKMSProvider: Partially Verified stub that documents the integration
  contract and raises if invoked without credentials — no fabricated AWS calls.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SignedBlob:
    payload: bytes
    signature: str
    key_id: str
    provider: str
    signed_at: float


class KeyProvider(ABC):
    @abstractmethod
    def key_id(self) -> str: ...

    @abstractmethod
    def sign(self, payload: bytes) -> SignedBlob: ...

    @abstractmethod
    def verify(self, payload: bytes, signature: str, key_id: str | None = None) -> bool: ...


def _hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    """Minimal HKDF-Extract+Expand (RFC 5869) using stdlib hmac/hashlib."""
    if not salt:
        salt = bytes(32)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = b""
    prev = b""
    counter = 1
    while len(okm) < length:
        prev = hmac.new(prk, prev + info + bytes([counter]), hashlib.sha256).digest()
        okm += prev
        counter += 1
    return okm[:length]


class SoftwareTEEProvider(KeyProvider):
    """In-process sealed key. Architectural stand-in for TEE-backed signing."""

    def __init__(self, seed: str, key_id: str = "tee-local-v1") -> None:
        if not seed or seed.startswith("nano-sandbox-dev") and os.environ.get("NANO_SANDBOX_REQUIRE_PROD_KMS") == "1":
            raise RuntimeError("production requires non-default kms_seed or cloud KMS")
        sealed = _hkdf_sha256(
            seed.encode("utf-8"),
            salt=b"nase-software-tee",
            info=b"phi-vector-signing",
            length=32,
        )
        self._sealed = sealed
        self._key_id = key_id
        self._lock = threading.Lock()

    def key_id(self) -> str:
        return self._key_id

    def sign(self, payload: bytes) -> SignedBlob:
        with self._lock:
            sig = hmac.new(self._sealed, payload, hashlib.sha256).hexdigest()
        return SignedBlob(
            payload=payload,
            signature=sig,
            key_id=self._key_id,
            provider="software_tee",
            signed_at=time.time(),
        )

    def verify(self, payload: bytes, signature: str, key_id: str | None = None) -> bool:
        if key_id is not None and key_id != self._key_id:
            return False
        expected = hmac.new(self._sealed, payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)


class CloudKMSProvider(KeyProvider):
    """Integration contract for AWS KMS / GCP KMS / Azure Key Vault.

    Evidence: Partially Verified interface only. Live cloud calls are Missing
    until NANO_SANDBOX_KMS_ARN (or equivalent) is configured in the environment.
    """

    def __init__(self, key_arn: str | None = None) -> None:
        self._arn = key_arn or os.environ.get("NANO_SANDBOX_KMS_ARN")
        self._key_id = self._arn or "cloud-kms-unconfigured"

    def key_id(self) -> str:
        return self._key_id

    def sign(self, payload: bytes) -> SignedBlob:
        if not self._arn:
            raise RuntimeError(
                "CloudKMSProvider: NANO_SANDBOX_KMS_ARN not configured — "
                "hardware-backed cloud signing is Missing in this environment"
            )
        # Real SDK call would go here (boto3 kms.sign, etc.). Not fabricated.
        raise RuntimeError(
            f"CloudKMSProvider: ARN set ({self._arn}) but cloud SDK not wired in this build"
        )

    def verify(self, payload: bytes, signature: str, key_id: str | None = None) -> bool:
        raise RuntimeError("CloudKMSProvider.verify requires wired cloud SDK (Missing)")


_provider_singleton: KeyProvider | None = None
_provider_lock = threading.Lock()


def get_key_provider(provider_name: str = "software_tee", seed: str = "") -> KeyProvider:
    global _provider_singleton
    with _provider_lock:
        if _provider_singleton is not None:
            return _provider_singleton
        if provider_name == "cloud_kms_stub":
            _provider_singleton = CloudKMSProvider()
        else:
            _provider_singleton = SoftwareTEEProvider(seed or "nano-sandbox-dev-kms-seed-change-me")
        return _provider_singleton


def reset_key_provider() -> None:
    """Test helper to clear singleton."""
    global _provider_singleton
    with _provider_lock:
        _provider_singleton = None
