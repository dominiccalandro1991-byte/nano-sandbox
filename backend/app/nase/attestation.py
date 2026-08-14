"""NASE live attestation: nonce, 25-engine S_attest, SQLAlchemy vault-sync.

Evidence classification
-----------------------
- Freshness: Verified (check_attestation_freshness).
- Nonce anti-replay: Partially Verified (process-local).
- S_attest equation: Partially Verified (engine_vectors + TEE/HMAC seal).
- Vault durability: Partially Verified (SQLAlchemy; PostgreSQL when DATABASE_URL
  points at a cluster; tests use SQLite). Multi-region deployment Missing until
  provisioned.
- Server never decrypts ciphertext: Verified.
"""

from __future__ import annotations

import secrets
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any

from app.nase.engine_vectors import compute_s_attest, export_engine_snapshot
from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness
from app.nase import vault_db


@dataclass
class NonceRecord:
    nonce: str
    issued_at: float
    expires_at: float
    consumed: bool = False
    snapshot_t: float | None = None
    weighted_sum: float | None = None
    expected_s_attest: str | None = None


class NonceStore:
    def __init__(self, ttl_seconds: float = 90.0, max_entries: int = 4000) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._lock = threading.Lock()
        self._items: dict[str, NonceRecord] = {}

    def issue(
        self,
        *,
        snapshot_t: float | None = None,
        weighted_sum_value: float | None = None,
        expected_s_attest: str | None = None,
    ) -> dict[str, Any]:
        now = time.time()
        nonce = secrets.token_hex(16) + uuid.uuid4().hex[:8]
        rec = NonceRecord(
            nonce=nonce,
            issued_at=now,
            expires_at=now + self._ttl,
            snapshot_t=snapshot_t,
            weighted_sum=weighted_sum_value,
            expected_s_attest=expected_s_attest,
        )
        with self._lock:
            self._purge_locked(now)
            if len(self._items) >= self._max:
                oldest = min(self._items.values(), key=lambda r: r.issued_at)
                self._items.pop(oldest.nonce, None)
            self._items[nonce] = rec
        return {
            "nonce": nonce,
            "issued_at": rec.issued_at,
            "expires_at": rec.expires_at,
            "ttl_seconds": self._ttl,
            "snapshot_t": snapshot_t,
            "weighted_sum": weighted_sum_value,
        }

    def peek(self, nonce: str) -> NonceRecord | None:
        with self._lock:
            return self._items.get(nonce)

    def consume(self, nonce: str, now: float | None = None) -> tuple[bool, str, NonceRecord | None]:
        now = time.time() if now is None else now
        with self._lock:
            self._purge_locked(now)
            rec = self._items.get(nonce)
            if rec is None:
                return False, "nonce unknown or expired", None
            if rec.consumed:
                return False, "nonce already consumed (replay)", rec
            if now > rec.expires_at:
                self._items.pop(nonce, None)
                return False, "nonce expired", None
            rec.consumed = True
            return True, "nonce accepted", rec

    def _purge_locked(self, now: float) -> None:
        dead = [k for k, v in self._items.items() if now > v.expires_at]
        for k in dead:
            self._items.pop(k, None)


_NONCE_STORE = NonceStore()


def issue_nonce_with_vectors(
    seed: str,
    *,
    rotation_seconds: float = 3600.0,
    grace_seconds: float = 300.0,
    kms_provider: str = "software_tee",
) -> dict[str, Any]:
    snap = export_engine_snapshot(
        seed,
        rotation_seconds=rotation_seconds,
        grace_seconds=grace_seconds,
        kms_provider=kms_provider,
    )
    provisional = _NONCE_STORE.issue(
        snapshot_t=snap["t"],
        weighted_sum_value=snap["weighted_sum"],
        expected_s_attest=None,
    )
    nonce = provisional["nonce"]
    expected = compute_s_attest(nonce, snap["weighted_sum"])
    rec = _NONCE_STORE.peek(nonce)
    if rec is not None:
        rec.expected_s_attest = expected
    return {
        **provisional,
        "engine_snapshot": snap,
        "expected_s_attest": expected,
        "equation": snap["equation"],
    }


