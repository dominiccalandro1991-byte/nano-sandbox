from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_validators():
    r = client.get("/validators")
    assert r.status_code == 200
    ids = {v["id"] for v in r.json()}
    assert {"soft-body-physics", "multi-agent-interaction"} <= ids


def test_submit_job_soft_body():
    r = client.post("/jobs", json={"validator_id": "soft-body-physics", "payload": {"rows": 3, "cols": 3, "steps": 100}, "seed": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in ("passed", "failed")
    assert body["report"] is not None


def test_submit_job_unknown_validator_404():
    r = client.post("/jobs", json={"validator_id": "nope", "payload": {}})
    assert r.status_code == 404


def test_get_job_roundtrip():
    submit = client.post("/jobs", json={"validator_id": "multi-agent-interaction", "payload": {"agent_count": 4, "steps": 50}, "seed": 3})
    job_id = submit.json()["id"]
    fetched = client.get(f"/jobs/{job_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == job_id


def test_get_missing_job_404():
    r = client.get("/jobs/does-not-exist")
    assert r.status_code == 404


def test_job_list_recent_first():
    for _ in range(3):
        client.post("/jobs", json={"validator_id": "soft-body-physics", "payload": {"rows": 2, "cols": 2, "steps": 20}})
    r = client.get("/jobs?limit=2")
    assert r.status_code == 200
    assert len(r.json()) == 2
