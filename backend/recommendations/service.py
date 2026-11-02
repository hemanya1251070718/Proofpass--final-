"""Combines Part 3 role gaps with passport skill gaps into one prioritised recommendation plan."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from . import course_service, github_practice, skill_map
from .config import ROLE_EVIDENCE_WEIGHTS
from .role_catalogue import get_role
from .role_engine import STATE_CODE, CandidateSkill, match_role, rank_roles, resolve_candidate

logger = logging.getLogger("proofpass.recommendations")

PASSPORT_GAP_POINTS = 5.0      # scale of a passport-gap signal vs role gain_points (0-100)
OTHER_ROLE_WEIGHT = 0.5        # top-matching roles count half as much as the chosen target role


def build_plan(
    db: Session, skills: List[CandidateSkill], target_role_id: Optional[str] = None, top_roles: int = 3,
    max_skills: int = 8, courses_per_skill: int = 3, practice_skills: int = 4, practice_per_skill: int = 3,
    http_client: Optional[httpx.Client] = None, resolver=None,
) -> Dict[str, Any]:
    sem_notes: List[Dict[str, Any]] = []
    candidate = resolve_candidate(skills, resolver, sem_notes)
    ranked = rank_roles(skills, resolver=resolver)
    target = None
    if target_role_id:
        role = get_role(target_role_id)
        if role is None:
            raise KeyError(target_role_id)
        target = match_role(role, candidate)
    considered = [(target, 1.0)] if target else []
    considered += [(r, OTHER_ROLE_WEIGHT) for r in ranked[:top_roles] if not target or r["role_id"] != target["role_id"]]

    # skill key -> {priority, reasons, state}
    targets: Dict[str, Dict[str, Any]] = {}

    def slot(name: str) -> Dict[str, Any]:
        key = skill_map.canonical(name)
        return targets.setdefault(key, {"skill": skill_map.display_name(name), "key": key, "priority": 0.0, "reasons": [], "state": None})

    for key, (state, original) in candidate.items():
        if state == "Verified":
            continue
        t = slot(original)
        t["state"] = STATE_CODE[state]
        t["priority"] += PASSPORT_GAP_POINTS * (1.0 - ROLE_EVIDENCE_WEIGHTS[state])
        t["reasons"].append({"type": "passport_gap", "state": STATE_CODE[state],
                             "text": f"{state} in your passport - not yet fully evidenced"})
    for res, w in considered:
        for p in res["improvement_priorities"]:
            t = slot(p["skill"])
            t["state"] = t["state"] or p["current_state"]
            t["priority"] += p["gain_points"] * w
            t["reasons"].append({"type": "role_gap", "role_id": res["role_id"], "role": res["title"], "tier": p["tier"],
                                 "gain_points": p["gain_points"], "action": p["action"],
                                 "text": f"{p['action'].capitalize()} {p['skill']} - {p['tier']} skill for {res['title']} (+{p['gain_points']:.0f} pts)"})
    ordered = sorted(targets.values(), key=lambda t: (-t["priority"], t["skill"]))[:max_skills]

    own_client = http_client is None and practice_skills > 0
    client = http_client or (httpx.Client() if own_client else None)
    recs: List[Dict[str, Any]] = []
    practice_used = 0
    seen_urls: set = set()
    try:
        for t in ordered:
            courses = course_service.courses_for_skill(db, t["key"], t["state"], limit=courses_per_skill)
            practice = None
            if practice_used < practice_skills and skill_map.github_mapping(t["key"]) is not None:
                practice = github_practice.practice_for_skill(db, t["key"], limit=practice_per_skill, client=client, exclude_urls=seen_urls)
                seen_urls.update(i["url"] for i in practice["items"] if not i.get("is_fallback"))
                practice_used += 1
            recs.append({"skill": t["skill"], "current_state": t["state"], "priority": round(t["priority"], 2),
                         "reasons": t["reasons"], "courses": courses, "practice": practice})
    finally:
        if own_client and client is not None:
            client.close()

    return {
        "target_role": target,
        "roles": ranked[: max(top_roles, 1)],
        "recommendations": recs,
        "meta": {
            "semantic_matches": sem_notes,
            "evidence_weights": ROLE_EVIDENCE_WEIGHTS,
            "course_catalogue_size": course_service.catalogue_size(db),
            "github": github_practice.rate_snapshot(),
            "notes": ["Courses come from the imported Coursera catalogue (SQLite).",
                      "Practice items carry a per-skill 'source': live | cache | stale_cache | fallback."],
        },
    }
