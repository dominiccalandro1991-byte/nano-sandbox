"""KeyHarbor HTTP surface. Does not load engine modules."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.keyharbor import audit, boot, bucket, proxy, tokens, vault

router = APIRouter(prefix="/keyharbor", tags=["keyharbor"])


class ChatIn(BaseModel):
    model: str
    messages: list[dict[str, Any]]
    temperature: float | None = 0.7
    max_tokens: int | None = None
    stream: bool | None = False


class EmbedIn(BaseModel):
    model: str = "openai/text-embedding-3-small"
    input: str = Field(..., min_length=1, max_length=32_000)


class MintIn(BaseModel):
    service: str = "studio"
    ttl_seconds: int = 3600


def _service(authorization: str | None, x_service: str | None) -> str:
    svc = tokens.service_from_headers(authorization, x_service)
    if not svc:
        raise HTTPException(status_code=401, detail="keyharbor_token_required")
    return svc


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "keyharbor",
        "vault": vault.status(),
        "buckets": bucket.snapshot(),
    }


@router.post("/v1/chat/completions")
def chat_completions(
    body: ChatIn,
    authorization: str | None = Header(default=None),
    x_keyharbor_service: str | None = Header(default=None, alias="X-KeyHarbor-Service"),
) -> dict[str, Any]:
    svc = _service(authorization, x_keyharbor_service)
    payload = body.model_dump(exclude_none=True)
    result = proxy.chat(svc, payload)
    if result.get("status") == 429:
        raise HTTPException(status_code=429, detail=result)
    if not result.get("ok"):
        raise HTTPException(status_code=int(result.get("status") or 502), detail=result)
    return result["data"]


@router.post("/v1/embeddings")
def embeddings(
    body: EmbedIn,
    authorization: str | None = Header(default=None),
    x_keyharbor_service: str | None = Header(default=None, alias="X-KeyHarbor-Service"),
) -> dict[str, Any]:
    svc = _service(authorization, x_keyharbor_service)
    result = proxy.embeddings(svc, body.model_dump())
    if result.get("status") == 429:
        raise HTTPException(status_code=429, detail=result)
    if not result.get("ok"):
        raise HTTPException(status_code=int(result.get("status") or 502), detail=result)
    return result["data"]


@router.post("/tokens")
def mint_token(
    body: MintIn,
    x_keyharbor_mint: str | None = Header(default=None, alias="X-KeyHarbor-Mint"),
) -> dict[str, Any]:
    import hashlib
    import hmac
    import os

    from app.config import get_settings

    settings = get_settings()
    expect = (os.environ.get("NANO_SANDBOX_KEYHARBOR_MINT") or "").strip()
    if not expect:
        expect = hashlib.sha256((settings.kms_seed or "").encode("utf-8") + b"|mint").hexdigest()[:24]
    got = (x_keyharbor_mint or "").strip()
    if not got or not hmac.compare_digest(got, expect):
        raise HTTPException(status_code=401, detail="mint_forbidden")
    token = tokens.mint(body.service, body.ttl_seconds)
    return {"token": token, "service": body.service, "ttl_seconds": body.ttl_seconds}


@router.get("/audit")
def audit_get(limit: int = 20) -> dict[str, Any]:
    return {"events": audit.recent(limit), "vault": vault.status(), "buckets": bucket.snapshot()}


def ensure_boot() -> int:
    if vault.count() == 0:
        return boot.boot()
    return vault.count()
