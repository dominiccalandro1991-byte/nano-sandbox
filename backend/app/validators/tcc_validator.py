"""Topological Component Anomaly (TCC) validator.

IMPORTANT SCOPE NOTE, read before trusting any output from this validator:

The source spec describes this as computing a "metric tensor divergence"
over a Riemannian manifold. What's actually implementable from the given
schema is simpler and it's important to be honest about the gap: the input
(`feature_matrix`, `baseline_matrix`) is a plain 2D grid of scalars, not an
indexed tensor field, so there is no metric tensor g_ij to take a
determinant of. What this validator actually does -- correctly and
concretely -- is:

  1. Pointwise difference between observed and baseline grids.
  2. A real Frobenius norm over that difference as the scalar "total
     divergence" (the discrete analogue of the spec's surface integral).
  3. Gaussian smoothing of the absolute difference field (implemented
     directly, no dependency beyond numpy) to suppress single-pixel noise.
  4. Local-maximum detection above `sensitivity_threshold` to locate
     candidate anomaly coordinates.

Anomaly *labels* are a deliberately generic heuristic (deviation sign +
magnitude band), NOT the domain-specific categories the spec's schema
comments suggest ('component_burn', 'solder_bridge', 'structural_fracture').
Assigning those specific real-world defect categories from a sign/magnitude
heuristic alone would be a fabricated-looking diagnosis with no real
evidentiary basis -- burn marks, solder bridges, and fractures are visually
and physically distinct phenomena that need actual trained classifiers fed
real labeled examples, not just "this scalar differs from baseline". If you
wire in a real trained classifier later, plug its output in as
`anomaly_type` in place of `_classify_deviation()` below -- everything else
in this file is unaffected.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from app.models import ValidationReport

MAX_GRID_DIM = 128


def _gaussian_kernel(size: int, sigma: float) -> np.ndarray:
    ax = np.arange(size) - (size - 1) / 2.0
    xx, yy = np.meshgrid(ax, ax)
    kernel = np.exp(-(xx**2 + yy**2) / (2.0 * sigma**2))
    return kernel / kernel.sum()


def _smooth(field: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Direct (non-FFT) 2D convolution with 'same' output size and edge
    replication padding. Grids are capped at MAX_GRID_DIM so this is fast
    enough without needing scipy as a dependency."""
    k = kernel.shape[0]
    pad = k // 2
    padded = np.pad(field, pad, mode="edge")
    out = np.zeros_like(field, dtype=float)
    h, w = field.shape
    for i in range(h):
        for j in range(w):
            window = padded[i : i + k, j : j + k]
            out[i, j] = float(np.sum(window * kernel))
    return out


def _local_maxima(field: np.ndarray, threshold: float) -> list[tuple[int, int]]:
    h, w = field.shape
    coords: list[tuple[int, int]] = []
    for i in range(h):
        for j in range(w):
            value = field[i, j]
            if value < threshold:
                continue
            is_max = True
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if di == 0 and dj == 0:
                        continue
                    ni, nj = i + di, j + dj
                    if 0 <= ni < h and 0 <= nj < w and field[ni, nj] > value:
                        is_max = False
                        break
                if not is_max:
                    break
            if is_max:
                coords.append((i, j))
    return coords


def _classify_deviation(signed_value: float, normalized_magnitude: float) -> str:
    """Generic, honestly-labeled heuristic -- see module docstring. NOT a
    real defect-type classifier."""
    if normalized_magnitude >= 0.66:
        band = "high_magnitude"
    elif normalized_magnitude >= 0.33:
        band = "moderate_magnitude"
    else:
        band = "low_magnitude"
    direction = "positive_deviation" if signed_value >= 0 else "negative_deviation"
    return f"{band}_{direction}"


