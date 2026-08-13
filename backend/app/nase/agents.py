"""Five NASE agent role definitions + Governing-Orchestrator identity.

These are structural definitions only. Runtime inference (Core ML) is out of
scope for this pure-Python formal core; evidence for on-device ML remains
Missing at this layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet


class AgentId(str, Enum):
    GOVERNOR = "policy-governor"
    DETECTOR = "detector"
    PREDICTOR = "predictor"
    RESPONDER = "responder"
    AUDITOR = "auditor"
    ORCHESTRATOR = "governing-orchestrator"


@dataclass(frozen=True)
class AgentRole:
    id: AgentId
    title: str
    purpose: str
    """One-sentence purpose (from NASE specification)."""
    capabilities: FrozenSet[str]
    """Capability tokens the Tool-Gateway may grant this identity."""


AGENT_DEFS: dict[AgentId, AgentRole] = {
    AgentId.GOVERNOR: AgentRole(
        id=AgentId.GOVERNOR,
        title="Policy Governor",
        purpose=(
            "Holds the sole mutable policy and identity registry; evaluates "
            "least-privilege, kill-switch, and attestation checks before any action."
        ),
        capabilities=frozenset({"policy.read", "policy.write", "identity.register", "kill_switch"}),
    ),
    AgentId.DETECTOR: AgentRole(
        id=AgentId.DETECTOR,
        title="Detector Agent",
        purpose=(
            "Continuous on-device anomaly detection over behavioral telemetry, "
            "NHSE habitat access patterns, and model-output integrity."
        ),
        capabilities=frozenset({"telemetry.read", "habitat.hash_check", "anomaly.report"}),
    ),
    AgentId.PREDICTOR: AgentRole(
        id=AgentId.PREDICTOR,
        title="Predictor Agent",
        purpose=(
            "Short-horizon threat forecasting; produces ranked attack-surface "
            "and risk scores without unconstrained external network calls."
        ),
        capabilities=frozenset({"risk.score", "attack_surface.rank", "forecast.read"}),
    ),
    AgentId.RESPONDER: AgentRole(
        id=AgentId.RESPONDER,
        title="Responder Agent",
        purpose=(
            "Executes only policy-approved autonomous actions: habitat isolation, "
            "forced re-encryption of CAS objects, access revocation, local alert, "
            "rate-limiting, temporary kill-switch of non-critical modules."
        ),
        capabilities=frozenset({
            "habitat.quarantine",
            "cas.reencrypt",
            "access.revoke",
            "alert.local",
            "rate_limit.set",
            "module.kill_switch",
        }),
    ),
    AgentId.AUDITOR: AgentRole(
        id=AgentId.AUDITOR,
        title="Auditor Agent",
        purpose=(
            "Immutable, content-addressed audit trail (Merkle-linked to NHSE CAS) "
            "of every decision, prompt, tool call, and outcome; supports formal replay."
        ),
        capabilities=frozenset({"audit.append", "audit.read", "merkle.link"}),
    ),
    AgentId.ORCHESTRATOR: AgentRole(
        id=AgentId.ORCHESTRATOR,
        title="Governing-Orchestrator",
        purpose=(
            "Coordinates the five specialized agents under unidirectional data flow; "
            "never bypasses the Policy Governor or Tool-Gateway."
        ),
        capabilities=frozenset({"orchestrate.dispatch", "agent.status"}),
    ),
}
