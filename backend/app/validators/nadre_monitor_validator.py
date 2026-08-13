"""NADRE monitor validator — registry entry for continuous invariant checks.

Evidence classification block
-----------------------------
- State-vector invariant evaluation: Partially Verified (pure predicates).
- On-the-fly source patching of habitat modules: Missing.
- Coupling to live NHSE governor/predictor stats: Partially Verified when
  caller supplies the snapshot fields.
"""

from __future__ import annotations

from typing import Any

from app.models import ValidationReport
from app.nadre.monitor import NadreMonitor


class NadreMonitorValidator:
    id = "nadre-monitor"
    description = (
        "NanoAutonomic Debug & Repair Engine formal monitor: evaluates governor "
        "budget, predictor calibration, Merkle integrity, and optional NASE "
        "gateway compatibility over a supplied state snapshot. Emits repair "
        "recommendations; does not rewrite source."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "resident_bytes": "float",
            "budget_bytes": "float",
            "predictor_hits": "float",
            "predictor_misses": "float",
            "predictor_transitions": "float",
            "expected_hash": "str?",
            "actual_hash": "str?",
            "quarantined": "bool?",
            "check_gateway": "bool?",
            "gateway_allowed": "bool?",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        monitor = NadreMonitor()
        result = monitor.evaluate(payload)
        findings = [f"{f['id']}:{f['passed']}:{f['detail']}" for f in result["findings"]]
        return ValidationReport(
            passed=bool(result["passed"]),
            score=1.0 if result["passed"] else 0.0,
            metrics={
                "invariant_count": float(len(result["findings"])),
                "repair_count": float(len(result["repairs"])),
                "safe_to_apply": 1.0 if result["safe_to_apply"] else 0.0,
            },
            findings=findings,
            details=result,
        )
