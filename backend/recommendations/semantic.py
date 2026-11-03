"""
OPTIONAL semantic skill-NAME resolver (off by default; enable with SEMANTIC_SKILL_MATCHING=1).

It only maps an otherwise-unrecognised skill name onto a catalogue skill. It never awards
evidence: ``role_engine.resolve_candidate`` caps any semantically-resolved skill at the
"Claimed" state, so similarity can never raise a role score above claim level for that skill.
Requires the optional `sentence-transformers` package; if it is missing the resolver is a no-op.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Callable, Optional, Tuple

from . import skill_map

logger = logging.getLogger("proofpass.semantic")
MODEL_NAME = os.getenv("SEMANTIC_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
THRESHOLD = float(os.getenv("SEMANTIC_THRESHOLD", "0.8"))  # chosen from semantic_eval (see docs)

Resolver = Callable[[str], Optional[Tuple[str, float]]]
_lock = threading.Lock()
_state = {"resolver": None, "tried": False}


def enabled() -> bool:
    return os.getenv("SEMANTIC_SKILL_MATCHING", "").strip().lower() in ("1", "true", "yes")


def _build() -> Optional[Resolver]:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        logger.warning("SEMANTIC_SKILL_MATCHING is on but sentence-transformers is not installed; using exact/alias only")
        return None
    model = SentenceTransformer(MODEL_NAME, device="cpu")
    labels, keys = [], []
    for key in skill_map.known_keys():
        names = {skill_map.display_name(key), key} | {a for a, k in skill_map._alias_index().items() if k == key}
        for n in sorted(names):
            labels.append(n)
            keys.append(key)
    matrix = model.encode(labels, normalize_embeddings=True, convert_to_numpy=True)

    def resolve(text: str) -> Optional[Tuple[str, float]]:
        v = model.encode([text], normalize_embeddings=True, convert_to_numpy=True)[0]
        sims = matrix @ v
        i = int(sims.argmax())
        return (keys[i], float(sims[i])) if sims[i] >= THRESHOLD else None

    return resolve


def get_resolver() -> Optional[Resolver]:
    """Lazily built singleton, or None when disabled / unavailable."""
    if not enabled():
        return None
    with _lock:
        if not _state["tried"]:
            _state["tried"] = True
            try:
                _state["resolver"] = _build()
            except Exception:  # model download/load failure must never break matching
                logger.exception("Semantic resolver failed to initialise; using exact/alias only")
        return _state["resolver"]
