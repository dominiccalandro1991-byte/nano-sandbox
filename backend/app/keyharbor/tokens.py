"""Ephemeral HMAC tokens. Internal services never see upstream API keys."""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Any

SEP = "."


def _secret() -> bytes:
    from app.config import get_settings

    s = get_settings()
    raw = (os.environ.get("NANO_SANDBOX_KEYHARBOR_MINT") or s.kms_seed or "").encode("utf-8")
    return hashlib.sha256(b"keyharbor-mint|" + raw).digest()


def mint(service: str, ttl_seconds: int = 3600) -> str:
    svc = "".join(ch for ch in (service or "studio") if ch.isalnum() or ch in "-_")[:32] or "studio"
    exp = int(time.time()) + max(60, int(ttl_seconds))
    nonce = os.urandom(8).hex()
    payload = f"{svc}:{exp}:{nonce}"
    sig = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return payload + SEP + sig


def verify(token: str | None) -> str | None:
    raw = (token or "").strip()
    if raw.lower().startswith("bearer "):
        raw = raw[7:].strip()
    if SEP not in raw:
        return None
    payload, sig = raw.rsplit(SEP, 1)
    expect = hmac.new(_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expect, sig):
        return None
    try:
        svc, exp_s, _nonce = payload.split(":", 2)
        if int(exp_s) < int(time.time()):
            return None
    except Exception:
        return None
    return svc


def service_from_headers(authorization: str | None, x_service: str | None = None) -> str | None:
    return verify(authorization)
