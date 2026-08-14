"""25-Engine cryptographic attestation + 5 macro-engine orchestrator.

Maps the five macro groups (research, inventor, coder, deploy, chat) onto the
verified 25-validator registry and reuses engine_vectors / compute_s_attest.

Evidence classification
-----------------------
- 25 validators / ω_k = 1/25: Verified (list_validators + UNIFORM_WEIGHT).
- S_attest = H(N_server || Σ ω_k·φ_k(t)): Partially Verified via
  app.nase.engine_vectors.compute_s_attest (same equation as live /nase path).
- Macro task execution: Partially Verified orchestration wrapper — dispatches
  structured results and attestation; does not claim live patent offices,
  App Store submission, or autonomous hardware fabrication.
- Inventor utility mass band (300–500 lb): Partially Verified as a pure
  validation constraint on payload metadata only.
- Chat vault binding: Partially Verified metadata link to nase_vault_blobs
  (ciphertext remains client-side; server never decrypts).
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

from pydantic import BaseModel, Field

from app.nase.engine_vectors import (
    ENGINE_COUNT,
    UNIFORM_WEIGHT,
    compute_phi_vector,
    compute_s_attest,
    weighted_sum,
)
from app.validators import list_validators

# Macro groups → ordered slices of the 25 registry engines (phi index 1..25)
MACRO_GROUPS: dict[str, list[int]] = {
    "research": list(range(1, 6)),
    "inventor": list(range(6, 11)),
    "coder": list(range(11, 16)),
    "deploy": list(range(16, 21)),
    "chat": list(range(21, 26)),
}

MACRO_ROLES: dict[str, str] = {
    "research": (
        "Multi-source research, patent-style validation, and credential checks "
        "(orchestration surface; external office APIs Missing unless configured)."
    ),
    "inventor": (
        "Friction detection and utility-product engineering constraints "
        "(utility payload mass band 300–500 lb enforced on metadata)."
    ),
    "coder": (
        "Full-stack multi-file generation orchestration, AST/pytest loop hooks "
        "(actual codegen still delegated to host tools)."
    ),
    "deploy": (
        "Deployment target formatting for iOS, Android, GitHub Pages, and Vercel "
        "(artifact packaging metadata; live store credentials Missing)."
    ),
    "chat": (
        "Grounded chat core bound to Supabase nase_vault_blobs via client "
        "AES-GCM-256; server stores ciphertext only (zero-knowledge relative to plaintext)."
    ),
}

INVENTOR_MASS_MIN_LB = 300.0
INVENTOR_MASS_MAX_LB = 500.0


class EngineState(BaseModel):
    engine_id: int
    engine_registry_id: str
    macro_group: str
    status: str = "active"
    last_execution_ms: float = 0.0
    telemetry_hash: str = ""
    phi: float = 0.0
    omega: float = UNIFORM_WEIGHT


class AttestationPipeline:
    """Builds S_attest from live registry φ vectors + server nonce."""

    def __init__(self) -> None:
        self.engines: list[EngineState] = []
        self._rebuild_engines()

    def _rebuild_engines(self) -> None:
        validators = list_validators()
        vectors = compute_phi_vector()
        by_k = {int(v["k"]): v for v in vectors}
        self.engines = []
        for group, ids in MACRO_GROUPS.items():
            for eid in ids:
                reg = validators[eid - 1] if 0 < eid <= len(validators) else None
                row = by_k.get(eid, {"phi": 0.0, "omega": UNIFORM_WEIGHT})
                self.engines.append(
                    EngineState(
                        engine_id=eid,
                        engine_registry_id=reg.id if reg else f"pad-{eid}",
                        macro_group=group,
                        phi=float(row.get("phi", 0.0)),
                        omega=float(row.get("omega", UNIFORM_WEIGHT)),
                    )
                )

    def refresh(self) -> None:
        self._rebuild_engines()

    def compute_attestation(
        self,
        server_nonce: str,
        runtime_signals: list[float] | None = None,
    ) -> dict[str, Any]:
        """S_attest = H(N_server || sum(omega_k * phi_k))."""
        self.refresh()
        if runtime_signals is not None and len(runtime_signals) == ENGINE_COUNT:
            # Blend runtime signals into phi for this attestation only
            vectors = []
            for i, eng in enumerate(self.engines):
                phi = max(1e-6, min(1.0, 0.7 * eng.phi + 0.3 * float(runtime_signals[i])))
                vectors.append({"omega": eng.omega, "phi": phi})
            wsum = weighted_sum(vectors)
        else:
            vectors = [{"omega": e.omega, "phi": e.phi} for e in self.engines]
            wsum = weighted_sum(vectors)
        s_attest = compute_s_attest(server_nonce, wsum)
        return {
            "s_attest": s_attest,
            "weighted_sum": round(wsum, 12),
            "omega": UNIFORM_WEIGHT,
            "engine_count": ENGINE_COUNT,
            "equation": "S_attest = H(N_server || sum(omega_k * phi_k(t)))",
            "nonce": server_nonce,
        }


class MacroEngineRegistry:
    def __init__(self) -> None:
        self.pipeline = AttestationPipeline()

    def list_macros(self) -> list[dict[str, Any]]:
        out = []
        for name, ids in MACRO_GROUPS.items():
            out.append(
                {
                    "macro": name,
                    "role": MACRO_ROLES.get(name, ""),
                    "engine_ids": ids,
                    "engine_registry_ids": [
                        e.engine_registry_id
                        for e in self.pipeline.engines
                        if e.engine_id in ids
                    ],
                }
            )
        return out

    def list_engines(self) -> list[dict[str, Any]]:
        self.pipeline.refresh()
        return [e.model_dump() for e in self.pipeline.engines]

    def _validate_inventor_payload(self, payload: dict[str, Any]) -> list[str]:
        findings: list[str] = []
        mass = payload.get("utility_mass_lb")
        if mass is None:
            findings.append("inventor: utility_mass_lb missing — constraint not evaluated")
            return findings
        try:
            m = float(mass)
        except (TypeError, ValueError):
            findings.append("inventor: utility_mass_lb not numeric")
            return findings
        if m < INVENTOR_MASS_MIN_LB or m > INVENTOR_MASS_MAX_LB:
            findings.append(
                f"inventor: utility_mass_lb={m} outside [{INVENTOR_MASS_MIN_LB}, {INVENTOR_MASS_MAX_LB}] lb"
            )
        else:
            findings.append(f"inventor: utility_mass_lb={m} within utility band")
        return findings

    def execute_macro_task(
        self,
        macro_name: str,
        payload: dict[str, Any] | None = None,
        server_nonce: str | None = None,
    ) -> dict[str, Any]:
        payload = payload or {}
        macro = macro_name.strip().lower()
        if macro not in MACRO_GROUPS:
            return {
                "macro_engine": macro_name,
                "status": "error",
                "error": f"unknown macro '{macro_name}'; expected one of {list(MACRO_GROUPS)}",
            }

        start = time.time()
        findings: list[str] = []
        if macro == "inventor":
            findings.extend(self._validate_inventor_payload(payload))

        # Deterministic runtime signals from payload + macro (not random noise)
        base = hashlib.sha256(
            f"{macro}|{sorted(payload.items())}".encode("utf-8", errors="replace")
        ).hexdigest()
        signals = [
            (int(base[i : i + 2], 16) % 100 + 1) / 101.0 for i in range(0, 50, 2)
        ]
        while len(signals) < 25:
            signals.append(1.0)
        signals = signals[:25]

        nonce = server_nonce or hashlib.sha256(
            f"macro|{macro}|{time.time():.3f}".encode()
        ).hexdigest()[:32]
        att = self.pipeline.compute_attestation(nonce, signals)

        # Mark involved engines
        involved = MACRO_GROUPS[macro]
        for eng in self.pipeline.engines:
            if eng.engine_id in involved:
                eng.last_execution_ms = (time.time() - start) * 1000.0
                eng.telemetry_hash = hashlib.sha256(
                    f"{eng.engine_registry_id}|{att['s_attest']}".encode()
                ).hexdigest()[:16]
                eng.status = "active"

        elapsed = (time.time() - start) * 1000.0
        ok = not any("outside" in f or "not numeric" in f for f in findings)

        result_body: dict[str, Any] = {
            "role": MACRO_ROLES[macro],
            "findings": findings,
            "payload_keys": sorted(payload.keys()),
        }
        if macro == "chat":
            result_body["vault_binding"] = {
                "table": "nase_vault_blobs",
                "mode": "ciphertext-only",
                "note": "Server never decrypts; client AES-GCM-256 zero-knowledge relative to plaintext.",
            }
        if macro == "deploy":
            result_body["targets"] = ["ios", "android", "github-pages", "vercel"]

        return {
            "macro_engine": macro,
            "status": "success" if ok else "failed",
            "attestation_signature": att["s_attest"],
            "attestation": att,
            "engines_involved": involved,
            "engine_registry_ids": [
                e.engine_registry_id
                for e in self.pipeline.engines
                if e.engine_id in involved
            ],
            "execution_ms": round(elapsed, 2),
            "result": result_body,
        }


# Process-global registry for FastAPI injection
engine_registry = MacroEngineRegistry()
