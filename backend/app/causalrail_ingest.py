"""HTTP-only notify to CausalRail. Separate product. Separate database.

Never accepts a postgres URI. Never imports engine modules.
ProofPatch verify still succeeds or fails independently of this call.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any

log = logging.getLogger("causalrail_ingest")

DEFAULT_URL = "https://causalrail-api.onrender.com/api/ingest"
SKIP_STATUS = {400, 413, 503}


def safe_ingest_url(raw: str | None) -> str:
    url = (raw or "").strip()
    if not url:
        return ""
    lowered = url.lower()
    if "postgres" in lowered or "postgresql" in lowered or "supabase.com" in lowered:
        log.warning("causalrail ingest url looks like a database URI; refusing")
        return ""
    if not lowered.startswith("https://"):
        return ""
    return url.rstrip("/")


def should_notify(result: dict[str, Any]) -> bool:
    if result.get("ok") is True:
        return False
    try:
        status = int(result.get("status") or 0)
    except (TypeError, ValueError):
        status = 0
    if status in SKIP_STATUS:
        return False
    if not result.get("branch") and not result.get("logs"):
        return False
    return True


def notify_proofpatch_failure(
    *,
    repo: str,
    result: dict[str, Any],
    ingest_url: str | None = None,
    user_id: str = "demo",
) -> bool:
    try:
        if not should_notify(result):
            return False
        url = safe_ingest_url(ingest_url if ingest_url is not None else DEFAULT_URL)
        if not url:
            return False
        logs = result.get("logs") or []
        if isinstance(logs, list):
            blob = "\n".join(str(x) for x in logs)
        else:
            blob = str(logs)
        raw_log = (
            "ProofPatch verify failed\n"
            f"repo={repo}\n"
            f"error={result.get('error')}\n"
            f"branch={result.get('branch')}\n"
            f"attempts={result.get('attempts')}\n"
            f"tests={result.get('tests')}\n"
            f"frontend_smoke={result.get('frontend_smoke')}\n"
            f"{blob}"
        )[-12000:]
        payload = {
            "userId": user_id,
            "repo": repo,
            "workflow": "proofpatch",
            "branch": str(result.get("branch") or "main"),
            "rawLog": raw_log,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            resp.read(256)
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("causalrail ingest skipped: %s", type(exc).__name__)
        return False
