"""Load upstream keys from env into the AES-GCM enclave. Does not import engines."""
from __future__ import annotations

import os

from app.keyharbor import vault


def collect_keys() -> list[str]:
    found: list[str] = []
    for name in (
        "NANO_SANDBOX_OPENROUTER_API_KEY",
        "OPENROUTER_API_KEY",
        "NANO_SANDBOX_OPENROUTER_API_KEYS",
    ):
        raw = (os.environ.get(name) or "").strip()
        if not raw:
            continue
        if name.endswith("KEYS"):
            found.extend([p.strip() for p in raw.split(",") if p.strip()])
        else:
            found.append(raw)
    return found


def boot() -> int:
    from app.config import get_settings

    settings = get_settings()
    seed = settings.kms_seed or "keyharbor-dev"
    extra = (getattr(settings, "openrouter_api_key", None) or "").strip()
    keys = collect_keys()
    if extra:
        keys.append(extra)
    return vault.init_vault(seed, keys)