class TCCAnomalyValidator:
    id = "tcc-anomaly"
    description = (
        "Diffs an observed feature grid against a baseline grid, applies Gaussian smoothing, "
        "and flags local maxima above threshold as candidate anomaly coordinates. Anomaly "
        "labels are a generic magnitude/direction heuristic, not a calibrated defect classifier "
        "-- see module docstring."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "feature_matrix": {"type": "array", "description": "Observed 2D grid, list of equal-length rows."},
            "baseline_matrix": {"type": "array", "description": "Golden-reference 2D grid, same shape as feature_matrix."},
            "sensitivity_threshold": {"type": "number", "default": 0.05, "min": 0.0, "max": 1.0},
            "smoothing_sigma": {"type": "number", "default": 1.0},
        }

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        feature_raw = payload.get("feature_matrix")
        baseline_raw = payload.get("baseline_matrix")
        sensitivity_threshold = float(payload.get("sensitivity_threshold", 0.05))
        smoothing_sigma = float(payload.get("smoothing_sigma", 1.0))

        if not isinstance(feature_raw, list) or not isinstance(baseline_raw, list):
            return ValidationReport(passed=False, error="feature_matrix and baseline_matrix must both be 2D arrays.")
        if not (0.0 <= sensitivity_threshold <= 1.0):
            return ValidationReport(passed=False, error="sensitivity_threshold must be within [0, 1].")

        try:
            feature = np.array(feature_raw, dtype=float)
            baseline = np.array(baseline_raw, dtype=float)
        except (ValueError, TypeError) as exc:
            return ValidationReport(passed=False, error=f"Could not parse matrices as numeric 2D arrays: {exc}")

        if feature.ndim != 2 or baseline.ndim != 2:
            return ValidationReport(passed=False, error="Both matrices must be rectangular 2D arrays.")
        if feature.shape != baseline.shape:
            return ValidationReport(
                passed=False,
                error=f"feature_matrix shape {feature.shape} does not match baseline_matrix shape {baseline.shape}.",
            )
        h, w = feature.shape
        if h < 2 or w < 2:
            return ValidationReport(passed=False, error="Grid must be at least 2x2.")
        if h > MAX_GRID_DIM or w > MAX_GRID_DIM:
            return ValidationReport(passed=False, error=f"Grid exceeds max supported dimension {MAX_GRID_DIM}.")
        if not (np.isfinite(feature).all() and np.isfinite(baseline).all()):
            return ValidationReport(passed=False, error="Matrices must contain only finite values.")

        diff = feature - baseline
        total_divergence = float(np.sqrt(np.sum(diff**2)))

        kernel_size = max(3, int(round(smoothing_sigma * 4)) | 1)  # odd, >= 3
        kernel = _gaussian_kernel(kernel_size, max(smoothing_sigma, 1e-6))
        smoothed_abs = _smooth(np.abs(diff), kernel)

        max_abs = float(smoothed_abs.max()) if smoothed_abs.size else 0.0
        normalized = smoothed_abs / max_abs if max_abs > 1e-12 else smoothed_abs

        candidate_coords = _local_maxima(normalized, sensitivity_threshold)

        anomalies: list[dict[str, Any]] = []
        for i, j in candidate_coords:
            signed = float(diff[i, j])
            magnitude = float(normalized[i, j])
            anomalies.append(
                {
                    "x": int(j),
                    "y": int(i),
                    "divergence_score": round(magnitude, 6),
                    "anomaly_type": _classify_deviation(signed, magnitude),
                }
            )

        anomalies.sort(key=lambda a: a["divergence_score"], reverse=True)
        max_anomaly_score = anomalies[0]["divergence_score"] if anomalies else 0.0
        passed_qc = len(anomalies) == 0

        findings = [
            f"Grid {h}x{w}: total_divergence={total_divergence:.4f}, {len(anomalies)} coordinate(s) "
            f"at or above sensitivity_threshold={sensitivity_threshold}.",
            "anomaly_type labels are a generic magnitude/direction heuristic, not a calibrated "
            "defect classifier -- see tcc_validator.py module docstring before treating a label "
            "as an actual diagnosis.",
        ]

        return ValidationReport(
            passed=passed_qc,
            score=max(0.0, 1.0 - max_anomaly_score),
            metrics={
                "total_divergence": total_divergence,
                "max_anomaly_score": max_anomaly_score,
                "anomaly_count": float(len(anomalies)),
                "grid_height": float(h),
                "grid_width": float(w),
            },
            findings=findings,
            details={"anomaly_coordinates": anomalies},
        )
