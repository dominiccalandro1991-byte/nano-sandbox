"""Barometric / Pneumatic Pressure validator (concrete pressure-loss subset).

Evidence classification block
-----------------------------
- Blueprint claim of full pneumatic CFD or certified leak-test hardware:
  Missing.
- Pressure time-series decay rate, absolute floor, and seal-integrity gate:
  Partially Verified (pure numpy finite differences / linear fit).
- Compressible-flow nozzle models / multi-chamber networks: Missing.
- Replacement of industrial leak-down testing: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class BarometricPressureValidator:
    id = "barometric-pressure"
    description = (
        "Validates pneumatic/hydraulic pressure time series for excessive loss "
        "rate and absolute pressure floor (seal integrity). Pure numpy; not a "
        "compressible-flow solver."
    )

    def __init__(
        self,
        default_loss_rate_limit: float = 0.5,   # pressure units per time unit
        default_min_pressure: float = 50.0,
    ):
        self.default_loss_rate_limit = default_loss_rate_limit
        self.default_min_pressure = default_min_pressure

    def payload_schema(self) -> dict[str, Any]:
        return {
            "times": "list[float] — sample times",
            "pressures": "list[float] — pressure readings (same length as times)",
            "loss_rate_limit": "float — max allowed |dp/dt| loss (default 0.5)",
            "min_pressure": "float — absolute pressure floor (default 50)",
            "setpoint": "optional float — target pressure; if given, final must be within 10% ",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        times = payload.get("times")
        pressures = payload.get("pressures")
        if not isinstance(times, list) or not isinstance(pressures, list):
            return ValidationReport(passed=False, error="times and pressures must be lists of numbers.")
        if len(times) < 2 or len(times) != len(pressures):
            return ValidationReport(passed=False, error="times and pressures must have equal length >= 2.")

        try:
            t = np.asarray(times, dtype=float)
            p = np.asarray(pressures, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce series: {e}")
        if not np.all(np.isfinite(t)) or not np.all(np.isfinite(p)):
            return ValidationReport(passed=False, error="non-finite values in times or pressures.")
        if np.any(np.diff(t) <= 0):
            return ValidationReport(passed=False, error="times must be strictly increasing.")

        loss_limit = float(payload.get("loss_rate_limit", self.default_loss_rate_limit))
        min_p = float(payload.get("min_pressure", self.default_min_pressure))

        # Linear fit slope dp/dt
        t_mean = float(np.mean(t))
        p_mean = float(np.mean(p))
        denom = float(np.sum((t - t_mean) ** 2))
        slope = float(np.sum((t - t_mean) * (p - p_mean)) / denom) if denom else 0.0
        loss_rate = max(0.0, -slope)  # pressure loss is negative slope

        final_p = float(p[-1])
        initial_p = float(p[0])
        total_drop = initial_p - final_p

        rate_ok = loss_rate <= loss_limit
        floor_ok = final_p >= min_p

        setpoint = payload.get("setpoint")
        setpoint_ok = True
        if setpoint is not None:
            try:
                sp = float(setpoint)
                setpoint_ok = abs(final_p - sp) <= 0.10 * abs(sp) if sp != 0 else abs(final_p) <= 1e-6
            except (TypeError, ValueError):
                return ValidationReport(passed=False, error="setpoint must be a finite number when provided.")

        passed = rate_ok and floor_ok and setpoint_ok
        findings = [
            f"loss_rate={loss_rate:.6f}",
            f"total_drop={total_drop:.6f}",
            f"final_pressure={final_p:.6f}",
            f"loss_rate_limit={loss_limit}",
            f"min_pressure={min_p}",
            f"rate_ok={rate_ok}",
            f"floor_ok={floor_ok}",
            f"setpoint_ok={setpoint_ok}",
        ]
        if not passed:
            findings.append("pressure loss rate, floor, and/or setpoint out of limits — seal integrity risk")

        return ValidationReport(
            passed=passed,
            score=round(
                (1.0 if rate_ok else max(0.0, 1.0 - loss_rate / (loss_limit + 1e-12)))
                * (1.0 if floor_ok else 0.3)
                * (1.0 if setpoint_ok else 0.5),
                6,
            ),
            metrics={
                "loss_rate": round(loss_rate, 6),
                "slope_dp_dt": round(slope, 6),
                "total_drop": round(total_drop, 6),
                "final_pressure": round(final_p, 6),
                "initial_pressure": round(initial_p, 6),
                "loss_rate_limit": loss_limit,
                "min_pressure": min_p,
                "sample_count": float(len(t)),
            },
            findings=findings,
            details={"setpoint": setpoint},
        )
