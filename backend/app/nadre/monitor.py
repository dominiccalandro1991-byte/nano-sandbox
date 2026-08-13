"""NADRE continuous monitor — evaluates invariant vector over a state snapshot.

Does not mutate production source. Emits structured repair *recommendations*
that a Responder-compatible agent may execute only through NASE Tool-Gateway.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.nadre.invariants import (
    check_governor_budget_invariant,
    check_merkle_integrity_invariant,
    check_nase_gateway_compatible,
    check_predictor_calibration,
)


@dataclass
class NadreMonitor:
    findings: list[dict[str, Any]] = field(default_factory=list)

    def evaluate(self, state: dict[str, Any]) -> dict[str, Any]:
        self.findings = []
        repairs: list[dict[str, str]] = []

        ok, detail = check_governor_budget_invariant(
            float(state.get("resident_bytes", 0)),
            float(state.get("budget_bytes", 1)),
        )
        self.findings.append({"id": "I1_governor_budget", "passed": ok, "detail": detail})
        if not ok:
            repairs.append({"action": "governor.evictTo", "reason": detail})

        ok, detail = check_predictor_calibration(
            float(state.get("predictor_hits", 0)),
            float(state.get("predictor_misses", 0)),
            float(state.get("predictor_transitions", 0)),
        )
        self.findings.append({"id": "I2_predictor_calibration", "passed": ok, "detail": detail})
        if not ok:
            repairs.append({"action": "predictor.retrain_window", "reason": detail})

        if state.get("expected_hash") is not None or state.get("actual_hash") is not None:
            ok, detail = check_merkle_integrity_invariant(
                state.get("expected_hash"),
                state.get("actual_hash"),
                bool(state.get("quarantined", False)),
            )
            self.findings.append({"id": "I3_merkle_integrity", "passed": ok, "detail": detail})
            if not ok:
                repairs.append({"action": "habitat.quarantine", "reason": detail})

        # Optional NASE gate on proposed repairs
        if state.get("check_gateway") and repairs:
            action = repairs[0]["action"]
            gok, gdetail = check_nase_gateway_compatible(bool(state.get("gateway_allowed", False)), action)
            self.findings.append({"id": "I4_nase_gateway", "passed": gok, "detail": gdetail})
            if not gok:
                repairs = []

        passed = all(f["passed"] for f in self.findings)
        return {
            "passed": passed,
            "findings": list(self.findings),
            "repairs": repairs,
            "safe_to_apply": passed or all(
                f["id"] != "I4_nase_gateway" or f["passed"] for f in self.findings
            ),
        }
