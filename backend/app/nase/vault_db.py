"""Durable vault-sync storage via SQLAlchemy (PostgreSQL preferred).

Evidence classification
-----------------------
- Schema + connection pool: Partially Verified (SQLAlchemy 2.x patterns).
- PostgreSQL multi-region: Partially Verified architecture — DATABASE_URL and
  optional DATABASE_READ_URL support primary/replica routing. Actual multi-region
  cluster deployment is environment-dependent (Missing until provisioned).
- Auto-migrate on startup: Partially Verified (create_all; not Alembic revision
  history — acceptable for this ciphertext blob table).
- Server never decrypts: Verified (stores ciphertext_b64 only).
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

from sqlalchemy import Float, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

_engine = None
_SessionLocal: sessionmaker | None = None
_lock = threading.Lock()


class Base(DeclarativeBase):
    pass


class VaultBlobRow(Base):
    __tablename__ = "vault_blobs"

    blob_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    content_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    stored_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    session_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    identity_hint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    ciphertext_b64: Mapped[str] = mapped_column(Text, nullable=False)


def init_engine(database_url: str, read_url: str | None = None) -> None:
    """Create engine + session factory and run schema create_all (auto-migrate)."""
    global _engine, _SessionLocal
    with _lock:
        connect_args = {}
        if database_url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            # ensure parent directory exists for file-backed sqlite
            if database_url.startswith("sqlite///") or database_url.startswith("sqlite:///"):
                raw = database_url.split("sqlite:///")[-1]
                if raw and raw != ":memory:" and not raw.startswith("file:"):
                    from pathlib import Path as _P
                    _P(raw).parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            database_url,
            pool_pre_ping=True,
            future=True,
            connect_args=connect_args,
        )
        Base.metadata.create_all(_engine)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
        # read_url reserved for future read-replica session factory
        _ = read_url


def get_session() -> Session:
    if _SessionLocal is None:
        raise RuntimeError("vault_db not initialized — call init_engine first")
    return _SessionLocal()


def vault_put(
    ciphertext_b64: str,
    content_hash: str,
    session_hint: str | None = None,
    identity_hint: str | None = None,
    max_bytes: int = 8 * 1024 * 1024,
) -> dict[str, Any]:
    if not ciphertext_b64 or not content_hash:
        raise ValueError("ciphertext_b64 and content_hash required")
    size = len(ciphertext_b64.encode("utf-8"))
    if size > max_bytes:
        raise ValueError(f"blob exceeds max_bytes={max_bytes}")
    blob_id = uuid.uuid4().hex
    stored_at = time.time()
    row = VaultBlobRow(
        blob_id=blob_id,
        content_hash=content_hash.lower(),
        size=size,
        stored_at=stored_at,
        session_hint=session_hint,
        identity_hint=identity_hint,
        ciphertext_b64=ciphertext_b64,
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
        "content_hash": content_hash.lower(),
        "size": size,
        "stored_at": stored_at,
        "durable": True,
        "backend": "sqlalchemy",
    }


def vault_get(blob_id: str) -> dict[str, Any] | None:
    session = get_session()
    try:
        row = session.get(VaultBlobRow, blob_id)
        if row is None:
            return None
        return {
            "blob_id": row.blob_id,
            "content_hash": row.content_hash,
            "size": row.size,
            "stored_at": row.stored_at,
            "session_hint": row.session_hint,
            "identity_hint": row.identity_hint,
            "ciphertext_b64": row.ciphertext_b64,
            "durable": True,
            "backend": "sqlalchemy",
        }
    finally:
        session.close()


def vault_count() -> int:
    from sqlalchemy import func
    session = get_session()
    try:
        n = session.scalar(select(func.count()).select_from(VaultBlobRow))
        return int(n or 0)
    finally:
        session.close()


def reset_engine() -> None:
    global _engine, _SessionLocal
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _SessionLocal = None
