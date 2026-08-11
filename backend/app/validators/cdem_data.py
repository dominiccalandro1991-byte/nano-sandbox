"""Example failure-mode hypothesis set for the CDEM validator.

EVERYTHING IN THIS FILE IS ILLUSTRATIVE PLACEHOLDER DATA. The priors and the
per-mode "expected" visual/acoustic/textual signatures below are made up to
exercise the Bayesian update and entropy math with something more concrete
than random numbers -- they are NOT sourced from real component failure
statistics, real acoustic recordings, or any real diagnostic dataset. Do not
present output derived from these tables as a real diagnosis. Replace this
table with real, sourced data before this validator means anything about a
real device.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FailureMode:
    id: str
    description: str
    prior: float
    expected_anomaly_class: str
    expected_divergence_center: float
    expected_divergence_scale: float
    expected_freq_band_hz: tuple[float, float]
    keywords: tuple[str, ...] = field(default_factory=tuple)


# Priors intentionally don't need to sum to 1 -- they're renormalized during
# the Bayesian update. Five modes including a deliberate catch-all
# ("unclassified_failure") so entropy stays honest when evidence doesn't
# clearly match any specific mode.
FAILURE_MODES: tuple[FailureMode, ...] = (
    FailureMode(
        id="loose_connection",
        description="A connector or solder joint has intermittent or high-resistance contact.",
        prior=0.25,
        expected_anomaly_class="positive_deviation",
        expected_divergence_center=0.3,
        expected_divergence_scale=0.25,
        expected_freq_band_hz=(50.0, 200.0),
        keywords=("intermittent", "flicker", "loose", "wiggle", "connector", "unstable"),
    ),
    FailureMode(
        id="component_short",
        description="A component is shorting, drawing excess current.",
        prior=0.2,
        expected_anomaly_class="high_magnitude_positive_deviation",
        expected_divergence_center=0.8,
        expected_divergence_scale=0.2,
        expected_freq_band_hz=(0.0, 20.0),
        keywords=("short", "hot", "smoke", "smell", "trips breaker", "fuse"),
    ),
    FailureMode(
        id="thermal_stress_failure",
        description="Heat cycling has degraded a component or joint over time.",
        prior=0.2,
        expected_anomaly_class="moderate_magnitude_negative_deviation",
        expected_divergence_center=0.5,
        expected_divergence_scale=0.3,
        expected_freq_band_hz=(20.0, 80.0),
        keywords=("worse when hot", "warms up", "intermittent when warm", "discolored"),
    ),
    FailureMode(
        id="mechanical_wear",
        description="A moving part (bearing, gear, fan) has worn beyond tolerance.",
        prior=0.2,
        expected_anomaly_class="low_magnitude_negative_deviation",
        expected_divergence_center=0.2,
        expected_divergence_scale=0.2,
        expected_freq_band_hz=(500.0, 4000.0),
        keywords=("grinding", "squeal", "vibration", "rattle", "bearing", "fan noise"),
    ),
    FailureMode(
        id="unclassified_failure",
        description="Evidence doesn't clearly match a known mode -- catch-all so confidence stays honest.",
        prior=0.15,
        expected_anomaly_class="low_magnitude_positive_deviation",
        expected_divergence_center=0.4,
        expected_divergence_scale=0.6,  # deliberately wide/flat -- weak opinion by design
        expected_freq_band_hz=(0.0, 5000.0),
        keywords=(),
    ),
)
