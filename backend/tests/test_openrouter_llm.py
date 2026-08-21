"""OpenRouter router unit tests (no live key required for catalog)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_list_free_models_catalog():
    r = client.get("/llm/models")
    assert r.status_code == 200
    body = r.json()
    assert len(body["models"]) == 6
    ids = {m["id"] for m in body["models"]}
    assert "poolside/laguna-s-2.1:free" in ids
    assert "google/gemma-4-26b-a4b-it:free" in ids
    assert len(body["categories"]) == 2


def test_chat_rejects_unknown_model():
    r = client.post(
        "/llm/chat",
        json={"model": "not-a-real/model", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert r.status_code == 400


def test_chat_without_key_returns_503(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.delenv("NANO_SANDBOX_OPENROUTER_API_KEY", raising=False)
    from app.keyharbor import vault

    vault.init_vault("test", [])
    r = client.post(
        "/llm/chat",
        json={
            "model": "google/gemma-4-26b-a4b-it:free",
            "messages": [{"role": "user", "content": "hi"}],
        },
    )
    assert r.status_code in (503, 502)
