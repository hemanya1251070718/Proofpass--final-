"""Centralised configuration for the recommendations package (env-driven, backend only)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_COURSE_CSV = REPO_ROOT / "backend" / "data" / "CourseraDataset-Clean.csv"


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def github_token() -> Optional[str]:
    """Optional GitHub token. Read at call time; never sent to the frontend."""
    tok = (os.getenv("GITHUB_TOKEN") or "").strip()
    return tok or None


GITHUB_API_BASE = os.getenv("GITHUB_API_BASE", "https://api.github.com")
GITHUB_CACHE_TTL_SECONDS = _int("GITHUB_CACHE_TTL_SECONDS", 6 * 3600)
GITHUB_TIMEOUT_SECONDS = _int("GITHUB_TIMEOUT_SECONDS", 8)
GITHUB_MAX_PER_PAGE = 30

# Part 3 evidence weights (separate from the verification engine's 1.0/0.6/0.2/0.0).
ROLE_EVIDENCE_WEIGHTS = {"Verified": 1.00, "Supported": 0.70, "Claimed": 0.35, "Contradicted": 0.00}
ROLE_TIER_WEIGHTS = {"core": 3.0, "important": 2.0, "nice": 1.0}
