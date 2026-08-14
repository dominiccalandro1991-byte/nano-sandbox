"""NASE HTTP surface: TEE-sealed vectors, S_attest, SQLAlchemy vault-sync, rotation status.

Evidence classification
-----------------------
- Endpoints wrap Partially Verified modules (engine_vectors, attestation, kms,
  secret_rotation, vault_db).
- Physical multi-region Postgres / cloud KMS / live OIDC JWKS: Missing until
  environment credentials are provisioned; architecture is ready.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.nase.attestation import (
    issue_nonce_with_vectors,
    verify_attestation,
    vault_sync_put,
    vault_sync_get,
    vault_sync_count,
)
from app.nase.engine_vectors import export_engine_snapshot
from app.nase.invariants import DEFAULT_DELTA_SECONDS
from app.nase.secret_rotation import get_rotator

router = APIRouter(prefix="/nase", tags=["nase"])


class VerifyBody(BaseModel):
    attestation_timestamp: float | None = None
    nonce: str | None = None
    client_s_attest: str | None = None
    client_binding_hash: str | None = None
    extra_material: str | None = None
    delta_seconds: float = DEFAULT_DELTA_SECONDS
    require_nonce: bool = True
    require_s_attest: bool = True


class VaultSyncBody(BaseModel):
    ciphertext_b64: str
    content_hash: str
    session_hint: str | None = None
    identity_hint: str | None = None


@router.post("/nonce")
@router.get("/nonce")
def nase_nonce(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return issue_nonce_with_vectors(
        settings.kms_seed,
        rotation_seconds=settings.hmac_rotation_seconds,
        grace_seconds=settings.hmac_grace_seconds,
        kms_provider=settings.kms_provider,
    )


@router.get("/engine-vectors")
def nase_engine_vectors(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return export_engine_snapshot(
        settings.kms_seed,
        rotation_seconds=settings.hmac_rotation_seconds,
        grace_seconds=settings.hmac_grace_seconds,
        kms_provider=settings.kms_provider,
    )


@router.post("/verify")
def nase_verify(body: VerifyBody, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    result = verify_attestation(
        attestation_timestamp=body.attestation_timestamp,
        nonce=body.nonce,
        client_s_attest=body.client_s_attest,
        client_binding_hash=body.client_binding_hash,
        extra_material=body.extra_material,
        delta_seconds=body.delta_seconds,
        require_nonce=body.require_nonce,
        require_s_attest=body.require_s_attest,
        attestation_secret=settings.kms_seed,
    )
    if not result["ok"]:
        raise HTTPException(status_code=int(result.get("http_hint") or 401), detail=result)
    return result


@router.post("/vault-sync")
def nase_vault_sync(body: VaultSyncBody) -> dict[str, Any]:
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
def nase_vault_status(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    from app.nase import vault_db
    try:
        st = vault_db.status()
    except Exception as exc:  # noqa: BLE001
        st = {"initialized": False, "last_init_error": str(exc), "count": None}
    return {
        "durable": True,
        "backend": "sqlalchemy",
        "table": "nase_vault_blobs",
        "database_url_scheme": settings.database_url.split(":", 1)[0],
        "supabase_project_ref": settings.supabase_project_ref,
        "supabase_host": settings.supabase_host,
        "read_replica_configured": bool(settings.database_read_url),
        "vault": st,
        "count": st.get("count"),
    }


@router.post("/rotate-hmac")
def nase_rotate_hmac(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    """Force HMAC secret rotation (ops / test endpoint)."""
    rotator = get_rotator(
        settings.kms_seed,
        settings.hmac_rotation_seconds,
        settings.hmac_grace_seconds,
    )
    ver = rotator.force_rotate()
    return {
        "rotated": True,
        "version_id": ver.version_id,
        "activated_at": ver.activated_at,
        "grace_seconds": settings.hmac_grace_seconds,
    }
