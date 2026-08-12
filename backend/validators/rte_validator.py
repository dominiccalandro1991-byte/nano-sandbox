"""
rte_validator.py — Runtime Trace Evaluator

Purpose (one-sentence, chosen under Partially Verified domain judgment because
the exact briefing sentence is Missing from the inspected repository):
Evaluate a live-module execution trace for timeout, uncaught errors, and
excessive log volume against fixed concrete thresholds and emit a pass/fail
score.

Evidence classification block
-----------------------------
- Purpose sentence text: Missing (not present in live clone or Master Instructions)
- BaseValidator interface: Missing (no backend/ or BaseValidator observed)
- Timeout / log-volume thresholds: Unknown (concrete values chosen for
  determinism; no golden baseline present in the repository)
- Trace schema: Partially Verified (mirrors LiveStateSnapshot + runtime result
  shape observed in lib/nhse/types.ts and lib/nhse/runtime.ts)
- Exception string matching: Partially Verified (simple substring / presence)
"""

from __future__ import annotations

from typing import Any, Dict, List


class RTEValidator:
    """Concrete Runtime Trace Evaluator."""

    name = "rte"
    version = "1.0.0"
    # Concrete thresholds (Unknown provenance relative to briefing)
    MAX_DURATION_MS = 5000
    MAX_LOG_COUNT = 200
    FAIL_ON_ERROR = True

    def validate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Accepts a single trace dict or {"traces": [ ... ]}.
        Each trace may contain: ok, durationMs / duration_ms, logCount / logs,
        error, result.
        Returns a concrete aggregate result; never a stub.
        """
        if isinstance(payload, dict) and "traces" in payload:
            traces: List[Any] = payload["traces"]
        elif isinstance(payload, list):
            traces = payload
        elif isinstance(payload, dict):
            traces = [payload]
        else:
            return {
                "ok": False,
                "engine": self.name,
                "score": 0.0,
                "passed": 0,
                "failed": 0,
                "detail": "payload must be a trace dict, list, or {traces: [...]}",
            }

        passed = 0
        failed = 0
        details: List[str] = []

        for i, t in enumerate(traces):
            if not isinstance(t, dict):
                failed += 1
                details.append(f"[{i}] not a dict")
                continue

            ok_flag = t.get("ok", True)
            duration = int(t.get("durationMs") or t.get("duration_ms") or 0)
            logs = t.get("logs")
            if isinstance(logs, list):
                log_count = len(logs)
            else:
                log_count = int(t.get("logCount") or t.get("log_count") or 0)
            error = t.get("error")

            reasons = []
            if self.FAIL_ON_ERROR and (ok_flag is False or error):
                reasons.append(f"error={error!r}")
            if duration > self.MAX_DURATION_MS:
                reasons.append(f"timeout {duration}ms>{self.MAX_DURATION_MS}")
            if log_count > self.MAX_LOG_COUNT:
                reasons.append(f"log_volume {log_count}>{self.MAX_LOG_COUNT}")

            if reasons:
                failed += 1
                details.append(f"[{i}] FAIL: {'; '.join(reasons)}")
            else:
                passed += 1
                details.append(f"[{i}] PASS")

        total = passed + failed
        score = round(passed / total, 4) if total else 0.0

        return {
            "ok": failed == 0 and total > 0,
            "engine": self.name,
            "score": score,
            "passed": passed,
            "failed": failed,
            "max_duration_ms": self.MAX_DURATION_MS,
            "max_log_count": self.MAX_LOG_COUNT,
            "detail": "; ".join(details[:12]) + (" ..." if len(details) > 12 else ""),
        }


def get_validator() -> RTEValidator:
    return RTEValidator()
