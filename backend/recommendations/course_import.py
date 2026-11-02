"""
Repeatable, idempotent Coursera CSV import.

Usage:  python -m backend.recommendations.course_import [--csv PATH] [--dry-run]

Rules (see CLAUDE.md): deduplicate by normalised URL, rating 0 -> unavailable,
"Skill gain" is the primary skill signal (outcomes/title are weaker), invalid rows are
rejected with a reason, non-technical courses are filtered out. Re-running syncs the
table to the file (insert / update / remove) without creating duplicates.
"""
from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from backend.database import SessionLocal, init_db

from . import skill_map
from .config import DEFAULT_COURSE_CSV
from .models import Course, CourseSkill

logger = logging.getLogger("proofpass.course_import")

REQUIRED_COLUMNS = {"Course Title", "Rating", "Level", "What you will learn", "Skill gain", "Offered By", "Keyword", "Course Url", "Duration to complete (Approx.)", "Number of Review"}
TECH_CATEGORIES = {"computer science", "datascience", "information technology"}
TECH_THRESHOLD = 0.5
_MISSING = {"", "not specified", "n/a", "none", "nan"}
_LEVELS = {"beginner level": "Beginner", "intermediate level": "Intermediate", "advanced level": "Advanced"}


@dataclass
class ImportStats:
    rows_read: int = 0
    rejected: Counter = field(default_factory=Counter)
    duplicates_removed: int = 0
    unique_courses: int = 0
    non_english: int = 0
    non_technical: int = 0
    technical: int = 0
    unrated: int = 0
    missing_skill_gain: int = 0
    inserted: int = 0
    updated: int = 0
    removed: int = 0
    course_skill_links: int = 0

    def as_dict(self) -> dict:
        d = self.__dict__.copy()
        d["rejected"] = dict(self.rejected)
        d["rejected_total"] = sum(self.rejected.values())
        return d


@dataclass
class ParsedCourse:
    url_norm: str
    url: str
    title: str
    provider: Optional[str]
    category: Optional[str]
    level: Optional[str]
    rating: Optional[float]
    review_count: int
    duration_hours: Optional[float]
    skills: List[str]
    outcomes: Optional[str]
    links: List[Tuple[str, str, float]] = field(default_factory=list)  # (skill, source, strength)
    tech_score: float = 0.0
    non_english: bool = False


def normalize_url(raw: str) -> Optional[str]:
    """Lower-case scheme/host, drop www/query/fragment/trailing slash. None if not a usable URL."""
    raw = (raw or "").strip()
    if not raw:
        return None
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return None
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = re.sub(r"/+$", "", parts.path)
    if not path:
        return None
    return f"https://{host}{path}"


def _clean(v: Optional[str]) -> str:
    v = (v or "").strip()
    return "" if v.lower() in _MISSING else v


def _float(v: str) -> Optional[float]:
    try:
        f = float((v or "").replace(",", "").strip())
    except ValueError:
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None


def _split_skills(raw: str) -> List[str]:
    seen, out = set(), []
    for item in _clean(raw).split(","):
        s = item.strip()
        if s and s.lower() not in _MISSING and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


def _word_hit(term: str, text: str) -> bool:
    return re.search(r"(?<![a-z0-9+#])" + re.escape(term) + r"(?![a-z0-9+#])", text) is not None


SHORT_TRUSTED = ("sql", "aws", "gcp", "git", "css", "php", "c++", "c#")
BROAD_SKILL_LIST = 10  # courses listing this many skills are surveys, not focused teaching


# phrases that contain a skill word but are a different skill
TITLE_EXCLUDE = {"react": ("react native",)}


def _title_names(key: str, title_l: str) -> bool:
    for phrase in TITLE_EXCLUDE.get(key, ()):
        title_l = title_l.replace(phrase, " ")
    names = {skill_map.display_name(key).lower(), *skill_map.course_terms(key)}
    return any((len(n) >= 4 or n in SHORT_TRUSTED) and _word_hit(n, title_l) for n in names)


