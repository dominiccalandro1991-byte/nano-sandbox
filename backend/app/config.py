"""Runtime configuration.

Evidence: settings are Partially Verified operational knobs. Cloud KMS ARNs,
multi-region Postgres clusters, and live OIDC client secrets are supplied by
the deployment environment (Missing until configured).
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NANO_SANDBOX_", env_file=".env", extra="ignore")

    cors_allow_origins: str = "*"
    job_timeout_seconds: float = 10.0
    job_memory_limit_bytes: int = 512 * 1024 * 1024
    max_retained_jobs: int = 500

    # Primary DB URL. Prefer PostgreSQL in production, e.g.:
    #   postgresql+psycopg://user:pass@host:5432/nase
    # Tests default to SQLite so CI needs no external cluster.
    database_url: str = "sqlite:////tmp/nano-sandbox-nase-vault.db"

    # Optional read-replica URL for multi-region read path (Partially Verified architecture).
    database_read_url: str | None = None

    # Seed material for Software TEE / rotation manager when cloud KMS is not configured.
    # Production should set NANO_SANDBOX_KMS_SEED or wire CloudKMSProvider.
    kms_seed: str = "nano-sandbox-dev-kms-seed-change-me"
    kms_provider: str = "software_tee"  # software_tee | cloud_kms_stub

    # OIDC (federated identity) — optional; client may present JWT for key derivation.
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None

    # HMAC rotation interval seconds (dynamic secret management)
    hmac_rotation_seconds: float = 3600.0
    hmac_grace_seconds: float = 300.0


def get_settings() -> Settings:
    return Settings()
