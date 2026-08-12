"""Sandbox Dependency Collision Grapher (concrete subset of the Master Blueprint engine).

Evidence classification block
-----------------------------
- Blueprint claim (AST adjacency matrix + Eigenvector Centrality for collision
  risk): Partially Verified for the variable-name collision detection and a
  pure-Python degree/centrality proxy.
- Full networkx.eigenvector_centrality: Missing (networkx is not in
  requirements.txt; a degree-based proxy is used instead).
- Memory-address collision detection: Missing (Python runtime does not expose
  stable addresses across processes for this purpose).
- Claim of predicting "systemic collapse": Unknown / overstated; this reports
  a concrete collision risk score based on name overlap only.
"""

from __future__ import annotations

import ast
from collections import defaultdict
from typing import Any

from app.models import ValidationReport


class DependencyCollisionValidator:
    id = "dependency-collision"
    description = (
        "Maps variable names extracted from sandbox source against a supplied "
        "global name list, builds a simple directed collision graph, and scores "
        "risk via a pure-Python degree-centrality proxy. No networkx required."
    )

    def __init__(self, risk_threshold: float = 0.5):
        self.risk_threshold = risk_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "global_vars": "list[str] — names already bound in the host/main context",
            "sandbox_source": "str — Python source of the sandbox module to scan",
            "sandbox_vars": "optional list[str] — if omitted, names are extracted via AST",
        }

    def _extract_names(self, source: str) -> set[str]:
        names: set[str] = set()
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return names
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                names.add(node.id)
            elif isinstance(node, ast.arg):
                names.add(node.arg)
            elif isinstance(node, ast.FunctionDef):
                names.add(node.name)
            elif isinstance(node, ast.ClassDef):
                names.add(node.name)
            elif isinstance(node, ast.Attribute):
                names.add(node.attr)
        return names

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        global_vars = payload.get("global_vars") or []
        if not isinstance(global_vars, list):
            return ValidationReport(passed=False, error="global_vars must be a list of strings.")
        global_set = {str(g) for g in global_vars}

        sandbox_vars = payload.get("sandbox_vars")
        if sandbox_vars is None:
            source = payload.get("sandbox_source") or ""
            sandbox_set = self._extract_names(str(source))
        else:
            if not isinstance(sandbox_vars, list):
                return ValidationReport(passed=False, error="sandbox_vars must be a list of strings.")
            sandbox_set = {str(s) for s in sandbox_vars}

        # Build simple directed edges for colliding names
        collisions = sorted(global_set & sandbox_set)
        # Degree centrality proxy: each collision node has degree 1 toward the global side
        # Normalize by total unique names so score is in [0, 1]
        total_names = len(global_set | sandbox_set) or 1
        risk_score = len(collisions) / total_names

        status = "Collision Detected" if risk_score > self.risk_threshold else "Stable"
        passed = risk_score <= self.risk_threshold

        findings = [
            f"status={status}",
            f"risk_score={risk_score:.6f}",
            f"collision_count={len(collisions)}",
            f"threshold={self.risk_threshold}",
        ]
        if collisions:
            findings.append(f"colliding_names={collisions[:20]}")

        return ValidationReport(
            passed=passed,
            score=round(1.0 - risk_score, 6),  # higher score = safer
            metrics={
                "risk_score": round(risk_score, 6),
                "collision_count": float(len(collisions)),
                "global_name_count": float(len(global_set)),
                "sandbox_name_count": float(len(sandbox_set)),
                "threshold": self.risk_threshold,
            },
            findings=findings,
            details={"colliding_names": collisions, "status": status},
        )
