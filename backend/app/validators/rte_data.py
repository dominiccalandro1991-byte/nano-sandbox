"""Example repair-template graphs for the RTE validator.

EVERYTHING IN THIS FILE IS ILLUSTRATIVE PLACEHOLDER DATA, deliberately
generic rather than device-specific. In particular: every step's
`pinout_voltage_check` is left as `None`. That field exists in the schema
because the source spec calls for it, but this file intentionally does not
populate it with any numeric value -- a plausible-looking-but-made-up
voltage (e.g. "check TP3 for 5.0V") is exactly the kind of fabricated
technical fact that's dangerous here: someone could point a multimeter at a
real circuit based on it. If you wire in real repair templates later,
populate `pinout_voltage_check` only from a verified source (manufacturer
datasheet, verified service manual) -- never invent one to fill the field.

The graph/pathfinding algorithm in rte_validator.py is real and works with
any correctly-shaped graph; only the two example graphs below are toy data,
namespaced to match CDEM's example failure_ids so the two validators can be
chained in a demo, not because either requires the other.
"""
from __future__ import annotations

from dataclasses import dataclass

SKILL_RANK = {"beginner": 0, "intermediate": 1, "expert": 2}
SKILL_HAZARD_CAP = {"beginner": 2, "intermediate": 3, "expert": 5}


@dataclass(frozen=True)
class RepairNode:
    id: str
    title: str
    instruction: str
    required_tools: tuple[str, ...]
    skill_required: str  # one of SKILL_RANK
    hazard_level: int  # 1-5
    time_seconds: int
    pinout_voltage_check: float | None = None  # see module docstring -- intentionally always None here


@dataclass(frozen=True)
class RepairGraph:
    start: str
    end: str
    nodes: dict[str, RepairNode]
    edges: dict[str, tuple[str, ...]]


def _virtual(node_id: str) -> RepairNode:
    return RepairNode(
        id=node_id, title=node_id, instruction="", required_tools=(), skill_required="beginner", hazard_level=1, time_seconds=0
    )


_LOOSE_CONNECTION_NODES = {
    "start": _virtual("start"),
    "visual_inspect": RepairNode(
        id="visual_inspect",
        title="Visual inspection",
        instruction="Visually inspect the flagged connection point for corrosion, looseness, or discoloration.",
        required_tools=("flashlight",),
        skill_required="beginner",
        hazard_level=1,
        time_seconds=120,
    ),
    "power_down_check": RepairNode(
        id="power_down_check",
        title="De-energize and verify",
        instruction="Fully de-energize the circuit and verify zero voltage with a meter before touching any contacts.",
        required_tools=("multimeter",),
        skill_required="intermediate",
        hazard_level=2,
        time_seconds=180,
    ),
    "reseat_connector_safe": RepairNode(
        id="reseat_connector_safe",
        title="Reseat connector (de-energized)",
        instruction="With power confirmed off, disconnect and reseat the connector; inspect pins for wear before reconnecting.",
        required_tools=("multimeter",),
        skill_required="intermediate",
        hazard_level=2,
        time_seconds=300,
    ),
    "reseat_connector_risky": RepairNode(
        id="reseat_connector_risky",
        title="Wiggle-test while powered",
        instruction="Wiggle-test the connector while energized to localize an intermittent fault. Higher risk -- only "
        "with training for working near live contacts.",
        required_tools=(),
        skill_required="expert",
        hazard_level=5,
        time_seconds=90,
    ),
    "verify_fix": RepairNode(
        id="verify_fix",
        title="Verify fix",
        instruction="Re-power the circuit and confirm the fault no longer reproduces under the original trigger conditions.",
        required_tools=(),
        skill_required="beginner",
        hazard_level=1,
        time_seconds=120,
    ),
    "end": _virtual("end"),
}

_LOOSE_CONNECTION_EDGES = {
    "start": ("visual_inspect",),
    "visual_inspect": ("power_down_check", "reseat_connector_risky"),
    "power_down_check": ("reseat_connector_safe",),
    "reseat_connector_safe": ("verify_fix",),
    "reseat_connector_risky": ("verify_fix",),
    "verify_fix": ("end",),
    "end": (),
}

_COMPONENT_SHORT_NODES = {
    "start": _virtual("start"),
    "isolate_circuit": RepairNode(
        id="isolate_circuit",
        title="Isolate the circuit",
        instruction="De-energize and electrically isolate the affected branch before further diagnosis.",
        required_tools=("multimeter",),
        skill_required="intermediate",
        hazard_level=3,
        time_seconds=240,
    ),
    "locate_short_safe": RepairNode(
        id="locate_short_safe",
        title="Locate short (isolated, low-power probe)",
        instruction="Use a low-power continuity/resistance probe on the isolated branch to bisect and locate the short.",
        required_tools=("multimeter",),
        skill_required="expert",
        hazard_level=3,
        time_seconds=400,
    ),
    "locate_short_risky": RepairNode(
        id="locate_short_risky",
        title="Locate short (energized thermal trace)",
        instruction="Briefly energize the circuit at reduced current to trace heating at the short location. Higher risk "
        "-- current-limited supply and PPE required.",
        required_tools=("current_limited_supply",),
        skill_required="expert",
        hazard_level=5,
        time_seconds=150,
    ),
    "replace_component": RepairNode(
        id="replace_component",
        title="Replace failed component",
        instruction="Remove and replace the identified shorted component, confirming orientation/rating against the "
        "verified reference design before installing the replacement.",
        required_tools=("soldering_iron",),
        skill_required="expert",
        hazard_level=3,
        time_seconds=600,
    ),
    "verify_fix": RepairNode(
        id="verify_fix",
        title="Verify fix",
        instruction="Re-energize under normal conditions and confirm the short no longer reproduces.",
        required_tools=(),
        skill_required="beginner",
        hazard_level=1,
        time_seconds=120,
    ),
    "end": _virtual("end"),
}

_COMPONENT_SHORT_EDGES = {
    "start": ("isolate_circuit",),
    "isolate_circuit": ("locate_short_safe", "locate_short_risky"),
    "locate_short_safe": ("replace_component",),
    "locate_short_risky": ("replace_component",),
    "replace_component": ("verify_fix",),
    "verify_fix": ("end",),
    "end": (),
}

REPAIR_GRAPHS: dict[str, RepairGraph] = {
    "loose_connection": RepairGraph(start="start", end="end", nodes=_LOOSE_CONNECTION_NODES, edges=_LOOSE_CONNECTION_EDGES),
    "component_short": RepairGraph(start="start", end="end", nodes=_COMPONENT_SHORT_NODES, edges=_COMPONENT_SHORT_EDGES),
}
