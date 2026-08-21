"""Projects, archive, and global thread search (Supabase / SQLite)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import workspace_db as ws

router = APIRouter(prefix="/workspace", tags=["workspace"])


class ProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)


class ThreadIn(BaseModel):
    id: str
    title: str | None = None
    preview: str | None = None
    haystack: str | None = None
    archived: bool = False
    pinned: bool = False
    project_id: str | None = None
    updated_at: float | None = None
    created_at: float | None = None


class ArchiveIn(BaseModel):
    archived: bool = True
    project_id: str | None = None


def _guard() -> None:
    try:
        ws._require()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"workspace_db: {exc}") from exc


@router.get("/projects")
def get_projects() -> dict[str, Any]:
    _guard()
    return {"projects": ws.list_projects()}


@router.post("/projects")
def post_project(body: ProjectIn) -> dict[str, Any]:
    _guard()
    return ws.create_project(body.name)


@router.delete("/projects/{pid}")
def remove_project(pid: str) -> dict[str, str]:
    _guard()
    ws.delete_project(pid)
    return {"ok": "deleted"}


@router.put("/threads")
def put_thread(body: ThreadIn) -> dict[str, Any]:
    _guard()
    return ws.upsert_thread(body.model_dump())


@router.get("/threads/search")
def search(q: str = "", archived: bool | None = None) -> dict[str, Any]:
    _guard()
    return {"q": q, "results": ws.search_threads(q, archived=archived)}


@router.patch("/threads/{tid}")
def patch_thread(tid: str, body: ArchiveIn) -> dict[str, str]:
    _guard()
    ws.set_archived(tid, body.archived)
    if "project_id" in body.model_fields_set:
        ws.set_project(tid, body.project_id)
    return {"ok": "updated"}


@router.delete("/threads/{tid}")
def remove_thread(tid: str) -> dict[str, str]:
    _guard()
    ws.delete_thread(tid)
    return {"ok": "deleted"}
