"""Fire-and-forget ProofPatch ↔ IncidentDojo. Never raises. Never imports engines."""
from __future__ import annotations

import logging
from typing import Any

from app.incidentdojo.crypto import proofpatch_commit_sha

log = logging.getLogger("incidentdojo.hooks")


def notify_from_proofpatch(*, result: dict[str, Any], patch: str | None, error_stack: str = "") -> None:
    try:
        from app.incidentdojo import store

        if not store.ready():
            return
        logs = result.get("logs") or []
        if isinstance(logs, list):
            blob = "\n".join(str(x) for x in logs)
        else:
            blob = str(logs)
        stack = (error_stack or "").strip() or blob
        if result.get("ok") and patch and patch.strip():
            store.record_remediation(
                patch_diff=patch,
                error_stack=stack or patch[:4000],
                proofpatch_sha=proofpatch_commit_sha(patch),
            )
            return
        if not result.get("ok") and stack:
            store.record_failure(error_stack=stack)
    except Exception as exc:  # noqa: BLE001
        log.warning("proofpatch hook skipped: %s", type(exc).__name__)
