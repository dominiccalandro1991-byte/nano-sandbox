"""Runtime configuration for nano-sandbox / NASE.

Supabase (project ref sujvxxrwjqsziswuazwm):
  Set NANO_SANDBOX_DATABASE_URL to a SQLAlchemy URL, e.g.:
    postgresql+psycopg://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres
  or direct:
    postgresql+psycopg://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres?sslmode=require

Evidence: host DNS Verified for sujvxxrwjqsziswuazwm.supabase.co.
Password / full URI must come from environment (never commit secrets).
"""
from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

# Documented Supabase project host (no credentials).
SUPABASE_PROJECT_REF = "sujvxxrwjqsziswuazwm"
SUPABASE_HOST = f"{SUPABASE_PROJECT_REF}.supabase.co"


def _default_database_url() -> str:
    """Prefer explicit env; else safe local SQLite for tests/dev."""
    for key in ("NANO_SANDBOX_DATABASE_URL", "DATABASE_URL"):
        val = os.environ.get(key, "").strip()
        if val:
            # Normalize postgres:// → postgresql+psycopg:// for SQLAlchemy 2 + psycopg3
            if val.startswith("postgres://"):
                val = "postgresql+psycopg://" + val[len("postgres://") :]
            elif val.startswith("postgresql://") and "+psycopg" not in val:
                val = "postgresql+psycopg://" + val[len("postgresql://") :]
            return val
    return "sqlite:////tmp/nano-sandbox-nase-vault.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NANO_SANDBOX_", env_file=".env", extra="ignore")

    cors_allow_origins: str = "*"
    job_timeout_seconds: float = 10.0
    job_memory_limit_bytes: int = 512 * 1024 * 1024
    max_retained_jobs: int = 500

    # Resolved at settings construction from env (see _default_database_url).
    database_url: str = _default_database_url()
    database_read_url: str | None = None

    kms_seed: str = "nano-sandbox-dev-kms-seed-change-me"
    kms_provider: str = "software_tee"

    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None

    hmac_rotation_seconds: float = 3600.0
    hmac_grace_seconds: float = 300.0

    supabase_project_ref: str = SUPABASE_PROJECT_REF
    supabase_host: str = SUPABASE_HOST


def get_settings() -> Settings:
    return Settings()
