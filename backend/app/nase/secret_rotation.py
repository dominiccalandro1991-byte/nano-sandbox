"""Dynamic HMAC secret rotation with dual-key grace window.

Evidence classification
-----------------------
- Rotation + grace validation: Partially Verified (in-process; survives only
  while the process runs unless seeds are externalized).
- Removes reliance on a single static attestation_secret string for signing
  after bootstrap: active key cycles on an interval.
- Cloud-managed secret stores (AWS Secrets Manager, etc.): Missing — seed
  still comes from Settings.kms_seed / env unless operators rotate externally.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class SecretVersion:
    version_id: str
    material: bytes
    activated_at: float
    retired_at: float | None = None


class RotatingHmacSecret:
    def __init__(
        self,
        seed: str,
        rotation_seconds: float = 3600.0,
        grace_seconds: float = 300.0,
    ) -> None:
        self._rotation = max(30.0, float(rotation_seconds))
        self._grace = max(5.0, float(grace_seconds))
        self._lock = threading.Lock()
        self._versions: list[SecretVersion] = []
        # Bootstrap first version from seed material (not used as the live secret itself)
        bootstrap = hashlib.sha256(f"bootstrap|{seed}".encode()).digest()
        self._versions.append(
            SecretVersion(
                version_id=secrets.token_hex(8),
                material=bootstrap,
                activated_at=time.time(),
            )
        )
        self._last_rotation = time.time()

    def _maybe_rotate_locked(self, now: float) -> None:
        if now - self._last_rotation < self._rotation:
            return
        new_mat = secrets.token_bytes(32)
        # retire previous current
        if self._versions:
            cur = self._versions[-1]
            self._versions[-1] = SecretVersion(
                version_id=cur.version_id,
                material=cur.material,
                activated_at=cur.activated_at,
                retired_at=now,
            )
        self._versions.append(
            SecretVersion(
                version_id=secrets.token_hex(8),
                material=new_mat,
                activated_at=now,
            )
        )
        self._last_rotation = now
        # prune versions outside grace
        alive: list[SecretVersion] = []
        for v in self._versions:
            if v.retired_at is None or (now - v.retired_at) <= self._grace:
                alive.append(v)
        self._versions = alive[-8:]  # hard cap

    def current(self) -> SecretVersion:
        with self._lock:
            self._maybe_rotate_locked(time.time())
            return self._versions[-1]

    def active_versions(self) -> list[SecretVersion]:
        with self._lock:
            now = time.time()
            self._maybe_rotate_locked(now)
            out: list[SecretVersion] = []
            for v in self._versions:
                if v.retired_at is None or (now - v.retired_at) <= self._grace:
                    out.append(v)
            return out

    def force_rotate(self) -> SecretVersion:
        with self._lock:
            self._last_rotation = 0.0
            self._maybe_rotate_locked(time.time())
            return self._versions[-1]

    def sign(self, payload: bytes) -> tuple[str, str]:
        """Return (signature_hex, version_id) using current secret."""
        ver = self.current()
        sig = hmac.new(ver.material, payload, hashlib.sha256).hexdigest()
        return sig, ver.version_id

    def verify(self, payload: bytes, signature: str, version_id: str | None = None) -> bool:
        """Validate against current or grace-window secrets."""
        versions = self.active_versions()
        if version_id:
            versions = [v for v in versions if v.version_id == version_id] or versions
        for v in versions:
            expected = hmac.new(v.material, payload, hashlib.sha256).hexdigest()
            if hmac.compare_digest(expected, signature):
                return True
        return False


_rotator: RotatingHmacSecret | None = None
_rot_lock = threading.Lock()


def get_rotator(seed: str, rotation_seconds: float = 3600.0, grace_seconds: float = 300.0) -> RotatingHmacSecret:
    global _rotator
    with _rot_lock:
        if _rotator is None:
            _rotator = RotatingHmacSecret(seed, rotation_seconds, grace_seconds)
        return _rotator


def reset_rotator() -> None:
    global _rotator
    with _rot_lock:
        _rotator = None
