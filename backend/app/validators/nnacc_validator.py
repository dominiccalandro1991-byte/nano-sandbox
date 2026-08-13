"""NanoNative Autonomous Chat Core validator (Engine 25).

Evidence classification block
-----------------------------
- NASE-gated chat turns + CAS message hashes: Partially Verified.
- Deterministic tool intent → registry engine id: Partially Verified.
- NADRE health gate on optional snapshot: Partially Verified.
- Frontier-model language quality: Missing.
"""

from __future__ import annotations

import time
from typing import Any

from app.models import ValidationReport
from app.nnacc.orchestrator import ChatOrchestrator


class NNACCValidator:
    id = "nnacc-chat"
    description = (
        "NanoNative Autonomous Chat Core: one conversational turn with NASE "
        "attestation-freshness, optional NADRE health gate, CAS message hashes, "
        "and deterministic tool proposals into the diagnostic registry. "
        "Not a frontier LLM weights runtime."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "message": "str — user utterance",
            "attestation_timestamp": "float — required",
            "delta_seconds": "float?",
            "now": "float?",
            "health": "dict? — NADRE snapshot fields",
            "prior_turns": "int? — ignored; single-turn validator is stateless unless session_continue",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            return ValidationReport(passed=False, error="message must be a non-empty string.")

        now = float(payload["now"]) if payload.get("now") is not None else time.time()
        delta = float(payload.get("delta_seconds", 30.0))
        orch = ChatOrchestrator(delta_seconds=delta)
        result = orch.turn(
            message.strip(),
            payload.get("attestation_timestamp"),
            now=now,
            health=payload.get("health") if isinstance(payload.get("health"), dict) else None,
        )

        if not result.ok:
            return ValidationReport(
                passed=False,
                error=result.error,
                findings=result.findings,
                metrics={"attestation_ok": 1.0 if result.attestation_ok else 0.0},
            )

        metrics = {
            "attestation_ok": 1.0,
            "tool_allowed": 1.0 if result.tool_allowed else 0.0,
            "nadre_passed": 1.0 if result.nadre_passed else 0.0,
            "session_leaf_count": 2.0,
        }
        findings = list(result.findings) + [
            f"user_hash={result.user_hash[:16]}…",
            f"assistant_hash={result.assistant_hash[:16]}…",
            f"session_root={result.session_root[:16]}…",
        ]
        return ValidationReport(
            passed=True,
            score=1.0,
            metrics=metrics,
            findings=findings,
            details={
                "reply": result.reply,
                "user_hash": result.user_hash,
                "assistant_hash": result.assistant_hash,
                "session_root": result.session_root,
                "tool": None
                if result.tool is None
                else {
                    "engine_id": result.tool.engine_id,
                    "reason": result.tool.reason,
                    "payload_hints": result.tool.payload_hints,
                },
            },
        )
