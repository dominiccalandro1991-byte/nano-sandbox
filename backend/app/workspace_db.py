"""project_nano_sandbox schema: projects + threads (archive, search)."""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

_lock = threading.Lock()
_engine: Engine | None = None
_is_pg = False


def init_workspace(database_url: str) -> None:
    global _engine, _is_pg
    url = (database_url or "").strip()
    if not url:
        return
    connect_args: dict[str, Any] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    with _lock:
        _engine = create_engine(url, pool_pre_ping=True, future=True, connect_args=connect_args)
        _is_pg = _engine.dialect.name == "postgresql"
        with _engine.begin() as conn:
            if _is_pg:
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS project_nano_sandbox"))
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS project_nano_cloud"))
                prefix = "project_nano_sandbox."
            else:
                prefix = ""
            conn.execute(
                text(
                    f"""
                    CREATE TABLE IF NOT EXISTS {prefix}projects (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      created_at DOUBLE PRECISION NOT NULL
                    )
                    """
                )
            )
            conn.execute(
                text(
                    f"""
                    CREATE TABLE IF NOT EXISTS {prefix}threads (
                      id TEXT PRIMARY KEY,
                      title TEXT,
                      preview TEXT,
                      haystack TEXT,
                      archived INTEGER NOT NULL DEFAULT 0,
                      pinned INTEGER NOT NULL DEFAULT 0,
                      project_id TEXT,
                      updated_at DOUBLE PRECISION NOT NULL,
                      created_at DOUBLE PRECISION NOT NULL
                    )
                    """
                )
            )


def _prefix() -> str:
    return "project_nano_sandbox." if _is_pg else ""


def _require() -> Engine:
    if _engine is None:
        raise RuntimeError("workspace_db not initialized")
    return _engine


def list_projects() -> list[dict[str, Any]]:
    eng = _require()
    with eng.connect() as conn:
        rows = conn.execute(
            text(f"SELECT id, name, created_at FROM {_prefix()}projects ORDER BY created_at DESC")
        ).mappings()
        return [dict(r) for r in rows]


def create_project(name: str) -> dict[str, Any]:
    pid = uuid.uuid4().hex[:12]
    row = {"id": pid, "name": (name or "Folder").strip()[:80], "created_at": time.time()}
    eng = _require()
    with eng.begin() as conn:
        conn.execute(
            text(f"INSERT INTO {_prefix()}projects (id, name, created_at) VALUES (:id, :name, :created_at)"),
            row,
        )
    return row


def delete_project(pid: str) -> None:
    eng = _require()
    with eng.begin() as conn:
        conn.execute(
            text(f"UPDATE {_prefix()}threads SET project_id = NULL WHERE project_id = :id"),
            {"id": pid},
        )
        conn.execute(text(f"DELETE FROM {_prefix()}projects WHERE id = :id"), {"id": pid})


def upsert_thread(payload: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    row = {
        "id": payload["id"],
        "title": (payload.get("title") or "Untitled")[:160],
        "preview": (payload.get("preview") or "")[:240],
        "haystack": (payload.get("haystack") or "")[:8000],
        "archived": 1 if payload.get("archived") else 0,
        "pinned": 1 if payload.get("pinned") else 0,
        "project_id": payload.get("project_id") or None,
        "updated_at": payload.get("updated_at") or now,
        "created_at": payload.get("created_at") or now,
    }
    eng = _require()
    p = _prefix()
    with eng.begin() as conn:
        conn.execute(
            text(
                f"""
                INSERT INTO {p}threads
                  (id, title, preview, haystack, archived, pinned, project_id, updated_at, created_at)
                VALUES
                  (:id, :title, :preview, :haystack, :archived, :pinned, :project_id, :updated_at, :created_at)
                ON CONFLICT (id) DO UPDATE SET
                  title = excluded.title,
                  preview = excluded.preview,
                  haystack = excluded.haystack,
                  archived = excluded.archived,
                  pinned = excluded.pinned,
                  project_id = excluded.project_id,
                  updated_at = excluded.updated_at
                """
            ),
            row,
        )
    return row


def search_threads(q: str, archived: bool | None = None, limit: int = 40) -> list[dict[str, Any]]:
    eng = _require()
    p = _prefix()
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    if q:
        where.append("(lower(title) LIKE :q OR lower(preview) LIKE :q OR lower(haystack) LIKE :q)")
        params["q"] = "%" + q.lower() + "%"
    if archived is True:
        where.append("archived = 1")
    elif archived is False:
        where.append("archived = 0")
    sql = f"""
      SELECT id, title, preview, haystack, archived, pinned, project_id, updated_at, created_at
      FROM {p}threads
      WHERE {' AND '.join(where)}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT :lim
    """
    with eng.connect() as conn:
        rows = conn.execute(text(sql), params).mappings()
        out = []
        for r in rows:
            d = dict(r)
            d["archived"] = bool(d.get("archived"))
            d["pinned"] = bool(d.get("pinned"))
            out.append(d)
        return out


def set_archived(tid: str, archived: bool) -> None:
    eng = _require()
    with eng.begin() as conn:
        conn.execute(
            text(f"UPDATE {_prefix()}threads SET archived = :a, updated_at = :t WHERE id = :id"),
            {"a": 1 if archived else 0, "t": time.time(), "id": tid},
        )


def set_project(tid: str, project_id: str | None) -> None:
    eng = _require()
    with eng.begin() as conn:
        conn.execute(
            text(f"UPDATE {_prefix()}threads SET project_id = :p, updated_at = :t WHERE id = :id"),
            {"p": project_id, "t": time.time(), "id": tid},
        )


def delete_thread(tid: str) -> None:
    eng = _require()
    with eng.begin() as conn:
        conn.execute(text(f"DELETE FROM {_prefix()}threads WHERE id = :id"), {"id": tid})
