"""NanoAutonomic Debug & Repair Engine (NADRE) — formal core.

Evidence classification
-----------------------
- Continuous state monitoring as pure state-vector predicates: Partially Verified.
- Autonomic re-route / quarantine decisions as policy functions: Partially Verified.
- Live source rewriting of production modules: Missing (not performed here).
- Integration with NHSE Merkle equality + NASE Tool-Gateway: Partially Verified
  (predicates composed; full on-device loop is a later runtime concern).
"""

from app.nadre.invariants import (
    DEFAULT_MONITOR_PERIOD_MS,
    check_governor_budget_invariant,
    check_merkle_integrity_invariant,
    check_nase_gateway_compatible,
    check_predictor_calibration,
)
from app.nadre.monitor import NadreMonitor

__all__ = [
    "NadreMonitor",
    "DEFAULT_MONITOR_PERIOD_MS",
    "check_governor_budget_invariant",
    "check_merkle_integrity_invariant",
    "check_nase_gateway_compatible",
    "check_predictor_calibration",
]
