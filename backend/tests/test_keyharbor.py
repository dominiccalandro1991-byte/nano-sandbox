from fastapi.testclient import TestClient

from app.keyharbor import bucket, crypto, tokens, vault
from app.keyharbor.audit import recent, record
from app.main import app

client = TestClient(app)


def test_aes_roundtrip():
    key = crypto.derive_key("unit-seed")
    blob = crypto.seal("sk-or-v1-secret", key)
    assert b"sk-or-v1-secret" not in blob
    assert crypto.open_sealed(blob, key) == "sk-or-v1-secret"


def test_token_mint_verify_and_expiry_shape():
    t = tokens.mint("causalrail", 120)
    assert tokens.verify(t) == "causalrail"
    assert tokens.verify("Bearer " + t) == "causalrail"
    assert tokens.verify("nope") is None
    assert "sk-" not in t


def test_bucket_429():
    bucket.reset()
    allowed = 0
    denied = 0
    for _ in range(30):
        ok, _meta = bucket.allow("proofpatch", 1.0)
        if ok:
            allowed += 1
        else:
            denied += 1
    assert allowed <= 4
    assert denied > 0


def test_health():
    r = client.get("/keyharbor/health")
    assert r.status_code == 200
    assert r.json()["service"] == "keyharbor"


def test_proxy_requires_token():
    r = client.post("/keyharbor/v1/chat/completions", json={"model": "x", "messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 401


def test_audit_never_contains_key():
    record(service="studio", path="/chat/completions", status=200, latency_ms=1.2, nbytes=10, tokens=1)
    blob = str(recent(5))
    assert "sk-or" not in blob
    assert "OPENROUTER" not in blob


def test_vault_round_robin_and_trip():
    n = vault.init_vault("unit-seed", ["aaa-key-one", "bbb-key-two", "aaa-key-one"])
    assert n == 2
    first = vault.acquire()
    second = vault.acquire()
    assert first and second
    assert first[0] != second[0]
    vault.trip(first[0])
    assert "aaa-key-one" not in str(vault.status())


def test_mint_forbidden_without_header():
    r = client.post("/keyharbor/tokens", json={"service": "causalrail"})
    assert r.status_code == 401


def test_does_not_import_engines():
    import app.keyharbor.proxy as p
    import app.keyharbor.vault as v
    assert "usse" not in dir(p) and "nase" not in dir(v)
