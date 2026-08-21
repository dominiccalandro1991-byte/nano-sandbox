"""POST /proofpatch/verify — isolated branch test. Does not load engine modules."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.config import get_settings
from app.proofpatch import verify
from app.causalrail_ingest import notify_proofpatch_failure

router = APIRouter(prefix="/proofpatch", tags=["proofpatch"])


class VerifyIn(BaseModel):
    repo: str = "dominiccalandro1991-byte/nano-sandbox"
    base: str = "main"
    patch: str | None = Field(default=None, max_length=200_000)


@router.post("/verify")
def proofpatch_verify(body: VerifyIn) -> dict[str, Any]:
    settings = get_settings()
    allowed = tuple(
        r.strip()
        for r in (getattr(settings, "proofpatch_allowed_repos", "") or "dominiccalandro1991-byte/nano-sandbox").split(",")
        if r.strip()
    )
    result = verify(
        repo=body.repo,
        base=body.base or "main",
        patch=body.patch,
        enabled=bool(getattr(settings, "proofpatch_enabled", True)),
        allowed_repos=allowed,
        timeout=float(getattr(settings, "proofpatch_timeout_seconds", 90.0)),
    )
    if not result.get("ok"):
        notify_proofpatch_failure(
            repo=body.repo,
            result=result,
            ingest_url=getattr(settings, "causalrail_ingest_url", None),
        )
    status = int(result.pop("status", 200))
    if status >= 400:
        raise HTTPException(status_code=status, detail=result)
    return result


@router.get("/health")
def proofpatch_health() -> dict[str, Any]:
    settings = get_settings()
    return {
        "ok": True,
        "enabled": bool(getattr(settings, "proofpatch_enabled", True)),
        "endpoint": "POST /proofpatch/verify",
    }
