"""Thermo-Mechanical Stress validator (concrete linear thermal-expansion subset).

Evidence classification block
-----------------------------
- Blueprint-style claim of full FEA / continuum thermoelasticity or PINN
  residual bounds: Missing.
- Linear isotropic thermal stress estimate σ = E · α · ΔT on a scalar or
  grid of temperature deltas: Partially Verified (standard elementary
  materials formula, pure numpy).
- Yield / safety-factor gate: Partially Verified as an algebraic comparison
  only; no plastic constitutive model is present.
- Any claim of replacing experimental thermo-mechanical testing: Unknown /
  overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class ThermoMechanicalStressValidator:
    id = "thermo-mechanical-stress"
    description = (
        "Estimates linear thermal stress σ = E · α · ΔT from a temperature-delta "
        "field (or scalar), compares peak stress to a yield limit, and reports a "
        "safety factor. Pure algebraic model; not continuum FEA."
    )

    def __init__(
        self,
        default_E: float = 200e9,          # Pa, steel-like
        default_alpha: float = 12e-6,      # 1/K
        default_yield: float = 250e6,      # Pa
    ):
        self.default_E = default_E
        self.default_alpha = default_alpha
        self.default_yield = default_yield

    def payload_schema(self) -> dict[str, Any]:
        return {
            "delta_T": "float | list[list[float]] — temperature change (K)",
            "youngs_modulus": "float — E in Pa (default 200e9)",
            "thermal_expansion": "float — α in 1/K (default 12e-6)",
            "yield_strength": "float — σ_yield in Pa (default 250e6)",
            "safety_factor_min": "float — required SF = yield / peak_stress (default 1.5)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        delta = payload.get("delta_T")
        if delta is None:
            return ValidationReport(passed=False, error="delta_T is required (float or 2-D list).")

        try:
            if isinstance(delta, (int, float)):
                dT = np.array([float(delta)], dtype=float)
            else:
                dT = np.asarray(delta, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce delta_T: {e}")

        if dT.size == 0 or not np.all(np.isfinite(dT)):
            return ValidationReport(passed=False, error="delta_T must be finite and non-empty.")

        E = float(payload.get("youngs_modulus", self.default_E))
        alpha = float(payload.get("thermal_expansion", self.default_alpha))
        yield_s = float(payload.get("yield_strength", self.default_yield))
        sf_min = float(payload.get("safety_factor_min", 1.5))

        if E <= 0 or alpha <= 0 or yield_s <= 0 or sf_min <= 0:
            return ValidationReport(passed=False, error="E, alpha, yield_strength, safety_factor_min must be > 0.")

        # Linear isotropic thermal stress (constrained expansion)
        stress = E * alpha * dT
        peak_stress = float(np.max(np.abs(stress)))
        mean_stress = float(np.mean(np.abs(stress)))
        safety_factor = yield_s / peak_stress if peak_stress > 0 else float("inf")

        passed = bool(np.isfinite(peak_stress)) and safety_factor >= sf_min
        findings = [
            f"peak_stress_Pa={peak_stress:.6e}",
            f"mean_abs_stress_Pa={mean_stress:.6e}",
            f"yield_Pa={yield_s:.6e}",
            f"safety_factor={safety_factor if np.isfinite(safety_factor) else 'inf'}",
            f"required_SF={sf_min}",
        ]
        if not passed:
            findings.append("safety factor below required minimum — thermo-mechanical risk")

        return ValidationReport(
            passed=passed,
            score=round(min(1.0, safety_factor / (sf_min * 2.0)) if np.isfinite(safety_factor) else 1.0, 6),
            metrics={
                "peak_stress_Pa": peak_stress,
                "mean_abs_stress_Pa": mean_stress,
                "yield_strength_Pa": yield_s,
                "safety_factor": float(safety_factor) if np.isfinite(safety_factor) else 1e12,
                "required_SF": sf_min,
                "youngs_modulus_Pa": E,
                "thermal_expansion_1_per_K": alpha,
            },
            findings=findings,
            details={
                "peak_location_flat_index": int(np.argmax(np.abs(stress.ravel()))),
                "delta_T_shape": list(dT.shape),
            },
        )
