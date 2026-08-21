from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_image_pollinations_url():
    r = client.get("/media/image", params={"prompt": "red cube on a table"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "pollinations"
    assert body["cost"] == 0.0
    assert "pollinations.ai" in body["url"]
    assert "red" in body["url"].lower() or "cube" in body["url"].lower()


def test_image_empty():
    assert client.get("/media/image", params={"prompt": ""}).status_code == 400


def test_search_empty():
    r = client.post("/search", json={"q": ""})
    assert r.status_code in (400, 422)
