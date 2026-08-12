"""
cdem_validator.py — Content Deduplication Effectiveness Metric

Purpose (one-sentence, chosen under Partially Verified domain judgment because
the exact briefing sentence is Missing from the inspected repository):
Compute the ratio of aggregate logical (ref-counted) bytes to physical stored
bytes for a collection of blob records and flag stores whose efficiency falls
below a concrete threshold.

Evidence classification block
-----------------------------
- Purpose sentence text: Missing (not present in live clone or Master Instructions)
- BaseValidator interface: Missing (no backend/ or BaseValidator observed)
- Deduplication ratio formula: Partially Verified (standard CAS metric:
  logical = sum(rawSize * refs), physical = sum(storedSize); ratio = physical / logical)
- Threshold value 0.85: Unknown (chosen as a concrete operating point; no golden
  baseline present in the repository)
- BlobRecord schema: Partially Verified (mirrors lib/nhse/types.ts BlobRecord fields
  observed in the clone)
"""

from __future__ import annotations

from typing import Any, Dict, List


class CDEMValidator:
    """Concrete Content Deduplication Effectiveness Metric engine."""

    name = "cdem"
    version = "1.0.0"
    # Concrete operating threshold (Unknown provenance relative to briefing)
    EFFICIENCY_FLOOR = 0.85

    def validate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Accepts {"blobs": [{"rawSize": int, "storedSize": int, "refs": int}, ...]}
        or a flat list of the same dicts.
        Returns a concrete numeric result; never a stub.
        """
        if isinstance(payload, list):
            blobs = payload
        elif isinstance(payload, dict):
            blobs = payload.get("blobs") or payload.get("records") or []
        else:
            return {
                "ok": False,
                "engine": self.name,
                "score": 0.0,
                "logical_bytes": 0,
                "physical_bytes": 0,
                "efficiency": 0.0,
                "detail": "payload must be dict or list of blob records",
            }

        logical = 0
        physical = 0
        count = 0
        for b in blobs:
            if not isinstance(b, dict):
                continue
            raw = int(b.get("rawSize") or b.get("raw_size") or 0)
            stored = int(b.get("storedSize") or b.get("stored_size") or 0)
            refs = max(1, int(b.get("refs") or 1))
            logical += raw * refs
            physical += stored
            count += 1

        if logical <= 0:
            efficiency = 1.0 if physical == 0 else 0.0
        else:
            efficiency = physical / logical

        ok = efficiency <= 1.0 and (efficiency >= self.EFFICIENCY_FLOOR or physical == 0)
        # score is inverted efficiency for "goodness" (lower physical better)
        score = round(max(0.0, min(1.0, 1.0 - (efficiency - self.EFFICIENCY_FLOOR))), 4) if logical else 1.0

        return {
            "ok": bool(ok),
            "engine": self.name,
            "score": score,
            "logical_bytes": logical,
            "physical_bytes": physical,
            "efficiency": round(efficiency, 6),
            "blob_count": count,
            "floor": self.EFFICIENCY_FLOOR,
            "detail": f"efficiency={efficiency:.4f} (floor={self.EFFICIENCY_FLOOR})",
        }


def get_validator() -> CDEMValidator:
    return CDEMValidator()
