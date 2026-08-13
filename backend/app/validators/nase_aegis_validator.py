"""NanoAegis Autonomous Security Engine (NASE) — registry validator.

Evidence classification block
-----------------------------
- Attestation-freshness temporal invariant (∀ action: attested ∧ age≤Δt ∧
  least_privilege): Partially Verified as pure predicate evaluation in
  app.nase.invariants / PolicyGovernor.
- Five agent roles + Tool-Gateway chokepoint: Partially Verified (structural
  definitions + capability lattice checks).
- Secure Enclave / DeviceCheck token issuance: Missing (caller supplies
  attestation_timestamp; this module does not mint hardware attestations).
- Core ML / Neural Engine anomaly models: Missing at this layer.
- NHSE CAS hash quarantine predicate: Partially Verified (hash equality).
- Claim of production iOS App-Store binary: Missing (formal core only).
"""

from __future__ import annotations

import time
from typing import Any

from app.models import ValidationReport
from app.nase.policy import PolicyGovernor


class NaseAegisValidator:
    id = "nase-aegis"
    description = (
        "NanoAegis formal core: evaluates attestation-freshness (Δt), "
        "least-privilege Tool-Gateway decisions for the five NASE agents, "
        "optional NHSE CAS hash integrity, and kill-switch state. "
        "Does not mint Secure Enclave tokens or run Core ML models."
    )

    def __init__(self, default_delta_seconds: float = 30.0):
        self.default_delta = default_delta_seconds

    def payload_schema(self) -> dict[str, Any]:
        return {
            "agent_id": "str — one of policy-governor|detector|predictor|responder|auditor|governing-orchestrator",
            "action": "str — capability token to request (e.g. habitat.quarantine)",
            "attestation_timestamp": "float — unix seconds of last attestation (required for grant)",
            "delta_seconds": "float — freshness bound Δt (default 30)",
            "now": "float — optional clock override for deterministic tests",
            "expected_hash": "str — optional NHSE content hash expected",
            "actual_hash": "str — optional NHSE content hash observed",
            "kill_switch": "bool — if true, Governor denies non-audit actions",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        agent_id = payload.get("agent_id")
        action = payload.get("action")
        if not isinstance(agent_id, str) or not agent_id:
            return ValidationReport(passed=False, error="agent_id is required (string).")
        if not isinstance(action, str) or not action:
            return ValidationReport(passed=False, error="action is required (string capability token).")

        delta = float(payload.get("delta_seconds", self.default_delta))
        gov = PolicyGovernor(delta_seconds=delta, kill_switch_active=bool(payload.get("kill_switch", False)))
        now = payload.get("now")
        now_ts = float(now) if now is not None else time.time()
        att_ts = payload.get("attestation_timestamp")
        if att_ts is not None:
            try:
                att_ts = float(att_ts)
            except (TypeError, ValueError):
                return ValidationReport(passed=False, error="attestation_timestamp must be numeric.")

        grant = gov.grant(agent_id, action, att_ts, now=now_ts)

        findings = [
            f"agent_id={agent_id}",
            f"action={action}",
            f"attestation_ok={grant['attestation_ok']}",
            f"allowed={grant['allowed']}",
            grant["reason"],
        ]

        hash_ok = True
        expected = payload.get("expected_hash")
        actual = payload.get("actual_hash")
        if expected is not None or actual is not None:
            if expected == actual and expected is not None:
                findings.append("cas_hash_integrity=ok")
            else:
                hash_ok = False
                findings.append("cas_hash_integrity=FAIL — quarantine required")

        passed = bool(grant["allowed"]) and hash_ok
        agents = gov.list_agents()

        return ValidationReport(
            passed=passed,
            score=1.0 if passed else 0.0,
            metrics={
                "attestation_ok": 1.0 if grant["attestation_ok"] else 0.0,
                "gateway_allowed": 1.0 if grant["allowed"] else 0.0,
                "hash_ok": 1.0 if hash_ok else 0.0,
                "delta_seconds": delta,
                "agent_count": float(len(agents)),
            },
            findings=findings,
            details={
                "grant": grant,
                "agents": agents,
                "invariant": (
                    "∀ action a by agent id: attested(id,t) ∧ (now−t≤Δt) ∧ "
                    "least_privilege(id,a) before Tool-Gateway emits a"
                ),
            },
        )
