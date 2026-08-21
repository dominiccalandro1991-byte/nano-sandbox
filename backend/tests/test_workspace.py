from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_project_and_search_roundtrip():
    created = client.post("/workspace/projects", json={"name": "Physics"})
    assert created.status_code == 200
    pid = created.json()["id"]
    listed = client.get("/workspace/projects")
    assert listed.status_code == 200
    assert any(p["id"] == pid for p in listed.json()["projects"])

    put = client.put(
        "/workspace/threads",
        json={
            "id": "nnacc_session_test1",
            "title": "Torque spec",
            "preview": "400 lb load",
            "haystack": "USSE torque 400 lb load on the arm",
            "project_id": pid,
        },
    )
    assert put.status_code == 200
    found = client.get("/workspace/threads/search", params={"q": "torque"})
    assert found.status_code == 200
    ids = [r["id"] for r in found.json()["results"]]
    assert "nnacc_session_test1" in ids

    arch = client.patch("/workspace/threads/nnacc_session_test1", json={"archived": True})
    assert arch.status_code == 200
    hidden = client.get("/workspace/threads/search", params={"q": "torque", "archived": False})
    assert "nnacc_session_test1" not in [r["id"] for r in hidden.json()["results"]]
