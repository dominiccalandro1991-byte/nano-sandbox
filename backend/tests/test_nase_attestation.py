"""NASE enterprise-hardening tests: TEE seal, rotation, SQLAlchemy vault, OIDC hints.

Evidence: mocks/contracts for cloud KMS and multi-region PG; Software TEE and
SQLite-backed SQLAlchemy exercised for real. Physical HSM / live Auth0 remain Missing.
"""

from __future__ import annotations

import time
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.nase.attestation import (
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
from app.nase.kms import CloudKMSProvider, SoftwareTEEProvider, get_key_provider, reset_key_provider
from app.nase.oidc import extract_subject_unverified, identity_hint_from_subject, verify_oidc_token
from app.nase.secret_rotation import RotatingHmacSecret, get_rotator, reset_rotator
from app.nase.vault_db import init_engine, reset_engine, vault_count, vault_put, vault_get

client = TestClient(app)
SEED = get_settings().kms_seed


@pytest.fixture(autouse=True)
def _reset_crypto_singletons():
    reset_key_provider()
    reset_rotator()
    yield
    reset_key_provider()
    reset_rotator()


def test_engine_vector_count_is_25():
    vectors = compute_phi_vector()
    assert len(vectors) == ENGINE_COUNT == 25
    assert abs(sum(v["omega"] for v in vectors) - 1.0) < 1e-9


def test_export_snapshot_tee_and_hmac_signed():
    snap = export_engine_snapshot(SEED)
    assert snap["engine_count"] == 25
    assert snap["tee_provider"] == "software_tee"
    assert snap["tee_signature"]
    assert snap["hmac_signature"]
    assert snap["hmac_version_id"]
    provider = get_key_provider("software_tee", seed=SEED)
    assert provider.verify(snap["canonical"].encode(), snap["tee_signature"])


def test_software_tee_does_not_export_raw_key():
    tee = SoftwareTEEProvider("test-seed-abc")
    blob = tee.sign(b"payload")
    assert blob.provider == "software_tee"
    assert not hasattr(tee, "export_key")
    assert tee.verify(b"payload", blob.signature)


def test_cloud_kms_unconfigured_fails_closed():
    kms = CloudKMSProvider(key_arn=None)
    with pytest.raises(RuntimeError, match="not configured"):
        kms.sign(b"x")


def test_s_attest_equation_matches():
    snap = export_engine_snapshot(SEED)
    nonce = "abc123nonce"
    s = compute_s_attest(nonce, snap["weighted_sum"])
    assert len(s) == 64
    assert s == compute_s_attest(nonce, weighted_sum(snap["vectors"]))


def test_issue_and_verify_with_s_attest():
    issued = issue_nonce_with_vectors(SEED)
    now = time.time()
    result = verify_attestation(
        attestation_timestamp=now - 2.0,
        nonce=issued["nonce"],
        client_s_attest=issued["expected_s_attest"],
        now=now,
        require_s_attest=True,
        attestation_secret=SEED,
    )
    assert result["ok"] is True


def test_verify_wrong_s_attest_403():
    issued = issue_nonce_with_vectors(SEED)
    now = time.time()
    result = verify_attestation(
        attestation_timestamp=now - 2.0,
        nonce=issued["nonce"],
        client_s_attest="0" * 64,
        now=now,
        require_s_attest=True,
        attestation_secret=SEED,
    )
    assert result["ok"] is False
    assert result["http_hint"] == 403


def test_hmac_rotation_grace_window():
    rot = RotatingHmacSecret("rot-seed", rotation_seconds=30.0, grace_seconds=60.0)
    sig1, ver1 = rot.sign(b"hello")
    assert rot.verify(b"hello", sig1, ver1)
    ver2 = rot.force_rotate()
    assert ver2.version_id != ver1
    # old signature still valid during grace
    assert rot.verify(b"hello", sig1, ver1)
    sig2, ver2b = rot.sign(b"hello")
    assert rot.verify(b"hello", sig2, ver2b)


def test_http_nonce_includes_tee_fields():
    r = client.post("/nase/nonce")
    assert r.status_code == 200
    body = r.json()
    snap = body["engine_snapshot"]
    assert snap["engine_count"] == 25
    assert "tee_signature" in snap
    assert "hmac_version_id" in snap
    assert body["expected_s_attest"]


def test_http_verify_and_rotate_endpoint():
    n = client.post("/nase/nonce").json()
    now = time.time()
    ok = client.post(
        "/nase/verify",
        json={
            "attestation_timestamp": now - 1.0,
            "nonce": n["nonce"],
            "client_s_attest": n["expected_s_attest"],
            "require_s_attest": True,
        },
    )
    assert ok.status_code == 200
    rot = client.post("/nase/rotate-hmac")
    assert rot.status_code == 200
    assert rot.json()["rotated"] is True


def test_sqlalchemy_vault_roundtrip(tmp_path):
    reset_engine()
    db = tmp_path / "vault.db"
    init_engine(f"sqlite:///{db}")
    put = vault_put("dGVzdA==", "abc123", session_hint="s1", identity_hint="id1")
    assert put["backend"] == "sqlalchemy"
    assert put["durable"] is True
    got = vault_get(put["blob_id"])
    assert got is not None
    assert got["ciphertext_b64"] == "dGVzdA=="
    # reopen
    reset_engine()
    init_engine(f"sqlite:///{db}")
    got2 = vault_get(put["blob_id"])
    assert got2 is not None
    assert vault_count() >= 1


def test_http_vault_sync_sqlalchemy():
    r = client.post(
        "/nase/vault-sync",
        json={
            "ciphertext_b64": "AQID",
            "content_hash": "deadbeef",
            "session_hint": "t",
            "identity_hint": "fp",
        },
    )
    assert r.status_code == 200
    assert r.json()["backend"] == "sqlalchemy"
    status = client.get("/nase/vault-sync-status")
    assert status.status_code == 200
    assert status.json()["backend"] == "sqlalchemy"
    assert status.json()["durable"] is True


def test_oidc_subject_and_test_issuer_verify():
    token = jwt.encode(
        {"sub": "user-42", "iss": "https://test.local/oidc", "aud": "nnacc"},
        key="not-used",
        algorithm="HS256",
    )
    sub = extract_subject_unverified(token)
    assert sub == "user-42"
    claims = verify_oidc_token(
        token,
        issuer="https://test.local/oidc",
        audience="nnacc",
        jwks_url=None,
    )
    assert claims["sub"] == "user-42"
    assert identity_hint_from_subject("user-42")


def test_oidc_unconfigured_fails_closed():
    with pytest.raises(RuntimeError, match="not configured"):
        verify_oidc_token("x.y.z", issuer=None, audience=None, jwks_url=None)


def test_existing_freshness_predicate_still_holds():
    now = 5_000_000.0
    ok, _ = check_attestation_freshness(now - 5.0, now, delta_seconds=30.0)
    assert ok is True
    ok, _ = check_attestation_freshness(now - 60.0, now, delta_seconds=30.0)
    assert ok is False

def test_vault_put_uses_nase_vault_blobs_table(tmp_path):
    reset_engine()
    db = tmp_path / "vault2.db"
    init_engine(f"sqlite:///{db}")
    put = vault_put("QQ==", "hash1", identity_hint="subj")
    assert put.get("table") == "nase_vault_blobs"
    assert put.get("id")
    got = vault_get(put["id"])
    assert got is not None
    assert got["user_subject_hash"] == "subj"

