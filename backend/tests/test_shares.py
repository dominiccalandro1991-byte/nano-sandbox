from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_share_roundtrip():
    created = client.post(
        "/shares",
        json={
            "title": "Hello thread",
            "messages": [
                {"role": "user", "text": "hi"},
                {"role": "assistant", "text": "hello"},
            ],
        },
    )
    assert created.status_code == 200
    share_id = created.json()["id"]
    got = client.get(f"/shares/{share_id}")
    assert got.status_code == 200
    body = got.json()
    assert body["title"] == "Hello thread"
    assert len(body["messages"]) == 2


def test_share_missing():
    assert client.get("/shares/does-not-exist").status_code == 404
