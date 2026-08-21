"""IncidentDojo HTTP API. Does not load engine modules."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.incidentdojo import store

log = logging.getLogger("incidentdojo.router")
router = APIRouter(prefix="/incidentdojo", tags=["incidentdojo"])


class FailureIn(BaseModel):
    error_stack: str = Field(..., min_length=1, max_length=200_000)
    causalrail_trace_id: str | None = None
    fingerprint: str = ""
    repo: str = ""
    workflow: str = ""


class RemediationIn(BaseModel):
    patch_diff: str = Field(..., min_length=1, max_length=200_000)
    error_stack: str = ""
    causalrail_trace_id: str | None = None
    fingerprint: str = ""
    proofpatch_commit_sha: str | None = None


class QueryIn(BaseModel):
    error_stack: str = Field(..., min_length=1, max_length=200_000)
    threshold: float | None = None


@router.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ok": True,
        "service": "incidentdojo",
        "enabled": bool(getattr(settings, "incidentdojo_enabled", True)),
        "ready": store.ready(),
        "threshold": float(getattr(settings, "incidentdojo_threshold", store.THRESHOLD)),
        "vector_dim": 1536,
    }


@router.post("/ingest-failure")
def ingest_failure(body: FailureIn) -> dict[str, Any]:
    _require_ready()
    try:
        return store.record_failure(
            error_stack=body.error_stack,
            causalrail_trace_id=body.causalrail_trace_id,
            fingerprint=body.fingerprint,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("ingest-failure failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="incidentdojo_unavailable") from exc


@router.post("/ingest-remediation")
def ingest_remediation(body: RemediationIn) -> dict[str, Any]:
    _require_ready()
    try:
        return store.record_remediation(
            patch_diff=body.patch_diff,
            error_stack=body.error_stack,
            causalrail_trace_id=body.causalrail_trace_id,
            fingerprint=body.fingerprint,
            proofpatch_sha=body.proofpatch_commit_sha,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("ingest-remediation failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="incidentdojo_unavailable") from exc


@router.post("/query")
def query(body: QueryIn) -> dict[str, Any]:
    _require_ready()
    settings = get_settings()
    threshold = body.threshold
    if threshold is None:
        threshold = float(getattr(settings, "incidentdojo_threshold", store.THRESHOLD))
    try:
        return store.query_patch(body.error_stack, threshold=float(threshold))
    except Exception as exc:  # noqa: BLE001
        log.warning("query failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="incidentdojo_unavailable") from exc


@router.get("/incidents")
def incidents(limit: int = 20) -> dict[str, Any]:
    _require_ready()
    try:
        return {"incidents": store.list_recent(limit)}
    except Exception as exc:  # noqa: BLE001
        log.warning("list failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="incidentdojo_unavailable") from exc


def _require_ready() -> None:
    settings = get_settings()
    if not bool(getattr(settings, "incidentdojo_enabled", True)):
        raise HTTPException(status_code=503, detail="incidentdojo_disabled")
    if not store.ready():
        raise HTTPException(status_code=503, detail="incidentdojo_not_initialized")
