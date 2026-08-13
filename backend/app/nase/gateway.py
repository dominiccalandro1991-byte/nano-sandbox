"""Tool-Gateway: single policy-governed chokepoint for agent actions.

Least-privilege: an action capability must be in the agent role's registered
capability set. Non-escalation: Responder cannot expand its own policy set
(policy.write is Governor-only).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from app.nase.agents import AGENT_DEFS, AgentId


@dataclass(frozen=True)
class GatewayDecision:
    allowed: bool
    agent_id: str
    action: str
    reason: str


class ToolGateway:
    def allow(self, agent_id: str, action: str) -> GatewayDecision:
        try:
            aid = AgentId(agent_id)
        except ValueError:
            return GatewayDecision(False, agent_id, action, f"unknown agent identity: {agent_id}")

        role = AGENT_DEFS[aid]
        if action not in role.capabilities:
            return GatewayDecision(
                False,
                agent_id,
                action,
                f"least-privilege deny: '{action}' not in {role.title} capability set",
            )
        return GatewayDecision(True, agent_id, action, f"allowed under {role.title}")

    def allow_many(self, agent_id: str, actions: Iterable[str]) -> list[GatewayDecision]:
        return [self.allow(agent_id, a) for a in actions]
