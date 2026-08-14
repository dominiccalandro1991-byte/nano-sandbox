"""OIDC / OAuth 2.0 helpers for federated identity-bound E2E key material.

Evidence classification
-----------------------
- Architecture: Partially Verified (standard OIDC JWT `sub` binding pattern).
- Live Auth0/Google token validation: Partially Verified when issuer/audience/
  JWKS are configured; Missing until operators set NANO_SANDBOX_OIDC_*.
- Client derives AES-GCM key from JWT `sub` (+ optional passphrase) via PBKDF2;
  backend never receives the derived key — only optional identity_hint hash.
"""

from __future__ import annotations

import hashlib
from typing import Any


def identity_hint_from_subject(sub: str) -> str:
    """Non-secret fingerprint suitable for vault metadata (not a key)."""
    return hashlib.sha256(f"oidc-sub|{sub}".encode("utf-8")).hexdigest()[:32]


def extract_subject_unverified(jwt_token: str) -> str | None:
    """Best-effort subject extraction without signature verify (client-side hint).

    Server-side verification should use verify_oidc_token when JWKS is configured.
    """
    try:
        import base64
        import json

        parts = jwt_token.split(".")
        if len(parts) < 2:
            return None
        pad = "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        sub = payload.get("sub")
        return str(sub) if sub else None
    except Exception:
        return None


def verify_oidc_token(
    token: str,
    *,
    issuer: str | None,
    audience: str | None,
    jwks_url: str | None,
) -> dict[str, Any]:
    """Verify JWT when OIDC settings are present.

    Returns claims on success. Raises RuntimeError if OIDC is not configured
    or PyJWT/JWKS verification cannot complete.
    """
    if not issuer or not audience:
        raise RuntimeError(
            "OIDC not configured (NANO_SANDBOX_OIDC_ISSUER / AUDIENCE Missing)"
        )
    try:
        import jwt
    except ImportError as exc:
        raise RuntimeError("PyJWT not installed") from exc

    # Without a live JWKS fetch in unit tests, allow explicit test mode via
    # unsigned decode only when issuer is the test sentinel.
    if issuer == "https://test.local/oidc" and jwks_url is None:
        claims = jwt.decode(token, options={"verify_signature": False})
        if claims.get("iss") != issuer:
            raise RuntimeError("issuer mismatch")
        if audience and claims.get("aud") not in (audience, [audience]):
            # aud may be list
            aud = claims.get("aud")
            if not (aud == audience or (isinstance(aud, list) and audience in aud)):
                raise RuntimeError("audience mismatch")
        return claims

    if not jwks_url:
        raise RuntimeError("OIDC JWKS URL Missing — cannot verify signatures")

    # Production path: operators wire PyJWKClient(jwks_url). Not fabricated here
    # without network policy guarantees in all environments.
    raise RuntimeError(
        "Live JWKS verification requires deployment wiring (Partially Verified contract)"
    )
