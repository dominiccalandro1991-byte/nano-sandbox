"""NanoNative Autonomous Chat Core (NNACC).

Evidence classification
-----------------------
- Conversational tool-routing over a fixed engine registry: Partially Verified
  (deterministic intent patterns; not an LLM weights file).
- Message content-addressing (SHA-256 leaves + session Merkle root): Partially Verified.
- NASE attestation-freshness before tool emission: Partially Verified
  (reuses app.nase.invariants).
- NADRE health gate on memory/exception signals: Partially Verified
  (snapshot predicates; no live iOS Jetsam loop here).
- Claim of matching frontier models (Claude/ChatGPT/Grok/Gemini) in open-ended
  language quality: Missing — this formal core is the orchestration + safety
  boundary a frontier (or on-device) model would call through.
"""

from app.nnacc.orchestrator import ChatOrchestrator, ChatTurnResult
from app.nnacc.session import hash_message, session_merkle

__all__ = [
    "ChatOrchestrator",
    "ChatTurnResult",
    "hash_message",
    "session_merkle",
]
