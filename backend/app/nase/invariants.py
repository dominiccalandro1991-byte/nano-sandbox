"""Machine-checkable NASE temporal / safety invariants (pure predicates).

Formal statement (attestation-freshness terminal correction):
  ∀ action a performed by agent id :
    attested(id, t) ∧ (now − t ≤ Δt) ∧ least_privilege(id, a)
  before the Tool-Gateway may emit the action.

Evidence: Partially Verified as pure boolean predicates. Secure Enclave
token production is Missing here; only freshness of a supplied timestamp
is enforced.
"""

from __future__ import annotations

from typing import Any

DEFAULT_DELTA_SECONDS = 30.0


def check_attestation_freshness(
    attestation_timestamp: float | None,
    now: float,
    delta_seconds: float = DEFAULT_DELTA_SECONDS,
) -> tuple[bool, str]:
    """Return (ok, reason). Fails closed if timestamp is missing or stale."""
    if attestation_timestamp is None:
        return False, "attestation timestamp missing — fail closed"
    try:
        t = float(attestation_timestamp)
    except (TypeError, ValueError):
        return False, "attestation timestamp not numeric"
    age = now - t
    if age < 0:
        return False, f"attestation timestamp in the future (age={age:.3f}s)"
    if age > delta_seconds:
        return False, f"attestation stale: age={age:.3f}s exceeds Δt={delta_seconds}s"
    return True, f"attestation fresh: age={age:.3f}s ≤ Δt={delta_seconds}s"


def check_hash_integrity(expected: str | None, actual: str | None) -> tuple[bool, str]:
    """NHSE CAS re-validation predicate: hash equality or quarantine."""
    if not expected or not actual:
        return False, "missing expected or actual content hash"
    if expected != actual:
        return False, "hash mismatch — quarantine required"
    return True, "hash integrity ok"


def evaluate_invariants(payload: dict[str, Any], now: float) -> list[dict[str, Any]]:
    """Run the core invariant suite; returns structured findings."""
    findings: list[dict[str, Any]] = []
    ok, reason = check_attestation_freshness(
        payload.get("attestation_timestamp"),
        now,
        float(payload.get("delta_seconds", DEFAULT_DELTA_SECONDS)),
    )
    findings.append({"invariant": "attestation_freshness", "passed": ok, "detail": reason})

    if "expected_hash" in payload or "actual_hash" in payload:
        hok, hreason = check_hash_integrity(payload.get("expected_hash"), payload.get("actual_hash"))
        findings.append({"invariant": "cas_hash_integrity", "passed": hok, "detail": hreason})

    return findings
