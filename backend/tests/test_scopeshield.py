from fastapi.testclient import TestClient

from app.main import app
from app.scopeshield.engine import load_contract, validate

client = TestClient(app)


def test_health():
    r = client.get("/scopeshield/health")
    assert r.status_code == 200
    assert r.json()["service"] == "scopeshield"


def test_ci_profile_missing_fails():
    spec = load_contract("ci")
    report = validate(spec, env={}, skip_liveness=True)
    assert report["ok"] is False
    assert report["failures"][0]["reason"] == "missing"


def test_ci_profile_ok():
    spec = load_contract("ci")
    report = validate(spec, env={"SCOPESHIELD_CI": "ok"}, skip_liveness=True)
    assert report["ok"] is True
    dumped = str(report)
    assert "ok" in dumped


def test_forbids_dead_ref():
    spec = load_contract("nano-sandbox")
    report = validate(
        spec,
        env={"NANO_SANDBOX_DATABASE_URL": "postgresql://postgres.hlwqtlrkwhuogcwnhjrs:secret@host/postgres"},
        skip_liveness=True,
    )
    assert report["ok"] is False
    assert any(f["reason"] == "forbidden_substring" for f in report["failures"])
    assert "secret" not in str(report)


def test_forbids_sujvxx_on_causalrail():
    spec = load_contract("causalrail")
    report = validate(
        spec,
        env={
            "DATABASE_URL": "postgresql://postgres.sujvxxrwjqsziswuazwm:secret@host/postgres",
            "GITHUB_WEBHOOK_SECRET": "long-enough-secret",
        },
        skip_liveness=True,
    )
    assert any(f["reason"] == "forbidden_substring" for f in report["failures"])
    assert "secret" not in str(report)


def test_preflight_http():
    r = client.get("/scopeshield/preflight?profile=ci")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "ci"
    assert "failures" in body


def test_unknown_profile_404():
    r = client.get("/scopeshield/preflight?profile=does-not-exist")
    assert r.status_code == 404


def test_contract_names_only():
    r = client.get("/scopeshield/contract/nano-sandbox")
    assert r.status_code == 200
    names = [v["name"] for v in r.json()["variables"]]
    assert "NANO_SANDBOX_DATABASE_URL" in names


def test_does_not_import_engines():
    import app.scopeshield.engine as eng
    assert "usse" not in dir(eng) and "nase" not in dir(eng)
