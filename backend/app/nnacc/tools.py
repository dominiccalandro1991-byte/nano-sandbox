"""Allowed NNACC tool surface — maps to registry engine ids only."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# Fixed allow-list: chat may propose these engines; never invent new privileges.
ALLOWED_TOOLS: dict[str, str] = {
    "usse-stress": "Universal Simulation & Stress Engine",
    "oiav-vault": "Omniversal IP & Asset Vault",
    "nase-aegis": "NanoAegis security formal core",
    "nadre-monitor": "NADRE autonomic monitor",
    "causal-fusion": "Causal fusion diagnostic",
    "soft-body-physics": "Soft-body physics validator",
    "tcc-anomaly": "TCC anomaly validator",
    "cdem-diagnosis": "CDEM diagnosis",
    "rte-repair-plan": "RTE repair plan",
    "geometry-tolerance": "Geometry tolerance",
    "physics-qc-matrix": "Physics QC matrix",
    "thermal-dissipation": "Thermal dissipation",
    "dependency-collision": "Dependency collision",
    "multi-agent-interaction": "Multi-agent interaction",
    "tier-drift": "Tier-drift scorer",
}


@dataclass(frozen=True)
class ToolProposal:
    engine_id: str
    reason: str
    payload_hints: dict[str, Any]


def parse_tool_intent(user_text: str) -> ToolProposal | None:
    """Deterministic mid-conversation tool routing (not an LLM)."""
    text = user_text.lower()

    patterns: list[tuple[str, str, dict[str, Any]]] = [
        (r"\b(usse|stress|torque|load_?lb|500\s*lb|300\s*lb)\b", "usse-stress", {"mode": "unified"}),
        (r"\b(oiav|vault|copyright|patent|ip\s*package|seal\s+asset)\b", "oiav-vault", {}),
        (r"\b(nase|attestation|tool-?gateway|quarantine)\b", "nase-aegis", {}),
        (r"\b(nadre|self-?heal|memory\s*pressure|debug\s*repair)\b", "nadre-monitor", {}),
        (r"\b(causal|fusion|failure\s*point)\b", "causal-fusion", {}),
        (r"\b(soft-?body|physics)\b", "soft-body-physics", {}),
        (r"\b(thermal|heat|dissipat)\b", "thermal-dissipation", {}),
        (r"\b(geometry|tolerance)\b", "geometry-tolerance", {}),
        (r"\b(repair\s*plan|rte)\b", "rte-repair-plan", {}),
        (r"\b(cdem|diagnos)\b", "cdem-diagnosis", {}),
        (r"\b(tier.?drift)\b", "tier-drift", {}),
    ]
    for pattern, engine_id, hints in patterns:
        if re.search(pattern, text):
            return ToolProposal(engine_id=engine_id, reason=f"matched /{pattern}/", payload_hints=hints)
    return None
