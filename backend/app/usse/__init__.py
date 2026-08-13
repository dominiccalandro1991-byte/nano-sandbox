"""Universal Simulation & Stress Engine (USSE).

Evidence classification
-----------------------
- Torque τ = r F sinθ and simple beam stress proxies: Partially Verified
  (standard statics; no FEA mesh solver is present).
- Multi-agent digital load score from concurrent intensity: Partially Verified
  (scalar pressure model, not a full distributed load-test farm).
- Soft-body / structural failure prediction fused with causal weights:
  Partially Verified (linear risk fusion; not a trained surrogate of reality).
- Claim of replacing physical lab tests for 300–500 lb loads: Unknown /
  overstated — this module quantifies caller-supplied parameters only.
- Core ML on-device kinematics: Missing at this Python layer.
"""

from app.usse.stress import compute_physical_stress, compute_digital_load, fuse_failure_risk

__all__ = [
    "compute_physical_stress",
    "compute_digital_load",
    "fuse_failure_risk",
]
