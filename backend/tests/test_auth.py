import time

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_register_login_settings():
    email = f"blockd{int(time.time()*1000)}@example.com"
    password = "correct-horse"
    reg = client.post("/auth/register", json={"email": email, "password": password, "display_name": "Dom"})
    assert reg.status_code == 200, reg.text
    token = reg.json()["token"]
    me = client.get("/auth/me", headers={"Authorization": "Bearer " + token})
    assert me.status_code == 200
    put = client.put(
        "/auth/me/settings",
        headers={"Authorization": "Bearer " + token},
        json={"traits": ["Concise"], "memory": ["Likes short answers"], "api_key": "sk-test"},
    )
    assert put.status_code == 200
    body = put.json()
    assert body["traits"] == ["Concise"]
    assert body["memory"] == ["Likes short answers"]
    assert body["has_api_key"] is True
    assert "api_key" not in body
    login = client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
