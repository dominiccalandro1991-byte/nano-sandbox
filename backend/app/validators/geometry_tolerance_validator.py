"""Geometry Tolerance validator (concrete spatial deviation subset).

Evidence classification block
-----------------------------
- Blueprint claim of full GD&T engines or 3-D metrology hardware: Missing.
- Point-wise / bounding-box deviation against a golden baseline with
  configurable absolute tolerance: Partially Verified (pure numpy Euclidean
  distances and coordinate comparisons).
- Datum reference frames / true position callouts: Missing (simplified
  absolute deviation only).
- Replacement of CMM inspection: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class GeometryToleranceValidator:
    id = "geometry-tolerance"
    description = (
        "Compares measured coordinates (or bounding boxes) against a golden "
        "baseline, reports max/mean deviation, and passes only when every "
        "deviation is within the absolute tolerance. Pure numpy."
    )

    def __init__(self, default_tolerance: float = 0.05):
        self.default_tolerance = default_tolerance

    def payload_schema(self) -> dict[str, Any]:
        return {
            "measured": "list[list[float]] — measured points [[x,y], ...] or boxes [[x,y,w,h], ...]",
            "baseline": "list[list[float]] — golden baseline, same shape semantics",
            "tolerance": "float — absolute max allowed deviation (default 0.05)",
            "mode": "str — 'points' (default) or 'boxes'",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        measured = payload.get("measured")
        baseline = payload.get("baseline")
        if not isinstance(measured, list) or not isinstance(baseline, list):
            return ValidationReport(passed=False, error="measured and baseline must be lists of coordinate lists.")
        if len(measured) == 0 or len(measured) != len(baseline):
            return ValidationReport(passed=False, error="measured and baseline must be non-empty and same length.")

        try:
            M = np.asarray(measured, dtype=float)
            B = np.asarray(baseline, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce coordinates: {e}")

        # ndim check: require 2-D. 1-D lists produce IndexError on shape[1].
        if M.ndim != 2 or B.ndim != 2:
            return ValidationReport(
                passed=False,
                error=f"measured and baseline must be 2-D arrays of shape (N, D); got measured.ndim={M.ndim}, baseline.ndim={B.ndim}",
            )

        if M.shape != B.shape:
            return ValidationReport(passed=False, error=f"shape mismatch: measured {M.shape} vs baseline {B.shape}.")
        if not np.all(np.isfinite(M)) or not np.all(np.isfinite(B)):
            return ValidationReport(passed=False, error="non-finite coordinates.")

        tolerance = float(payload.get("tolerance", self.default_tolerance))
        mode = str(payload.get("mode", "points")).lower()
        if tolerance < 0:
            return ValidationReport(passed=False, error="tolerance must be >= 0.")

        if mode == "boxes":
            if M.shape[1] < 4:
                return ValidationReport(passed=False, error="boxes mode requires 4 values per row [x,y,w,h].")
            # Corner-wise max deviation
            m_corners = self._box_corners(M)
            b_corners = self._box_corners(B)
            diffs = np.linalg.norm(m_corners - b_corners, axis=-1)  # (N, 4)
            per_item = np.max(diffs, axis=1)
        else:
            # Point Euclidean deviation
            if M.shape[1] < 2:
                return ValidationReport(passed=False, error="points mode requires at least 2 values per row [x,y].")
            per_item = np.linalg.norm(M[:, :2] - B[:, :2], axis=1)

        max_dev = float(np.max(per_item))
        mean_dev = float(np.mean(per_item))
        outliers = int(np.sum(per_item > tolerance))
        outlier_idx = [int(i) for i in np.where(per_item > tolerance)[0][:30]]

        passed = outliers == 0
        findings = [
            f"max_deviation={max_dev:.6f}",
            f"mean_deviation={mean_dev:.6f}",
            f"outlier_count={outliers}",
            f"tolerance={tolerance}",
            f"mode={mode}",
        ]
        if not passed:
            findings.append("one or more features exceed absolute tolerance")

        return ValidationReport(
            passed=passed,
            score=round(max(0.0, 1.0 - max_dev / (tolerance + 1e-12)), 6) if tolerance > 0 else (1.0 if max_dev == 0 else 0.0),
            metrics={
                "max_deviation": round(max_dev, 6),
                "mean_deviation": round(mean_dev, 6),
                "outlier_count": float(outliers),
                "tolerance": tolerance,
                "feature_count": float(len(per_item)),
            },
            findings=findings,
            details={"outlier_indices": outlier_idx, "per_item_deviations": [round(float(d), 6) for d in per_item.tolist()[:50]]},
        )

    @staticmethod
    def _box_corners(boxes: np.ndarray) -> np.ndarray:
        """Return (N, 4, 2) corners for boxes [x,y,w,h]."""
        x, y, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        return np.stack(
            [
                np.stack([x, y], axis=1),
                np.stack([x + w, y], axis=1),
                np.stack([x + w, y + h], axis=1),
                np.stack([x, y + h], axis=1),
            ],
            axis=1,
        )
