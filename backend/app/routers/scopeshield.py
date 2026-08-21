"""GET /scopeshield/preflight — never prints secret values. Does not load engines."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.scopeshield.engine import load_contract, preflight, validate

router = APIRouter(prefix="/scopeshield", tags=["scopeshield"])


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "scopeshield", "binary": "scopeshield/bin/scopeshield"}


@router.get("/preflight")
def preflight_get(
    profile: str = Query(default="nano-sandbox"),
    liveness: bool = Query(default=False),
) -> dict[str, Any]:
    try:
        report = preflight(profile, skip_liveness=not liveness)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="unknown_profile") from None
    except ValueError:
        raise HTTPException(status_code=400, detail="bad_profile") from None
    return report


@router.get("/contract/{profile}")
def contract(profile: str) -> dict[str, Any]:
    try:
        spec = load_contract(profile)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="unknown_profile") from None
    except ValueError:
        raise HTTPException(status_code=400, detail="bad_profile") from None
    # names only — never include live values
    return {
        "service": spec.get("service"),
        "description": spec.get("description"),
        "variables": [
            {"name": v.get("name"), "type": v.get("type"), "required": bool(v.get("required"))}
            for v in spec.get("variables") or []
        ],
    }


def boot_report() -> dict[str, Any]:
    return validate(load_contract("nano-sandbox"), skip_liveness=True)
