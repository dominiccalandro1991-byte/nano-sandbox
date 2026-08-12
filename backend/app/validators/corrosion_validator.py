"""Corrosion / Oxidation validator (concrete progression-rate subset).

Evidence classification block
-----------------------------
- Blueprint claim of full electrochemical corrosion models or material
  databases: Missing.
- Linear or power-law thickness-loss progression from a time series, plus a
  rate threshold gate: Partially Verified (pure numpy regression / finite
  differences).
- Galvanic couple tables / Pourbaix diagrams: Missing.
- Replacement of corrosion coupon testing: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class CorrosionOxidationValidator:
    id = "corrosion-oxidation"
    description = (
        "Tracks surface thickness or oxide-growth time series, estimates a "
        "corrosion rate (linear fit), and fails when the rate exceeds a design "
        "limit or remaining thickness falls below a floor. Pure numpy."
    )

    def __init__(self, default_rate_limit: float = 0.05, default_min_thickness: float = 0.1):
        self.default_rate_limit = default_rate_limit
        self.default_min_thickness = default_min_thickness

    def payload_schema(self) -> dict[str, Any]:
        return {
            "times": "list[float] — sample times (same units throughout)",
            "thickness": "list[float] — remaining thickness at each time (same length as times)",
            "rate_limit": "float — max allowed |d(thickness)/dt| (default 0.05)",
            "min_thickness": "float — absolute thickness floor (default 0.1)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        times = payload.get("times")
        thickness = payload.get("thickness")
        if not isinstance(times, list) or not isinstance(thickness, list):
            return ValidationReport(passed=False, error="times and thickness must be lists of numbers.")
        if len(times) < 2 or len(times) != len(thickness):
            return ValidationReport(passed=False, error="times and thickness must have equal length >= 2.")

        try:
            t = np.asarray(times, dtype=float)
            h = np.asarray(thickness, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce series: {e}")
        if not np.all(np.isfinite(t)) or not np.all(np.isfinite(h)):
            return ValidationReport(passed=False, error="non-finite values in times or thickness.")
        if np.any(np.diff(t) <= 0):
            return ValidationReport(passed=False, error="times must be strictly increasing.")

        rate_limit = float(payload.get("rate_limit", self.default_rate_limit))
        min_h = float(payload.get("min_thickness", self.default_min_thickness))

        # Linear least-squares slope dh/dt
        t_mean = float(np.mean(t))
        h_mean = float(np.mean(h))
        denom = float(np.sum((t - t_mean) ** 2))
        if denom == 0:
            slope = 0.0
        else:
            slope = float(np.sum((t - t_mean) * (h - h_mean)) / denom)

        # Corrosion rate as positive loss rate
        loss_rate = max(0.0, -slope)
        final_h = float(h[-1])
        initial_h = float(h[0])
        total_loss = initial_h - final_h

        rate_ok = loss_rate <= rate_limit
        thickness_ok = final_h >= min_h
        passed = rate_ok and thickness_ok

        findings = [
            f"loss_rate={loss_rate:.6f}",
            f"total_loss={total_loss:.6f}",
            f"final_thickness={final_h:.6f}",
            f"rate_limit={rate_limit}",
            f"min_thickness={min_h}",
            f"rate_ok={rate_ok}",
            f"thickness_ok={thickness_ok}",
        ]
        if not passed:
            findings.append("corrosion rate and/or remaining thickness out of design limits")

        return ValidationReport(
            passed=passed,
            score=round(
                (1.0 if rate_ok else max(0.0, 1.0 - loss_rate / (rate_limit + 1e-12)))
                * (1.0 if thickness_ok else 0.3),
                6,
            ),
            metrics={
                "loss_rate": round(loss_rate, 6),
                "slope_dh_dt": round(slope, 6),
                "total_loss": round(total_loss, 6),
                "final_thickness": round(final_h, 6),
                "initial_thickness": round(initial_h, 6),
                "rate_limit": rate_limit,
                "min_thickness": min_h,
                "sample_count": float(len(t)),
            },
            findings=findings,
            details={},
        )
