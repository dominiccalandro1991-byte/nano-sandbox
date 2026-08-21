"""Ephemeral thread-share snapshots. In-memory, $0.00 OPEX, no Supabase."""
from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/shares", tags=["shares"])

_MAX = 200
_TTL_SEC = 7 * 24 * 3600
_STORE: dict[str, dict[str, Any]] = {}


class ShareIn(BaseModel):
    title: str = "Shared chat"
    messages: list[dict[str, Any]] = Field(default_factory=list)


def _purge() -> None:
    now = time.time()
    dead = [k for k, v in _STORE.items() if now - float(v.get("created_at") or 0) > _TTL_SEC]
    for k in dead:
        _STORE.pop(k, None)
    while len(_STORE) > _MAX:
        oldest = min(_STORE.items(), key=lambda kv: float(kv[1].get("created_at") or 0))
        _STORE.pop(oldest[0], None)


@router.post("")
def create_share(body: ShareIn) -> dict[str, Any]:
    _purge()
    share_id = uuid.uuid4().hex[:12]
    cleaned = []
    for m in body.messages:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant", "system"):
            continue
        cleaned.append(
            {
                "role": role,
                "text": str(m.get("text") or m.get("content") or "")[:8000],
                "ts": m.get("ts"),
                "kind": m.get("kind"),
            }
        )
    _STORE[share_id] = {
        "id": share_id,
        "title": (body.title or "Shared chat")[:160],
        "messages": cleaned[:200],
        "created_at": time.time(),
    }
    return {"id": share_id, "url_path": f"#share/{share_id}", "expires_in_seconds": _TTL_SEC}


@router.get("/{share_id}")
def get_share(share_id: str) -> dict[str, Any]:
    _purge()
    row = _STORE.get(share_id)
    if not row:
        raise HTTPException(status_code=404, detail="share_not_found")
    return row
