"""Omniversal IP & Asset Vault validator (Engine 24).

Evidence classification block
-----------------------------
- SHA-256 package + Merkle root over asset leaves: Partially Verified.
- Timestamped documentation object for IP workflows: Partially Verified
  as structured output — not a legal filing.
- NASE attestation-freshness before seal: Partially Verified.
- Government/loan acceptance of package: Missing / Unknown.
"""

from __future__ import annotations

import time
from typing import Any

from app.models import ValidationReport
from app.nase.invariants import DEFAULT_DELTA_SECONDS, check_attestation_freshness
from app.oiav.vault import build_ip_package


class OIAVValidator:
    id = "oiav-vault"
    description = (
        "Omniversal IP & Asset Vault: compiles habitat assets into a timestamped, "
        "content-addressed documentation package with Merkle root. Sealing requires "
        "fresh NASE attestation. Does not file patents or copyrights."
    )

    def payload_schema(self) -> dict[str, Any]:
        return {
            "attestation_timestamp": "float — required (NASE freshness)",
            "delta_seconds": "float",
            "now": "float?",
            "title": "str",
            "asset_type": "app|hardware|music|business|mixed",
            "notes": "str",
            "assets": "list[{name, kind, content}]",
            "sealed_at": "float? — defaults to now",
        }

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        now = float(payload["now"]) if payload.get("now") is not None else time.time()
        delta = float(payload.get("delta_seconds", DEFAULT_DELTA_SECONDS))
        att_ok, att_reason = check_attestation_freshness(
            payload.get("attestation_timestamp"), now, delta
        )
        if not att_ok:
            return ValidationReport(
                passed=False,
                error=f"NASE attestation-freshness failed: {att_reason}",
                findings=[att_reason],
            )

        assets = payload.get("assets")
        if not isinstance(assets, list) or len(assets) == 0:
            return ValidationReport(
                passed=False,
                error="assets must be a non-empty list of IP items.",
            )

        sealed_at = float(payload["sealed_at"]) if payload.get("sealed_at") is not None else now
        pkg = build_ip_package(payload, sealed_at)

        findings = [
            att_reason,
            f"title={pkg['package']['title']}",
            f"asset_type={pkg['package']['asset_type']}",
            f"leaf_count={pkg['leaf_count']}",
            f"package_hash={pkg['package_hash'][:16]}…",
            f"merkle_root={pkg['merkle_root'][:16]}…",
            f"sealed_at={sealed_at}",
        ]
        return ValidationReport(
            passed=True,
            score=1.0,
            metrics={
                "leaf_count": float(pkg["leaf_count"]),
                "canonical_bytes": float(pkg["canonical_bytes"]),
                "attestation_ok": 1.0,
                "sealed_at": sealed_at,
            },
            findings=findings,
            details={
                "package_hash": pkg["package_hash"],
                "merkle_root": pkg["merkle_root"],
                "package": pkg["package"],
                "nase": att_reason,
            },
        )
