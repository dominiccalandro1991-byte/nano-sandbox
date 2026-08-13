"""USSE stress & load primitives (pure numpy / math)."""

from __future__ import annotations

import math
from typing import Any


def compute_physical_stress(payload: dict[str, Any]) -> dict[str, float]:
    """Kinematic / structural proxies from caller-supplied parameters.

    - torque_nm = force_n * lever_arm_m * sin(theta_rad)
    - bending stress proxy σ ≈ M c / I with M = force * arm (simplified)
    - battery_draw_wh ≈ power_w * duration_h
    """
    force_n = float(payload.get("force_n", 0.0))
    lever_arm_m = float(payload.get("lever_arm_m", 0.0))
    theta_deg = float(payload.get("theta_deg", 90.0))
    theta_rad = math.radians(theta_deg)
    mass_kg = float(payload.get("mass_kg", 0.0))
    # 300–500 lb ≈ 136–227 kg — caller may pass mass_kg directly
    if mass_kg <= 0 and payload.get("load_lb") is not None:
        mass_kg = float(payload["load_lb"]) * 0.45359237
    duration_h = float(payload.get("duration_h", 0.0))
    power_w = float(payload.get("power_w", 0.0))
    section_modulus_m3 = float(payload.get("section_modulus_m3", 1e-5))  # avoid div0

    torque_nm = force_n * lever_arm_m * math.sin(theta_rad)
    # Gravity load force if force not given but mass is
    gravity_force = mass_kg * 9.80665
    effective_force = force_n if force_n > 0 else gravity_force
    moment_nm = effective_force * lever_arm_m
    bending_stress_pa = moment_nm / max(section_modulus_m3, 1e-12)
    battery_draw_wh = power_w * duration_h
    # Utilization vs optional yield stress
    yield_pa = float(payload.get("yield_stress_pa", 2.5e8))  # mild steel-ish default scale
    utilization = bending_stress_pa / yield_pa if yield_pa > 0 else 0.0

    return {
        "torque_nm": torque_nm,
        "moment_nm": moment_nm,
        "bending_stress_pa": bending_stress_pa,
        "battery_draw_wh": battery_draw_wh,
        "mass_kg": mass_kg,
        "utilization": utilization,
        "gravity_force_n": gravity_force,
    }


def compute_digital_load(payload: dict[str, Any]) -> dict[str, float]:
    """Multi-agent / app load pressure score in [0, ∞)."""
    agents = float(payload.get("agent_count", 0))
    rps = float(payload.get("requests_per_second", 0))
    latency_ms = float(payload.get("p99_latency_ms", 0))
    error_rate = float(payload.get("error_rate", 0))
    # Simple pressure: concurrency × rate × latency penalty × error inflation
    pressure = agents * (1.0 + rps / 100.0) * (1.0 + latency_ms / 1000.0) * (1.0 + 5.0 * error_rate)
    return {
        "digital_pressure": pressure,
        "agent_count": agents,
        "requests_per_second": rps,
        "p99_latency_ms": latency_ms,
        "error_rate": error_rate,
    }


def fuse_failure_risk(
    physical: dict[str, float],
    digital: dict[str, float],
    causal_weights: dict[str, float] | None = None,
) -> dict[str, float]:
    """Weighted fusion toward a [0, 1]-ish failure risk (not calibrated probability)."""
    w = causal_weights or {"physical": 0.55, "digital": 0.35, "interaction": 0.10}
    util = min(2.0, max(0.0, physical.get("utilization", 0.0)))
    phys_risk = min(1.0, util)  # utilization ≥1 → saturated
    dig = digital.get("digital_pressure", 0.0)
    dig_risk = min(1.0, dig / 50.0)  # soft scale
    interaction = phys_risk * dig_risk
    risk = (
        w.get("physical", 0.55) * phys_risk
        + w.get("digital", 0.35) * dig_risk
        + w.get("interaction", 0.10) * interaction
    )
    return {
        "failure_risk": min(1.0, max(0.0, risk)),
        "physical_risk": phys_risk,
        "digital_risk": dig_risk,
        "interaction_risk": interaction,
    }
