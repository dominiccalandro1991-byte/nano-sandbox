"""ASEE Tier-Drift Validator (concrete subset of the Master Blueprint engine).

Evidence classification block
-----------------------------
- Blueprint claim ("high-dimensional embedding of Tier-1 idea vs Tier-3 code
  + cosine similarity penalized by cyclomatic complexity"): Partially Verified
  for the scoring formula; the *embedding* step itself is Missing (no
  embedding model is present in the repository or environment).
- Cyclomatic complexity via AST walk: Partially Verified (standard Python
  `ast` module, same approach used in many static-analysis tools).
- Cosine similarity: Partially Verified (numpy.linalg.norm + dot product).
- Claim that a score < 0.85 "rejects the PR" as a hard guarantee: Unknown
  (threshold is an operating parameter, not a proven formal bound).
- Any neural / LLM-based embedding of natural-language requirements:
  Missing.
"""

from __future__ import annotations

import ast
from typing import Any

import numpy as np

from app.models import ValidationReport


class TierDriftValidator:
    id = "tier-drift"
    description = (
        "Scores alignment between a Tier-1 idea vector and a Tier-3 code vector "
        "via cosine similarity, then penalizes by cyclomatic complexity of the "
        "supplied source. Returns a concrete numeric score; does not invent "
        "embeddings."
    )

    def __init__(self, arch_weight: float = 1.2, complexity_penalty: float = 0.05, threshold: float = 0.85):
        self.w_arch = arch_weight
        self.lambda_pen = complexity_penalty
        self.threshold = threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "idea_vector": "list[float] — pre-computed Tier-1 embedding (caller supplies)",
            "code_vector": "list[float] — pre-computed Tier-3 embedding (caller supplies)",
            "source_code": "str — Python source whose cyclomatic complexity is measured",
        }

    def _cyclomatic(self, source: str) -> int:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return 999  # unparseable code is maximally complex for scoring purposes
        complexity = 1
        for node in ast.walk(tree):
            if isinstance(node, (ast.If, ast.For, ast.While, ast.And, ast.Or, ast.ExceptHandler, ast.With, ast.Assert)):
                complexity += 1
            elif isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
                complexity += len(node.values) - 1
        return complexity

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        idea = payload.get("idea_vector")
        code = payload.get("code_vector")
        source = payload.get("source_code") or ""

        if not isinstance(idea, (list, tuple)) or not isinstance(code, (list, tuple)):
            return ValidationReport(
                passed=False,
                error="idea_vector and code_vector must be lists of floats (caller must supply embeddings).",
            )
        if len(idea) == 0 or len(code) == 0 or len(idea) != len(code):
            return ValidationReport(
                passed=False,
                error="idea_vector and code_vector must be non-empty and same length.",
            )

        v1 = np.asarray(idea, dtype=float)
        v2 = np.asarray(code, dtype=float)
        n1 = float(np.linalg.norm(v1))
        n2 = float(np.linalg.norm(v2))
        if n1 == 0.0 or n2 == 0.0:
            return ValidationReport(passed=False, error="zero-norm vector; cosine undefined.")

        similarity = float(np.dot(v1, v2) / (n1 * n2))
        complexity = self._cyclomatic(str(source))
        score = (similarity * self.w_arch) - (self.lambda_pen * complexity)

        passed = score >= self.threshold
        findings = [
            f"cosine_similarity={similarity:.6f}",
            f"cyclomatic_complexity={complexity}",
            f"score={score:.6f} (threshold={self.threshold})",
        ]
        if not passed:
            findings.append("score below threshold — drift detected relative to supplied vectors")

        return ValidationReport(
            passed=passed,
            score=round(score, 6),
            metrics={
                "cosine_similarity": round(similarity, 6),
                "cyclomatic_complexity": float(complexity),
                "arch_weight": self.w_arch,
                "complexity_penalty": self.lambda_pen,
                "threshold": self.threshold,
            },
            findings=findings,
            details={"raw_score": score},
        )
