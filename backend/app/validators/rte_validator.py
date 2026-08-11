"""Repair Trajectory Engine (RTE) validator.

Runs real Dijkstra shortest-path over a repair-template graph, after
pruning nodes the requester can't actually use (missing required tools, or
skill_required above their stated user_skill_level). Cost per the spec's
formula: C(a_k) = TimeCost + alpha*SkillDifficulty + lambda*RiskFactor.
The pathfinding and pruning are real and unit-tested.

The example repair graphs (rte_data.py) are placeholder data -- generic
instructions, no device-specific measurements, and every
`pinout_voltage_check` deliberately left `None` rather than filled with an
invented-but-plausible-looking number. See that module's docstring for why.

`is_safe_for_user` is a second, independent safety gate on top of the
skill_required pruning: even a step a user is technically permitted to
attempt (skill_required <= their level) might carry a hazard_level above
what's recommended for that skill tier (SKILL_HAZARD_CAP). `passed` on this
validator requires both a path existing AND that path staying within the
requester's hazard envelope -- a plan that "works" but exceeds the safe
hazard band for the requester's stated skill is reported, not silently
passed.
"""
from __future__ import annotations

import heapq
from typing import Any

from app.models import ValidationReport
from app.validators.rte_data import REPAIR_GRAPHS, SKILL_HAZARD_CAP, SKILL_RANK, RepairGraph, RepairNode

DEFAULT_ALPHA = 2.0  # skill-difficulty weight
DEFAULT_LAMBDA = 3.0  # risk weight


def _skill_difficulty(node: RepairNode) -> float:
    return float(SKILL_RANK.get(node.skill_required, 0) + 1)  # 1..3


def _node_cost(node: RepairNode, alpha: float, lam: float) -> float:
    time_minutes = node.time_seconds / 60.0
    return time_minutes + alpha * _skill_difficulty(node) + lam * node.hazard_level


def _dijkstra(
    graph: RepairGraph,
    usable_nodes: set[str],
    alpha: float,
    lam: float,
) -> list[str] | None:
    if graph.start not in usable_nodes or graph.end not in usable_nodes:
        return None

    dist: dict[str, float] = {graph.start: 0.0}
    prev: dict[str, str] = {}
    visited: set[str] = set()
    heap: list[tuple[float, str]] = [(0.0, graph.start)]

    while heap:
        d, node_id = heapq.heappop(heap)
        if node_id in visited:
            continue
        visited.add(node_id)
        if node_id == graph.end:
            break
        for neighbor_id in graph.edges.get(node_id, ()):
            if neighbor_id not in usable_nodes:
                continue
            neighbor = graph.nodes[neighbor_id]
            step_cost = 0.0 if neighbor_id == graph.end else _node_cost(neighbor, alpha, lam)
            nd = d + step_cost
            if nd < dist.get(neighbor_id, float("inf")):
                dist[neighbor_id] = nd
                prev[neighbor_id] = node_id
                heapq.heappush(heap, (nd, neighbor_id))

    if graph.end not in dist:
        return None

    path: list[str] = [graph.end]
    while path[-1] != graph.start:
        path.append(prev[path[-1]])
    path.reverse()
    return path


