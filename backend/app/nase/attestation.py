"""NASE live attestation helpers: single-use nonce + freshness verification.

Evidence classification
-----------------------
- Attestation-freshness predicate: Verified (reuses check_attestation_freshness
  from invariants.py; covered by existing test_nase.py).
- Single-use server nonce (anti-replay): Partially Verified (in-memory map with
  TTL; not distributed / not Secure Enclave backed).
- SHA-256 binding of (nonce || client_attestation_ts || optional material):
  Partially Verified (stdlib hashlib; standard construction).
- Directive equation
    S_attest = H( N_server || Σ_{k=1}^{25} ω_k · φ_k(t) )
  is **Missing**: this repository does not expose signed per-engine state
  vectors φ_k(t) or engine weights ω_k as cryptographic material. Implementing
  that sum would be fabrication. This module therefore binds the real
  freshness invariant + single-use nonce instead of inventing φ vectors.
- Secure Enclave / DeviceCheck token issuance: Missing (documented in
  nase/__init__.py).
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness


@dataclass
class NonceRecord:
    nonce: str
    issued_at: float
    expires_at: float
    consumed: bool = False


class NonceStore:
    """Process-local single-use nonce store with TTL."""

    def __init__(self, ttl_seconds: float = 60.0, max_entries: int = 2000) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._lock = threading.Lock()
        self._items: dict[str, NonceRecord] = {}

    def issue(self) -> dict[str, Any]:
        now = time.time()
        nonce = secrets.token_hex(16) + uuid.uuid4().hex[:8]
        rec = NonceRecord(nonce=nonce, issued_at=now, expires_at=now + self._ttl)
        with self._lock:
            self._purge_locked(now)
            if len(self._items) >= self._max:
                # drop oldest
                oldest = min(self._items.values(), key=lambda r: r.issued_at)
                self._items.pop(oldest.nonce, None)
            self._items[nonce] = rec
        return {
            "nonce": nonce,
            "issued_at": rec.issued_at,
            "expires_at": rec.expires_at,
            "ttl_seconds": self._ttl,
        }

    def consume(self, nonce: str, now: float | None = None) -> tuple[bool, str]:
        now = time.time() if now is None else now
        with self._lock:
            self._purge_locked(now)
            rec = self._items.get(nonce)
            if rec is None:
                return False, "nonce unknown or expired"
            if rec.consumed:
                return False, "nonce already consumed (replay)"
            if now > rec.expires_at:
                self._items.pop(nonce, None)
                return False, "nonce expired"
            rec.consumed = True
            return True, "nonce accepted"

    def _purge_locked(self, now: float) -> None:
        dead = [k for k, v in self._items.items() if now > v.expires_at or v.consumed]
        for k in dead:
            self._items.pop(k, None)


_NONCE_STORE = NonceStore()


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def bind_attestation_material(
    nonce: str,
    attestation_timestamp: float,
    extra: str | None = None,
) -> str:
    """Canonical binding hash: H(nonce || att_ts || extra)."""
    parts = [nonce.strip(), f"{float(attestation_timestamp):.6f}"]
    if extra:
        parts.append(extra)
    return sha256_hex("|".join(parts))


def verify_attestation(
    *,
    attestation_timestamp: float | None,
    nonce: str | None,
    client_binding_hash: str | None = None,
    extra_material: str | None = None,
    now: float | None = None,
    delta_seconds: float = DEFAULT_DELTA_SECONDS,
    require_nonce: bool = True,
) -> dict[str, Any]:
    """Server-side verification combining freshness + optional single-use nonce.

    Returns a structured result suitable for HTTP 200 or 401/403 mapping.
    """
    now_ts = time.time() if now is None else float(now)
    findings: list[str] = []

    ok_fresh, reason_fresh = check_attestation_freshness(
        attestation_timestamp, now_ts, delta_seconds=delta_seconds
    )
    findings.append(reason_fresh)
    if not ok_fresh:
        return {
            "ok": False,
            "http_hint": 401,
            "reason": reason_fresh,
            "findings": findings,
            "server_now": now_ts,
            "delta_seconds": delta_seconds,
            "binding_ok": False,
            "nonce_ok": False,
        }

    nonce_ok = True
    if require_nonce:
        if not nonce:
            return {
                "ok": False,
                "http_hint": 401,
                "reason": "nonce required",
                "findings": findings + ["nonce missing"],
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "binding_ok": False,
                "nonce_ok": False,
            }
        nonce_ok, nonce_reason = _NONCE_STORE.consume(nonce, now=now_ts)
        findings.append(nonce_reason)
        if not nonce_ok:
            return {
                "ok": False,
                "http_hint": 403,
                "reason": nonce_reason,
                "findings": findings,
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "binding_ok": False,
                "nonce_ok": False,
            }

    binding_ok = True
    expected_binding = None
    if client_binding_hash is not None and nonce and attestation_timestamp is not None:
        expected_binding = bind_attestation_material(
            nonce, float(attestation_timestamp), extra_material
        )
        binding_ok = secrets.compare_digest(
            expected_binding.lower(), str(client_binding_hash).lower()
        )
        findings.append("binding_ok" if binding_ok else "binding_hash_mismatch")
        if not binding_ok:
            return {
                "ok": False,
                "http_hint": 403,
                "reason": "binding hash mismatch",
                "findings": findings,
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "binding_ok": False,
                "nonce_ok": nonce_ok,
                "expected_binding_prefix": expected_binding[:12],
            }

    return {
        "ok": True,
        "http_hint": 200,
        "reason": "attestation verified",
        "findings": findings,
        "server_now": now_ts,
        "delta_seconds": delta_seconds,
        "binding_ok": binding_ok,
        "nonce_ok": nonce_ok,
    }


def issue_nonce() -> dict[str, Any]:
    return _NONCE_STORE.issue()


# --- Ephemeral vault-sync store (memory mode mitigation) ---

@dataclass
class VaultBlob:
    blob_id: str
    content_hash: str
    size: int
    stored_at: float
    session_hint: str | None
    # ciphertext is base64 text from client; server does not decrypt
    ciphertext_b64: str


class VaultSyncStore:
    def __init__(self, max_blobs: int = 200, max_bytes: int = 8 * 1024 * 1024) -> None:
        self._lock = threading.Lock()
        self._blobs: dict[str, VaultBlob] = {}
        self._max_blobs = max_blobs
        self._max_bytes = max_bytes

    def put(
        self,
        ciphertext_b64: str,
        content_hash: str,
        session_hint: str | None = None,
    ) -> dict[str, Any]:
        if not ciphertext_b64 or not content_hash:
            raise ValueError("ciphertext_b64 and content_hash required")
        size = len(ciphertext_b64.encode("utf-8"))
        if size > self._max_bytes:
            raise ValueError(f"blob exceeds max_bytes={self._max_bytes}")
        # optional integrity: re-hash of ciphertext must match client claim if they sent raw hash of cipher
        blob_id = uuid.uuid4().hex
        rec = VaultBlob(
            blob_id=blob_id,
            content_hash=content_hash.lower(),
            size=size,
            stored_at=time.time(),
            session_hint=session_hint,
            ciphertext_b64=ciphertext_b64,
        )
        with self._lock:
            if len(self._blobs) >= self._max_blobs:
                oldest = min(self._blobs.values(), key=lambda b: b.stored_at)
                self._blobs.pop(oldest.blob_id, None)
            self._blobs[blob_id] = rec
        return {
            "blob_id": blob_id,
            "content_hash": rec.content_hash,
            "size": size,
            "stored_at": rec.stored_at,
        }

    def get(self, blob_id: str) -> VaultBlob | None:
        with self._lock:
            return self._blobs.get(blob_id)


_VAULT_SYNC = VaultSyncStore()


def vault_sync_put(ciphertext_b64: str, content_hash: str, session_hint: str | None = None) -> dict[str, Any]:
    return _VAULT_SYNC.put(ciphertext_b64, content_hash, session_hint)


def vault_sync_get(blob_id: str) -> dict[str, Any] | None:
    rec = _VAULT_SYNC.get(blob_id)
    if rec is None:
        return None
    return {
        "blob_id": rec.blob_id,
        "content_hash": rec.content_hash,
        "size": rec.size,
        "stored_at": rec.stored_at,
        "session_hint": rec.session_hint,
        "ciphertext_b64": rec.ciphertext_b64,
    }
