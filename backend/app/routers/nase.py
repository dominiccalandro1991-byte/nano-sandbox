"""NASE HTTP surface: 25-engine vectors, S_attest verify, durable vault-sync.

Evidence classification
-----------------------
- Endpoints wrap Partially Verified engine_vectors + attestation modules.
- φ_k are registry-derived diagnostic scalars, not Secure-Enclave internals.
- Vault-sync uses SQLite (durable across process restart); server stores
  ciphertext only and cannot decrypt.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.nase.attestation import (
    issue_nonce,
    issue_nonce_with_vectors,
    verify_attestation,
    vault_sync_put,
    vault_sync_get,
    get_vault_db_path,
)
from app.nase.engine_vectors import export_engine_snapshot
from app.nase.invariants import DEFAULT_DELTA_SECONDS

router = APIRouter(prefix="/nase", tags=["nase"])


class VerifyBody(BaseModel):
    attestation_timestamp: float | None = Field(
        default=None, description="Client attestation wall-clock (seconds)."
    )
    nonce: str | None = None
    client_s_attest: str | None = Field(
        default=None,
        description="SHA-256 hex of nonce|weighted_sum (25-engine equation).",
    )
    client_binding_hash: str | None = Field(
        default=None,
        description="Legacy alias for client_s_attest.",
    )
    extra_material: str | None = None
    delta_seconds: float = DEFAULT_DELTA_SECONDS
    require_nonce: bool = True
    require_s_attest: bool = True


class VaultSyncBody(BaseModel):
    ciphertext_b64: str
    content_hash: str = Field(..., description="Client content hash (hex) of plaintext.")
    session_hint: str | None = None
    identity_hint: str | None = Field(
        default=None,
        description="Non-secret identity fingerprint (e.g. hash of token id); never a key.",
    )


@router.post("/nonce")
@router.get("/nonce")
def nase_nonce(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Issue single-use nonce bound to signed 25-engine vector snapshot + S_attest."""
    return issue_nonce_with_vectors(settings.attestation_secret)


@router.get("/engine-vectors")
def nase_engine_vectors(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Export current signed φ_k / ω_k snapshot for all registered validators."""
    return export_engine_snapshot(settings.attestation_secret)


@router.post("/verify")
def nase_verify(body: VerifyBody, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Verify freshness + nonce + S_attest = H(N || sum(ω·φ)).

    Fail-closed → HTTP 401/403 so nnacc-v2 can lock vault UI.
    """
    result = verify_attestation(
        attestation_timestamp=body.attestation_timestamp,
        nonce=body.nonce,
        client_s_attest=body.client_s_attest,
        client_binding_hash=body.client_binding_hash,
        extra_material=body.extra_material,
        delta_seconds=body.delta_seconds,
        require_nonce=body.require_nonce,
        require_s_attest=body.require_s_attest,
        attestation_secret=settings.attestation_secret,
    )
    if not result["ok"]:
        raise HTTPException(status_code=int(result.get("http_hint") or 401), detail=result)
    return result


@router.post("/vault-sync")
def nase_vault_sync(body: VaultSyncBody) -> dict[str, Any]:
    """Accept encrypted vault blob. Server stores ciphertext only (never decrypts)."""
    try:
        return vault_sync_put(
            body.ciphertext_b64,
            body.content_hash,
            body.session_hint,
            body.identity_hint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/vault-sync/{blob_id}")
def nase_vault_sync_get(blob_id: str) -> dict[str, Any]:
    rec = vault_sync_get(blob_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="blob not found")
    return rec


@router.get("/vault-sync-status")
def nase_vault_status() -> dict[str, Any]:
    from app.nase.attestation import vault_sync_count

    return {
        "durable": True,
        "backend": "sqlite",
        "path": get_vault_db_path(),
        "count": vault_sync_count(),
    }
