"""Multi-Vector Physics QC Matrix (concrete subset of the Master Blueprint engine).

Evidence classification block
-----------------------------
- Blueprint claim (weighted Euclidean divergence of simulated vs ideal entity
  states across frames): Partially Verified for the distance formula.
- "Ideal mathematical models" of thermal/fluid cascades: Missing (caller must
  supply the ideal_state; this module does not invent physics models).
- Claim of replacing human playtesting: Unknown / overstated; this is a
  quantitative divergence score only.
- Implementation: pure numpy, no external physics engine.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class PhysicsQCMatrixValidator:
    id = "physics-qc-matrix"
    description = (
        "Computes a weighted Euclidean divergence between simulated entity "
        "state vectors and caller-supplied ideal state vectors. Lower score "
        "is better. Does not invent ideal physics models."
    )

    def __init__(self, spatial_weight: float = 1.5, thermal_weight: float = 2.0, pass_threshold: float = 5.0):
        self.weights = np.array([spatial_weight, thermal_weight], dtype=float)
        self.pass_threshold = pass_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "simulated_state": "list[list[float]] — shape (M, D) simulated entity vectors",
            "ideal_state": "list[list[float]] — shape (M, D) ideal entity vectors",
            "weights": "optional list[float] of length D (defaults to [spatial, thermal])",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        sim = payload.get("simulated_state")
        ideal = payload.get("ideal_state")
        if not isinstance(sim, list) or not isinstance(ideal, list):
            return ValidationReport(passed=False, error="simulated_state and ideal_state must be lists of vectors.")
        if len(sim) == 0 or len(sim) != len(ideal):
            return ValidationReport(passed=False, error="simulated_state and ideal_state must be non-empty and same length.")

        try:
            sim_arr = np.asarray(sim, dtype=float)
            ideal_arr = np.asarray(ideal, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce states to float arrays: {e}")

        if sim_arr.shape != ideal_arr.shape:
            return ValidationReport(passed=False, error=f"shape mismatch: sim {sim_arr.shape} vs ideal {ideal_arr.shape}")

        if not np.all(np.isfinite(sim_arr)) or not np.all(np.isfinite(ideal_arr)):
            return ValidationReport(
                passed=False,
                error="non-finite values in state vectors (NaN/Inf).",
                findings=["numerical instability detected in input states"],
            )

        # Euclidean distance per entity, then weighted sum
        # If D == 2 we use the configured spatial/thermal weights; otherwise uniform.
        squared = np.square(sim_arr - ideal_arr)
        # sum over feature dims -> (M,)
        dists = np.sqrt(np.sum(squared, axis=1))

        custom_w = payload.get("weights")
        if isinstance(custom_w, (list, tuple)) and len(custom_w) == sim_arr.shape[1]:
            # re-weight per dimension then re-sum
            w = np.asarray(custom_w, dtype=float)
            weighted_sq = squared * w
            dists = np.sqrt(np.sum(weighted_sq, axis=1))
            q_score = float(np.sum(dists))
        else:
            # default: apply the two blueprint weights if D>=2, else plain sum
            if sim_arr.shape[1] >= 2:
                # treat first two dims with the configured weights, remainder weight 1
                w = np.ones(sim_arr.shape[1], dtype=float)
                w[0] = self.weights[0]
                w[1] = self.weights[1]
                weighted_sq = squared * w
                dists = np.sqrt(np.sum(weighted_sq, axis=1))
            q_score = float(np.sum(dists))

        passed = q_score <= self.pass_threshold and bool(np.all(np.isfinite(dists)))
        findings = [
            f"q_score={q_score:.6f}",
            f"entity_count={len(dists)}",
            f"max_entity_divergence={float(np.max(dists)):.6f}",
            f"pass_threshold={self.pass_threshold}",
        ]
        if not passed:
            findings.append("divergence exceeds threshold or non-finite distance")

        return ValidationReport(
            passed=passed,
            score=round(q_score, 6),
            metrics={
                "q_score": round(q_score, 6),
                "max_entity_divergence": round(float(np.max(dists)), 6),
                "mean_entity_divergence": round(float(np.mean(dists)), 6),
                "entity_count": float(len(dists)),
                "pass_threshold": self.pass_threshold,
            },
            findings=findings,
            details={"per_entity_distances": [round(float(d), 6) for d in dists.tolist()]},
        )
