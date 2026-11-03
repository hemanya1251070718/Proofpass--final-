"""Skill-based course retrieval and ranking from the imported SQLite catalogue."""
from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from . import skill_map
from .models import Course, CourseSkill

PRIOR_RATING = 3.8      # mean rating prior for Bayesian smoothing
PRIOR_WEIGHT = 50       # equivalent number of reviews carried by the prior
MIN_RELEVANCE = 0.5      # weaker links (outcomes-only mentions) are stored but never recommended
LOW_REVIEW_FLOOR = 25
UNRATED_RATING_CONF = 0.25  # rating confidence assigned to unrated courses
LEVEL_ORDER = {"Beginner": 0, "Intermediate": 1, "Advanced": 2}

# Evidence state of the candidate's skill -> preferred course level.
STATE_TO_LEVEL = {None: "Beginner", "C": "Beginner", "X": "Beginner", "S": "Intermediate", "V": "Advanced"}


def level_fit(course_level: Optional[str], target: str) -> float:
    if course_level is None:
        return 0.5
    d = abs(LEVEL_ORDER[course_level] - LEVEL_ORDER[target])
    return {0: 1.0, 1: 0.6}.get(d, 0.25)


def rating_confidence(rating: Optional[float], reviews: int) -> float:
    """Bayesian-smoothed rating scaled to 0..1; unrated courses get a flat low value."""
    if rating is None:
        return UNRATED_RATING_CONF
    smoothed = (rating * reviews + PRIOR_RATING * PRIOR_WEIGHT) / (reviews + PRIOR_WEIGHT)
    return max(0.0, min(1.0, (smoothed - 3.0) / 2.0))


def review_confidence(reviews: int) -> float:
    return max(0.0, min(1.0, math.log1p(max(reviews, 0)) / math.log1p(20000)))


def score_course(strength: float, level: Optional[str], rating: Optional[float], reviews: int, target_level: str) -> Dict[str, float]:
    parts = {
        "relevance": strength,
        "level_fit": level_fit(level, target_level),
        "rating": rating_confidence(rating, reviews),
        "reviews": review_confidence(reviews),
    }
    total = 0.45 * parts["relevance"] + 0.20 * parts["level_fit"] + 0.20 * parts["rating"] + 0.15 * parts["reviews"]
    if reviews < LOW_REVIEW_FLOOR:
        total *= 0.85  # too few reviews to trust the rating (also covers unrated courses)
    parts["total"] = round(total, 4)
    return parts


def _serialise(c: Course, strength: float, source: str, parts: Dict[str, float], skill: str, target_level: str) -> Dict[str, Any]:
    reasons = [f"{'Lists' if source == 'skill_gain' else 'Mentions'} {skill_map.display_name(skill)} ({source.replace('_', ' ')})"]
    if c.level:
        reasons.append(f"{c.level} level" + (" - matches your current level" if c.level == target_level else ""))
    if c.rating is not None:
        reasons.append(f"Rated {c.rating:.1f}/5 from {c.review_count:,} reviews")
    else:
        reasons.append("No rating available")
    return {
        "id": c.id, "title": c.title, "provider": c.provider, "category": c.category,
        "url": c.url, "level": c.level, "rating": c.rating, "review_count": c.review_count,
        "duration_hours": c.duration_hours, "skills": json.loads(c.skills_json or "[]")[:8],
        "matched_skill": skill_map.display_name(skill), "match_source": source,
        "score": parts["total"], "score_breakdown": {k: round(v, 3) for k, v in parts.items() if k != "total"},
        "reasons": reasons, "source": "coursera_catalogue",
    }


def courses_for_skill(db: Session, skill: str, state: Optional[str] = None, limit: int = 5, exclude_ids: Optional[set] = None) -> List[Dict[str, Any]]:
    """Top courses for one skill. ``state`` is the candidate's V/S/C/X state (None = missing)."""
    key = skill_map.canonical(skill)
    target = STATE_TO_LEVEL.get(state, "Beginner")
    exclude_ids = exclude_ids or set()
    rows = (
        db.query(Course, CourseSkill)
        .join(CourseSkill, CourseSkill.course_id == Course.id)
        .filter(CourseSkill.skill == key)
        .all()
    )
    out = []
    for c, cs in rows:
        if c.id in exclude_ids or cs.strength < MIN_RELEVANCE:
            continue
        parts = score_course(cs.strength, c.level, c.rating, c.review_count, target)
        out.append((parts["total"], c.review_count, c.id, _serialise(c, cs.strength, cs.source, parts, key, target)))
    if not out and not skill_map.is_known(skill):
        # Skill outside the catalogue vocabulary: parameterised title/outcome text match (relevance fixed at 0.5).
        if len(key) < 3:
            return []
        esc = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pat = f"%{esc}%"
        for c in db.query(Course).filter(Course.title.ilike(pat, escape="\\") | Course.outcomes.ilike(pat, escape="\\")).limit(200).all():
            if c.id in exclude_ids:
                continue
            parts = score_course(0.5, c.level, c.rating, c.review_count, target)
            out.append((parts["total"], c.review_count, c.id, _serialise(c, 0.5, "title", parts, key, target)))
    out.sort(key=lambda t: (-t[0], -t[1], t[2]))
    return [t[3] for t in out[:limit]]


def catalogue_size(db: Session) -> int:
    return db.query(Course).count()
