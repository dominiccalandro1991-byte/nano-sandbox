"""NNACC chat orchestrator — NASE-gated tool proposals + CAS message trail."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.nadre.monitor import NadreMonitor
from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness
from app.nnacc.session import hash_message, session_merkle
from app.nnacc.tools import ALLOWED_TOOLS, ToolProposal, parse_tool_intent


@dataclass
class ChatTurnResult:
    ok: bool
    reply: str
    user_hash: str
    assistant_hash: str
    session_root: str
    tool: ToolProposal | None = None
    tool_allowed: bool = False
    attestation_ok: bool = False
    nadre_passed: bool = True
    findings: list[str] = field(default_factory=list)
    error: str | None = None


class ChatOrchestrator:
    """Single-turn orchestrator. Frontier model quality is Missing; routing is real."""

    def __init__(self, delta_seconds: float = DEFAULT_DELTA_SECONDS):
        self.delta_seconds = delta_seconds
        self._hashes: list[str] = []
        self.system_prompt_fingerprint = hash_message(
            "system",
            "NNACC formal core: route tools via NASE; store messages as CAS leaves; never escalate policy.",
            0.0,
        )

    def session_root(self) -> str:
        return session_merkle(self._hashes)

    def turn(
        self,
        user_text: str,
        attestation_timestamp: float | None,
        now: float | None = None,
        health: dict[str, Any] | None = None,
    ) -> ChatTurnResult:
        now_ts = time.time() if now is None else float(now)
        findings: list[str] = []

        att_ok, att_reason = check_attestation_freshness(
            attestation_timestamp, now_ts, self.delta_seconds
        )
        findings.append(att_reason)
        if not att_ok:
            return ChatTurnResult(
                ok=False,
                reply="",
                user_hash="",
                assistant_hash="",
                session_root=self.session_root(),
                attestation_ok=False,
                findings=findings,
                error=f"C1 attestation failed: {att_reason}",
            )

        # NADRE health supervision (optional snapshot)
        nadre_passed = True
        if health:
            nadre = NadreMonitor().evaluate(health)
            nadre_passed = bool(nadre["passed"])
            findings.append(f"NADRE passed={nadre_passed}")
            if not nadre_passed:
                return ChatTurnResult(
                    ok=False,
                    reply="",
                    user_hash="",
                    assistant_hash="",
                    session_root=self.session_root(),
                    attestation_ok=True,
                    nadre_passed=False,
                    findings=findings + [f["detail"] for f in nadre["findings"] if not f["passed"]],
                    error="NADRE health gate blocked this turn",
                )

        user_hash = hash_message("user", user_text, now_ts)
        self._hashes.append(user_hash)

        proposal = parse_tool_intent(user_text)
        tool_allowed = False
        if proposal is not None:
            if proposal.engine_id not in ALLOWED_TOOLS:
                findings.append(f"C3 non-escalation: unknown tool {proposal.engine_id}")
                proposal = None
            else:
                tool_allowed = True
                findings.append(f"tool proposed: {proposal.engine_id} ({proposal.reason})")

        reply = self._compose_reply(user_text, proposal, tool_allowed)
        assistant_hash = hash_message("assistant", reply, now_ts + 0.001)
        self._hashes.append(assistant_hash)
        root = session_merkle(self._hashes)

        return ChatTurnResult(
            ok=True,
            reply=reply,
            user_hash=user_hash,
            assistant_hash=assistant_hash,
            session_root=root,
            tool=proposal,
            tool_allowed=tool_allowed,
            attestation_ok=True,
            nadre_passed=True,
            findings=findings,
        )

    def _compose_reply(self, user_text: str, tool: ToolProposal | None, allowed: bool) -> str:
        lower = user_text.lower().strip()
        if tool and allowed:
            return (
                f"I can route that through **{tool.engine_id}** ({ALLOWED_TOOLS[tool.engine_id]}). "
                f"NASE attestation is fresh. Proposed tool call is gateway-bounded "
                f"(hints={tool.payload_hints}). "
                "Submit the structured payload via Remote jobs or confirm to execute when a backend is attached. "
                f"Your message is stored as a CAS leaf in this session."
            )
        if any(w in lower for w in ("hello", "hi", "hey", "help")):
            return (
                "NNACC formal core online. I ground replies in NHSE habitats, gate tools with NASE "
                f"(Δt≤{self.delta_seconds}s), and supervise turns with NADRE. "
                f"I can propose any of {len(ALLOWED_TOOLS)} registry tools mid-chat "
                "(e.g. “run USSE on a 400 lb load”, “seal IP in OIAV”, “check NASE attestation”). "
                "Open-ended frontier-model generation is out of scope for this formal core."
            )
        if "engine" in lower or "list" in lower:
            names = ", ".join(sorted(ALLOWED_TOOLS.keys())[:8]) + ", …"
            return f"Tool allow-list (non-escalating): {names}"
        return (
            "Acknowledged. No diagnostic tool intent matched. "
            "Message recorded as a content-addressed session leaf under C2. "
            "Try naming an engine (USSE, OIAV, NASE, NADRE, thermal, geometry…) to propose a tool call."
        )
