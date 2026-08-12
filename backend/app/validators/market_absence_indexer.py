"""Autonomous Market-Absence Indexer (concrete subset of the Master Blueprint engine).

Evidence classification block
-----------------------------
- Blueprint claim (TF-IDF + Euclidean distance to nearest market cluster):
  Partially Verified for a pure-Python bag-of-words + TF-IDF-like weighting
  and Euclidean distance. sklearn is not available in requirements.txt.
- "Database of known products" / millions of apps: Missing (caller must
  supply the existing_market_data list).
- Claim of mathematically proving "zero direct competition": Unknown /
  overstated; this returns a concrete distance-based absence score only.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

from app.models import ValidationReport


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


class MarketAbsenceIndexerValidator:
    id = "market-absence"
    description = (
        "Scores how far a new concept description sits from a caller-supplied "
        "list of existing market descriptions using a pure-Python TF-IDF-like "
        "vector space and Euclidean distance. Higher score = greater absence."
    )

    def __init__(self, absence_threshold: float = 1.5):
        self.absence_threshold = absence_threshold

    def payload_schema(self) -> dict[str, Any]:
        return {
            "new_blueprint_desc": "str — description of the new concept",
            "existing_market_data": "list[str] — descriptions of known products/apps",
        }

    def _tfidf_matrix(self, docs: list[list[str]]) -> tuple[list[str], list[dict[str, float]]]:
        """Return (vocab_list, list of {term: tfidf} dicts)."""
        df: Counter[str] = Counter()
        tfs: list[Counter[str]] = []
        for tokens in docs:
            c = Counter(tokens)
            tfs.append(c)
            for term in c:
                df[term] += 1
        n = len(docs) or 1
        vocab = sorted(df.keys())
        vectors: list[dict[str, float]] = []
        for c in tfs:
            total = sum(c.values()) or 1
            vec: dict[str, float] = {}
            for term, count in c.items():
                tf = count / total
                idf = math.log(n / (1 + df[term]))
                vec[term] = tf * idf
            vectors.append(vec)
        return vocab, vectors

    def _euclidean(self, a: dict[str, float], b: dict[str, float]) -> float:
        keys = set(a) | set(b)
        s = 0.0
        for k in keys:
            d = a.get(k, 0.0) - b.get(k, 0.0)
            s += d * d
        return math.sqrt(s)

    def run(self, payload: dict[str, Any], seed: int | None = None) -> ValidationReport:
        desc = payload.get("new_blueprint_desc")
        market = payload.get("existing_market_data")
        if not isinstance(desc, str) or not desc.strip():
            return ValidationReport(passed=False, error="new_blueprint_desc must be a non-empty string.")
        if not isinstance(market, list) or len(market) == 0:
            return ValidationReport(passed=False, error="existing_market_data must be a non-empty list of strings.")

        docs = [_tokenize(str(d)) for d in market]
        docs.append(_tokenize(desc))
        vocab, vectors = self._tfidf_matrix(docs)
        if not vocab:
            return ValidationReport(passed=False, error="no tokens extracted from any document.")

        new_vec = vectors[-1]
        market_vecs = vectors[:-1]
        distances = [self._euclidean(new_vec, mv) for mv in market_vecs]
        min_distance = min(distances) if distances else 0.0
        # Blueprint-style scaling
        absence_score = float(min_distance * math.log(max(len(market_vecs), 2)))

        # Higher absence is "good" for originality; pass if above threshold
        passed = absence_score >= self.absence_threshold
        findings = [
            f"absence_score={absence_score:.6f}",
            f"min_euclidean={min_distance:.6f}",
            f"market_size={len(market_vecs)}",
            f"threshold={self.absence_threshold}",
        ]
        if not passed:
            findings.append("concept sits too close to existing market cluster")

        return ValidationReport(
            passed=passed,
            score=round(absence_score, 6),
            metrics={
                "absence_score": round(absence_score, 6),
                "min_euclidean": round(min_distance, 6),
                "market_size": float(len(market_vecs)),
                "vocab_size": float(len(vocab)),
                "threshold": self.absence_threshold,
            },
            findings=findings,
            details={"nearest_index": int(distances.index(min_distance)) if distances else -1},
        )
