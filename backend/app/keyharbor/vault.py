"""Encrypted in-process key enclave. Round-robin with error cooldown."""
from __future__ import annotations

import threading
import time
from typing import Any

from app.keyharbor.crypto import derive_key, open_sealed, seal

_lock = threading.Lock()
_master: bytes | None = None
_keys: list[dict[str, Any]] = []
_rr = 0
COOLDOWN = 30.0


def init_vault(seed: str, raw_keys: list[str]) -> int:
    global _master, _keys, _rr
    _master = derive_key(seed)
    sealed: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, raw in enumerate(raw_keys):
        k = (raw or "").strip()
        if not k or k in seen:
            continue
        seen.add(k)
        sealed.append({
            "id": f"k{i}",
            "blob": seal(k, _master),
            "cool_until": 0.0,
            "errors": 0,
        })
    with _lock:
        _keys = sealed
        _rr = 0
    return len(sealed)


def count() -> int:
    return len(_keys)


def _open(entry: dict[str, Any]) -> str:
    if _master is None:
        raise RuntimeError("vault_not_initialized")
    return open_sealed(entry["blob"], _master)


def acquire() -> tuple[str, str] | None:
    """Return (key_id, plaintext) or None. Plaintext must not be logged."""
    now = time.monotonic()
    with _lock:
        if not _keys:
            return None
        n = len(_keys)
        global _rr
        for _ in range(n):
            entry = _keys[_rr % n]
            _rr += 1
            if entry["cool_until"] > now:
                continue
            return entry["id"], _open(entry)
        return _keys[0]["id"], _open(_keys[0])


def trip(key_id: str) -> None:
    now = time.monotonic()
    with _lock:
        for entry in _keys:
            if entry["id"] == key_id:
                entry["errors"] += 1
                entry["cool_until"] = now + COOLDOWN
                return


def status() -> dict[str, Any]:
    now = time.monotonic()
    with _lock:
        return {
            "keys": len(_keys),
            "cooling": sum(1 for k in _keys if k["cool_until"] > now),
            "errors": sum(int(k["errors"]) for k in _keys),
        }
