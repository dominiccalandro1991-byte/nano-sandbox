"""NADRE temporal / state invariants (pure, model-checkable predicates).

I1  Governor budget:  ∀t. resident_bytes(t) ≤ budget_bytes
I2  Predictor calibration:  transitions>0 ⇒ hit_rate ≥ ρ_min  (after warm-up)
I3  Merkle integrity:  expected_hash = actual_hash  ∨  quarantined
I4  NASE compatibility:  any repair action a requires gateway.allow(agent, a)
I5  Non-escalation:  NADRE cannot expand its own capability set

Attestation-freshness (from NASE) still binds every repair emission:
  ∀ repair r: attested(id,t) ∧ (now−t ≤ Δt) ∧ least_privilege(id,r)
"""

from __future__ import annotations

from typing import Any

DEFAULT_MONITOR_PERIOD_MS = 250.0
DEFAULT_HIT_RATE_MIN = 0.5


def check_governor_budget_invariant(resident_bytes: float, budget_bytes: float) -> tuple[bool, str]:
    if budget_bytes <= 0:
        return False, "budget_bytes must be positive"
    if resident_bytes > budget_bytes:
        return False, f"budget violated: resident={resident_bytes} > budget={budget_bytes}"
    return True, "resident_bytes ≤ budget_bytes"


def check_predictor_calibration(
    hits: float,
    misses: float,
    transitions: float,
    min_hit_rate: float = DEFAULT_HIT_RATE_MIN,
    warm_up: float = 3.0,
) -> tuple[bool, str]:
    total = hits + misses
    if transitions < warm_up or total < warm_up:
        return True, "warm-up — calibration not yet enforced"
    rate = hits / total if total else 0.0
    if rate < min_hit_rate:
        return False, f"hit_rate {rate:.3f} < min {min_hit_rate}"
    return True, f"hit_rate {rate:.3f} ≥ {min_hit_rate}"


def check_merkle_integrity_invariant(expected: str | None, actual: str | None, quarantined: bool) -> tuple[bool, str]:
    if expected is None or actual is None:
        return False, "missing hash"
    if expected == actual:
        return True, "merkle equality holds"
    if quarantined:
        return True, "mismatch quarantined (safe state)"
    return False, "hash mismatch without quarantine"


def check_nase_gateway_compatible(gateway_allowed: bool, action: str) -> tuple[bool, str]:
    if not gateway_allowed:
        return False, f"NASE Tool-Gateway denied repair action '{action}'"
    return True, f"gateway allowed '{action}'"
