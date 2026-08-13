"""NanoAegis Autonomous Security Engine (NASE) — formal core.

Evidence classification
-----------------------
- Five specialized agent roles + Governing-Orchestrator: Partially Verified
  (standard multi-agent role partition; orchestration pattern from verified
  agentic security pipelines such as MDASH / CSA Agentic Trust patterns).
- Attestation-freshness temporal invariant: Partially Verified as a pure
  predicate (time-delta + identity check). Secure Enclave / DeviceCheck
  token issuance is Missing in this Python backend — callers supply
  attestation metadata; this module only enforces the freshness bound.
- Tool-Gateway least-privilege lattice: Partially Verified (capability set
  membership checks).
- NHSE CAS hash re-validation quarantine: Partially Verified (hash equality
  predicate; integrates with existing NHSE content-addressable design).
- On-device Core ML / Neural Engine inference: Missing in this repository
  layer (iOS runtime concern; not simulated as trained models here).
"""

from app.nase.agents import AGENT_DEFS, AgentId, AgentRole
from app.nase.gateway import ToolGateway
from app.nase.invariants import check_attestation_freshness, DEFAULT_DELTA_SECONDS
from app.nase.policy import PolicyGovernor

__all__ = [
    "AGENT_DEFS",
    "AgentId",
    "AgentRole",
    "ToolGateway",
    "PolicyGovernor",
    "check_attestation_freshness",
    "DEFAULT_DELTA_SECONDS",
]
