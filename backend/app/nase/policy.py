"""Policy Governor — SSOT for policy + identity under UDF.

Owns the mutable policy view for the formal core. All capability grants must
pass attestation-freshness before the Tool-Gateway may emit an action.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.nase.agents import AGENT_DEFS, AgentId
from app.nase.gateway import GatewayDecision, ToolGateway
from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness


@dataclass
class PolicyGovernor:
    delta_seconds: float = DEFAULT_DELTA_SECONDS
    kill_switch_active: bool = False
    gateway: ToolGateway = field(default_factory=ToolGateway)

    def grant(
        self,
        agent_id: str,
        action: str,
        attestation_timestamp: float | None,
        now: float | None = None,
    ) -> dict[str, Any]:
        """Evaluate attestation-freshness ∧ least_privilege before allowing action."""
        now_ts = time.time() if now is None else float(now)

        if self.kill_switch_active and action not in {"audit.append", "audit.read", "policy.read"}:
            return {
                "allowed": False,
                "reason": "global kill-switch active — only audit/policy.read permitted",
                "attestation_ok": False,
                "gateway": None,
            }

        att_ok, att_reason = check_attestation_freshness(
            attestation_timestamp, now_ts, self.delta_seconds
        )
        if not att_ok:
            return {
                "allowed": False,
                "reason": att_reason,
                "attestation_ok": False,
                "gateway": None,
            }

        decision: GatewayDecision = self.gateway.allow(agent_id, action)
        return {
            "allowed": decision.allowed,
            "reason": decision.reason if decision.allowed else f"{att_reason}; {decision.reason}",
            "attestation_ok": True,
            "attestation_detail": att_reason,
            "gateway": {
                "allowed": decision.allowed,
                "agent_id": decision.agent_id,
                "action": decision.action,
                "reason": decision.reason,
            },
        }

    def list_agents(self) -> list[dict[str, Any]]:
        return [
            {
                "id": role.id.value,
                "title": role.title,
                "purpose": role.purpose,
                "capabilities": sorted(role.capabilities),
            }
            for role in AGENT_DEFS.values()
        ]
