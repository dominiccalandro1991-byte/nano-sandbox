"""Macro orchestrator + 25-engine attestation mapping tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.nase.engine_core import (
    ENGINE_COUNT,
    MACRO_GROUPS,
    AttestationPipeline,
    MacroEngineRegistry,
    UNIFORM_WEIGHT,
)
from app.nase.engine_vectors import compute_s_attest

client = TestClient(app)


def test_macro_groups_cover_25():
    ids = sorted(i for group in MACRO_GROUPS.values() for i in group)
    assert ids == list(range(1, 26))
    assert abs(UNIFORM_WEIGHT - 0.04) < 1e-12


def test_pipeline_attestation_matches_equation():
    pipe = AttestationPipeline()
    assert len(pipe.engines) == ENGINE_COUNT == 25
    att = pipe.compute_attestation("test-nonce-abc")
    expected = compute_s_attest("test-nonce-abc", att["weighted_sum"])
    assert att["s_attest"] == expected
    assert len(att["s_attest"]) == 64


def test_inventor_mass_band():
    reg = MacroEngineRegistry()
    bad = reg.execute_macro_task("inventor", {"utility_mass_lb": 100})
    assert bad["status"] == "failed"
    good = reg.execute_macro_task("inventor", {"utility_mass_lb": 400})
    assert good["status"] == "success"
    assert good["attestation_signature"]


def test_http_macros_and_execute():
    r = client.get("/nase/macros")
    assert r.status_code == 200
    assert len(r.json()["macros"]) == 5
    e = client.get("/nase/engines")
    assert e.status_code == 200
    assert e.json()["count"] == 25
    x = client.post("/nase/macro/research", json={"payload": {"query": "test"}})
    assert x.status_code == 200
    body = x.json()
    assert body["status"] == "success"
    assert body["attestation_signature"]
    assert body["engines_involved"] == list(range(1, 6))
