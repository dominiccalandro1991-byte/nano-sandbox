"""Omniversal IP & Asset Vault (OIAV).

Evidence classification
-----------------------
- Canonical JSON serialization + SHA-256 content addressing: Partially Verified
  (hashlib; same family as NHSE CAS hashing conceptually).
- Timestamped IP package structure for filings: Partially Verified as a
  structured document object — not a filed USPTO/copyright submission.
- Merkle root over asset leaves: Partially Verified (binary tree hash).
- NASE attestation-freshness before vault seal: Partially Verified.
- Legal sufficiency of output for patents/loans: Unknown (jurisdiction-specific).
- On-device Secure Enclave timestamping: Missing (caller supplies attestation).
"""

from app.oiav.vault import build_ip_package, merkle_root

__all__ = ["build_ip_package", "merkle_root"]