def derive_skill_links(skills: List[str], title: str, outcomes: str) -> List[Tuple[str, str, float]]:
    """Map a course onto canonical skills with a relevance strength (no metadata is invented).

    Skill gain is the primary signal, graded by how central the skill looks:
      skill in Skill gain AND named in the title ........ 1.00
      skill in the first 3 Skill-gain items ............. 0.85
      later Skill-gain item ............................ 0.60 (0.45 if the list has 10+ skills)
      only named in the title .......................... 0.60
      only named in the learning outcomes .............. 0.40
    """
    best: Dict[str, Tuple[str, float]] = {}
    idx = skill_map.term_index()
    title_l, out_l = title.lower(), outcomes.lower()
    for pos, s in enumerate(skills):
        for key in idx.get(skill_map._norm(s), []):
            if _title_names(key, title_l):
                strength = 1.0
            elif pos < 3:
                strength = 0.85
            else:
                strength = 0.45 if len(skills) >= BROAD_SKILL_LIST else 0.6
            if key not in best or strength > best[key][1]:
                best[key] = ("skill_gain", strength)
    for key in skill_map.known_keys():
        if key in best:
            continue
        if _title_names(key, title_l):
            best[key] = ("title", 0.6)
            continue
        for term in skill_map.course_terms(key):
            # short ambiguous terms (e.g. "c", "go", "r") are only trusted from Skill gain
            if len(term) < 4 and term not in SHORT_TRUSTED:
                continue
            if outcomes and _word_hit(term, out_l):
                best[key] = ("outcomes", 0.4)
                break
    return [(k, src, st) for k, (src, st) in best.items()]


def technical_score(category: str, links: List[Tuple[str, str, float]]) -> float:
    """0..1. Tech categories start at 0.5; any recognised skill signal raises it.
    Other categories are technical only when Skill gain names a recognised technical skill."""
    gain_links = sum(1 for k, src, _s in links if src == "skill_gain" and k not in skill_map.WEAK_KEYS)
    if category.lower() in TECH_CATEGORIES:
        return round(min(1.0, 0.5 + 0.25 * len(links)), 3)
    if gain_links:
        return round(min(1.0, 0.45 + 0.15 * gain_links), 3)
    return 0.0


_NON_EN = re.compile(r"\b(?:de|la|el|los|las|para|con|en|del|al|une|des|les|du|em|uma|dos|und|der|die|da|por|pour|dans|mit|ao|que|et)\b", re.I)
_ES_ACCENT = re.compile(r"[¿¡ñáéíóúçãõàèù]", re.I)


def looks_non_english(title: str) -> bool:
    """Heuristic (the CSV has no language column): non-Latin scripts, replacement chars, or
    Romance/German function words combined with accents / repeated hits."""
    if any(ord(ch) > 0x24F and not 0x2000 <= ord(ch) <= 0x206F for ch in title) or "�" in title:
        return True
    words = len(_NON_EN.findall(title))
    return words >= 2 or (words >= 1 and bool(_ES_ACCENT.search(title)))


def parse_row(row: Dict[str, str]) -> Tuple[Optional[ParsedCourse], Optional[str]]:
    title = _clean(row.get("Course Title"))
    if not title:
        return None, "missing_title"
    url_norm = normalize_url(row.get("Course Url", ""))
    if not url_norm:
        return None, "invalid_url"
    rating = _float(row.get("Rating", ""))
    if rating is not None and (rating <= 0 or rating > 5):
        rating = None  # 0 = unavailable; out-of-range treated as unavailable
    reviews = _float(row.get("Number of Review", ""))
    review_count = int(reviews) if reviews is not None and reviews >= 0 else 0
    duration = _float(row.get("Duration to complete (Approx.)", ""))
    if duration is not None and duration <= 0:
        duration = None
    skills = _split_skills(row.get("Skill gain", ""))
    outcomes = _clean(row.get("What you will learn")) or None
    category = _clean(row.get("Keyword")) or None
    links = derive_skill_links(skills, title, outcomes or "")
    return ParsedCourse(
        url_norm=url_norm, url=url_norm, title=title[:512],
        provider=_clean(row.get("Offered By")) or None, category=category,
        level=_LEVELS.get((row.get("Level") or "").strip().lower()),
        rating=rating, review_count=review_count, duration_hours=duration,
        skills=skills, outcomes=outcomes, links=links,
        tech_score=technical_score(category or "", links),
        non_english=looks_non_english(title),
    ), None


