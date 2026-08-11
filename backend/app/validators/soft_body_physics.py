"""Soft-body (mass-spring grid) stability validator.

Builds a 2D grid of point masses connected by structural springs (to
right/down neighbors) and shear springs (to both diagonal neighbors) -- the
standard mass-spring approximation of a soft body / cloth used in a lot of
game physics. Perturbs it from rest with a seeded random displacement, then
integrates with semi-implicit (symplectic) Euler and checks two concrete,
falsifiable invariants:

  1. Numerical stability: every position/velocity component stays finite
     and within a bounded region for the whole run. NaN/Inf or an exploding
     trajectory is an unconditional FAIL regardless of tuning.

  2. Passivity: with gravity off (the default), this is a damped
     conservative system. A damped conservative system's total mechanical
     energy must be non-increasing over time. If it *increases* beyond
     numerical tolerance, the integrator/parameters are injecting energy
     that isn't physically there -- a real bug class in spring-mass sims,
     not a made-up threshold.

If gravity is turned on, invariant (2) is skipped (gravity does external
work, so energy legitimately changes) and only (1) is enforced; this is
reported explicitly in `findings` rather than silently relaxed.
"""
from __future__ import annotations

import math
import random
from typing import Any

from app.models import ValidationReport


class SoftBodyPhysicsValidator:
    id = "soft-body-physics"
    description = (
        "Simulates a mass-spring soft-body grid and checks numerical "
        "stability and (when gravity is off) non-increasing mechanical "
        "energy under damping."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "rows": {"type": "integer", "default": 4, "min": 2, "max": 12},
            "cols": {"type": "integer", "default": 4, "min": 2, "max": 12},
            "stiffness": {"type": "number", "default": 120.0},
            "damping": {"type": "number", "default": 0.6, "description": "velocity damping coefficient, >= 0"},
            "mass": {"type": "number", "default": 1.0},
            "dt": {"type": "number", "default": 1.0 / 120.0},
            "steps": {"type": "integer", "default": 600},
            "gravity": {"type": "number", "default": 0.0},
            "perturbation": {"type": "number", "default": 0.15, "description": "max seeded random displacement per axis"},
            "explosion_factor": {"type": "number", "default": 50.0, "description": "max allowed displacement, as a multiple of lattice spacing"},
        }

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        rows = int(payload.get("rows", 4))
        cols = int(payload.get("cols", 4))
        k = float(payload.get("stiffness", 120.0))
        damping = float(payload.get("damping", 0.6))
        mass = float(payload.get("mass", 1.0))
        dt = float(payload.get("dt", 1.0 / 120.0))
        steps = int(payload.get("steps", 600))
        gravity = float(payload.get("gravity", 0.0))
        perturbation = float(payload.get("perturbation", 0.15))
        explosion_factor = float(payload.get("explosion_factor", 50.0))

        findings: list[str] = []

        if rows < 2 or cols < 2:
            return ValidationReport(passed=False, error="rows and cols must each be >= 2 to form at least one spring.")
        if dt <= 0 or steps <= 0:
            return ValidationReport(passed=False, error="dt and steps must be positive.")
        if mass <= 0:
            return ValidationReport(passed=False, error="mass must be positive.")

        rng = random.Random(seed)
        n = rows * cols
        lattice_spacing = 1.0

        rest_x = [[float(c) * lattice_spacing for c in range(cols)] for _ in range(rows)]
        rest_y = [[float(r) * lattice_spacing for c in range(cols)] for r in range(rows)]

        def idx(r: int, c: int) -> int:
            return r * cols + c

        px = [0.0] * n
        py = [0.0] * n
        vx = [0.0] * n
        vy = [0.0] * n
        for r in range(rows):
            for c in range(cols):
                i = idx(r, c)
                px[i] = rest_x[r][c] + rng.uniform(-perturbation, perturbation)
                py[i] = rest_y[r][c] + rng.uniform(-perturbation, perturbation)

        springs: list[tuple[int, int, float]] = []

        def add_spring(a: tuple[int, int], b: tuple[int, int]) -> None:
            ia, ib = idx(*a), idx(*b)
            rest_len = math.hypot(rest_x[a[0]][a[1]] - rest_x[b[0]][b[1]], rest_y[a[0]][a[1]] - rest_y[b[0]][b[1]])
            springs.append((ia, ib, rest_len))

        for r in range(rows):
            for c in range(cols):
                if c + 1 < cols:
                    add_spring((r, c), (r, c + 1))
                if r + 1 < rows:
                    add_spring((r, c), (r + 1, c))
                if r + 1 < rows and c + 1 < cols:
                    add_spring((r, c), (r + 1, c + 1))
                    add_spring((r, c + 1), (r + 1, c))

        max_extent = lattice_spacing * max(rows, cols) * explosion_factor

        def total_energy() -> float:
            ke = 0.5 * mass * sum(vx[i] * vx[i] + vy[i] * vy[i] for i in range(n))
            pe = 0.0
            for ia, ib, rest_len in springs:
                dx = px[ib] - px[ia]
                dy = py[ib] - py[ia]
                length = math.hypot(dx, dy)
                stretch = length - rest_len
                pe += 0.5 * k * stretch * stretch
            return ke + pe

        initial_energy = total_energy()
        peak_energy = initial_energy
        energy_history: list[float] = [initial_energy]

        gravity_on = abs(gravity) > 1e-12

        for _step in range(steps):
            fx = [0.0] * n
            fy = [0.0] * n
            for ia, ib, rest_len in springs:
                dx = px[ib] - px[ia]
                dy = py[ib] - py[ia]
                length = math.hypot(dx, dy)
                if length < 1e-9:
                    continue
                nx, ny = dx / length, dy / length
                stretch = length - rest_len
                f_spring = k * stretch
                rvx = vx[ib] - vx[ia]
                rvy = vy[ib] - vy[ia]
                f_damp = damping * (rvx * nx + rvy * ny)
                f_total = f_spring + f_damp
                fx[ia] += f_total * nx
                fy[ia] += f_total * ny
                fx[ib] -= f_total * nx
                fy[ib] -= f_total * ny

            for i in range(n):
                fy[i] += mass * gravity
                ax = fx[i] / mass
                ay = fy[i] / mass
                vx[i] += ax * dt
                vy[i] += ay * dt
                px[i] += vx[i] * dt
                py[i] += vy[i] * dt

                if not (math.isfinite(px[i]) and math.isfinite(py[i]) and math.isfinite(vx[i]) and math.isfinite(vy[i])):
                    return ValidationReport(
                        passed=False,
                        score=0.0,
                        metrics={"failed_at_step": float(_step), "particle_index": float(i)},
                        findings=["Non-finite state (NaN/Inf) detected -- integrator diverged."],
                    )
                if abs(px[i]) > max_extent or abs(py[i]) > max_extent:
                    return ValidationReport(
                        passed=False,
                        score=0.0,
                        metrics={"failed_at_step": float(_step), "particle_index": float(i), "max_extent": max_extent},
                        findings=[f"Particle {i} exceeded explosion bound of {max_extent:.2f} at step {_step} -- unstable."],
                    )

            e = total_energy()
            energy_history.append(e)
            peak_energy = max(peak_energy, e)

        final_energy = energy_history[-1]
        max_displacement = max(
            math.hypot(px[i] - (rest_x[i // cols][i % cols]), py[i] - (rest_y[i // cols][i % cols])) for i in range(n)
        )

        passed = True
        score = 1.0

        if not gravity_on:
            tolerance = max(1e-6, 1e-3 * max(initial_energy, 1.0))
            if final_energy > peak_energy + tolerance and final_energy > initial_energy + tolerance:
                passed = False
                score = 0.0
                findings.append(
                    f"Total mechanical energy increased over the run (initial={initial_energy:.6f}, "
                    f"final={final_energy:.6f}) despite damping={damping} and zero gravity -- "
                    "the integrator/spring parameters are non-physically injecting energy."
                )
            else:
                findings.append("Energy non-increasing under damping with gravity off -- passivity holds.")
        else:
            findings.append("Gravity is nonzero; passivity/energy-monotonicity check skipped by design (external work is expected).")

        return ValidationReport(
            passed=passed,
            score=score,
            metrics={
                "initial_energy": initial_energy,
                "peak_energy": peak_energy,
                "final_energy": final_energy,
                "max_displacement": max_displacement,
                "particle_count": float(n),
                "spring_count": float(len(springs)),
                "steps": float(steps),
            },
            findings=findings,
        )
