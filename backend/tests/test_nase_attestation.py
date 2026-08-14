"""NASE live attestation + vault-sync tests (e124886 follow-up).

Evidence: exercises Verified freshness predicates and Partially Verified
nonce/binding/vault-sync helpers. Does not claim the Missing multi-engine
weighted φ-vector equation from external directives.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.nase.attestation import (
    bind_attestation_material,
    issue_nonce,
    verify_attestation,
    vault_sync_put,
    vault_sync_get,
)
from app.nase.invariants import check_attestation_freshness


client = TestClient(app)


def test_nonce_issue_unique():
    a = issue_nonce()
    b = issue_nonce()
    assert a["nonce"] != b["nonce"]
    assert a["expires_at"] > a["issued_at"]


def test_verify_fresh_with_nonce():
    n = issue_nonce()
    now = time.time()
    att = now - 5.0
    binding = bind_attestation_material(n["nonce"], att)
    result = verify_attestation(
        attestation_timestamp=att,
        nonce=n["nonce"],
        client_binding_hash=binding,
        now=now,
        require_nonce=True,
    )
    assert result["ok"] is True
    assert result["nonce_ok"] is True
    assert result["binding_ok"] is True


def test_verify_replay_nonce_denied():
    n = issue_nonce()
    now = time.time()
    att = now - 2.0
    binding = bind_attestation_material(n["nonce"], att)
    first = verify_attestation(
        attestation_timestamp=att,
        nonce=n["nonce"],
        client_binding_hash=binding,
        now=now,
    )
    assert first["ok"] is True
    second = verify_attestation(
        attestation_timestamp=att,
        nonce=n["nonce"],
        client_binding_hash=binding,
        now=now,
    )
    assert second["ok"] is False
    assert second["http_hint"] == 403


def test_verify_stale_attestation_401():
    n = issue_nonce()
    now = time.time()
    att = now - 120.0  # stale vs default 30s
    result = verify_attestation(
        attestation_timestamp=att,
        nonce=n["nonce"],
        now=now,
        delta_seconds=30.0,
    )
    assert result["ok"] is False
    assert result["http_hint"] == 401


def test_verify_missing_attestation_fail_closed():
    result = verify_attestation(
        attestation_timestamp=None,
        nonce=None,
        require_nonce=False,
    )
    assert result["ok"] is False


def test_binding_mismatch_403():
    n = issue_nonce()
    now = time.time()
    att = now - 1.0
    result = verify_attestation(
        attestation_timestamp=att,
        nonce=n["nonce"],
        client_binding_hash="0" * 64,
        now=now,
    )
    assert result["ok"] is False
    assert result["http_hint"] == 403


def test_http_nonce_endpoint():
    r = client.get("/nase/nonce")
    assert r.status_code == 200
    body = r.json()
    assert "nonce" in body
    assert "expires_at" in body


def test_http_verify_ok_and_lock_path():
    n = client.post("/nase/nonce").json()
    now = time.time()
    att = now - 3.0
    binding = bind_attestation_material(n["nonce"], att)
    ok = client.post(
        "/nase/verify",
        json={
            "attestation_timestamp": att,
            "nonce": n["nonce"],
            "client_binding_hash": binding,
            "delta_seconds": 30.0,
        },
    )
    assert ok.status_code == 200
    assert ok.json()["ok"] is True

    # stale → 401
    n2 = client.post("/nase/nonce").json()
    bad = client.post(
        "/nase/verify",
        json={
            "attestation_timestamp": now - 90.0,
            "nonce": n2["nonce"],
            "delta_seconds": 30.0,
        },
    )
    assert bad.status_code == 401


def test_vault_sync_roundtrip():
    put = vault_sync_put("dGVzdC1jaXBoZXI=", content_hash="abc123", session_hint="s1")
    assert "blob_id" in put
    got = vault_sync_get(put["blob_id"])
    assert got is not None
    assert got["ciphertext_b64"] == "dGVzdC1jaXBoZXI="
    assert got["content_hash"] == "abc123"


def test_http_vault_sync():
    r = client.post(
        "/nase/vault-sync",
        json={
            "ciphertext_b64": "AQID",
            "content_hash": "deadbeef",
            "session_hint": "nnacc-test",
        },
    )
    assert r.status_code == 200
    blob_id = r.json()["blob_id"]
    g = client.get(f"/nase/vault-sync/{blob_id}")
    assert g.status_code == 200
    assert g.json()["content_hash"] == "deadbeef"


def test_existing_freshness_predicate_still_holds():
    now = 5_000_000.0
    ok, _ = check_attestation_freshness(now - 5.0, now, delta_seconds=30.0)
    assert ok is True
    ok, _ = check_attestation_freshness(now - 60.0, now, delta_seconds=30.0)
    assert ok is False
