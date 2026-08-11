"""Causal Diagnostic Entropy Minimizer (CDEM) validator.

Runs a real Bayesian posterior update -- P(d_i | V, A, T) proportional to
P(V|d_i) * P(A|d_i) * P(T|d_i) * P(d_i), normalized over i -- and reports
the resulting Shannon entropy H(D) and top-hypothesis confidence. The math
here (Bayes update, entropy, normalization) is genuine and unit-tested.

What is NOT genuine: the failure-mode hypothesis set and its expected
visual/acoustic/textual signatures, imported from `cdem_data.py`, are
illustrative placeholder data -- see that module's docstring. A confident,
low-entropy output from this validator reflects confident placeholder
priors, not a real diagnosis, until that table is replaced with sourced
data.

Also note on the spec's "fuzzy term/embedding matching" for text_symptoms:
this implementation uses literal keyword overlap, not semantic embeddings
-- there's no embedding model wired into this service. Keyword overlap is
a real, simple technique; it is explicitly not what "embedding matching"
usually implies, and is labeled as such rather than silently passed off as
more sophisticated than it is.
"""
from __future__ import annotations

import math
from typing import Any

from app.models import ValidationReport
from app.validators.cdem_data import FAILURE_MODES, FailureMode


def _gaussian_likelihood(x: float, center: float, scale: float) -> float:
    scale = max(scale, 1e-6)
    return math.exp(-((x - center) ** 2) / (2 * scale**2))


def _visual_likelihood(mode: FailureMode, visual: dict[str, Any]) -> float:
    divergence = float(visual.get("max_divergence", 0.0))
    likelihood = _gaussian_likelihood(divergence, mode.expected_divergence_center, mode.expected_divergence_scale)
    if visual.get("primary_anomaly_class") == mode.expected_anomaly_class:
        likelihood *= 1.5  # example weighting for a matching TCC-style label; not calibrated
    return max(likelihood, 1e-6)


def _audio_likelihood(mode: FailureMode, audio: dict[str, Any] | None) -> float:
    if audio is None:
        return 1.0  # absent evidence is neutral, not disconfirming
    peaks = audio.get("fft_peak_frequencies") or []
    lo, hi = mode.expected_freq_band_hz
    if not peaks:
        return 1.0
    in_band = sum(1 for f in peaks if lo <= float(f) <= hi)
    fraction_in_band = in_band / len(peaks)
    return max(0.1 + 0.9 * fraction_in_band, 1e-6)


def _text_likelihood(mode: FailureMode, text_symptoms: str | None) -> float:
    if not text_symptoms:
        return 1.0  # absent evidence is neutral
    if not mode.keywords:
        return 1.0  # catch-all mode has no keyword opinion
    lowered = text_symptoms.lower()
    hits = sum(1 for kw in mode.keywords if kw in lowered)
    if hits == 0:
        return 0.5  # mild disconfirmation, not a hard zero -- text descriptions are noisy
    return min(1.0 + 0.5 * hits, 3.0)


def _entropy_bits(probs: list[float]) -> float:
    return -sum(p * math.log2(p) for p in probs if p > 0.0)


class CDEMDiagnosisValidator:
    id = "cdem-diagnosis"
    description = (
        "Bayesian posterior update over an illustrative failure-mode hypothesis set, fusing "
        "visual/audio/text evidence; reports Shannon entropy and top-hypothesis confidence. "
        "Domain priors are placeholder data -- see cdem_data.py."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "visual_data": {
                "type": "object",
                "required": True,
                "properties": {"anomaly_count": "int", "max_divergence": "float", "primary_anomaly_class": "str"},
            },
            "audio_data": {"type": "object", "required": False},
            "text_symptoms": {"type": "string", "required": False},
            "target_entropy": {"type": "number", "default": 0.2},
            "min_confidence": {"type": "number", "default": 0.90},
        }

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        visual = payload.get("visual_data")
        audio = payload.get("audio_data")
        text_symptoms = payload.get("text_symptoms")
        target_entropy = float(payload.get("target_entropy", 0.2))
        min_confidence = float(payload.get("min_confidence", 0.90))

        if not isinstance(visual, dict):
            return ValidationReport(passed=False, error="visual_data is required and must be an object.")
        if target_entropy <= 0:
            return ValidationReport(passed=False, error="target_entropy must be positive.")
        if not (0.5 <= min_confidence <= 1.0):
            return ValidationReport(passed=False, error="min_confidence must be within [0.5, 1.0].")

        unnormalized: dict[str, float] = {}
        for mode in FAILURE_MODES:
            likelihood = _visual_likelihood(mode, visual) * _audio_likelihood(mode, audio) * _text_likelihood(mode, text_symptoms)
            unnormalized[mode.id] = likelihood * mode.prior

        total = sum(unnormalized.values())
        if total <= 0:
            return ValidationReport(passed=False, error="All hypothesis likelihoods collapsed to zero -- degenerate input.")

        posterior = {mode_id: value / total for mode_id, value in unnormalized.items()}
        entropy = _entropy_bits(list(posterior.values()))

        ranked = sorted(posterior.items(), key=lambda kv: kv[1], reverse=True)
        mode_by_id = {m.id: m for m in FAILURE_MODES}
        primary_id, primary_prob = ranked[0]
        primary = {
            "failure_id": primary_id,
            "description": mode_by_id[primary_id].description,
            "probability": round(primary_prob, 6),
        }
        competing = [
            {"failure_id": mid, "description": mode_by_id[mid].description, "probability": round(p, 6)}
            for mid, p in ranked[1:]
        ]

        entropy_minimized = entropy <= target_entropy and primary_prob >= min_confidence
        passed = entropy_minimized

        findings = [
            f"Shannon entropy H(D)={entropy:.4f} bits over {len(FAILURE_MODES)} hypotheses "
            f"(target <= {target_entropy}).",
            f"Top hypothesis '{primary_id}' at {primary_prob:.1%} confidence (need >= {min_confidence:.0%}).",
            "Hypothesis set and expected signatures are illustrative placeholder data -- see "
            "cdem_data.py module docstring. Do not present this as a real diagnosis.",
        ]
        if audio is None:
            findings.append("No audio_data supplied -- audio evidence treated as neutral, not disconfirming.")
        if not text_symptoms:
            findings.append("No text_symptoms supplied -- text evidence treated as neutral, not disconfirming.")

        return ValidationReport(
            passed=passed,
            score=round(primary_prob, 6),
            metrics={
                "shannon_entropy_bits": entropy,
                "primary_confidence": primary_prob,
                "hypothesis_count": float(len(FAILURE_MODES)),
            },
            findings=findings,
            details={"primary_diagnosis": primary, "competing_hypotheses": competing, "posterior": {k: round(v, 6) for k, v in posterior.items()}},
        )
