from app.validators import get_validator, list_validators
from app.nnacc.orchestrator import ChatOrchestrator
from app.nnacc.tools import parse_tool_intent
from app.validators.nnacc_validator import NNACCValidator


def test_nnacc_registered():
    assert get_validator("nnacc-chat") is not None
    assert len(list_validators()) >= 25


def test_tool_intent_usse():
    p = parse_tool_intent("Please run USSE stress for a 400 lb load")
    assert p is not None and p.engine_id == "usse-stress"


def test_turn_requires_attestation():
    orch = ChatOrchestrator()
    r = orch.turn("hello", attestation_timestamp=None, now=1_000_000.0)
    assert r.ok is False


def test_turn_with_fresh_attestation():
    now = 2_000_000.0
    orch = ChatOrchestrator()
    r = orch.turn("list engines", attestation_timestamp=now - 1, now=now)
    assert r.ok is True
    assert r.session_root
    assert r.user_hash and r.assistant_hash


def test_tool_proposal_oiav():
    now = 3_000_000.0
    orch = ChatOrchestrator()
    r = orch.turn("seal this IP package in the vault", attestation_timestamp=now - 2, now=now)
    assert r.ok and r.tool_allowed
    assert r.tool and r.tool.engine_id == "oiav-vault"


def test_nadre_blocks_unhealthy():
    now = 4_000_000.0
    orch = ChatOrchestrator()
    r = orch.turn(
        "hello",
        attestation_timestamp=now - 1,
        now=now,
        health={"resident_bytes": 9999, "budget_bytes": 100, "predictor_hits": 0, "predictor_misses": 0, "predictor_transitions": 0},
    )
    assert r.ok is False
    assert r.nadre_passed is False


def test_validator_happy_path():
    now = 5_000_000.0
    report = NNACCValidator().run({
        "message": "check NASE attestation path",
        "attestation_timestamp": now - 1,
        "now": now,
    })
    assert report.passed is True
    assert report.details["tool"]["engine_id"] == "nase-aegis"
