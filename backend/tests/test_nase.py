"""NASE formal-core tests: attestation-freshness, least-privilege, five agents."""

from __future__ import annotations

import time

from app.nase.agents import AGENT_DEFS, AgentId
from app.nase.gateway import ToolGateway
from app.nase.invariants import check_attestation_freshness, check_hash_integrity
from app.nase.policy import PolicyGovernor
from app.validators.nase_aegis_validator import NaseAegisValidator


def test_five_agents_defined():
    assert len(AGENT_DEFS) == 6  # five specialists + governing-orchestrator
    assert AgentId.DETECTOR in AGENT_DEFS
    assert AgentId.PREDICTOR in AGENT_DEFS
    assert AgentId.RESPONDER in AGENT_DEFS
    assert AgentId.AUDITOR in AGENT_DEFS
    assert AgentId.GOVERNOR in AGENT_DEFS
    assert AgentId.ORCHESTRATOR in AGENT_DEFS


def test_attestation_freshness_pass():
    now = 1_000_000.0
    ok, _ = check_attestation_freshness(now - 10.0, now, delta_seconds=30.0)
    assert ok is True


def test_attestation_freshness_stale():
    now = 1_000_000.0
    ok, reason = check_attestation_freshness(now - 60.0, now, delta_seconds=30.0)
    assert ok is False
    assert "stale" in reason


def test_attestation_missing_fail_closed():
    ok, reason = check_attestation_freshness(None, time.time())
    assert ok is False
    assert "missing" in reason


def test_gateway_least_privilege_deny():
    gw = ToolGateway()
    d = gw.allow("detector", "policy.write")
    assert d.allowed is False


def test_gateway_least_privilege_allow():
    gw = ToolGateway()
    d = gw.allow("responder", "habitat.quarantine")
    assert d.allowed is True


def test_governor_requires_fresh_attestation():
    gov = PolicyGovernor(delta_seconds=30.0)
    now = 2_000_000.0
    denied = gov.grant("responder", "habitat.quarantine", attestation_timestamp=now - 90.0, now=now)
    assert denied["allowed"] is False
    allowed = gov.grant("responder", "habitat.quarantine", attestation_timestamp=now - 5.0, now=now)
    assert allowed["allowed"] is True


def test_hash_integrity_quarantine():
    ok, _ = check_hash_integrity("abc", "abc")
    assert ok is True
    ok, reason = check_hash_integrity("abc", "xyz")
    assert ok is False
    assert "mismatch" in reason


def test_nase_validator_fresh_grant_passes():
    v = NaseAegisValidator()
    now = 3_000_000.0
    report = v.run(
        {
            "agent_id": "auditor",
            "action": "audit.append",
            "attestation_timestamp": now - 2.0,
            "now": now,
        },
        seed=1,
    )
    assert report.error is None
    assert report.passed is True
    assert report.metrics["attestation_ok"] == 1.0


def test_nase_validator_stale_fails():
    v = NaseAegisValidator()
    now = 3_000_000.0
    report = v.run(
        {
            "agent_id": "responder",
            "action": "habitat.quarantine",
            "attestation_timestamp": now - 120.0,
            "now": now,
            "delta_seconds": 30,
        },
        seed=1,
    )
    assert report.passed is False


def test_nase_validator_hash_mismatch_fails_even_if_grant_ok():
    v = NaseAegisValidator()
    now = 3_000_000.0
    report = v.run(
        {
            "agent_id": "detector",
            "action": "habitat.hash_check",
            "attestation_timestamp": now - 1.0,
            "now": now,
            "expected_hash": "aaa",
            "actual_hash": "bbb",
        },
        seed=1,
    )
    assert report.passed is False
    assert report.metrics["hash_ok"] == 0.0


def test_nase_registered_in_registry():
    from app.validators import get_validator, list_validators

    v = get_validator("nase-aegis")
    assert v is not None
    assert v.id == "nase-aegis"
    assert any(x.id == "nase-aegis" for x in list_validators())
