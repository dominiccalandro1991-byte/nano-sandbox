"""1536-d embeddings: OpenRouter/OpenAI text-embedding-3-small, else deterministic hash.

Hash fallback keeps ingest live with no extra key and makes identical stacks match
at cosine distance 0. It is not a substitute for the paid embedding model.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import urllib.request
from typing import Any

log = logging.getLogger("incidentdojo.embeddings")

DIM = 1536
MODEL = "openai/text-embedding-3-small"


def l2_normalize(vec: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / n for x in vec]


def hash_embedding(text: str, dim: int = DIM) -> list[float]:
    raw = (text or "").encode("utf-8")
    out: list[float] = []
    i = 0
    while len(out) < dim:
        block = hashlib.sha256(raw + b"#" + str(i).encode("ascii")).digest()
        for b in block:
            out.append((b / 127.5) - 1.0)
            if len(out) >= dim:
                break
        i += 1
    return l2_normalize(out[:dim])


def cosine_distance(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 1.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    sim = max(-1.0, min(1.0, dot / (na * nb)))
    return 1.0 - sim


def _openrouter_embed(text: str, api_key: str, base_url: str) -> list[float] | None:
    url = base_url.rstrip("/") + "/embeddings"
    body = json.dumps({"model": MODEL, "input": (text or "")[:8000]}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://dominiccalandro1991-byte.github.io/nano-sandbox/",
            "X-Title": "IncidentDojo",
        },
    )
    with urllib.request.urlopen(req, timeout=12) as resp:
        payload: dict[str, Any] = json.loads(resp.read().decode("utf-8"))
    vec = (((payload.get("data") or [{}])[0]).get("embedding")) or []
    if not isinstance(vec, list) or not vec:
        return None
    nums = [float(x) for x in vec]
    if len(nums) < DIM:
        nums = nums + [0.0] * (DIM - len(nums))
    return l2_normalize(nums[:DIM])


def embed(text: str) -> tuple[list[float], str]:
    from app.config import get_settings, resolved_openrouter_key

    settings = get_settings()
    key = resolved_openrouter_key(settings)
    base = (getattr(settings, "openrouter_base_url", None) or "https://openrouter.ai/api/v1").rstrip("/")
    if key and not os.environ.get("PYTEST_CURRENT_TEST"):
        try:
            vec = _openrouter_embed(text, key, base)
            if vec:
                return vec, "openrouter:text-embedding-3-small"
        except Exception as exc:  # noqa: BLE001
            log.warning("openrouter embed failed: %s", type(exc).__name__)
    return hash_embedding(text), "hash:sha256-expand"
