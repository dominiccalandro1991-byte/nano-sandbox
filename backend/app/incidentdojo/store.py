"""IncidentDojo persistence. Own schema. Does not import engines or CausalRail DB."""
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.incidentdojo.crypto import as_uuid, origin_hash, proofpatch_commit_sha
from app.incidentdojo.embeddings import DIM, cosine_distance, embed

log = logging.getLogger("incidentdojo.store")

_lock = threading.Lock()
_engine: Engine | None = None
_is_pg = False
_has_vector = False
THRESHOLD = 0.05


def ready() -> bool:
    return _engine is not None


def init_incidentdojo(database_url: str) -> None:
    global _engine, _is_pg, _has_vector
    url = (database_url or "").strip()
    if not url:
        return
    connect_args: dict[str, Any] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    elif "postgresql" in url or url.startswith("postgres"):
        connect_args["sslmode"] = "require"
        connect_args["prepare_threshold"] = None
    with _lock:
        _engine = create_engine(url, pool_pre_ping=True, future=True, connect_args=connect_args)
        _is_pg = _engine.dialect.name == "postgresql"
        _has_vector = False
        with _engine.begin() as conn:
            if _is_pg:
                try:
                    conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
                    _has_vector = True
                except Exception as exc:  # noqa: BLE001
                    log.warning("pgvector unavailable: %s", type(exc).__name__)
                    _has_vector = False
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS incidentdojo"))
                vec_type = "VECTOR(1536)" if _has_vector else "JSONB"
                conn.execute(
                    text(
                        f"""
                        CREATE TABLE IF NOT EXISTS incidentdojo.incidents (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          causalrail_trace_id UUID,
                          error_signature VARCHAR NOT NULL,
                          error_vector {vec_type} NOT NULL,
                          fingerprint TEXT,
                          origin_hash VARCHAR(64) NOT NULL UNIQUE,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                        """
                    )
                )
                conn.execute(
                    text(
                        """
                        CREATE TABLE IF NOT EXISTS incidentdojo.remediations (
                          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                          incident_id UUID NOT NULL REFERENCES incidentdojo.incidents (id) ON DELETE CASCADE,
                          proofpatch_commit_sha VARCHAR NOT NULL,
                          patch_diff TEXT NOT NULL,
                          origin_hash VARCHAR(64) NOT NULL UNIQUE,
                          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                        """
                    )
                )
                if _has_vector:
                    try:
                        conn.execute(
                            text(
                                "CREATE INDEX IF NOT EXISTS incidents_hnsw "
                                "ON incidentdojo.incidents USING hnsw (error_vector vector_cosine_ops)"
                            )
                        )
                    except Exception as exc:  # noqa: BLE001
                        log.warning("hnsw index skipped: %s", type(exc).__name__)
                conn.execute(text("CREATE INDEX IF NOT EXISTS incidents_fingerprint_idx ON incidentdojo.incidents (fingerprint)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS remediations_incident_idx ON incidentdojo.remediations (incident_id)"))
                for tbl in ("incidentdojo.incidents", "incidentdojo.remediations"):
                    try:
                        conn.execute(text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
                    except Exception:
                        pass
                service = "current_user LIKE 'postgres%'"
                for tbl, pname in (
                    ("incidentdojo.incidents", "incidentdojo_incidents_service"),
                    ("incidentdojo.remediations", "incidentdojo_remediations_service"),
                ):
                    try:
                        conn.execute(text(f"DROP POLICY IF EXISTS {pname} ON {tbl}"))
                        conn.execute(
                            text(
                                f"CREATE POLICY {pname} ON {tbl} FOR ALL USING ({service}) WITH CHECK ({service})"
                            )
                        )
                    except Exception:
                        pass
            else:
                conn.execute(
                    text(
                        """
                        CREATE TABLE IF NOT EXISTS incidents (
                          id TEXT PRIMARY KEY,
                          causalrail_trace_id TEXT,
                          error_signature TEXT NOT NULL,
                          error_vector TEXT NOT NULL,
                          fingerprint TEXT,
                          origin_hash TEXT NOT NULL UNIQUE,
                          created_at TEXT
                        )
                        """
                    )
                )
                conn.execute(
                    text(
                        """
                        CREATE TABLE IF NOT EXISTS remediations (
                          id TEXT PRIMARY KEY,
                          incident_id TEXT NOT NULL,
                          proofpatch_commit_sha TEXT NOT NULL,
                          patch_diff TEXT NOT NULL,
                          origin_hash TEXT NOT NULL UNIQUE,
                          created_at TEXT
                        )
                        """
                    )
                )


def _require() -> Engine:
    if _engine is None:
        raise RuntimeError("incidentdojo not initialized")
    return _engine


def _prefix() -> str:
    return "incidentdojo." if _is_pg else ""


def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


def record_failure(
    *,
    error_stack: str,
    causalrail_trace_id: str | None = None,
    fingerprint: str = "",
) -> dict[str, Any]:
    sig = (error_stack or "").strip()
    if not sig:
        return {"ok": False, "error": "empty_stack"}
    vec, source = embed(sig)
    fp = (fingerprint or "").strip()
    trace = as_uuid(causalrail_trace_id, fallback_key=fp or sig)
    oh = origin_hash(signature=sig, fingerprint=fp, trace_id=trace)
    iid = str(uuid.uuid4())
    eng = _require()
    with eng.begin() as conn:
        if _is_pg and _has_vector:
            conn.execute(
                text(
                    f"""
                    INSERT INTO {_prefix()}incidents
                      (id, causalrail_trace_id, error_signature, error_vector, fingerprint, origin_hash)
                    VALUES
                      (CAST(:id AS uuid), CAST(:trace AS uuid), :sig, CAST(:vec AS vector), :fp, :oh)
                    ON CONFLICT (origin_hash) DO NOTHING
                    """
                ),
                {"id": iid, "trace": trace, "sig": sig[:8000], "vec": _vec_literal(vec), "fp": fp or None, "oh": oh},
            )
        elif _is_pg:
            conn.execute(
                text(
                    f"""
                    INSERT INTO {_prefix()}incidents
                      (id, causalrail_trace_id, error_signature, error_vector, fingerprint, origin_hash)
                    VALUES
                      (CAST(:id AS uuid), CAST(:trace AS uuid), :sig, CAST(:vec AS jsonb), :fp, :oh)
                    ON CONFLICT (origin_hash) DO NOTHING
                    """
                ),
                {"id": iid, "trace": trace, "sig": sig[:8000], "vec": json.dumps(vec), "fp": fp or None, "oh": oh},
            )
        else:
            conn.execute(
                text(
                    f"""
                    INSERT OR IGNORE INTO {_prefix()}incidents
                      (id, causalrail_trace_id, error_signature, error_vector, fingerprint, origin_hash, created_at)
                    VALUES (:id, :trace, :sig, :vec, :fp, :oh, datetime('now'))
                    """
                ),
                {"id": iid, "trace": trace, "sig": sig[:8000], "vec": json.dumps(vec), "fp": fp or None, "oh": oh},
            )
        row = conn.execute(
            text(f"SELECT id FROM {_prefix()}incidents WHERE origin_hash = :oh"),
            {"oh": oh},
        ).first()
    return {
        "ok": True,
        "incident_id": str(row[0]) if row else iid,
        "origin_hash": oh,
        "causalrail_trace_id": trace,
        "embedding": source,
        "dim": DIM,
    }


def record_remediation(
    *,
    patch_diff: str,
    error_stack: str = "",
    causalrail_trace_id: str | None = None,
    fingerprint: str = "",
    proofpatch_sha: str | None = None,
) -> dict[str, Any]:
    diff = patch_diff or ""
    if not diff.strip():
        return {"ok": False, "error": "empty_patch"}
    sig = (error_stack or "").strip() or diff[:4000]
    sha = (proofpatch_sha or "").strip() or proofpatch_commit_sha(diff)
    hit = query_patch(sig, threshold=THRESHOLD)
    if hit.get("incident_id") and float(hit.get("distance") or 1) <= THRESHOLD:
        incident_id = hit["incident_id"]
        failure_meta = {"ok": True, "incident_id": incident_id, "linked": "vector"}
    else:
        failure_meta = record_failure(
            error_stack=sig,
            causalrail_trace_id=causalrail_trace_id,
            fingerprint=fingerprint,
        )
        incident_id = failure_meta.get("incident_id")
    rid = str(uuid.uuid4())
    roh = origin_hash(signature=sig, patch_sha=sha, fingerprint=fingerprint or "", trace_id=str(incident_id or ""))
    eng = _require()
    with eng.begin() as conn:
        if _is_pg:
            conn.execute(
                text(
                    f"""
                    INSERT INTO {_prefix()}remediations
                      (id, incident_id, proofpatch_commit_sha, patch_diff, origin_hash)
                    VALUES
                      (CAST(:id AS uuid), CAST(:iid AS uuid), :sha, :diff, :oh)
                    ON CONFLICT (origin_hash) DO NOTHING
                    """
                ),
                {"id": rid, "iid": incident_id, "sha": sha, "diff": diff[:200_000], "oh": roh},
            )
        else:
            conn.execute(
                text(
                    f"""
                    INSERT OR IGNORE INTO {_prefix()}remediations
                      (id, incident_id, proofpatch_commit_sha, patch_diff, origin_hash, created_at)
                    VALUES (:id, :iid, :sha, :diff, :oh, datetime('now'))
                    """
                ),
                {"id": rid, "iid": incident_id, "sha": sha, "diff": diff[:200_000], "oh": roh},
            )
    return {
        "ok": True,
        "remediation_id": rid,
        "incident_id": incident_id,
        "proofpatch_commit_sha": sha,
        "origin_hash": roh,
        "incident": failure_meta,
    }


def query_patch(error_stack: str, threshold: float = THRESHOLD) -> dict[str, Any]:
    sig = (error_stack or "").strip()
    if not sig:
        return {"hit": False, "error": "empty_stack"}
    vec, source = embed(sig)
    eng = _require()
    best: dict[str, Any] | None = None
    with eng.connect() as conn:
        if _is_pg and _has_vector:
            row = conn.execute(
                text(
                    f"""
                    SELECT i.id, i.causalrail_trace_id, i.error_signature, i.origin_hash, i.fingerprint,
                           r.patch_diff, r.proofpatch_commit_sha,
                           (i.error_vector <=> CAST(:vec AS vector)) AS distance
                    FROM {_prefix()}incidents i
                    LEFT JOIN {_prefix()}remediations r ON r.incident_id = i.id
                    ORDER BY i.error_vector <=> CAST(:vec AS vector),
                             (r.patch_diff IS NULL),
                             r.created_at DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {"vec": _vec_literal(vec)},
            ).mappings().first()
            if row:
                best = dict(row)
                best["distance"] = float(best.get("distance") or 1.0)
        else:
            rows = conn.execute(
                text(
                    f"""
                    SELECT i.id, i.causalrail_trace_id, i.error_signature, i.origin_hash, i.fingerprint,
                           i.error_vector, r.patch_diff, r.proofpatch_commit_sha
                    FROM {_prefix()}incidents i
                    LEFT JOIN {_prefix()}remediations r ON r.incident_id = i.id
                    """
                )
            ).mappings()
            for row in rows:
                stored = row["error_vector"]
                if isinstance(stored, str):
                    stored = json.loads(stored)
                dist = cosine_distance(vec, list(stored))
                patch = row.get("patch_diff")
                better = best is None or dist < best["distance"] or (
                    dist == best["distance"] and patch and not best.get("patch_diff")
                )
                if better:
                    item = dict(row)
                    item.pop("error_vector", None)
                    item["distance"] = dist
                    best = item
    if not best:
        return {"hit": False, "embedding": source, "threshold": threshold}
    dist = float(best["distance"])
    patch = best.get("patch_diff")
    hit = dist <= threshold and bool(patch)
    return {
        "hit": hit,
        "distance": dist,
        "threshold": threshold,
        "incident_id": str(best["id"]),
        "causalrail_trace_id": str(best.get("causalrail_trace_id") or ""),
        "origin_hash": best.get("origin_hash"),
        "fingerprint": best.get("fingerprint"),
        "proofpatch_commit_sha": best.get("proofpatch_commit_sha"),
        "patch_diff": patch if hit else None,
        "embedding": source,
    }


def list_recent(limit: int = 20) -> list[dict[str, Any]]:
    eng = _require()
    lim = max(1, min(int(limit), 100))
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT i.id, i.causalrail_trace_id, i.error_signature, i.fingerprint, i.origin_hash,
                       r.proofpatch_commit_sha
                FROM {_prefix()}incidents i
                LEFT JOIN {_prefix()}remediations r ON r.incident_id = i.id
                ORDER BY i.created_at DESC
                LIMIT {lim}
                """
            )
        ).mappings()
        out = []
        for r in rows:
            item = dict(r)
            sig = item.get("error_signature") or ""
            item["error_signature"] = sig[:240]
            item["id"] = str(item["id"])
            item["causalrail_trace_id"] = str(item.get("causalrail_trace_id") or "")
            out.append(item)
        return out
