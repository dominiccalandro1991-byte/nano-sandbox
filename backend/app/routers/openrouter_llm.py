"""OpenRouter LLM proxy — key stays server-side.

Evidence: Partially Verified against OpenRouter chat completions API.
Free-tier model IDs are as specified by product directive; availability
depends on OpenRouter catalog at request time.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, get_settings, resolved_openrouter_key

router = APIRouter(prefix="/llm", tags=["llm"])

# Exact free-tier catalog for Voltage Cipher Studio
FREE_MODELS: list[dict[str, str]] = [
    {
        "id": "poolside/laguna-s-2.1:free",
        "label": "Laguna S 2.1 (Lead Architect)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
    },
    {
        "id": "poolside/laguna-xs-2.1:free",
        "label": "Laguna XS 2.1 (Fast Iteration)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
    },
    {
        "id": "openai/gpt-oss-20b:free",
        "label": "GPT-OSS 20B (Code Reviewer)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
    },
    {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "label": "Nemotron 3 Ultra (Deep Reasoning)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
    },
    {
        "id": "nvidia/nemotron-3-super-120b-a12b:free",
        "label": "Nemotron 3 Super (Balanced)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
    },
    {
        "id": "google/gemma-4-26b-a4b-it:free",
        "label": "Gemma 4 26B (Generalist)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
    },
]

ALLOWED_IDS = {m["id"] for m in FREE_MODELS}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    model: str = Field(..., description="OpenRouter model id from free catalog")
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 2048
    persona: str | None = None
    engine_id: int | None = None


@router.get("/models")
def list_models() -> dict[str, Any]:
    coding = [m for m in FREE_MODELS if m["category"] == "coding_pro"]
    general = [m for m in FREE_MODELS if m["category"] == "general"]
    return {
        "categories": [
            {"id": "coding_pro", "label": "Coding Pro (Free)", "models": coding},
            {"id": "general", "label": "General Chat & Reasoning (Free)", "models": general},
        ],
        "models": FREE_MODELS,
        "default": "google/gemma-4-26b-a4b-it:free",
    }


@router.post("/chat")
async def chat(body: ChatBody, settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    model = body.model.strip()
    if model not in ALLOWED_IDS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "model_not_allowed",
                "message": f"Model must be one of free catalog: {sorted(ALLOWED_IDS)}",
            },
        )
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    key = resolved_openrouter_key(settings)
    if not key:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "openrouter_key_missing",
                "message": "Set NANO_SANDBOX_OPENROUTER_API_KEY or OPENROUTER_API_KEY on the server",
            },
        )

    system_bits: list[str] = [
        "You are Voltage Cipher Studio, a multi-engine assistant.",
        "Be clear, helpful, and prefer structured answers with code fences when coding.",
    ]
    if body.persona:
        system_bits.append(f"Active artist persona: {body.persona}.")
    if body.engine_id is not None:
        system_bits.append(f"Bound diagnostic engine id: {body.engine_id}.")

    messages: list[dict[str, str]] = [{"role": "system", "content": " ".join(system_bits)}]
    for m in body.messages:
        role = m.role if m.role in ("user", "assistant", "system") else "user"
        messages.append({"role": role, "content": m.content})

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.openrouter_http_referer,
        "X-Title": settings.openrouter_app_title,
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
    }
    url = settings.openrouter_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"openrouter_unreachable: {exc}") from exc

    if resp.status_code >= 400:
        detail: Any
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text[:500]
        raise HTTPException(status_code=502, detail={"openrouter_error": detail, "status": resp.status_code})

    data = resp.json()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"error": "malformed_openrouter_response", "raw": data}) from exc

    return {
        "ok": True,
        "model": model,
        "content": content,
        "result": content,
        "usage": data.get("usage"),
        "id": data.get("id"),
        "persona": body.persona,
        "engine_id": body.engine_id,
    }
