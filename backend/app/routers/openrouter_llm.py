"""OpenRouter LLM proxy — key stays server-side.

Supports high max_tokens and optional SSE streaming for long generations.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import Settings, get_settings, resolved_openrouter_key

router = APIRouter(prefix="/llm", tags=["llm"])

FREE_MODELS: list[dict[str, Any]] = [
    {
        "id": "poolside/laguna-s-2.1:free",
        "label": "Laguna S 2.1 (Lead Architect)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
        "context_max": 131072,
    },
    {
        "id": "poolside/laguna-xs-2.1:free",
        "label": "Laguna XS 2.1 (Fast Iteration)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
        "context_max": 131072,
    },
    {
        "id": "openai/gpt-oss-20b:free",
        "label": "GPT-OSS 20B (Code Reviewer)",
        "category": "coding_pro",
        "category_label": "Coding Pro (Free)",
        "context_max": 131072,
    },
    {
        "id": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "label": "Nemotron 3 Ultra (Deep Reasoning)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
        "context_max": 262144,
    },
    {
        "id": "nvidia/nemotron-3-super-120b-a12b:free",
        "label": "Nemotron 3 Super (Balanced)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
        "context_max": 262144,
    },
    {
        "id": "google/gemma-4-26b-a4b-it:free",
        "label": "Gemma 4 26B (Generalist)",
        "category": "general",
        "category_label": "General Chat & Reasoning (Free)",
        "context_max": 131072,
    },
]

ALLOWED_IDS = {m["id"] for m in FREE_MODELS}
CONTEXT_MAX = {m["id"]: int(m["context_max"]) for m in FREE_MODELS}
DELTA_BUFFER = 256
HARD_CAP_OUT = 65536


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    model: str = Field(..., description="OpenRouter model id from free catalog")
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int | None = None
    persona: str | None = None
    engine_id: int | None = None
    stream: bool = False


def _estimate_tokens(text: str) -> int:
    # Rough heuristic ~4 chars/token for mixed code+prose
    return max(1, (len(text) + 3) // 4)


def _compute_max_out(model: str, messages: list[dict[str, str]], requested: int | None) -> int:
    c_max = CONTEXT_MAX.get(model, 131072)
    tin = sum(_estimate_tokens(m.get("content", "")) + 4 for m in messages)
    tin += 64  # system overhead
    budget = c_max - tin - DELTA_BUFFER
    if budget < 256:
        budget = 256
    if requested is not None and requested > 0:
        budget = min(budget, requested)
    return min(budget, HARD_CAP_OUT)


def _build_messages(body: ChatBody) -> list[dict[str, str]]:
    system_bits: list[str] = [
        "You are Voltage Cipher Studio, a multi-engine full-stack assistant.",
        "When generating software, emit complete multi-file repositories.",
        "Wrap every file in a Markdown fenced code block whose info string is the exact file path,",
        "e.g. ```src/components/App.tsx",
        "Do not truncate critical files; if approaching limits, end with CONTINUE_NEEDED.",
    ]
    if body.persona:
        system_bits.append(f"Active artist persona: {body.persona}.")
    if body.engine_id is not None:
        system_bits.append(f"Bound diagnostic engine id: {body.engine_id}.")
    messages: list[dict[str, str]] = [{"role": "system", "content": " ".join(system_bits)}]
    for m in body.messages:
        role = m.role if m.role in ("user", "assistant", "system") else "user"
        messages.append({"role": role, "content": m.content})
    return messages


def _headers(settings: Settings, key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.openrouter_http_referer,
        "X-Title": settings.openrouter_app_title,
    }


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
        "delta_buffer": DELTA_BUFFER,
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

    messages = _build_messages(body)
    max_out = _compute_max_out(
        model, messages, body.max_tokens if body.max_tokens and body.max_tokens > 0 else None
    )
    payload = {
        "model": model,
        "messages": messages,
        "temperature": body.temperature,
        "max_tokens": max_out,
    }
    url = settings.openrouter_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(url, headers=_headers(settings, key), json=payload)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"openrouter_unreachable: {exc}") from exc

    if resp.status_code >= 400:
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

    finish = None
    try:
        finish = data["choices"][0].get("finish_reason")
    except Exception:
        pass

    return {
        "ok": True,
        "model": model,
        "content": content,
        "result": content,
        "usage": data.get("usage"),
        "id": data.get("id"),
        "persona": body.persona,
        "engine_id": body.engine_id,
        "max_tokens_used": max_out,
        "context_max": CONTEXT_MAX.get(model),
        "finish_reason": finish,
        "continue_needed": bool(
            finish == "length"
            or (isinstance(content, str) and "CONTINUE_NEEDED" in content[-80:])
        ),
    }


@router.post("/chat/stream")
async def chat_stream(body: ChatBody, settings: Settings = Depends(get_settings)) -> StreamingResponse:
    model = body.model.strip()
    if model not in ALLOWED_IDS:
        raise HTTPException(status_code=400, detail="model_not_allowed")
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages required")
    key = resolved_openrouter_key(settings)
    if not key:
        raise HTTPException(status_code=503, detail={"error": "openrouter_key_missing"})

    messages = _build_messages(body)
    max_out = _compute_max_out(
        model, messages, body.max_tokens if body.max_tokens and body.max_tokens > 0 else None
    )
    payload = {
        "model": model,
        "messages": messages,
        "temperature": body.temperature,
        "max_tokens": max_out,
        "stream": True,
    }
    url = settings.openrouter_base_url.rstrip("/") + "/chat/completions"

    async def event_generator() -> AsyncIterator[bytes]:
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                async with client.stream(
                    "POST", url, headers=_headers(settings, key), json=payload
                ) as resp:
                    if resp.status_code >= 400:
                        err = await resp.aread()
                        yield f"data: {json.dumps({'error': err.decode('utf-8', 'replace')[:400]})}\n\n".encode()
                        yield b"data: [DONE]\n\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            yield (line + "\n\n").encode("utf-8")
                        else:
                            yield f"data: {line}\n\n".encode("utf-8")
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(exc)})}\n\n".encode()
            yield b"data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
