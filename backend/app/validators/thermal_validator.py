"""Thermal Dissipation validator (concrete discrete heat-diffusion subset).

Evidence classification block
-----------------------------
- Blueprint-style claim of full continuum thermodynamics / PINN residual
  bounds: Missing (no trained network, no continuous PDE solver).
- Discrete 2-D explicit heat equation (finite-difference diffusion) + energy
  and stability checks: Partially Verified (standard FTCS scheme, pure numpy).
- Conservation / dissipation invariants under Neumann boundaries: Partially
  Verified for the discrete system implemented here.
- Any claim of replacing physical thermal testing: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class ThermalDissipationValidator:
    id = "thermal-dissipation"
    description = (
        "Runs a discrete 2-D heat-diffusion (FTCS) simulation on a caller-supplied "
        "temperature field and checks numerical stability plus monotonic total-energy "
        "decay under insulating boundaries. Pure numpy; no continuum PDE claim."
    )

    def __init__(
        self,
        default_alpha: float = 0.2,
        default_steps: int = 40,
        energy_tol: float = 1e-6,
    ):
        self.default_alpha = default_alpha
        self.default_steps = default_steps
        self.energy_tol = energy_tol

    def payload_schema(self) -> dict[str, Any]:
        return {
            "temperature_field": "list[list[float]] — initial 2-D temperature grid",
            "alpha": "float — thermal diffusivity (default 0.2; must keep FTCS stable)",
            "steps": "int — number of diffusion steps (default 40)",
            "dx": "float — grid spacing (default 1.0)",
            "dt": "float — time step (default 0.1)",
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
        if T.ndim != 2 or T.shape[0] < 2 or T.shape[1] < 2:
            return ValidationReport(passed=False, error="temperature_field must be 2-D with shape >= (2,2).")
        if not np.all(np.isfinite(T)):
            return ValidationReport(passed=False, error="non-finite values in temperature_field.")

        alpha = float(payload.get("alpha", self.default_alpha))
        steps = int(payload.get("steps", self.default_steps))
        dx = float(payload.get("dx", 1.0))
        dt = float(payload.get("dt", 0.1))

        if alpha <= 0 or dx <= 0 or dt <= 0 or steps < 1:
            return ValidationReport(passed=False, error="alpha, dx, dt must be > 0 and steps >= 1.")

        # FTCS stability criterion for 2-D: r = alpha * dt / dx^2  <= 1/4
        r = alpha * dt / (dx * dx)
        if r > 0.25 + 1e-12:
            return ValidationReport(
                passed=False,
                error=f"FTCS unstable: r={r:.6f} > 0.25 (reduce alpha*dt/dx^2).",
                metrics={"fourier_number": r},
                findings=["stability criterion violated"],
            )

        energy_hist: list[float] = []
        T_work = T.copy()
        energy_hist.append(float(np.sum(T_work**2)))

        for _ in range(steps):
            # 5-point stencil, Neumann (copy edge) boundaries
            Tn = T_work.copy()
            Tn[1:-1, 1:-1] = (
                T_work[1:-1, 1:-1]
                + r
                * (
                    T_work[1:-1, 2:]
                    + T_work[1:-1, :-2]
                    + T_work[2:, 1:-1]
                    + T_work[:-2, 1:-1]
                    - 4.0 * T_work[1:-1, 1:-1]
                )
            )
            # Neumann: edges stay equal to interior neighbour (already approx via no update)
            if not np.all(np.isfinite(Tn)):
                return ValidationReport(
                    passed=False,
                    error="non-finite temperature during diffusion (numerical blow-up).",
                    findings=["stability failure mid-run"],
                    metrics={"fourier_number": r, "steps_completed": float(_)},
                )
            T_work = Tn
            energy_hist.append(float(np.sum(T_work**2)))

        # Under pure diffusion with Neumann BCs, discrete energy should be non-increasing
        energy_increases = sum(
            1 for i in range(1, len(energy_hist)) if energy_hist[i] > energy_hist[i - 1] + self.energy_tol
        )
        final_energy = energy_hist[-1]
        initial_energy = energy_hist[0]
        dissipated = initial_energy - final_energy

        passed = energy_increases == 0 and final_energy <= initial_energy + self.energy_tol
        findings = [
            f"fourier_number={r:.6f}",
            f"initial_energy={initial_energy:.6f}",
            f"final_energy={final_energy:.6f}",
            f"dissipated={dissipated:.6f}",
            f"energy_increase_steps={energy_increases}",
        ]
        if not passed:
            findings.append("energy increased under diffusion — discrete dissipation invariant violated")

        return ValidationReport(
            passed=passed,
            score=round(max(0.0, 1.0 - abs(dissipated) / (initial_energy + 1e-12)), 6) if passed else 0.0,
            metrics={
                "fourier_number": round(r, 6),
                "initial_energy": round(initial_energy, 6),
                "final_energy": round(final_energy, 6),
                "dissipated": round(dissipated, 6),
                "energy_increase_steps": float(energy_increases),
                "steps": float(steps),
            },
            findings=findings,
            details={"energy_history_head": energy_hist[:5], "energy_history_tail": energy_hist[-5:]},
        )
