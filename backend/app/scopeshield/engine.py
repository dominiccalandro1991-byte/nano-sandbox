"""Fail-fast env validation. Never logs secret values. Does not import engines."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CONTRACT_DIR = Path(__file__).resolve().parent / "contracts"


def load_contract(profile: str) -> dict[str, Any]:
    name = (profile or "nano-sandbox").strip() or "nano-sandbox"
    if not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError("bad_profile")
    path = CONTRACT_DIR / f"{name}.json"
    if not path.is_file():
        raise FileNotFoundError(name)
    return json.loads(path.read_text(encoding="utf-8"))


def _type_ok(kind: str, value: str) -> str | None:
    if kind == "string":
        return None
    if kind == "url":
        return None if value.startswith(("http://", "https://")) else "type:url"
    if kind == "https_url":
        return None if value.startswith("https://") else "type:https_url"
    if kind == "postgres_url":
        v = value.lower()
        if v.startswith(("sqlite:", "postgres://", "postgresql://", "postgresql+psycopg://")):
            return None
        return "type:postgres_url"
    if kind == "hex":
        return None if value and all(c in "0123456789abcdefABCDEF" for c in value) else "type:hex"
    if kind == "jwt":
        parts = value.split(".")
        if value.startswith("eyJ") and len(parts) == 3 and all(parts):
            return None
        return "type:jwt"
    return f"unknown_type:{kind}"


def _ping(url: str, method: str, timeout_ms: int, bearer: str | None) -> dict[str, Any]:
    req = urllib.request.Request(url, method=(method or "HEAD").upper())
    if bearer:
        req.add_header("Authorization", f"Bearer {bearer}")
    try:
        with urllib.request.urlopen(req, timeout=max(timeout_ms, 1) / 1000.0) as resp:
            status = getattr(resp, "status", 200)
            ok = 200 <= status < 400 or status == 403
            return {"url": url, "ok": ok, "status": status, "reason": "ok" if ok else f"http_{status}"}
    except urllib.error.HTTPError as exc:
        return {"url": url, "ok": False, "status": exc.code, "reason": f"http_{exc.code}"}
    except Exception:
        return {"url": url, "ok": False, "status": None, "reason": "unreachable"}


def validate(contract: dict[str, Any], env: dict[str, str] | None = None, *, skip_liveness: bool = False) -> dict[str, Any]:
    started = time.perf_counter()
    ast = env if env is not None else dict(os.environ)
    failures: list[dict[str, str]] = []
    liveness: list[dict[str, Any]] = []
    variables = contract.get("variables") or []
    for var in variables:
        name = var.get("name") or ""
        present = (ast.get(name) or "").strip()
        if not present:
            if var.get("required"):
                failures.append({"name": name, "reason": "missing", "constraint": "required"})
            continue
        min_length = var.get("min_length")
        if min_length and len(present) < int(min_length):
            failures.append({"name": name, "reason": "too_short", "constraint": f"min_length:{min_length}"})
        terr = _type_ok(var.get("type") or "string", present)
        if terr:
            failures.append({"name": name, "reason": "type", "constraint": terr})
        pat = var.get("regex")
        if pat:
            try:
                if re.search(pat, present) is None:
                    failures.append({"name": name, "reason": "regex", "constraint": pat})
            except re.error:
                failures.append({"name": name, "reason": "bad_regex", "constraint": pat})
        lowered = present.lower()
        for needle in var.get("forbid") or []:
            if needle and needle.lower() in lowered:
                failures.append({"name": name, "reason": "forbidden_substring", "constraint": needle})
        live = var.get("liveness")
        if live and not skip_liveness:
            bearer = None
            bname = live.get("bearer_env")
            if bname:
                bearer = ast.get(bname) or None
            result = _ping(live.get("url") or "", live.get("method") or "HEAD", int(live.get("timeout_ms") or 4000), bearer)
            result["name"] = name
            liveness.append(result)
            if not result["ok"]:
                failures.append({"name": name, "reason": "liveness", "constraint": result["reason"]})
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "ok": not failures,
        "service": contract.get("service"),
        "elapsed_ms": elapsed_ms,
        "checks": len(variables),
        "failures": failures,
        "liveness": liveness,
    }


def preflight(profile: str = "nano-sandbox", *, skip_liveness: bool = True) -> dict[str, Any]:
    return validate(load_contract(profile), skip_liveness=skip_liveness)
