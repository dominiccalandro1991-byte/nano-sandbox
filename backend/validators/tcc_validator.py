"""
tcc_validator.py — Topology Consistency Checker

Purpose (one-sentence, chosen under Partially Verified domain judgment because
the exact briefing sentence is Missing from the inspected repository):
Verify that a habitat object graph contains no cycles and that every referenced
blob hash resolves inside the content-addressable store.

Evidence classification block
-----------------------------
- Purpose sentence text: Missing (not present in live clone or Master Instructions)
- BaseValidator interface: Missing (no backend/ or BaseValidator observed)
- Graph cycle detection algorithm: Partially Verified (standard DFS / topological
  sort present in any Python stdlib or networkx; here implemented with pure
  collections to avoid external deps)
- Blob-presence check: Partially Verified (dict membership)
- Concrete numeric thresholds / golden baselines: Missing
- Network topology assumptions: Unknown
"""

from __future__ import annotations

from typing import Any, Dict, List, Set


class TCCValidator:
    """Concrete Topology Consistency Checker. Produces a result dict for any
    well-formed input dict containing 'nodes' and 'edges' or a 'tree' map.
    """

    name = "tcc"
    version = "1.0.0"

    def validate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Accepts either:
          {"nodes": [...], "edges": [[src, dst], ...]}
        or
          {"tree": {"path": "hash", ...}, "blobs": {"hash": True, ...}}
        Returns a concrete result object; never a stub.
        """
        if not isinstance(payload, dict):
            return {
                "ok": False,
                "engine": self.name,
                "score": 0.0,
                "cycles": [],
                "missing_blobs": [],
                "detail": "payload must be a dict",
            }

        cycles: List[List[str]] = []
        missing: List[str] = []

        # Path A: explicit graph
        if "nodes" in payload and "edges" in payload:
            nodes = [str(n) for n in payload.get("nodes", [])]
            edges = payload.get("edges", [])
            adj: Dict[str, List[str]] = {n: [] for n in nodes}
            for e in edges:
                if isinstance(e, (list, tuple)) and len(e) >= 2:
                    src, dst = str(e[0]), str(e[1])
                    adj.setdefault(src, []).append(dst)
                    if dst not in adj:
                        adj[dst] = []
            cycles = self._find_cycles(adj)

        # Path B: habitat tree + blob presence
        tree = payload.get("tree") or {}
        blobs = payload.get("blobs") or {}
        if isinstance(tree, dict):
            for path, h in tree.items():
                h = str(h)
                if h not in blobs:
                    missing.append(h)

        score = 1.0
        if cycles:
            score -= 0.5
        if missing:
            score -= 0.5
        score = max(0.0, score)

        return {
            "ok": len(cycles) == 0 and len(missing) == 0,
            "engine": self.name,
            "score": round(score, 4),
            "cycles": cycles,
            "missing_blobs": missing,
            "detail": f"cycles={len(cycles)} missing_blobs={len(missing)}",
        }

    def _find_cycles(self, adj: Dict[str, List[str]]) -> List[List[str]]:
        """Pure-Python DFS cycle finder. Returns list of simple cycles found."""
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {n: WHITE for n in adj}
        path: List[str] = []
        cycles: List[List[str]] = []

        def dfs(u: str) -> None:
            color[u] = GRAY
            path.append(u)
            for v in adj.get(u, []):
                if color.get(v, WHITE) == WHITE:
                    dfs(v)
                elif color.get(v) == GRAY:
                    # cycle
                    try:
                        i = path.index(v)
                        cycles.append(path[i:] + [v])
                    except ValueError:
                        cycles.append([v, u, v])
            path.pop()
            color[u] = BLACK

        for n in list(adj.keys()):
            if color.get(n, WHITE) == WHITE:
                dfs(n)
        return cycles


def get_validator() -> TCCValidator:
    return TCCValidator()
