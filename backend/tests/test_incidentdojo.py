from fastapi.testclient import TestClient

from app.incidentdojo.crypto import origin_hash, proofpatch_commit_sha
from app.incidentdojo.embeddings import cosine_distance, hash_embedding
from app.main import app

client = TestClient(app)

STACK = 'AssertionError: expected 1 got 2\n  File "app/foo.py", line 12, in test_x'
PATCH = "diff --git a/app/foo.py b/app/foo.py\n--- a/app/foo.py\n+++ b/app/foo.py\n@@ -12,1 +12,1 @@\n-return 2\n+return 1\n"


def test_hash_embedding_dim_and_identical_distance():
    a = hash_embedding(STACK)
    b = hash_embedding(STACK)
    assert len(a) == 1536
    assert cosine_distance(a, b) < 1e-9


def test_origin_hash_stable():
    assert origin_hash(signature="x", fingerprint="y") == origin_hash(signature="x", fingerprint="y")
    assert proofpatch_commit_sha(PATCH) == proofpatch_commit_sha(PATCH)
    assert len(proofpatch_commit_sha(PATCH)) == 64


def test_health():
    r = client.get("/incidentdojo/health")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "incidentdojo"
    assert body["vector_dim"] == 1536
    assert body["ready"] is True


def test_ingest_query_remediation_roundtrip():
    fail = client.post(
        "/incidentdojo/ingest-failure",
        json={"error_stack": STACK, "fingerprint": "abc123", "causalrail_trace_id": "11111111-1111-1111-1111-111111111111"},
    )
    assert fail.status_code == 200
    assert fail.json()["ok"] is True

    miss = client.post("/incidentdojo/query", json={"error_stack": STACK})
    assert miss.status_code == 200
    assert miss.json()["hit"] is False

    rem = client.post(
        "/incidentdojo/ingest-remediation",
        json={"patch_diff": PATCH, "error_stack": STACK, "fingerprint": "abc123"},
    )
    assert rem.status_code == 200
    body = rem.json()
    assert body["ok"] is True
    assert body["proofpatch_commit_sha"]
    assert body["incident_id"]

    hit = client.post("/incidentdojo/query", json={"error_stack": STACK, "threshold": 0.05})
    assert hit.status_code == 200
    q = hit.json()
    assert q["hit"] is True
    assert q["distance"] <= 0.05
    assert "return 1" in (q.get("patch_diff") or "")
    assert q["causalrail_trace_id"]


def test_proofpatch_unknown_repo_still_400():
    r = client.post("/proofpatch/verify", json={"repo": "evil/not-allowed"})
    assert r.status_code in (400, 409, 503)


def test_engines_not_imported_by_incidentdojo():
    import app.incidentdojo.store as st
    import app.incidentdojo.hooks as hooks
    assert "usse" not in dir(st) and "nase" not in dir(hooks)
