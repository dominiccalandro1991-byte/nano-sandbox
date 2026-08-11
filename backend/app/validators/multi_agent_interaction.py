"""Multi-agent interaction validator.

Places N seeking agents with pairwise separation (basic crowd-steering: seek
target + repel from neighbors, speed-capped) in a bounded arena and checks
three concrete, falsifiable properties that matter for any multi-agent
system you'd actually want to trust:

  1. Determinism: the exact same seed + payload must produce a bit-identical
     trajectory on repeated runs. A "multi-agent swarm" that can't replay
     deterministically can't be debugged or safely merge-gated -- this is
     checked by literally running the sim twice in-process and hashing both
     full trajectories.

  2. Stability: no NaN/Inf, and every agent stays within the arena bounds
     for the whole run.

  3. Convergence: by the end of the run, at least `convergence_threshold`
     of agents must be within `epsilon` of their assigned target. This is
     the actual task-success signal, separate from (1) and (2) which are
     correctness/safety signals.
"""
from __future__ import annotations

import hashlib
import math
import random
from typing import Any

from app.models import ValidationReport


def _run_sim(
    *,
    agent_count: int,
    arena_size: float,
    steps: int,
    dt: float,
    max_speed: float,
    separation_radius: float,
    separation_strength: float,
    seed: int | None,
) -> tuple[list[tuple[float, float]], list[tuple[float, float]], list[list[tuple[float, float]]]]:
    """Runs one full simulation. Returns (final_positions, targets, trajectory)."""
    rng = random.Random(seed)
    pos = [(rng.uniform(0, arena_size), rng.uniform(0, arena_size)) for _ in range(agent_count)]
    targets = [(rng.uniform(0, arena_size), rng.uniform(0, arena_size)) for _ in range(agent_count)]
    trajectory: list[list[tuple[float, float]]] = [list(pos)]

    for _ in range(steps):
        new_pos: list[tuple[float, float]] = []
        for i in range(agent_count):
            px, py = pos[i]
            tx, ty = targets[i]
            dx, dy = tx - px, ty - py
            dist = math.hypot(dx, dy)
            if dist > 1e-9:
                seek_x, seek_y = (dx / dist) * max_speed, (dy / dist) * max_speed
            else:
                seek_x, seek_y = 0.0, 0.0

            sep_x, sep_y = 0.0, 0.0
            for j in range(agent_count):
                if j == i:
                    continue
                ox, oy = pos[j]
                ddx, ddy = px - ox, py - oy
                d = math.hypot(ddx, ddy)
                if 1e-9 < d < separation_radius:
                    weight = separation_strength * (1.0 - d / separation_radius) / d
                    sep_x += ddx * weight
                    sep_y += ddy * weight

            vx, vy = seek_x + sep_x, seek_y + sep_y
            speed = math.hypot(vx, vy)
            if speed > max_speed:
                vx, vy = vx * (max_speed / speed), vy * (max_speed / speed)

            nx = min(max(px + vx * dt, 0.0), arena_size)
            ny = min(max(py + vy * dt, 0.0), arena_size)
            new_pos.append((nx, ny))
        pos = new_pos
        trajectory.append(list(pos))

    return pos, targets, trajectory


def _trajectory_hash(trajectory: list[list[tuple[float, float]]]) -> str:
    h = hashlib.sha256()
    for frame in trajectory:
        for x, y in frame:
            h.update(f"{x:.10f},{y:.10f};".encode())
        h.update(b"|")
    return h.hexdigest()


class MultiAgentInteractionValidator:
    id = "multi-agent-interaction"
    description = (
        "Runs a seek+separation multi-agent simulation twice to check "
        "deterministic replay, checks stability (finite, in-bounds), and "
        "scores convergence to per-agent targets."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "agent_count": {"type": "integer", "default": 8, "min": 1, "max": 64},
            "arena_size": {"type": "number", "default": 20.0},
            "steps": {"type": "integer", "default": 300},
            "dt": {"type": "number", "default": 1.0 / 30.0},
            "max_speed": {"type": "number", "default": 3.0},
            "separation_radius": {"type": "number", "default": 1.5},
            "separation_strength": {"type": "number", "default": 2.0},
            "epsilon": {"type": "number", "default": 0.5, "description": "distance from target counted as 'arrived'"},
            "convergence_threshold": {"type": "number", "default": 0.75, "description": "fraction of agents that must arrive to pass"},
        }

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        agent_count = int(payload.get("agent_count", 8))
        arena_size = float(payload.get("arena_size", 20.0))
        steps = int(payload.get("steps", 300))
        dt = float(payload.get("dt", 1.0 / 30.0))
        max_speed = float(payload.get("max_speed", 3.0))
        separation_radius = float(payload.get("separation_radius", 1.5))
        separation_strength = float(payload.get("separation_strength", 2.0))
        epsilon = float(payload.get("epsilon", 0.5))
        convergence_threshold = float(payload.get("convergence_threshold", 0.75))

        if agent_count < 1:
            return ValidationReport(passed=False, error="agent_count must be >= 1.")
        if steps <= 0 or dt <= 0:
            return ValidationReport(passed=False, error="steps and dt must be positive.")

        kwargs = dict(
            agent_count=agent_count,
            arena_size=arena_size,
            steps=steps,
            dt=dt,
            max_speed=max_speed,
            separation_radius=separation_radius,
            separation_strength=separation_strength,
            seed=seed,
        )

        final_a, targets, traj_a = _run_sim(**kwargs)
        final_b, _targets_b, traj_b = _run_sim(**kwargs)

        findings: list[str] = []

        for frame in traj_a:
            for x, y in frame:
                if not (math.isfinite(x) and math.isfinite(y)):
                    return ValidationReport(passed=False, score=0.0, findings=["Non-finite agent position detected."])
                if x < -1e-6 or x > arena_size + 1e-6 or y < -1e-6 or y > arena_size + 1e-6:
                    return ValidationReport(
                        passed=False,
                        score=0.0,
                        findings=[f"Agent left arena bounds [0,{arena_size}] -- position ({x:.4f}, {y:.4f})."],
                    )

        hash_a = _trajectory_hash(traj_a)
        hash_b = _trajectory_hash(traj_b)
        deterministic = hash_a == hash_b
        if not deterministic:
            findings.append(
                "Replay with identical seed/payload produced a different trajectory hash -- "
                "simulation is not deterministic (check for unseeded randomness or dict/set "
                "iteration order dependence)."
            )
        else:
            findings.append("Two independent runs with the same seed produced an identical trajectory hash.")

        arrived = sum(
            1 for i in range(agent_count) if math.hypot(final_a[i][0] - targets[i][0], final_a[i][1] - targets[i][1]) <= epsilon
        )
        convergence_fraction = arrived / agent_count
        findings.append(f"{arrived}/{agent_count} agents within epsilon={epsilon} of target ({convergence_fraction:.0%}).")

        passed = deterministic and convergence_fraction >= convergence_threshold

        return ValidationReport(
            passed=passed,
            score=convergence_fraction,
            metrics={
                "deterministic": 1.0 if deterministic else 0.0,
                "convergence_fraction": convergence_fraction,
                "agents_arrived": float(arrived),
                "agent_count": float(agent_count),
                "trajectory_hash_a": float(int(hash_a[:8], 16)),
            },
            findings=findings,
        )
