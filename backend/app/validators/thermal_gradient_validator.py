"""Thermal Gradient validator (concrete discrete gradient subset).

Evidence classification block
-----------------------------
- Blueprint-style claim of continuum gradient fields or PINN residual bounds:
  Missing.
- Discrete temperature gradient via numpy.gradient + hotspot detection:
  Partially Verified (standard central differences).
- Any physical material conductivity model: Missing (caller supplies the
  temperature field only).
- Claim of industrial thermal QC replacement: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class ThermalGradientValidator:
    id = "thermal-gradient"
    description = (
        "Computes discrete spatial gradients of a 2-D temperature field, reports "
        "max/mean gradient magnitude, and flags hotspots above a caller-configurable "
        "threshold. Pure numpy central differences."
    )

    def __init__(self, default_threshold: float = 5.0):
        self.default_threshold = default_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "temperature_field": "list[list[float]] — 2-D temperature grid",
            "gradient_threshold": "float — magnitude above which a cell is a hotspot (default 5.0)",
            "dx": "float — spacing in x (default 1.0)",
            "dy": "float — spacing in y (default 1.0)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        field = payload.get("temperature_field")
        if not isinstance(field, list) or len(field) < 2:
            return ValidationReport(
                passed=False,
                error="temperature_field must be a 2-D list with at least 2 rows.",
            )
        try:
            T = np.asarray(field, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce temperature_field: {e}")
        if T.ndim != 2 or min(T.shape) < 2:
            return ValidationReport(passed=False, error="temperature_field must be 2-D with shape >= (2,2).")
        if not np.all(np.isfinite(T)):
            return ValidationReport(passed=False, error="non-finite values in temperature_field.")

        dx = float(payload.get("dx", 1.0))
        dy = float(payload.get("dy", 1.0))
        threshold = float(payload.get("gradient_threshold", self.default_threshold))
        if dx <= 0 or dy <= 0:
            return ValidationReport(passed=False, error="dx and dy must be > 0.")

        # numpy.gradient returns dy, dx order for 2-D
        gy, gx = np.gradient(T, dy, dx)
        magnitude = np.sqrt(gx**2 + gy**2)

        max_g = float(np.max(magnitude))
        mean_g = float(np.mean(magnitude))
        hotspot_mask = magnitude > threshold
        hotspot_count = int(np.sum(hotspot_mask))
        hotspot_coords = [
            {"row": int(i), "col": int(j), "magnitude": round(float(magnitude[i, j]), 6)}
            for i, j in zip(*np.where(hotspot_mask))
        ][:50]  # cap for payload size

        # Pass if finite and max gradient is below a hard safety multiple of threshold
        # (or zero hotspots when threshold is the design limit)
        passed = bool(np.all(np.isfinite(magnitude))) and max_g <= threshold * 3.0
        findings = [
            f"max_gradient={max_g:.6f}",
            f"mean_gradient={mean_g:.6f}",
            f"hotspot_count={hotspot_count}",
            f"threshold={threshold}",
        ]
        if hotspot_count > 0:
            findings.append(f"hotspots_detected={hotspot_count}")
        if not passed:
            findings.append("gradient magnitude exceeds safety band or non-finite")

        return ValidationReport(
            passed=passed,
            score=round(max(0.0, 1.0 - max_g / (threshold * 3.0 + 1e-12)), 6),
            metrics={
                "max_gradient": round(max_g, 6),
                "mean_gradient": round(mean_g, 6),
                "hotspot_count": float(hotspot_count),
                "threshold": threshold,
                "dx": dx,
                "dy": dy,
            },
            findings=findings,
            details={"hotspot_coords": hotspot_coords},
        )
