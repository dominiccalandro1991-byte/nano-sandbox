"""Zero-cost web search via DuckDuckGo (ddgs). O(1) HTTP hop."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/search", tags=["search"])

try:
    from ddgs import DDGS  # type: ignore
except ImportError:  # pragma: no cover
    try:
        from duckduckgo_search import DDGS  # type: ignore
    except ImportError:
        DDGS = None  # type: ignore


class SearchIn(BaseModel):
    q: str = Field(..., min_length=1, max_length=400)
    max_results: int = Field(5, ge=1, le=10)


@router.post("")
def search(body: SearchIn) -> dict[str, Any]:
    q = body.q.strip()
    if not q:
        raise HTTPException(status_code=400, detail="empty_query")
    if DDGS is None:
        raise HTTPException(status_code=503, detail="ddgs_not_installed")
    rows: list[dict[str, Any]] = []
    try:
        with DDGS() as client:
            for item in client.text(q, max_results=body.max_results):
                rows.append(
                    {
                        "title": item.get("title") or "",
                        "href": item.get("href") or item.get("url") or "",
                        "body": (item.get("body") or item.get("snippet") or "")[:400],
                    }
                )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"ddgs_failed: {exc}") from exc
    return {"q": q, "results": rows, "provider": "ddgs", "cost": 0.0}


@router.get("")
def search_get(q: str, max_results: int = 5) -> dict[str, Any]:
    return search(SearchIn(q=q, max_results=max(1, min(10, max_results))))
