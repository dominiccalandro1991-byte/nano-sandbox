"""Validator registry.

REGISTRY is the single source of truth for what validators exist. Routers,
the sandbox runner, and the job store all go through get_validator() /
list_validators() -- none of them know about individual validator classes.
"""
from __future__ import annotations

from app.validators.base import Validator
from app.validators.cdem_validator import CDEMDiagnosisValidator
from app.validators.multi_agent_interaction import MultiAgentInteractionValidator
from app.validators.rte_validator import RTERepairPlanValidator
from app.validators.soft_body_physics import SoftBodyPhysicsValidator
from app.validators.tcc_validator import TCCAnomalyValidator

REGISTRY: dict[str, Validator] = {
    v.id: v
    for v in (
        SoftBodyPhysicsValidator(),
        MultiAgentInteractionValidator(),
        TCCAnomalyValidator(),
        CDEMDiagnosisValidator(),
        RTERepairPlanValidator(),
    )
}


def get_validator(validator_id: str) -> Validator | None:
    return REGISTRY.get(validator_id)


def list_validators() -> list[Validator]:
    return list(REGISTRY.values())
