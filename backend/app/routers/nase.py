"""NASE HTTP surface: nonce issue, attestation verify, ephemeral vault-sync.

Evidence classification
-----------------------
- Endpoints wrap Partially Verified / Verified pure predicates from
  app.nase.attestation and app.nase.invariants.
- Does NOT implement the fabricated multi-engine weighted state-vector sum
  from the external directive; that material is Missing in this repository.
- Vault-sync is an ephemeral in-process store for memory-mode client mitigation;
  not durable multi-tenant storage.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.nase.attestation import (
    issue_nonce,
    verify_attestation,
    vault_sync_put,
    vault_sync_get,
)
from app.nase.invariants import DEFAULT_DELTA_SECONDS

router = APIRouter(prefix="/nase", tags=["nase"])


class VerifyBody(BaseModel):
    attestation_timestamp: float | None = Field(
        default=None, description="Client attestation wall-clock (seconds)."
    )
    nonce: str | None = None
    client_binding_hash: str | None = Field(
        default=None,
        description="SHA-256 hex of nonce|attestation_timestamp|extra (optional).",
    )
    extra_material: str | None = None
    delta_seconds: float = DEFAULT_DELTA_SECONDS
    require_nonce: bool = True


class VaultSyncBody(BaseModel):
    ciphertext_b64: str
    content_hash: str = Field(..., description="Client content hash (hex) of plaintext or cipher.")
    session_hint: str | None = None


@router.post("/nonce")
@router.get("/nonce")
def nase_nonce() -> dict[str, Any]:
    """Issue a single-use server nonce for attestation binding."""
    return issue_nonce()


@router.post("/verify")
def nase_verify(body: VerifyBody) -> dict[str, Any]:
    """Verify attestation freshness (+ optional nonce + binding hash).

    Maps fail-closed results to HTTP 401/403 so the nnacc-v2 client can lock vault UI.
    """
    result = verify_attestation(
        attestation_timestamp=body.attestation_timestamp,
        nonce=body.nonce,
        client_binding_hash=body.client_binding_hash,
        extra_material=body.extra_material,
        delta_seconds=body.delta_seconds,
        require_nonce=body.require_nonce,
    )
    if not result["ok"]:
        raise HTTPException(status_code=int(result.get("http_hint") or 401), detail=result)
    return result


@router.post("/vault-sync")
def nase_vault_sync(body: VaultSyncBody) -> dict[str, Any]:
    """Accept encrypted vault blob from client operating in memory-only mode."""
    try:
        return vault_sync_put(body.ciphertext_b64, body.content_hash, body.session_hint)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/vault-sync/{blob_id}")
def nase_vault_sync_get(blob_id: str) -> dict[str, Any]:
    rec = vault_sync_get(blob_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="blob not found")
    return rec