def issue_nonce() -> dict[str, Any]:
    return _NONCE_STORE.issue()


def verify_attestation(
    *,
    attestation_timestamp: float | None,
    nonce: str | None,
    client_s_attest: str | None = None,
    client_binding_hash: str | None = None,
    extra_material: str | None = None,
    now: float | None = None,
    delta_seconds: float = DEFAULT_DELTA_SECONDS,
    require_nonce: bool = True,
    require_s_attest: bool = False,
    attestation_secret: str | None = None,
) -> dict[str, Any]:
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
            "s_attest_ok": False,
            "nonce_ok": False,
        }

    if require_nonce and not nonce:
        return {
            "ok": False,
            "http_hint": 401,
            "reason": "nonce required",
            "findings": findings + ["nonce missing"],
            "server_now": now_ts,
            "delta_seconds": delta_seconds,
            "s_attest_ok": False,
            "nonce_ok": False,
        }

    nonce_ok = True
    rec: NonceRecord | None = None
    if require_nonce and nonce:
        nonce_ok, nonce_reason, rec = _NONCE_STORE.consume(nonce, now=now_ts)
        findings.append(nonce_reason)
        if not nonce_ok:
            return {
                "ok": False,
                "http_hint": 403,
                "reason": nonce_reason,
                "findings": findings,
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "s_attest_ok": False,
                "nonce_ok": False,
            }

    s_attest_ok = True
    expected_s = None
    client_hash = client_s_attest or client_binding_hash

    if require_s_attest or client_hash:
        if rec and rec.expected_s_attest:
            expected_s = rec.expected_s_attest
        elif rec and rec.weighted_sum is not None and nonce:
            expected_s = compute_s_attest(nonce, float(rec.weighted_sum))
        elif nonce and attestation_secret:
            snap = export_engine_snapshot(attestation_secret, t=now_ts)
            expected_s = compute_s_attest(nonce, snap["weighted_sum"])

        if not client_hash or not expected_s:
            return {
                "ok": False,
                "http_hint": 403,
                "reason": "S_attest required (H(nonce || sum(omega*phi)))",
                "findings": findings + ["s_attest missing or unbound"],
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "s_attest_ok": False,
                "nonce_ok": nonce_ok,
            }
        s_attest_ok = secrets.compare_digest(expected_s.lower(), str(client_hash).lower())
        findings.append("s_attest_ok" if s_attest_ok else "s_attest_mismatch")
        if not s_attest_ok:
            return {
                "ok": False,
                "http_hint": 403,
                "reason": "S_attest mismatch — 25-engine equation failed",
                "findings": findings,
                "server_now": now_ts,
                "delta_seconds": delta_seconds,
                "s_attest_ok": False,
                "nonce_ok": nonce_ok,
                "expected_s_attest_prefix": expected_s[:16],
            }

    return {
        "ok": True,
        "http_hint": 200,
        "reason": "attestation verified",
        "findings": findings,
        "server_now": now_ts,
        "delta_seconds": delta_seconds,
        "s_attest_ok": s_attest_ok,
        "nonce_ok": nonce_ok,
        "equation": "S_attest = H(N_server || sum(omega_k * phi_k(t)))",
    }


def vault_sync_put(
    ciphertext_b64: str,
    content_hash: str,
    session_hint: str | None = None,
    identity_hint: str | None = None,
) -> dict[str, Any]:
    return vault_db.vault_put(ciphertext_b64, content_hash, session_hint, identity_hint)


def vault_sync_get(blob_id: str) -> dict[str, Any] | None:
    return vault_db.vault_get(blob_id)


def vault_sync_count() -> int:
    return vault_db.vault_count()


def get_vault_db_path() -> str:
    return "sqlalchemy-managed"
