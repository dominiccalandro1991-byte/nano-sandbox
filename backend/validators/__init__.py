"""
backend/validators — registration of the Tri-Engine Diagnostic Suite.

Evidence classification
-----------------------
- Existing BaseValidator / factory pattern: Missing (no prior validators/ or
  BaseValidator class observed in the live clone)
- Registration mechanism: Partially Verified (standard Python package
  __init__ export + dict registry pattern)
"""

from __future__ import annotations

from typing import Any, Dict, Type

from .tcc_validator import TCCValidator, get_validator as get_tcc
from .cdem_validator import CDEMValidator, get_validator as get_cdem
from .rte_validator import RTEValidator, get_validator as get_rte

# Concrete registry — maps engine id to factory
VALIDATORS: Dict[str, Any] = {
    "tcc": get_tcc,
    "cdem": get_cdem,
    "rte": get_rte,
}

VALIDATOR_CLASSES: Dict[str, Type] = {
    "tcc": TCCValidator,
    "cdem": CDEMValidator,
    "rte": RTEValidator,
}


def get_validator(name: str):
    """Return a fresh validator instance by short name, or raise KeyError."""
    factory = VALIDATORS[name]
    return factory()


def list_validators() -> list[str]:
    return sorted(VALIDATORS.keys())


def run_all(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Convenience: run every registered engine against the same payload."""
    results = {}
    for name, factory in VALIDATORS.items():
        results[name] = factory().validate(payload)
    return results
