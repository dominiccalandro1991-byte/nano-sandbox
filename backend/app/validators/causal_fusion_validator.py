"""Causal Fusion & Synthesis validator (concrete weighted probabilistic fusion).

Evidence classification block
-----------------------------
- Blueprint claim of a full joint Bayesian belief network trained on labeled
  failure corpora, or causal discovery (e.g. do-calculus / structural causal
  models): Missing.
- Weighted log-odds / softmax fusion of caller-supplied engine scores into a
  ranked root-cause probability list: Partially Verified (standard numerical
  probability fusion with pure numpy; no learned structure).
- Causal graph structure among the 19 upstream engines: Unknown (caller may
  supply optional pairwise weights; default is independent weighted sum).
- Claim of identifying the "ultimate" root cause with formal guarantees:
  Unknown / overstated — this ranks fused posterior mass only.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class CausalFusionValidator:
    id = "causal-fusion"
    description = (
        "Fuses scores from prior diagnostic engines via weighted log-odds "
        "(optional pairwise coupling), produces a ranked probability list of "
        "candidate root causes, and flags when no single cause dominates. "
        "Pure numpy; not a trained Bayesian network."
    )

    def __init__(self, dominance_threshold: float = 0.45, min_engines: int = 2):
        self.dominance_threshold = dominance_threshold
        self.min_engines = min_engines

    def payload_schema(self) -> dict[str, Any]:
        return {
            "engine_results": (
                "list[dict] — each dict has at least "
                "{'engine_id': str, 'score': float in [0,1] or any finite, "
                "'passed': optional bool, 'label': optional str root-cause name}"
            ),
            "weights": "optional dict[str,float] — per-engine_id weight (default 1.0)",
            "pair_weights": (
                "optional list[dict] — {'a': id, 'b': id, 'weight': float} for "
                "pairwise coupling (positive = reinforcing)"
            ),
            "dominance_threshold": "optional float — min posterior mass to declare a dominant cause (default 0.45)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        results = payload.get("engine_results")
        if not isinstance(results, list) or len(results) < self.min_engines:
            return ValidationReport(
                passed=False,
                error=f"engine_results must be a list of at least {self.min_engines} engine result dicts.",
            )

        engine_ids: list[str] = []
        scores: list[float] = []
        labels: list[str] = []
        passed_flags: list[bool] = []

        for i, item in enumerate(results):
            if not isinstance(item, dict):
                return ValidationReport(passed=False, error=f"engine_results[{i}] must be a dict.")
            eid = str(item.get("engine_id") or item.get("id") or f"engine_{i}")
            try:
                sc = float(item.get("score", 0.0))
            except (TypeError, ValueError):
                return ValidationReport(passed=False, error=f"engine_results[{i}].score must be numeric.")
            if not np.isfinite(sc):
                return ValidationReport(passed=False, error=f"engine_results[{i}].score is non-finite.")
            # Clamp score into a soft [0,1] evidence mass; values outside are compressed
            sc_clamped = float(1.0 / (1.0 + np.exp(-4.0 * (sc - 0.5)))) if sc < 0 or sc > 1 else sc
            # Invert: low upstream score / failed check → higher root-cause evidence
            passed = item.get("passed")
            if passed is False:
                evidence = 1.0 - sc_clamped * 0.3  # strong evidence of a problem
            elif passed is True:
                evidence = max(0.05, 1.0 - sc_clamped)  # weak evidence if already healthy
            else:
                evidence = 1.0 - sc_clamped
            engine_ids.append(eid)
            scores.append(evidence)
            labels.append(str(item.get("label") or eid))
            passed_flags.append(bool(passed) if passed is not None else False)

        n = len(engine_ids)
        weights_map = payload.get("weights") or {}
        if not isinstance(weights_map, dict):
            return ValidationReport(passed=False, error="weights must be a dict of engine_id → float.")
        w = np.array([float(weights_map.get(eid, 1.0)) for eid in engine_ids], dtype=float)
        if np.any(w < 0) or not np.all(np.isfinite(w)):
            return ValidationReport(passed=False, error="weights must be finite and non-negative.")
        if float(np.sum(w)) == 0:
            w = np.ones(n, dtype=float)

        evidence = np.asarray(scores, dtype=float)
        # Log-odds fusion: start from weighted evidence
        log_odds = w * np.log(np.clip(evidence, 1e-6, 1.0 - 1e-6) / np.clip(1.0 - evidence, 1e-6, 1.0))

        # Optional pairwise coupling (reinforcing or dampening)
        pair_weights = payload.get("pair_weights") or []
        if isinstance(pair_weights, list):
            id_to_idx = {eid: i for i, eid in enumerate(engine_ids)}
            for pw in pair_weights:
                if not isinstance(pw, dict):
                    continue
                a, b = str(pw.get("a", "")), str(pw.get("b", ""))
                if a in id_to_idx and b in id_to_idx:
                    try:
                        coup = float(pw.get("weight", 0.0))
                    except (TypeError, ValueError):
                        continue
                    i, j = id_to_idx[a], id_to_idx[b]
                    # Symmetric additive coupling on log-odds
                    log_odds[i] += 0.5 * coup * evidence[j]
                    log_odds[j] += 0.5 * coup * evidence[i]

        # Softmax → posterior masses
        log_odds -= np.max(log_odds)  # stability
        exp_lo = np.exp(log_odds)
        posterior = exp_lo / np.sum(exp_lo)

        order = np.argsort(-posterior)
        ranked = [
            {
                "rank": int(r + 1),
                "engine_id": engine_ids[int(i)],
                "label": labels[int(i)],
                "probability": round(float(posterior[int(i)]), 6),
                "evidence": round(float(evidence[int(i)]), 6),
                "weight": round(float(w[int(i)]), 4),
            }
            for r, i in enumerate(order)
        ]

        top = ranked[0]
        dominance_thr = float(payload.get("dominance_threshold", self.dominance_threshold))
        dominant = top["probability"] >= dominance_thr
        # Pass if fusion is numerically stable and we have a coherent ranking
        # (dominance is informative, not a hard fail — fusion itself always produces a ranking)
        passed = bool(np.all(np.isfinite(posterior))) and len(ranked) >= self.min_engines

        findings = [
            f"top_cause={top['label']}",
            f"top_probability={top['probability']:.4f}",
            f"dominant={dominant}",
            f"dominance_threshold={dominance_thr}",
            f"engine_count={n}",
            f"failed_upstream={sum(1 for p in passed_flags if not p)}",
        ]
        if dominant:
            findings.append(f"dominant root-cause candidate: {top['label']} ({top['probability']:.1%})")
        else:
            findings.append("no single dominant cause — ambiguity across top candidates")

        return ValidationReport(
            passed=passed,
            score=round(float(top["probability"]), 6),
            metrics={
                "top_probability": float(top["probability"]),
                "dominant": 1.0 if dominant else 0.0,
                "engine_count": float(n),
                "entropy": round(float(-np.sum(posterior * np.log(np.clip(posterior, 1e-12, 1.0)))), 6),
                "dominance_threshold": dominance_thr,
            },
            findings=findings,
            details={"ranked_root_causes": ranked, "posterior": [round(float(p), 6) for p in posterior.tolist()]},
        )
