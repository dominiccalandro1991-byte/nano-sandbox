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


def test_suno_system_prompt_is_artist_not_coder():
    from app.routers.openrouter_llm import ChatBody, ChatMessage, _build_messages

    body = ChatBody(
        model="google/gemma-4-26b-a4b-it:free",
        messages=[ChatMessage(role="user", content="hi what are you doing?")],
        persona="funkastatic",
        suno=True,
    )
    msgs = _build_messages(body)
    sys = msgs[0]["content"]
    assert "Funkastatic" in sys
    assert "STYLE" in sys and "LYRICS" in sys
    assert "multi-file repositories" not in sys


def test_suno_fallback_skips_busy_preferred():
    from app.routers.openrouter_llm import _model_chain

    chain = _model_chain("google/gemma-4-26b-a4b-it:free", suno=True)
    assert chain[0] == "google/gemma-4-26b-a4b-it:free"
    assert "poolside/laguna-xs-2.1:free" in chain
    assert "nvidia/nemotron-3-super-120b-a12b:free" in chain

    from app.routers.openrouter_llm import ChatBody, ChatMessage, _build_messages

    body = ChatBody(
        model="google/gemma-4-26b-a4b-it:free",
        messages=[ChatMessage(role="user", content="hi")],
        persona="vail-cipher",
        suno=False,
    )
    sys = _build_messages(body)[0]["content"]
    assert "Voltage Cipher Studio" in sys
    assert "You are Vail Cipher" not in sys


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
