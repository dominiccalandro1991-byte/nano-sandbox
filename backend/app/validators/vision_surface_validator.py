"""Vision Surface Defects validator (concrete discrete edge-detection subset).

Evidence classification block
-----------------------------
- Blueprint claim of trained micro-fracture / scratch / burn classifiers or
  real OpenCV pipelines: Missing.
- Discrete Sobel-style edge magnitude on a caller-supplied intensity grid +
  thresholded defect isolation: Partially Verified (standard finite-difference
  kernels, pure numpy).
- Semantic labels (fracture vs scratch vs burn): Unknown / heuristic only —
  intensity + gradient magnitude cannot uniquely identify physical defect
  type without labeled training data.
- Replacement of optical inspection hardware: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class VisionSurfaceDefectsValidator:
    id = "vision-surface-defects"
    description = (
        "Applies Sobel-style discrete edge detection to a 2-D intensity grid, "
        "flags cells whose gradient magnitude exceeds a threshold, and reports "
        "defect count and peak edge strength. Pure numpy; no trained classifier."
    )

    def __init__(self, default_threshold: float = 30.0):
        self.default_threshold = default_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "intensity_field": "list[list[float]] — 2-D grayscale / intensity grid",
            "edge_threshold": "float — gradient magnitude above which a cell is a defect (default 30)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        field = payload.get("intensity_field")
        if not isinstance(field, list) or len(field) < 3:
            return ValidationReport(
                passed=False,
                error="intensity_field must be a 2-D list with at least 3 rows.",
            )
        try:
            img = np.asarray(field, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce intensity_field: {e}")
        if img.ndim != 2 or min(img.shape) < 3:
            return ValidationReport(passed=False, error="intensity_field must be 2-D with shape >= (3,3).")
        if not np.all(np.isfinite(img)):
            return ValidationReport(passed=False, error="non-finite values in intensity_field.")

        threshold = float(payload.get("edge_threshold", self.default_threshold))

        # Sobel-like kernels
        kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=float)
        ky = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=float)

        # Valid convolution (no padding) via sliding windows
        h, w = img.shape
        gx = np.zeros((h - 2, w - 2), dtype=float)
        gy = np.zeros((h - 2, w - 2), dtype=float)
        for i in range(h - 2):
            for j in range(w - 2):
                patch = img[i : i + 3, j : j + 3]
                gx[i, j] = float(np.sum(patch * kx))
                gy[i, j] = float(np.sum(patch * ky))

        magnitude = np.sqrt(gx**2 + gy**2)
        defect_mask = magnitude > threshold
        defect_count = int(np.sum(defect_mask))
        max_edge = float(np.max(magnitude)) if magnitude.size else 0.0
        mean_edge = float(np.mean(magnitude)) if magnitude.size else 0.0

        coords = [
            {"row": int(i + 1), "col": int(j + 1), "magnitude": round(float(magnitude[i, j]), 4)}
            for i, j in zip(*np.where(defect_mask))
        ][:40]

        # Pass if finite and defect density is not extreme (heuristic gate)
        density = defect_count / max(magnitude.size, 1)
        passed = bool(np.all(np.isfinite(magnitude))) and density <= 0.35
        findings = [
            f"max_edge={max_edge:.4f}",
            f"mean_edge={mean_edge:.4f}",
            f"defect_count={defect_count}",
            f"defect_density={density:.4f}",
            f"threshold={threshold}",
        ]
        if not passed:
            findings.append("high defect density or non-finite edge field")

        return ValidationReport(
            passed=passed,
            score=round(max(0.0, 1.0 - density), 6),
            metrics={
                "max_edge": round(max_edge, 4),
                "mean_edge": round(mean_edge, 4),
                "defect_count": float(defect_count),
                "defect_density": round(density, 6),
                "threshold": threshold,
            },
            findings=findings,
            details={"defect_coords": coords},
        )
