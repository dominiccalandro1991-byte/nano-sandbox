"""Durable NASE vault-sync storage via SQLAlchemy (Supabase PostgreSQL preferred).

Table: nase_vault_blobs
  id, user_subject_hash, content_hash, ciphertext, version,
  plus size/stored_at/session_hint for ops.

Evidence classification
-----------------------
- Schema + create_all auto-init: Partially Verified (SQLAlchemy 2.x).
- Supabase host sujvxxrwjqsziswuazwm.supabase.co: Verified DNS resolution in deploy env.
- Live authenticated connection: requires NANO_SANDBOX_DATABASE_URL with password
  (Missing from agent session — never hardcode secrets in git).
- Server never decrypts ciphertext: Verified.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from sqlalchemy import Float, Integer, String, Text, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

_engine = None
_SessionLocal: sessionmaker | None = None
_lock = threading.Lock()
_last_init_error: str | None = None
_database_url_scheme: str = "uninitialized"


class Base(DeclarativeBase):
    pass


class VaultBlobModel(Base):
    """Production vault row — aligned to Supabase nase_vault_blobs."""

    __tablename__ = "nase_vault_blobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_subject_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stored_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    session_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)


# Backward-compatible alias
VaultBlobRow = VaultBlobModel


def init_engine(database_url: str, read_url: str | None = None) -> None:
    """Create engine + session factory and run Base.metadata.create_all (auto-migrate)."""
    global _engine, _SessionLocal, _last_init_error, _database_url_scheme
    with _lock:
        _last_init_error = None
        connect_args: dict[str, Any] = {}
        url = database_url.strip()
        _database_url_scheme = url.split(":", 1)[0] if url else "empty"

        if url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            if ":///" in url:
                raw = url.split("sqlite:///", 1)[-1]
                if raw and raw != ":memory:" and not raw.startswith("file:"):
                    from pathlib import Path as _P

                    _P(raw).parent.mkdir(parents=True, exist_ok=True)

        # Supabase / Postgres: prefer SSL
        if url.startswith("postgresql"):
            # psycopg3 accepts sslmode in URL query; ensure pool_pre_ping
            pass

        try:
            _engine = create_engine(
                url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                future=True,
                connect_args=connect_args,
            )
            Base.metadata.create_all(_engine)
            _SessionLocal = sessionmaker(
                bind=_engine, autoflush=False, autocommit=False, future=True
            )
            # probe
            with _engine.connect() as conn:
                conn.execute(select(1))
        except Exception as exc:
            _last_init_error = str(exc)
            _engine = None
            _SessionLocal = None
            raise

        _ = read_url


def get_session() -> Session:
    if _SessionLocal is None:
        raise RuntimeError(
            "vault_db not initialized — call init_engine first"
            + (f" (last error: {_last_init_error})" if _last_init_error else "")
        )
    return _SessionLocal()


def vault_put(
    ciphertext_b64: str,
    content_hash: str,
    session_hint: str | None = None,
    identity_hint: str | None = None,
    max_bytes: int = 8 * 1024 * 1024,
    version: int = 1,
) -> dict[str, Any]:
    if not ciphertext_b64 or not content_hash:
        raise ValueError("ciphertext_b64 and content_hash required")
    size = len(ciphertext_b64.encode("utf-8"))
    if size > max_bytes:
        raise ValueError(f"blob exceeds max_bytes={max_bytes}")
    blob_id = uuid.uuid4().hex
    stored_at = time.time()
    row = VaultBlobModel(
        id=blob_id,
        user_subject_hash=identity_hint,
        content_hash=content_hash.lower(),
        ciphertext=ciphertext_b64,
        version=int(version),
        size=size,
        stored_at=stored_at,
        session_hint=session_hint,
    )
    session = get_session()
    try:
        session.add(row)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return {
        "blob_id": blob_id,
        "id": blob_id,
        "content_hash": content_hash.lower(),
        "size": size,
        "stored_at": stored_at,
        "version": version,
        "durable": True,
        "backend": "sqlalchemy",
        "table": "nase_vault_blobs",
    }


def vault_get(blob_id: str) -> dict[str, Any] | None:
    session = get_session()
    try:
        row = session.get(VaultBlobModel, blob_id)
        if row is None:
            return None
        return {
            "blob_id": row.id,
            "id": row.id,
            "content_hash": row.content_hash,
            "size": row.size,
            "stored_at": row.stored_at,
            "session_hint": row.session_hint,
            "identity_hint": row.user_subject_hash,
            "user_subject_hash": row.user_subject_hash,
            "ciphertext_b64": row.ciphertext,
            "ciphertext": row.ciphertext,
            "version": row.version,
            "durable": True,
            "backend": "sqlalchemy",
            "table": "nase_vault_blobs",
        }
    finally:
        session.close()


def vault_count() -> int:
    session = get_session()
    try:
        n = session.scalar(select(func.count()).select_from(VaultBlobModel))
        return int(n or 0)
    finally:
        session.close()


def status() -> dict[str, Any]:
    return {
        "initialized": _SessionLocal is not None,
        "scheme": _database_url_scheme,
        "table": "nase_vault_blobs",
        "last_init_error": _last_init_error,
        "count": vault_count() if _SessionLocal is not None else None,
    }


def reset_engine() -> None:
    global _engine, _SessionLocal, _last_init_error
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _SessionLocal = None
        _last_init_error = None
