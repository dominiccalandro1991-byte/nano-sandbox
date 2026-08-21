from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.proofpatch import verify

client = TestClient(app)


def test_proofpatch_health():
    r = client.get("/proofpatch/health")
    assert r.status_code == 200
    assert r.json()["endpoint"] == "POST /proofpatch/verify"


def test_proofpatch_rejects_unknown_repo():
    r = client.post("/proofpatch/verify", json={"repo": "evil/not-allowed"})
    assert r.status_code in (400, 409, 503)


def test_isolated_fixture_branch(tmp_path: Path):
    (tmp_path / "ok.py").write_text("x = 1\n")
    result = verify(
        repo="dominiccalandro1991-byte/nano-sandbox",
        fixture_dir=str(tmp_path),
        enabled=True,
        timeout=30,
    )
    assert result["ok"] is True
    assert result["branch"].startswith("proofpatch/")
    assert result["attempts"] >= 1
    assert "DATABASE_URL" not in "".join(result.get("logs") or [])
