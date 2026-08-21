from app.causalrail_ingest import notify_proofpatch_failure, safe_ingest_url, should_notify


def test_refuses_database_uris():
    assert safe_ingest_url("postgresql://postgres.example:x@host/postgres") == ""

    assert safe_ingest_url("postgresql+psycopg://postgres.sujvxxrwjqsziswuazwm:x@aws-0-us-west-2.pooler.supabase.com:6543/postgres") == ""
    assert safe_ingest_url("https://xyz.supabase.com/api/ingest") == ""
    assert (
        safe_ingest_url("https://causalrail-api.onrender.com/api/ingest")
        == "https://causalrail-api.onrender.com/api/ingest"
    )
    assert safe_ingest_url("") == ""
    assert safe_ingest_url("http://insecure.example/api/ingest") == ""


def test_skips_ok_and_client_errors():
    assert should_notify({"ok": True, "status": 200, "branch": "proofpatch/x", "logs": ["a"]}) is False
    assert should_notify({"ok": False, "status": 400, "branch": "x", "logs": ["a"]}) is False
    assert should_notify({"ok": False, "status": 503, "logs": ["a"]}) is False
    assert should_notify({"ok": False, "status": 413}) is False
    assert should_notify({"ok": False, "status": 409}) is False
    assert should_notify({"ok": False, "status": 409, "branch": "proofpatch/abc", "logs": ["clone exit=1"]}) is True


def test_notify_swallows_network_errors(monkeypatch):
    def boom(*_a, **_k):
        raise TimeoutError("nope")

    monkeypatch.setattr("urllib.request.urlopen", boom)
    sent = notify_proofpatch_failure(
        repo="dominiccalandro1991-byte/nano-sandbox",
        result={"ok": False, "status": 409, "branch": "proofpatch/x", "logs": ["fail"], "error": "clone_failed"},
        ingest_url="https://causalrail-api.onrender.com/api/ingest",
    )
    assert sent is False


def test_notify_posts_without_patch_body(monkeypatch):
    captured = {}

    class FakeResp:
        def read(self, _n=None):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    def fake_urlopen(req, timeout=0):
        captured["url"] = req.full_url
        captured["body"] = req.data.decode("utf-8")
        captured["timeout"] = timeout
        return FakeResp()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    ok = notify_proofpatch_failure(
        repo="dominiccalandro1991-byte/nano-sandbox",
        result={
            "ok": False,
            "status": 409,
            "branch": "proofpatch/deadbeef",
            "logs": ["apply exit=1"],
            "error": "patch_apply_failed",
        },
        ingest_url="https://causalrail-api.onrender.com/api/ingest",
    )
    assert ok is True
    assert captured["url"] == "https://causalrail-api.onrender.com/api/ingest"
    assert "SECRET" not in captured["body"]
    assert "diff --git" not in captured["body"]
    assert "proofpatch" in captured["body"]
    assert captured["timeout"] == 4
