"""Runtime configuration.

Every value has a safe default so the service boots with zero configuration
for local dev / testing. Override via environment variables in real
deployments.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NANO_SANDBOX_", env_file=".env", extra="ignore")

    # Comma-separated list of origins allowed to call this API from a browser.
    # "*" is fine for local dev; NHSE running from a real hosted origin should
    # pin this down in production.
    cors_allow_origins: str = "*"

    # Hard ceiling on how long a single sandboxed validation job may run.
    job_timeout_seconds: float = 10.0

    # Hard ceiling on memory (bytes) a sandboxed job's worker process may use.
    # Enforced via RLIMIT_AS on POSIX; best-effort only on other platforms.
    job_memory_limit_bytes: int = 512 * 1024 * 1024  # 512 MB

    # Maximum number of validation jobs kept in the in-memory job store.
    # This is intentionally NOT a database -- see app/orchestrator/jobs.py
    # for why, and what to swap in if this needs to survive restarts.
    max_retained_jobs: int = 500

    # HMAC secret for signing 25-engine attestation snapshots.
    # Override in production via NANO_SANDBOX_ATTESTATION_SECRET.
    attestation_secret: str = "nano-sandbox-dev-attestation-secret-change-me"

    # SQLite path for durable vault-sync ciphertext (server never decrypts).
    vault_db_path: str = "data/nase_vault.sqlite"


def get_settings() -> Settings:
    return Settings()
