"""NNACC session hashing — every message is a CAS leaf."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_message(role: str, content: str, ts: float) -> str:
    blob = _canonical({"role": role, "content": content, "ts": ts})
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def session_merkle(message_hashes: list[str]) -> str:
    if not message_hashes:
        return hashlib.sha256(b"").hexdigest()
    layer = [h.lower() for h in message_hashes]
    while len(layer) > 1:
        nxt: list[str] = []
        for i in range(0, len(layer), 2):
            left = layer[i]
            right = layer[i + 1] if i + 1 < len(layer) else left
            nxt.append(hashlib.sha256((left + right).encode("utf-8")).hexdigest())
        layer = nxt
    return layer[0]
