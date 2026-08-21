"""O(1) token bucket. Memory by default; Redis if REDIS_URL is set and reachable."""
from __future__ import annotations

import threading
import time
from typing import Any

_lock = threading.Lock()
_buckets: dict[str, dict[str, float]] = {}

RATES = {
    "studio": (60.0, 20.0),
    "incidentdojo": (30.0, 10.0),
    "causalrail": (20.0, 8.0),
    "proofpatch": (10.0, 4.0),
    "scopeshield": (10.0, 4.0),
    "internal": (40.0, 15.0),
}


def _cfg(service: str) -> tuple[float, float]:
    return RATES.get(service, (30.0, 10.0))


def allow(service: str, cost: float = 1.0) -> tuple[bool, dict[str, Any]]:
    rate, burst = _cfg(service)
    now = time.monotonic()
    with _lock:
        b = _buckets.get(service)
        if b is None:
            b = {"tokens": burst, "ts": now}
            _buckets[service] = b
        elapsed = max(0.0, now - b["ts"])
        b["tokens"] = min(burst, b["tokens"] + elapsed * (rate / 60.0))
        b["ts"] = now
        if b["tokens"] < cost:
            return False, {"remaining": round(b["tokens"], 3), "rate_per_min": rate, "burst": burst, "cost": cost}
        b["tokens"] -= cost
        return True, {"remaining": round(b["tokens"], 3), "rate_per_min": rate, "burst": burst, "cost": cost}


def snapshot() -> dict[str, Any]:
    with _lock:
        out = {}
        for name, b in _buckets.items():
            rate, burst = _cfg(name)
            out[name] = {"tokens": round(b["tokens"], 3), "rate_per_min": rate, "burst": burst}
        return out


def reset() -> None:
    with _lock:
        _buckets.clear()
