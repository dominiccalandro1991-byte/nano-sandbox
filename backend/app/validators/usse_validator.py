"""Universal Simulation & Stress Engine validator (Engine 23).

Evidence classification block
-----------------------------
- Statics torque / bending proxy / battery Wh: Partially Verified.
- Digital multi-agent pressure scalar: Partially Verified.
- Causal-style risk fusion: Partially Verified (linear weights).
- NASE attestation-freshness gate on simulation run: Partially Verified
  (reuses app.nase.invariants.check_attestation_freshness).
- Replacement of physical certification labs: Missing / Unknown.
"""

from __future__ import annotations

import time
from typing import Any

from app.models import ValidationReport
from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness
from app.usse.stress import compute_digital_load, compute_physical_stress, fuse_failure_risk


class USSEValidator:
    id = "usse-stress"
    description = (
        "Universal Simulation & Stress Engine: computes torque, bending-stress "
        "proxy, battery draw, multi-agent digital load pressure, and fused "
        "failure risk. Requires fresh NASE attestation. Does not replace lab FEA."
    )

    def __init__(self, fail_risk_threshold: float = 0.85):
        self.fail_risk_threshold = fail_risk_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "attestation_timestamp": "float — required unix seconds (NASE freshness)",
            "delta_seconds": "float — Δt bound (default 30)",
            "now": "float? — clock override for tests",
            "force_n": "float",
            "lever_arm_m": "float",
            "theta_deg": "float",
            "mass_kg": "float",
            "load_lb": "float — alternative to mass_kg",
            "power_w": "float",
            "duration_h": "float",
            "section_modulus_m3": "float",
            "yield_stress_pa": "float",
            "agent_count": "float",
            "requests_per_second": "float",
            "p99_latency_ms": "float",
            "error_rate": "float 0-1",
            "causal_weights": "dict? physical/digital/interaction",
            "mode": "str — physical|digital|unified (default unified)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        now = float(payload["now"]) if payload.get("now") is not None else time.time()
        delta = float(payload.get("delta_seconds", DEFAULT_DELTA_SECONDS))
        att_ok, att_reason = check_attestation_freshness(
            payload.get("attestation_timestamp"), now, delta
        )
        if not att_ok:
            return ValidationReport(
                passed=False,
                error=f"NASE attestation-freshness failed: {att_reason}",
                findings=[att_reason],
            )

        mode = str(payload.get("mode", "unified")).lower()
        physical = compute_physical_stress(payload) if mode in ("physical", "unified") else {
            "torque_nm": 0.0, "moment_nm": 0.0, "bending_stress_pa": 0.0,
            "battery_draw_wh": 0.0, "mass_kg": 0.0, "utilization": 0.0, "gravity_force_n": 0.0,
        }
        digital = compute_digital_load(payload) if mode in ("digital", "unified") else {
            "digital_pressure": 0.0, "agent_count": 0.0, "requests_per_second": 0.0,
            "p99_latency_ms": 0.0, "error_rate": 0.0,
        }
        weights = payload.get("causal_weights") if isinstance(payload.get("causal_weights"), dict) else None
        fused = fuse_failure_risk(physical, digital, weights)

        risk = fused["failure_risk"]
        passed = risk < self.fail_risk_threshold and att_ok
        findings = [
            att_reason,
            f"mode={mode}",
            f"torque_nm={physical['torque_nm']:.6f}",
            f"utilization={physical['utilization']:.6f}",
            f"digital_pressure={digital['digital_pressure']:.6f}",
            f"failure_risk={risk:.6f} (threshold={self.fail_risk_threshold})",
        ]
        if not passed:
            findings.append("failure risk at or above threshold — predicted stress concentration")

        metrics = {**{k: float(v) for k, v in physical.items()},
                   **{k: float(v) for k, v in digital.items()},
                   **{k: float(v) for k, v in fused.items()},
                   "attestation_ok": 1.0,
                   "fail_risk_threshold": self.fail_risk_threshold}
        return ValidationReport(
            passed=passed,
            score=round(1.0 - risk, 6),
            metrics=metrics,
            findings=findings,
            details={"physical": physical, "digital": digital, "fused": fused, "nase": att_reason},
        )
