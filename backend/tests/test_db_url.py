from app.config import Settings, normalize_database_url


def test_normalize_plain_postgres():
    out = normalize_database_url(
        "postgresql://postgres.sujvxxrwjqsziswuazwm:x@aws-0-us-west-2.pooler.supabase.com:6543/postgres"
    )
    assert out.startswith("postgresql+psycopg://")
    assert "psycopg2" not in out


def test_settings_env_rewrites(monkeypatch):
    monkeypatch.setenv(
        "NANO_SANDBOX_DATABASE_URL",
        "postgresql://postgres.example:pass@host:5432/postgres",
    )
    s = Settings()
    assert s.database_url.startswith("postgresql+psycopg://")
