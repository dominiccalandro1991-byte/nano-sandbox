"""Isolated ProofPatch: clone → branch → apply diff → pytest + JS smoke.

Never logs secrets or patch bodies. Never imports engine modules.
Host env is stripped before subprocesses (no DATABASE_URL leak).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

FORBIDDEN_ENV = {
    "DATABASE_URL",
    "NANO_SANDBOX_DATABASE_URL",
    "NANO_SANDBOX_DATABASE_READ_URL",
    "OPENROUTER_API_KEY",
    "NANO_SANDBOX_OPENROUTER_API_KEY",
    "HF_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
}
SECRET_RE = re.compile(
    r"(hlwqtlrkwhuogcwnhjrs|DATABASE_URL|OPENROUTER_API_KEY|postgres:[^@\s]+@)",
    re.I,
)
ALLOWED_DEFAULT = ("dominiccalandro1991-byte/nano-sandbox",)
MAX_PATCH = 200_000
MAX_ATTEMPTS = 3


def _clean_env() -> dict[str, str]:
    keep = {"PATH", "HOME", "LANG", "LC_ALL", "TERM", "USER", "TMPDIR"}
    out = {k: v for k, v in os.environ.items() if k in keep}
    out["PYTHONDONTWRITEBYTECODE"] = "1"
    return out


def _redact(text: str) -> str:
    text = SECRET_RE.sub("[redacted]", text or "")
    return text[-8000:]


def _run(cmd: list[str], cwd: Path | None, timeout: float) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            env=_clean_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        blob = (proc.stdout or "") + "\n" + (proc.stderr or "")
        return proc.returncode, _redact(blob)
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except FileNotFoundError as exc:
        return 127, _redact(str(exc))


def _allowed(repo: str, allowed: tuple[str, ...]) -> bool:
    return repo.strip() in allowed


def verify(
    *,
    repo: str,
    base: str = "main",
    patch: str | None = None,
    enabled: bool = True,
    allowed_repos: tuple[str, ...] = ALLOWED_DEFAULT,
    timeout: float = 90.0,
    fixture_dir: str | None = None,
) -> dict[str, Any]:
    if not enabled:
        return {"ok": False, "error": "proofpatch_disabled", "status": 503}
    repo = (repo or "").strip()
    if not _allowed(repo, allowed_repos) and not fixture_dir:
        return {"ok": False, "error": "repo_not_allowed", "status": 400}
    if patch and len(patch) > MAX_PATCH:
        return {"ok": False, "error": "patch_too_large", "status": 413}

    pid = uuid.uuid4().hex[:12]
    branch = f"proofpatch/{pid}"
    root = Path(tempfile.mkdtemp(prefix=f"proofpatch-{pid}-", dir="/tmp"))
    logs: list[str] = []
    started = time.time()
    try:
        dest = root / "src"
        if fixture_dir:
            shutil.copytree(fixture_dir, dest, ignore=shutil.ignore_patterns(".git", "node_modules", ".venv"))
            _run(["git", "init"], dest, 15)
            _run(["git", "add", "-A"], dest, 15)
            _run(["git", "-c", "user.email=proofpatch@local", "-c", "user.name=proofpatch", "commit", "-m", "fixture"], dest, 15)
        else:
            url = f"https://github.com/{repo}.git"
            code, out = _run(["git", "clone", "--depth", "1", "--branch", base, url, str(dest)], None, min(timeout, 45))
            logs.append(f"clone exit={code}")
            if code != 0:
                return {
                    "ok": False,
                    "error": "clone_failed",
                    "status": 409,
                    "branch": branch,
                    "logs": logs + [out[-1500:]],
                    "attempts": 0,
                }
        code, out = _run(["git", "checkout", "-b", branch], dest, 15)
        logs.append(f"branch {branch} exit={code}")
        if patch:
            apply = subprocess.run(
                ["git", "apply", "--whitespace=nowarn"],
                cwd=str(dest),
                env=_clean_env(),
                input=patch,
                capture_output=True,
                text=True,
                timeout=20,
            )
            logs.append(f"apply exit={apply.returncode} bytes={len(patch)}")
            if apply.returncode != 0:
                return {
                    "ok": False,
                    "error": "patch_apply_failed",
                    "status": 409,
                    "branch": branch,
                    "logs": logs + [_redact(apply.stderr or "")],
                    "attempts": 0,
                }

        attempts = 0
        test_ok = False
        smoke_ok = False
        last = ""
        tests_dir = dest / "backend" / "tests"
        js_dir = dest / "public" / "nnacc-v2" / "js"
        for attempts in range(1, MAX_ATTEMPTS + 1):
            if tests_dir.is_dir():
                env = _clean_env()
                env["PYTHONPATH"] = str(dest / "backend")
                try:
                    proc = subprocess.run(
                        ["python3", "-m", "pytest", str(tests_dir), "-q", "--tb=line", "-x"],
                        cwd=str(dest / "backend"),
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=timeout,
                    )
                    last = _redact((proc.stdout or "") + (proc.stderr or ""))
                    test_ok = proc.returncode == 0
                except subprocess.TimeoutExpired:
                    last = "pytest timeout"
                    test_ok = False
            else:
                test_ok = True
                last = "no backend/tests (skipped)"

            smoke_ok = True
            if js_dir.is_dir():
                for js in sorted(js_dir.glob("*.js")):
                    c, o = _run(["node", "--check", str(js)], dest, 10)
                    if c != 0:
                        smoke_ok = False
                        last += f"\nnode --check {js.name} failed"
                        break
            logs.append(f"attempt {attempts} tests={test_ok} smoke={smoke_ok}")
            if test_ok and smoke_ok:
                break

        ok = test_ok and smoke_ok
        return {
            "ok": ok,
            "status": 200 if ok else 409,
            "branch": branch,
            "repo": repo,
            "attempts": attempts,
            "tests": test_ok,
            "frontend_smoke": smoke_ok,
            "elapsed_s": round(time.time() - started, 3),
            "logs": logs + [last[-2000:]],
            "patch_bytes": len(patch) if patch else 0,
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)
