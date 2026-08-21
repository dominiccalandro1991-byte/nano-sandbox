"""Upstream forwarder with key rotation. Callers never receive the upstream key."""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from typing import Any

from app.keyharbor import audit, bucket, vault

log = logging.getLogger("keyharbor.proxy")
OPENROUTER = "https://openrouter.ai/api/v1"
REFERER = "https://dominiccalandro1991-byte.github.io/nano-sandbox/"
TITLE = "KeyHarbor"


def _post(url: str, payload: dict[str, Any], api_key: str, timeout: float) -> tuple[int, bytes]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": REFERER,
            "X-Title": TITLE,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return int(getattr(resp, "status", 200)), resp.read()
    except urllib.error.HTTPError as exc:
        return int(exc.code), exc.read() if exc.fp else b""


def forward(
    *,
    service: str,
    path: str,
    payload: dict[str, Any],
    timeout: float = 60.0,
    cost: float = 1.0,
) -> dict[str, Any]:
    ok, meta = bucket.allow(service, cost)
    if not ok:
        audit.record(service=service, path=path, status=429, latency_ms=0, nbytes=0, tokens=cost)
        return {"ok": False, "status": 429, "error": "budget_exceeded", "budget": meta}

    started = time.perf_counter()
    last_status = 503
    last_body = b""
    attempts = max(1, vault.count())
    used_id = ""
    for _ in range(attempts):
        got = vault.acquire()
        if not got:
            break
        used_id, api_key = got
        status, raw = _post(f"{OPENROUTER}{path}", payload, api_key, timeout)
        last_status, last_body = status, raw
        if status in (401, 429, 402):
            vault.trip(used_id)
            continue
        break
    latency = (time.perf_counter() - started) * 1000.0
    audit.record(
        service=service,
        path=path,
        status=last_status,
        latency_ms=latency,
        nbytes=len(last_body),
        tokens=cost,
    )
    parsed: Any
    try:
        parsed = json.loads(last_body.decode("utf-8") or "null")
    except Exception:
        parsed = {"raw": last_body.decode("utf-8", "replace")[:400]}
    if last_status >= 400:
        return {"ok": False, "status": last_status, "error": "upstream", "detail": parsed, "budget": meta}
    return {"ok": True, "status": last_status, "data": parsed, "budget": meta, "latency_ms": round(latency, 1)}


def chat(service: str, payload: dict[str, Any]) -> dict[str, Any]:
    cost = 1.0
    try:
        cost += max(0, int(payload.get("max_tokens") or 0)) / 1000.0
    except Exception:
        pass
    return forward(service=service, path="/chat/completions", payload=payload, timeout=180.0, cost=cost)


def embeddings(service: str, payload: dict[str, Any]) -> dict[str, Any]:
    return forward(service=service, path="/embeddings", payload=payload, timeout=20.0, cost=1.0)
