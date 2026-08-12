"""Solder Bridge Inspection validator (concrete discrete pad-adjacency subset).

Evidence classification block
-----------------------------
- Blueprint claim of trained optical PCB inspection or real vision hardware:
  Missing.
- Discrete analysis of a pad-intensity / occupancy grid for bridging between
  adjacent pads and cold-joint low-intensity anomalies: Partially Verified
  (pure numpy thresholding + 4-connected neighbourhood checks).
- True solder metallurgy / X-ray classification: Missing.
- Replacement of AOI equipment: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class SolderBridgeInspectionValidator:
    id = "solder-bridge-inspection"
    description = (
        "Inspects a 2-D pad occupancy/intensity grid for bridges (high-intensity "
        "paths linking distinct pad labels) and cold-joint candidates (pads below "
        "a minimum intensity). Pure numpy neighbourhood logic; no trained AOI model."
    )

    def __init__(self, bridge_threshold: float = 0.6, cold_joint_threshold: float = 0.25):
        self.bridge_threshold = bridge_threshold
        self.cold_joint_threshold = cold_joint_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "pad_grid": "list[list[float]] — intensity/occupancy in [0,1] per cell",
            "pad_labels": "optional list[list[int]] — integer pad IDs (0 = background)",
            "bridge_threshold": "float — intensity above which a cell can form a bridge (default 0.6)",
            "cold_joint_threshold": "float — pad mean intensity below which a cold joint is flagged (default 0.25)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        grid = payload.get("pad_grid")
        if not isinstance(grid, list) or len(grid) < 2:
            return ValidationReport(passed=False, error="pad_grid must be a 2-D list with at least 2 rows.")
        try:
            G = np.asarray(grid, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce pad_grid: {e}")
        if G.ndim != 2 or min(G.shape) < 2:
            return ValidationReport(passed=False, error="pad_grid must be 2-D with shape >= (2,2).")
        if not np.all(np.isfinite(G)):
            return ValidationReport(passed=False, error="non-finite values in pad_grid.")

        bridge_thr = float(payload.get("bridge_threshold", self.bridge_threshold))
        cold_thr = float(payload.get("cold_joint_threshold", self.cold_joint_threshold))

        labels_raw = payload.get("pad_labels")
        if labels_raw is not None:
            try:
                L = np.asarray(labels_raw, dtype=int)
            except (ValueError, TypeError) as e:
                return ValidationReport(passed=False, error=f"could not coerce pad_labels: {e}")
            if L.shape != G.shape:
                return ValidationReport(passed=False, error="pad_labels shape must match pad_grid.")
        else:
            # Auto-label: connected components of cells above cold_thr via simple flood
            L = self._label_components(G > cold_thr)

        # Bridge detection: high-intensity cells whose 4-neighbours belong to >=2 distinct pad IDs
        bridges = 0
        bridge_coords: list[dict[str, Any]] = []
        h, w = G.shape
        for i in range(h):
            for j in range(w):
                if G[i, j] < bridge_thr:
                    continue
                neigh_labels = set()
                for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ni, nj = i + di, j + dj
                    if 0 <= ni < h and 0 <= nj < w and L[ni, nj] != 0:
                        neigh_labels.add(int(L[ni, nj]))
                if len(neigh_labels) >= 2:
                    bridges += 1
                    if len(bridge_coords) < 30:
                        bridge_coords.append({"row": i, "col": j, "intensity": round(float(G[i, j]), 4)})

        # Cold joints: per-pad mean intensity below threshold
        cold_joints = 0
        pad_ids = sorted(set(int(x) for x in L.ravel() if x != 0))
        for pid in pad_ids:
            mask = L == pid
            if not np.any(mask):
                continue
            mean_i = float(np.mean(G[mask]))
            if mean_i < cold_thr:
                cold_joints += 1

        passed = bridges == 0 and cold_joints == 0
        findings = [
            f"bridge_count={bridges}",
            f"cold_joint_count={cold_joints}",
            f"pad_count={len(pad_ids)}",
            f"bridge_threshold={bridge_thr}",
            f"cold_joint_threshold={cold_thr}",
        ]
        if not passed:
            findings.append("bridging and/or cold-joint anomalies detected")

        return ValidationReport(
            passed=passed,
            score=round(1.0 if passed else max(0.0, 1.0 - 0.15 * bridges - 0.1 * cold_joints), 6),
            metrics={
                "bridge_count": float(bridges),
                "cold_joint_count": float(cold_joints),
                "pad_count": float(len(pad_ids)),
                "bridge_threshold": bridge_thr,
                "cold_joint_threshold": cold_thr,
            },
            findings=findings,
            details={"bridge_coords": bridge_coords},
        )

    @staticmethod
    def _label_components(mask: np.ndarray) -> np.ndarray:
        """Simple 4-connected component labelling."""
        h, w = mask.shape
        labels = np.zeros((h, w), dtype=int)
        current = 0
        for i in range(h):
            for j in range(w):
                if not mask[i, j] or labels[i, j] != 0:
                    continue
                current += 1
                stack = [(i, j)]
                labels[i, j] = current
                while stack:
                    ci, cj = stack.pop()
                    for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        ni, nj = ci + di, cj + dj
                        if 0 <= ni < h and 0 <= nj < w and mask[ni, nj] and labels[ni, nj] == 0:
                            labels[ni, nj] = current
                            stack.append((ni, nj))
        return labels
