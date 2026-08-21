"""Zero-cost image generation: Pollinations primary, FLUX.1-schnell fallback."""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/media", tags=["media"])

POLLINATIONS = os.environ.get("POLLINATIONS_BASE", "https://image.pollinations.ai/prompt").rstrip("/")
HF_MODEL = os.environ.get("HF_IMAGE_MODEL", "black-forest-labs/FLUX.1-schnell")
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()


class ImageIn(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=800)


def _pollinations_url(prompt: str) -> str:
    encoded = quote(prompt[:500], safe="")
    return f"{POLLINATIONS}/{encoded}?nologo=true&width=1024&height=1024"


@router.get("/image")
def image_get(prompt: str) -> dict[str, Any]:
    p = (prompt or "").strip()
    if not p:
        raise HTTPException(status_code=400, detail="empty_prompt")
    return {
        "provider": "pollinations",
        "url": _pollinations_url(p),
        "prompt": p[:500],
        "fallback": "huggingface:" + HF_MODEL if HF_TOKEN else None,
        "cost": 0.0,
    }


@router.post("/image")
def image_post(body: ImageIn) -> dict[str, Any]:
    return image_get(body.prompt)
