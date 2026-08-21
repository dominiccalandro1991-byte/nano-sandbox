"""Immutable origin hashes. No engine imports."""
from __future__ import annotations

import hashlib
import uuid


def sha256_hex(payload: str) -> str:
    return hashlib.sha256((payload or "").encode("utf-8")).hexdigest()


def proofpatch_commit_sha(patch_diff: str) -> str:
    """ProofPatch does not push a git commit. SHA-256 of the diff is the cryptographic link."""
    return sha256_hex(patch_diff or "")


def origin_hash(*, signature: str, fingerprint: str = "", trace_id: str = "", patch_sha: str = "") -> str:
    return sha256_hex("|".join([signature.strip(), fingerprint.strip(), trace_id.strip(), patch_sha.strip()]))


def as_uuid(value: str | None, *, fallback_key: str = "") -> str:
    raw = (value or "").strip()
    try:
        return str(uuid.UUID(raw))
    except Exception:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, fallback_key or raw or "incidentdojo:empty"))
