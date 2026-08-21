"""AES-256-GCM for upstream keys at rest in process memory. Never logs plaintext."""
from __future__ import annotations

import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes


def derive_key(seed: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"keyharbor-aes256-gcm",
        info=b"upstream-key-enclave",
    ).derive((seed or "keyharbor-dev").encode("utf-8"))


def seal(plaintext: str, key: bytes) -> bytes:
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), b"keyharbor")
    return nonce + ct


def open_sealed(blob: bytes, key: bytes) -> str:
    aes = AESGCM(key)
    nonce, ct = blob[:12], blob[12:]
    return aes.decrypt(nonce, ct, b"keyharbor").decode("utf-8")
