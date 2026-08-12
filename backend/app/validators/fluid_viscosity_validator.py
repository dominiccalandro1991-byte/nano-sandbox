"""Fluid Viscosity validator (concrete discrete flow / density subset).

Evidence classification block
-----------------------------
- Blueprint claim of full CFD / rheometer hardware or trained fluid models:
  Missing.
- Density, kinematic-viscosity estimate from flow rate + geometry, and a
  simple Reynolds-number anomaly gate: Partially Verified (standard
  elementary fluid formulas, pure numpy).
- Non-Newtonian constitutive models / multiphase flow: Missing.
- Replacement of laboratory viscometry: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class FluidViscosityValidator:
    id = "fluid-viscosity"
    description = (
        "Evaluates fluid density and an effective kinematic viscosity from "
        "caller-supplied mass/volume and flow-rate data, computes a Reynolds "
        "number, and flags out-of-band density or Re anomalies. Pure numpy; "
        "not a CFD solver."
    )

    def __init__(
        self,
        density_lo: float = 500.0,      # kg/m^3
        density_hi: float = 2000.0,
        re_laminar_max: float = 2300.0,
        re_turbulent_min: float = 4000.0,
    ):
        self.density_lo = density_lo
        self.density_hi = density_hi
        self.re_laminar_max = re_laminar_max
        self.re_turbulent_min = re_turbulent_min

    def payload_schema(self) -> dict[str, Any]:
        return {
            "mass_kg": "float — sample mass",
            "volume_m3": "float — sample volume",
            "flow_rate_m3_s": "float — volumetric flow rate",
            "pipe_diameter_m": "float — characteristic diameter",
            "dynamic_viscosity_pa_s": "optional float — if omitted, a default water-like 1e-3 is used for Re",
            "expected_regime": "optional str — 'laminar' | 'turbulent' | 'any' (default any)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        try:
            mass = float(payload["mass_kg"])
            volume = float(payload["volume_m3"])
            q = float(payload["flow_rate_m3_s"])
            d = float(payload["pipe_diameter_m"])
        except (KeyError, TypeError, ValueError) as e:
            return ValidationReport(
                passed=False,
                error=f"mass_kg, volume_m3, flow_rate_m3_s, pipe_diameter_m required as finite numbers: {e}",
            )

        if volume <= 0 or d <= 0:
            return ValidationReport(passed=False, error="volume_m3 and pipe_diameter_m must be > 0.")
        if not all(np.isfinite([mass, volume, q, d])):
            return ValidationReport(passed=False, error="non-finite input values.")

        density = mass / volume  # kg/m^3
        mu = float(payload.get("dynamic_viscosity_pa_s", 1.0e-3))
        if mu <= 0:
            return ValidationReport(passed=False, error="dynamic_viscosity_pa_s must be > 0.")

        # Mean velocity in a circular pipe: V = Q / A
        area = np.pi * (d / 2.0) ** 2
        velocity = abs(q) / area if area > 0 else 0.0
        nu = mu / density if density > 0 else float("inf")  # kinematic viscosity
        re = abs(velocity) * d / nu if nu > 0 and np.isfinite(nu) else float("inf")

        density_ok = self.density_lo <= density <= self.density_hi
        regime = str(payload.get("expected_regime", "any")).lower()
        regime_ok = True
        if regime == "laminar":
            regime_ok = re <= self.re_laminar_max
        elif regime == "turbulent":
            regime_ok = re >= self.re_turbulent_min

        passed = bool(density_ok and regime_ok and np.isfinite(re))
        findings = [
            f"density_kg_m3={density:.4f}",
            f"velocity_m_s={velocity:.6f}",
            f"kinematic_viscosity_m2_s={nu:.6e}",
            f"reynolds={re:.2f}",
            f"density_ok={density_ok}",
            f"regime={regime}",
            f"regime_ok={regime_ok}",
        ]
        if not passed:
            findings.append("density out of band and/or flow regime mismatch")

        return ValidationReport(
            passed=passed,
            score=round(1.0 if passed else 0.4, 6),
            metrics={
                "density_kg_m3": round(density, 4),
                "velocity_m_s": round(velocity, 6),
                "kinematic_viscosity_m2_s": float(nu) if np.isfinite(nu) else 1e12,
                "reynolds": float(re) if np.isfinite(re) else 1e12,
                "density_lo": self.density_lo,
                "density_hi": self.density_hi,
            },
            findings=findings,
            details={"expected_regime": regime},
        )
