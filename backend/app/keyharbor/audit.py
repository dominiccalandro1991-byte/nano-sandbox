"""Stdout JSON audit. No secrets. Ring buffer for the Settings pane."""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any

log = logging.getLogger("keyharbor.audit")
_lock = threading.Lock()
_ring: list[dict[str, Any]] = []
MAX = 50


def record(*, service: str, path: str, status: int, latency_ms: float, nbytes: int, tokens: float) -> None:
    row = {
        "ts": time.time(),
        "service": service,
        "path": path,
        "status": int(status),
        "latency_ms": round(float(latency_ms), 1),
        "bytes": int(nbytes),
        "tokens": round(float(tokens), 3),
    }
    line = json.dumps(row, separators=(",", ":"))
    log.info("%s", line)
    with _lock:
        _ring.append(row)
        del _ring[:-MAX]


def recent(limit: int = 20) -> list[dict[str, Any]]:
    n = max(1, min(int(limit), MAX))
    with _lock:
        return list(_ring[-n:])
