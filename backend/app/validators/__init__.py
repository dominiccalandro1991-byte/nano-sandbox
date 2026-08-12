"""Validator registry.

REGISTRY is the single source of truth for what validators exist. Routers,
the sandbox runner, and the job store all go through get_validator() /
list_validators() -- none of them know about individual validator classes.
"""
from __future__ import annotations

from app.validators.base import Validator
from app.validators.causal_fusion_validator import CausalFusionValidator
from app.validators.cdem_validator import CDEMDiagnosisValidator
from app.validators.corrosion_validator import CorrosionOxidationValidator
from app.validators.dependency_collision import DependencyCollisionValidator
from app.validators.fluid_viscosity_validator import FluidViscosityValidator
from app.validators.geometry_tolerance_validator import GeometryToleranceValidator
from app.validators.market_absence_indexer import MarketAbsenceIndexerValidator
from app.validators.multi_agent_interaction import MultiAgentInteractionValidator
from app.validators.physics_qc_matrix import PhysicsQCMatrixValidator
from app.validators.pressure_validator import BarometricPressureValidator
from app.validators.rte_validator import RTERepairPlanValidator
from app.validators.soft_body_physics import SoftBodyPhysicsValidator
from app.validators.solder_bridge_validator import SolderBridgeInspectionValidator
from app.validators.tcc_validator import TCCAnomalyValidator
from app.validators.thermal_gradient_validator import ThermalGradientValidator
from app.validators.thermal_validator import ThermalDissipationValidator
from app.validators.thermo_mechanical_validator import ThermoMechanicalStressValidator
from app.validators.tier_drift_validator import TierDriftValidator
from app.validators.uv_luminescence_validator import UVLuminescenceValidator
from app.validators.vision_surface_validator import VisionSurfaceDefectsValidator

REGISTRY: dict[str, Validator] = {
    v.id: v
    for v in (
        SoftBodyPhysicsValidator(),
        MultiAgentInteractionValidator(),
        TCCAnomalyValidator(),
        CDEMDiagnosisValidator(),
        RTERepairPlanValidator(),
        TierDriftValidator(),
        PhysicsQCMatrixValidator(),
        DependencyCollisionValidator(),
        MarketAbsenceIndexerValidator(),
        ThermalDissipationValidator(),
        ThermalGradientValidator(),
        ThermoMechanicalStressValidator(),
        VisionSurfaceDefectsValidator(),
        SolderBridgeInspectionValidator(),
        GeometryToleranceValidator(),
        UVLuminescenceValidator(),
        FluidViscosityValidator(),
        CorrosionOxidationValidator(),
        BarometricPressureValidator(),
        CausalFusionValidator(),
    )
}


def get_validator(validator_id: str) -> Validator | None:
    return REGISTRY.get(validator_id)


def list_validators() -> list[Validator]:
    return list(REGISTRY.values())
