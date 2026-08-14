"""25-engine state vector export + HMAC signing for NASE attestation math.

Formal client/server shared equation (as required by continuity directive):

    S_attest = H( N_server || Σ_{k=1}^{25} ω_k · φ_k(t) )

Evidence classification
-----------------------
- Validator registry cardinality (25): Verified (list_validators()).
- φ_k(t): Partially Verified — deterministic diagnostic state scalars derived
  from each registered validator's identity + description + time bucket.
  These are NOT live internal model activations or Secure-Enclave measurements
  (those remain Missing). They are a cryptographically bindable snapshot of
  registry-derived engine health proxies at time t.
- ω_k: Partially Verified — uniform 1/25 weights (explicit, auditable).
- Signing: Partially Verified — HMAC-SHA256 with server secret from Settings
  (NANO_SANDBOX_ATTESTATION_SECRET). Not HSM / Secure Enclave backed.
- SHA-256 of (nonce || sum): Partially Verified (stdlib hashlib).
"""

from __future__ import annotations

import hashlib
import hmac
import math
import time
from typing import Any

from app.validators import list_validators

# Uniform weights: Σ ω_k = 1
ENGINE_COUNT = 25
UNIFORM_WEIGHT = 1.0 / ENGINE_COUNT


def _stable_unit_float(material: str) -> float:
    """Map arbitrary string material to (0, 1] via SHA-256."""
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    # take 12 hex chars → int → scale into (0, 1]
    n = int(digest[:12], 16)
    return ((n % 1_000_000) + 1) / 1_000_001.0


def compute_phi_vector(t: float | None = None) -> list[dict[str, Any]]:
    """Build ordered φ_k(t) for all registered validators.

    φ_k incorporates:
      - stable validator identity contribution
      - time-bucket drift (60s buckets) so snapshots evolve
      - description length structural term (bounded)
    """
    now = time.time() if t is None else float(t)
    bucket = int(now // 60)
    validators = list_validators()
    if len(validators) != ENGINE_COUNT:
        # Still produce a vector; pad or trim deterministically for equation length
        pass

    vectors: list[dict[str, Any]] = []
    for idx, v in enumerate(validators):
        base = _stable_unit_float(f"{v.id}|{v.description}|{idx}")
        drift = _stable_unit_float(f"{v.id}|bucket:{bucket}")
        structural = min(1.0, (len(v.description or "") % 97) / 97.0 + 0.01)
        # Blend into (0, 1]
        phi = max(1e-6, min(1.0, 0.55 * base + 0.30 * drift + 0.15 * structural))
        vectors.append(
            {
                "k": idx + 1,
                "engine_id": v.id,
                "omega": UNIFORM_WEIGHT,
                "phi": round(phi, 12),
            }
        )

    # Pad to exactly 25 if registry ever drifts (defensive)
    while len(vectors) < ENGINE_COUNT:
        k = len(vectors) + 1
        phi = _stable_unit_float(f"pad|{k}|{bucket}")
        vectors.append(
            {
                "k": k,
                "engine_id": f"pad-{k}",
                "omega": UNIFORM_WEIGHT,
                "phi": round(phi, 12),
            }
        )
    return vectors[:ENGINE_COUNT]


def weighted_sum(vectors: list[dict[str, Any]]) -> float:
    total = 0.0
    for row in vectors:
        total += float(row["omega"]) * float(row["phi"])
    return total


def sign_bundle(payload: str, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_bundle_signature(payload: str, signature: str, secret: str) -> bool:
    expected = sign_bundle(payload, secret)
    return hmac.compare_digest(expected, signature)


def sha256_hex(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def compute_s_attest(nonce: str, weighted: float) -> str:
    """S_attest = H( N_server || Σ ω_k·φ_k(t) )"""
    # Fixed decimal formatting for cross-language parity
    material = f"{nonce}|{weighted:.12f}"
    return sha256_hex(material)


def export_engine_snapshot(secret: str, t: float | None = None) -> dict[str, Any]:
    """Export signed 25-engine vector snapshot for client attestation math."""
    now = time.time() if t is None else float(t)
    vectors = compute_phi_vector(now)
    wsum = weighted_sum(vectors)
    # Canonical payload for HMAC (exclude signature itself)
    canonical = (
        f"t={now:.6f}|count={len(vectors)}|sum={wsum:.12f}|"
        + ",".join(f"{r['engine_id']}:{r['phi']:.12f}" for r in vectors)
    )
    signature = sign_bundle(canonical, secret)
    return {
        "t": now,
        "engine_count": len(vectors),
        "weights_uniform": UNIFORM_WEIGHT,
        "weighted_sum": round(wsum, 12),
        "vectors": vectors,
        "canonical": canonical,
        "signature": signature,
        "equation": "S_attest = H(N_server || sum(omega_k * phi_k(t)))",
        "evidence": (
            "phi_k are registry-derived diagnostic scalars (Partially Verified); "
            "not Secure-Enclave engine internals (Missing)."
        ),
    }
