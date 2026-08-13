import time

from app.validators import get_validator, list_validators
from app.validators.usse_validator import USSEValidator
from app.validators.oiav_validator import OIAVValidator
from app.usse.stress import compute_physical_stress, fuse_failure_risk, compute_digital_load
from app.oiav.vault import build_ip_package, merkle_root, sha256_hex


def test_usse_registered():
    assert get_validator("usse-stress") is not None
    assert any(v.id == "usse-stress" for v in list_validators())


def test_oiav_registered():
    assert get_validator("oiav-vault") is not None


def test_usse_rejects_stale_attestation():
    now = 5_000_000.0
    r = USSEValidator().run({
        "attestation_timestamp": now - 120,
        "now": now,
        "delta_seconds": 30,
        "force_n": 100,
        "lever_arm_m": 0.5,
    })
    assert r.passed is False
    assert "attestation" in (r.error or "").lower() or any("stale" in f for f in (r.findings or []))


def test_usse_physical_torque_and_pass():
    now = 5_000_000.0
    r = USSEValidator(fail_risk_threshold=0.95).run({
        "attestation_timestamp": now - 1,
        "now": now,
        "force_n": 50,
        "lever_arm_m": 0.2,
        "theta_deg": 90,
        "mass_kg": 10,
        "power_w": 5,
        "duration_h": 0.1,
        "agent_count": 2,
        "requests_per_second": 1,
        "mode": "unified",
    })
    assert r.error is None
    assert r.metrics["torque_nm"] > 0
    assert "failure_risk" in r.metrics


def test_usse_load_lb_conversion():
    phys = compute_physical_stress({"load_lb": 400, "lever_arm_m": 0.3})
    assert 180 < phys["mass_kg"] < 185  # ~181.4 kg
    assert phys["gravity_force_n"] > 1700


def test_oiav_rejects_stale_attestation():
    now = 6_000_000.0
    r = OIAVValidator().run({
        "attestation_timestamp": now - 90,
        "now": now,
        "assets": [{"name": "x", "content": "hello"}],
    })
    assert r.passed is False


def test_oiav_seals_package_with_merkle():
    now = 6_000_000.0
    r = OIAVValidator().run({
        "attestation_timestamp": now - 2,
        "now": now,
        "title": "NanoHabitat Engine",
        "asset_type": "app",
        "notes": "CAS habitat IP",
        "assets": [
            {"name": "readme", "kind": "text", "content": "hello world"},
            {"name": "arch", "kind": "note", "content": "ports and adapters"},
        ],
    })
    assert r.passed is True
    assert r.details["package_hash"]
    assert r.details["merkle_root"]
    assert r.metrics["leaf_count"] == 2.0


def test_merkle_deterministic():
    a = merkle_root([sha256_hex("a"), sha256_hex("b")])
    b = merkle_root([sha256_hex("a"), sha256_hex("b")])
    assert a == b


def test_engine_count_at_least_24():
    ids = {v.id for v in list_validators()}
    assert "usse-stress" in ids and "oiav-vault" in ids
    assert len(ids) >= 24
