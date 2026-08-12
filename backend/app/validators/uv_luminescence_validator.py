"""UV Luminescence validator (concrete intensity-threshold / blob subset).

Evidence classification block
-----------------------------
- Blueprint claim of spectroscopic UV analysis or trained fluorescent tracers:
  Missing.
- Discrete intensity thresholding + connected-component blob stats on a
  caller-supplied UV intensity field: Partially Verified (pure numpy).
- Chemical identification of leak fluids or coating chemistry: Missing.
- Replacement of UV inspection lamps / spectrometers: Unknown / overstated.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport


class UVLuminescenceValidator:
    id = "uv-luminescence"
    description = (
        "Thresholds a 2-D UV intensity field, labels connected bright regions, "
        "and flags blobs whose area or peak intensity exceeds design limits. "
        "Pure numpy; no spectral library."
    )

    def __init__(
        self,
        default_intensity_thr: float = 0.4,
        default_max_blob_area: int = 25,
        default_max_peak: float = 0.95,
    ):
        self.default_intensity_thr = default_intensity_thr
        self.default_max_blob_area = default_max_blob_area
        self.default_max_peak = default_max_peak

    def payload_schema(self) -> dict[str, Any]:
        return {
            "uv_field": "list[list[float]] — 2-D UV / fluorescence intensity grid in [0,1] or arbitrary scale",
            "intensity_threshold": "float — cells above this are candidate luminescence (default 0.4)",
            "max_blob_area": "int — max allowed connected-cell count per blob (default 25)",
            "max_peak_intensity": "float — max allowed peak inside any blob (default 0.95)",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        field = payload.get("uv_field")
        if not isinstance(field, list) or len(field) < 2:
            return ValidationReport(passed=False, error="uv_field must be a 2-D list with at least 2 rows.")
        try:
            U = np.asarray(field, dtype=float)
        except (ValueError, TypeError) as e:
            return ValidationReport(passed=False, error=f"could not coerce uv_field: {e}")
        if U.ndim != 2 or min(U.shape) < 2:
            return ValidationReport(passed=False, error="uv_field must be 2-D with shape >= (2,2).")
        if not np.all(np.isfinite(U)):
            return ValidationReport(passed=False, error="non-finite values in uv_field.")

        thr = float(payload.get("intensity_threshold", self.default_intensity_thr))
        max_area = int(payload.get("max_blob_area", self.default_max_blob_area))
        max_peak = float(payload.get("max_peak_intensity", self.default_max_peak))

        mask = U >= thr
        labels, blob_count = self._label(mask)
        oversized = 0
        hot_blobs = 0
        blob_stats: list[dict[str, Any]] = []
        for bid in range(1, blob_count + 1):
            bmask = labels == bid
            area = int(np.sum(bmask))
            peak = float(np.max(U[bmask])) if area else 0.0
            if area > max_area:
                oversized += 1
            if peak > max_peak:
                hot_blobs += 1
            if len(blob_stats) < 25:
                ys, xs = np.where(bmask)
                blob_stats.append(
                    {
                        "id": bid,
                        "area": area,
                        "peak": round(peak, 4),
                        "centroid_row": round(float(np.mean(ys)), 2),
                        "centroid_col": round(float(np.mean(xs)), 2),
                    }
                )

        total_bright = int(np.sum(mask))
        passed = oversized == 0 and hot_blobs == 0
        findings = [
            f"blob_count={blob_count}",
            f"oversized_blobs={oversized}",
            f"hot_peak_blobs={hot_blobs}",
            f"total_bright_cells={total_bright}",
            f"intensity_threshold={thr}",
            f"max_blob_area={max_area}",
            f"max_peak_intensity={max_peak}",
        ]
        if not passed:
            findings.append("luminescence blobs exceed area or peak limits — possible leak/coating flaw")

        return ValidationReport(
            passed=passed,
            score=round(1.0 if passed else max(0.0, 1.0 - 0.1 * oversized - 0.1 * hot_blobs), 6),
            metrics={
                "blob_count": float(blob_count),
                "oversized_blobs": float(oversized),
                "hot_peak_blobs": float(hot_blobs),
                "total_bright_cells": float(total_bright),
                "intensity_threshold": thr,
                "max_blob_area": float(max_area),
                "max_peak_intensity": max_peak,
            },
            findings=findings,
            details={"blob_stats": blob_stats},
        )

    @staticmethod
    def _label(mask: np.ndarray) -> tuple[np.ndarray, int]:
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
        return labels, current