def _quality(c: ParsedCourse) -> tuple:
    return (c.review_count, bool(c.skills), c.rating is not None, len(c.outcomes or ""))


def read_courses(csv_path: Path, stats: ImportStats) -> List[ParsedCourse]:
    unique: Dict[str, ParsedCourse] = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV is missing required columns: {sorted(missing)}")
        for row in reader:
            stats.rows_read += 1
            parsed, reason = parse_row(row)
            if parsed is None:
                stats.rejected[reason] += 1
                continue
            prev = unique.get(parsed.url_norm)
            if prev is None:
                unique[parsed.url_norm] = parsed
            else:
                stats.duplicates_removed += 1
                if _quality(parsed) > _quality(prev):
                    unique[parsed.url_norm] = parsed
    stats.unique_courses = len(unique)
    return list(unique.values())


def import_courses(csv_path: Path = DEFAULT_COURSE_CSV, session: Optional[Session] = None, dry_run: bool = False) -> ImportStats:
    csv_path = Path(csv_path)
    if not csv_path.is_file():
        raise FileNotFoundError(f"Course CSV not found: {csv_path}")
    stats = ImportStats()
    courses = read_courses(csv_path, stats)
    # Counts partition cleanly: rows = invalid + duplicate rows + unique; unique = non_english + non_technical + technical
    english = [c for c in courses if not c.non_english]
    stats.non_english = len(courses) - len(english)
    keep = [c for c in english if c.tech_score >= TECH_THRESHOLD]
    stats.non_technical = len(english) - len(keep)
    stats.technical = len(keep)
    stats.unrated = sum(1 for c in keep if c.rating is None)
    stats.missing_skill_gain = sum(1 for c in keep if not c.skills)
    if dry_run:
        stats.course_skill_links = sum(len(c.links) for c in keep)
        return stats

    own = session is None
    db = session or SessionLocal()
    try:
        existing = {u: i for u, i in db.query(Course.url_norm, Course.id).all()}
        keep_urls = {c.url_norm for c in keep}
        stale_ids = [i for u, i in existing.items() if u not in keep_urls]
        if stale_ids:
            for chunk in range(0, len(stale_ids), 500):
                ids = stale_ids[chunk:chunk + 500]
                db.query(CourseSkill).filter(CourseSkill.course_id.in_(ids)).delete(synchronize_session=False)
                db.query(Course).filter(Course.id.in_(ids)).delete(synchronize_session=False)
            stats.removed = len(stale_ids)
        for c in keep:
            fields = dict(
                url=c.url, title=c.title, provider=c.provider, category=c.category, level=c.level,
                rating=c.rating, review_count=c.review_count, duration_hours=c.duration_hours,
                skills_json=json.dumps(c.skills), outcomes=c.outcomes, tech_score=c.tech_score,
            )
            cid = existing.get(c.url_norm)
            if cid is None:
                obj = Course(url_norm=c.url_norm, **fields)
                db.add(obj)
                db.flush()
                cid = obj.id
                stats.inserted += 1
            else:
                db.query(Course).filter(Course.id == cid).update(fields)
                db.query(CourseSkill).filter(CourseSkill.course_id == cid).delete(synchronize_session=False)
                stats.updated += 1
            db.add_all(CourseSkill(course_id=cid, skill=k, source=src, strength=st) for k, src, st in c.links)
            stats.course_skill_links += len(c.links)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if own:
            db.close()
    return stats


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Import the Coursera CSV into SQLite (idempotent).")
    ap.add_argument("--csv", default=str(DEFAULT_COURSE_CSV))
    ap.add_argument("--dry-run", action="store_true", help="parse and report without writing")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    init_db()
    try:
        stats = import_courses(Path(args.csv), dry_run=args.dry_run)
    except (OSError, ValueError) as exc:
        logger.error("Import failed: %s", exc)
        return 1
    print(json.dumps(stats.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
