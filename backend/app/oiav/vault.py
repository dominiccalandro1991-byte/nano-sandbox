"""OIAV vault: content-addressed IP package + Merkle root."""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def merkle_root(leaves: list[str]) -> str:
    """Merkle root over hex leaf hashes; empty → zero hash."""
    if not leaves:
        return sha256_hex("")
    layer = [sha256_hex(x) if len(x) != 64 or any(c not in "0123456789abcdef" for c in x.lower()) else x.lower()
             for x in leaves]
    # Normalize: always hash leaf content strings first for consistency
    layer = [sha256_hex(x) for x in leaves]
    while len(layer) > 1:
        nxt: list[str] = []
        for i in range(0, len(layer), 2):
            left = layer[i]
            right = layer[i + 1] if i + 1 < len(layer) else left
            nxt.append(sha256_hex(left + right))
        layer = nxt
    return layer[0]


def build_ip_package(payload: dict[str, Any], sealed_at: float) -> dict[str, Any]:
    """Compile habitat/IP assets into a timestamped, hashed documentation package."""
    title = str(payload.get("title", "Untitled IP Asset"))
    asset_type = str(payload.get("asset_type", "mixed"))  # app|hardware|music|business|mixed
    notes = str(payload.get("notes", ""))
    assets = payload.get("assets")
    if not isinstance(assets, list):
        assets = []

    leaves: list[str] = []
    normalized_assets: list[dict[str, Any]] = []
    for i, item in enumerate(assets):
        if not isinstance(item, dict):
            item = {"name": str(item), "content": str(item)}
        name = str(item.get("name", f"asset-{i}"))
        content = item.get("content", "")
        if not isinstance(content, str):
            content = _canonical(content)
        content_hash = sha256_hex(content)
        leaves.append(content_hash)
        normalized_assets.append({
            "name": name,
            "kind": str(item.get("kind", "blob")),
            "content_hash": content_hash,
            "byte_length": len(content.encode("utf-8")),
        })

    body = {
        "title": title,
        "asset_type": asset_type,
        "notes": notes,
        "assets": normalized_assets,
        "sealed_at": sealed_at,
        "filing_hints": {
            "copyright": asset_type in ("app", "music", "mixed"),
            "patent_sketch": asset_type in ("hardware", "mixed"),
            "business_loan_packet": asset_type in ("business", "mixed"),
        },
    }
    body_canonical = _canonical(body)
    package_hash = sha256_hex(body_canonical)
    root = merkle_root(leaves) if leaves else package_hash

    return {
        "package": body,
        "package_hash": package_hash,
        "merkle_root": root,
        "leaf_count": len(leaves),
        "canonical_bytes": len(body_canonical.encode("utf-8")),
    }
