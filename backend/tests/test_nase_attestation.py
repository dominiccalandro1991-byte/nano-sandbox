"""NASE attestation tests: 25-engine S_attest equation, durable SQLite vault-sync.

Evidence: exercises registry-derived φ_k (Partially Verified), HMAC snapshots,
S_attest = H(nonce || sum), SQLite durability across reopen, and fail-closed HTTP.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.nase.attestation import (
    DurableVaultStore,
    issue_nonce,
    issue_nonce_with_vectors,
    verify_attestation,
    vault_sync_put,
    vault_sync_get,
)
from app.nase.engine_vectors import (
    ENGINE_COUNT,
    compute_phi_vector,
    compute_s_attest,
    export_engine_snapshot,
    weighted_sum,
)
from app.nase.invariants import check_attestation_freshness
from app.config import get_settings

client = TestClient(app)
SECRET = get_settings().attestation_secret


def test_engine_vector_count_is_25():
    vectors = compute_phi_vector()
    assert len(vectors) == ENGINE_COUNT == 25
    assert abs(sum(v["omega"] for v in vectors) - 1.0) < 1e-9


def test_export_snapshot_signed():
    snap = export_engine_snapshot(SECRET)
    assert snap["engine_count"] == 25
    assert "signature" in snap
    assert len(snap["vectors"]) == 25
    assert "weighted_sum" in snap


def test_s_attest_equation_matches():
    snap = export_engine_snapshot(SECRET)
    nonce = "abc123nonce"
    s = compute_s_attest(nonce, snap["weighted_sum"])
    assert len(s) == 64
    # recompute
    s2 = compute_s_attest(nonce, weighted_sum(snap["vectors"]))
    assert s == s2


def test_issue_nonce_with_vectors_binds_s_attest():
    issued = issue_nonce_with_vectors(SECRET)
    assert "nonce" in issued
    assert "engine_snapshot" in issued
    assert issued["engine_snapshot"]["engine_count"] == 25
    assert issued["expected_s_attest"] == compute_s_attest(
        issued["nonce"], issued["engine_snapshot"]["weighted_sum"]
    )


def test_verify_with_correct_s_attest():
    issued = issue_nonce_with_vectors(SECRET)
    now = time.time()
    att = now - 3.0
    result = verify_attestation(
        attestation_timestamp=att,
        nonce=issued["nonce"],
        client_s_attest=issued["expected_s_attest"],
        now=now,
        require_nonce=True,
        require_s_attest=True,
        attestation_secret=SECRET,
    )
    assert result["ok"] is True
    assert result["s_attest_ok"] is True


def test_verify_wrong_s_attest_403():
    issued = issue_nonce_with_vectors(SECRET)
    now = time.time()
    result = verify_attestation(
        attestation_timestamp=now - 2.0,
        nonce=issued["nonce"],
        client_s_attest="0" * 64,
        now=now,
        require_s_attest=True,
        attestation_secret=SECRET,
    )
    assert result["ok"] is False
    assert result["http_hint"] == 403


def test_verify_replay_nonce_denied():
    issued = issue_nonce_with_vectors(SECRET)
    now = time.time()
    att = now - 2.0
    first = verify_attestation(
        attestation_timestamp=att,
        nonce=issued["nonce"],
        client_s_attest=issued["expected_s_attest"],
        now=now,
        require_s_attest=True,
        attestation_secret=SECRET,
    )
    assert first["ok"] is True
    second = verify_attestation(
        attestation_timestamp=att,
        nonce=issued["nonce"],
        client_s_attest=issued["expected_s_attest"],
        now=now,
        require_s_attest=True,
        attestation_secret=SECRET,
    )
    assert second["ok"] is False
    assert second["http_hint"] == 403


def test_verify_stale_attestation_401():
    issued = issue_nonce_with_vectors(SECRET)
    now = time.time()
    result = verify_attestation(
        attestation_timestamp=now - 120.0,
        nonce=issued["nonce"],
        client_s_attest=issued["expected_s_attest"],
        now=now,
        delta_seconds=30.0,
        require_s_attest=True,
        attestation_secret=SECRET,
    )
    assert result["ok"] is False
    assert result["http_hint"] == 401


def test_http_nonce_includes_engine_snapshot():
    r = client.post("/nase/nonce")
    assert r.status_code == 200
    body = r.json()
    assert "nonce" in body
    assert body["engine_snapshot"]["engine_count"] == 25
    assert "expected_s_attest" in body


def test_http_engine_vectors():
    r = client.get("/nase/engine-vectors")
    assert r.status_code == 200
    body = r.json()
    assert body["engine_count"] == 25
    assert len(body["vectors"]) == 25


def test_http_verify_ok_and_fail():
    n = client.post("/nase/nonce").json()
    now = time.time()
    ok = client.post(
        "/nase/verify",
        json={
            "attestation_timestamp": now - 2.0,
            "nonce": n["nonce"],
            "client_s_attest": n["expected_s_attest"],
            "require_s_attest": True,
        },
    )
    assert ok.status_code == 200

    n2 = client.post("/nase/nonce").json()
    bad = client.post(
        "/nase/verify",
        json={
            "attestation_timestamp": now - 2.0,
            "nonce": n2["nonce"],
            "client_s_attest": "ff" * 32,
            "require_s_attest": True,
        },
    )
    assert bad.status_code == 403


def test_sqlite_vault_durable_across_reopen(tmp_path):
    db = tmp_path / "vault_test.sqlite"
    store = DurableVaultStore(str(db))
    put = store.put("dGVzdA==", content_hash="abc123", session_hint="s1", identity_hint="id1")
    assert put["durable"] is True
    assert put["backend"] == "sqlite"
    # reopen new instance on same path
    store2 = DurableVaultStore(str(db))
    got = store2.get(put["blob_id"])
    assert got is not None
    assert got["ciphertext_b64"] == "dGVzdA=="
    assert got["content_hash"] == "abc123"
    assert store2.count() >= 1


def test_http_vault_sync_durable():
    r = client.post(
        "/nase/vault-sync",
        json={
            "ciphertext_b64": "AQIDBA==",
            "content_hash": "deadbeef",
            "session_hint": "nnacc-test",
            "identity_hint": "fp-test",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("durable") is True
    assert body.get("backend") == "sqlite"
    blob_id = body["blob_id"]
    g = client.get(f"/nase/vault-sync/{blob_id}")
    assert g.status_code == 200
    assert g.json()["content_hash"] == "deadbeef"

    status = client.get("/nase/vault-sync-status")
    assert status.status_code == 200
    assert status.json()["durable"] is True
    assert status.json()["backend"] == "sqlite"


def test_server_response_has_no_plaintext_key_material():
    r = client.post(
        "/nase/vault-sync",
        json={"ciphertext_b64": "AAAA", "content_hash": "00"},
    )
    body = r.json()
    # Must not echo any decryption key fields
    assert "key" not in body
    assert "aes" not in str(body).lower()
    assert "pbkdf" not in str(body).lower()


def test_existing_freshness_predicate_still_holds():
    now = 5_000_000.0
    ok, _ = check_attestation_freshness(now - 5.0, now, delta_seconds=30.0)
    assert ok is True
    ok, _ = check_attestation_freshness(now - 60.0, now, delta_seconds=30.0)
    assert ok is False