class RTERepairPlanValidator:
    id = "rte-repair-plan"
    description = (
        "Dijkstra-optimal path over an illustrative repair-template graph, weighted by time/skill/risk, "
        "pruned by available tools and user skill level, gated by a hazard-vs-skill safety check. "
        "Graph contents are placeholder data -- see rte_data.py."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "failure_id": {"type": "string", "description": "Must match a key in REPAIR_GRAPHS, e.g. 'loose_connection'."},
            "user_skill_level": {"type": "string", "default": "intermediate", "enum": ["beginner", "intermediate", "expert"]},
            "available_tools": {"type": "array", "default": []},
            "alpha": {"type": "number", "default": DEFAULT_ALPHA, "description": "skill-difficulty cost weight"},
            "lambda_risk": {"type": "number", "default": DEFAULT_LAMBDA, "description": "risk cost weight"},
        }

    def run(self, payload: dict[str, Any], seed: int | None) -> ValidationReport:
        failure_id = payload.get("failure_id")
        user_skill_level = str(payload.get("user_skill_level", "intermediate"))
        available_tools = set(payload.get("available_tools", []) or [])
        alpha = float(payload.get("alpha", DEFAULT_ALPHA))
        lam = float(payload.get("lambda_risk", DEFAULT_LAMBDA))

        if not isinstance(failure_id, str) or failure_id not in REPAIR_GRAPHS:
            return ValidationReport(
                passed=False,
                error=f"Unknown failure_id '{failure_id}'. Known: {sorted(REPAIR_GRAPHS.keys())}.",
            )
        if user_skill_level not in SKILL_RANK:
            return ValidationReport(passed=False, error=f"user_skill_level must be one of {sorted(SKILL_RANK.keys())}.")

        graph = REPAIR_GRAPHS[failure_id]
        user_rank = SKILL_RANK[user_skill_level]

        usable_nodes: set[str] = set()
        pruned_for_skill: list[str] = []
        pruned_for_tools: list[str] = []
        for node_id, node in graph.nodes.items():
            if SKILL_RANK.get(node.skill_required, 99) > user_rank:
                pruned_for_skill.append(node_id)
                continue
            missing_tools = set(node.required_tools) - available_tools
            if missing_tools:
                pruned_for_tools.append(node_id)
                continue
            usable_nodes.add(node_id)

        path_ids = _dijkstra(graph, usable_nodes, alpha, lam)

        findings = [
            "Repair graph and every pinout_voltage_check value are illustrative placeholder data "
            "-- see rte_data.py module docstring. Do not use this output to guide real electrical repair work.",
        ]
        if pruned_for_skill:
            findings.append(f"Excluded steps above user_skill_level '{user_skill_level}': {sorted(pruned_for_skill)}.")
        if pruned_for_tools:
            findings.append(f"Excluded steps missing required tools: {sorted(pruned_for_tools)}.")

        if path_ids is None:
            findings.append("No repair path exists given the supplied tools and skill level.")
            return ValidationReport(
                passed=False,
                score=0.0,
                metrics={"total_steps": 0.0, "total_risk_score": 0.0, "estimated_duration_minutes": 0.0},
                findings=findings,
                details={"repair_trajectory": []},
            )

        step_nodes = [graph.nodes[nid] for nid in path_ids if nid not in (graph.start, graph.end)]
        total_risk_score = float(sum(n.hazard_level for n in step_nodes))
        max_hazard = max((n.hazard_level for n in step_nodes), default=0)
        hazard_cap = SKILL_HAZARD_CAP[user_skill_level]
        is_safe_for_user = max_hazard <= hazard_cap

        trajectory = [
            {
                "step_number": i + 1,
                "action_title": n.title,
                "instruction": n.instruction,
                "required_tools": list(n.required_tools),
                "pinout_voltage_check": n.pinout_voltage_check,
                "safety_hazard_level": n.hazard_level,
                "estimated_time_seconds": n.time_seconds,
            }
            for i, n in enumerate(step_nodes)
        ]

        total_duration_minutes = sum(n.time_seconds for n in step_nodes) / 60.0

        if not is_safe_for_user:
            findings.append(
                f"Path's max hazard_level {max_hazard} exceeds the recommended cap of {hazard_cap} for "
                f"skill level '{user_skill_level}' -- flagged unsafe for this requester even though a path exists."
            )

        passed = is_safe_for_user

        return ValidationReport(
            passed=passed,
            score=round(1.0 - (total_risk_score / (5.0 * max(len(step_nodes), 1))), 6),
            metrics={
                "total_steps": float(len(step_nodes)),
                "total_risk_score": total_risk_score,
                "estimated_duration_minutes": round(total_duration_minutes, 2),
                "max_hazard_level": float(max_hazard),
            },
            findings=findings,
            details={"repair_trajectory": trajectory, "is_safe_for_user": is_safe_for_user},
        )
