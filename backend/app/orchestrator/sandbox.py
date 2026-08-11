"""Isolated test-environment orchestrator.

This is process-level isolation, not container-level isolation: each
validation job runs in its own subprocess with a wall-clock timeout and (on
POSIX) an address-space (RLIMIT_AS) and CPU-time (RLIMIT_CPU) limit, and its
own memory space so a runaway or crashing validator can't take down the API
process or step on another job's state.

This is NOT a security sandbox against a hostile validator -- a validator
that imports `os` and calls `os.system(...)` will still run with this
process's OS permissions. If nano-sandbox ever needs to run untrusted,
agent-authored code (as opposed to trusted validators registered by you),
swap this module for a real container/gVisor/firecracker boundary before
doing that. Said plainly rather than silently implied, per this project's
own no-fabricated-verification standard.
"""
from __future__ import annotations

import multiprocessing as mp
import sys
import time
import traceback
from dataclasses import dataclass

from app.models import JobStatus, ValidationReport

if sys.platform != "win32":
    import resource
else:  # pragma: no cover - resource module is POSIX-only
    resource = None  # type: ignore[assignment]


@dataclass
class SandboxResult:
    status: JobStatus
    report: ValidationReport | None
    error: str | None
    duration_seconds: float


def _child_entrypoint(validator_id: str, payload: dict, seed: int | None, memory_limit_bytes: int, cpu_limit_seconds: int, out_queue: "mp.Queue") -> None:
    try:
        if resource is not None:
            try:
                resource.setrlimit(resource.RLIMIT_AS, (memory_limit_bytes, memory_limit_bytes))
            except (ValueError, OSError):
                pass  # best-effort; some hosts (containers, macOS) restrict this
            try:
                resource.setrlimit(resource.RLIMIT_CPU, (cpu_limit_seconds, cpu_limit_seconds))
            except (ValueError, OSError):
                pass

        # Imported inside the child on purpose: keeps the parent process free
        # of validator-side import side effects, and means a validator that
        # segfaults or OOMs only takes its own subprocess down with it.
        from app.validators import get_validator

        validator = get_validator(validator_id)
        if validator is None:
            out_queue.put(("error", f"Unknown validator_id '{validator_id}'."))
            return

        report = validator.run(payload, seed)
        out_queue.put(("ok", report.model_dump()))
    except Exception:  # noqa: BLE001 - deliberately broad: this is a sandbox boundary
        out_queue.put(("error", traceback.format_exc()))


def run_in_sandbox(
    *,
    validator_id: str,
    payload: dict,
    seed: int | None,
    timeout_seconds: float,
    memory_limit_bytes: int,
) -> SandboxResult:
    ctx = mp.get_context("spawn")
    out_queue: mp.Queue = ctx.Queue()
    cpu_limit_seconds = max(1, int(timeout_seconds) + 1)

    process = ctx.Process(
        target=_child_entrypoint,
        args=(validator_id, payload, seed, memory_limit_bytes, cpu_limit_seconds, out_queue),
        daemon=True,
    )

    start = time.monotonic()
    process.start()
    process.join(timeout_seconds)
    duration = time.monotonic() - start

    if process.is_alive():
        process.terminate()
        process.join(1.0)
        if process.is_alive():
            process.kill()
            process.join(1.0)
        return SandboxResult(status=JobStatus.TIMEOUT, report=None, error=f"Job exceeded {timeout_seconds}s timeout.", duration_seconds=duration)

    if not out_queue.empty():
        kind, value = out_queue.get()
        if kind == "ok":
            report = ValidationReport(**value)
            status = JobStatus.PASSED if report.passed else JobStatus.FAILED
            return SandboxResult(status=status, report=report, error=None, duration_seconds=duration)
        return SandboxResult(status=JobStatus.ERROR, report=None, error=value, duration_seconds=duration)

    exit_code = process.exitcode
    return SandboxResult(
        status=JobStatus.ERROR,
        report=None,
        error=f"Sandbox process exited with code {exit_code} and produced no result "
        "(likely killed by the OS -- probably the memory limit).",
        duration_seconds=duration,
    )
