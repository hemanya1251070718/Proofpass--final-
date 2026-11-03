"""Part 1 & 3 API: role matching, course and practice recommendations (/api/v1/recommendations)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend import accounts
from backend.database import get_db, init_db
from backend.recommendations import course_service, github_practice, semantic, service, skill_map
from backend.recommendations.config import ROLE_EVIDENCE_WEIGHTS
from backend.recommendations.role_catalogue import get_role, load_catalogue
from backend.recommendations.role_engine import STATE_ALIASES, CandidateSkill, match_role, rank_roles, resolve_candidate

logger = logging.getLogger("proofpass.recommendations.api")
recommendations_router = APIRouter(prefix="/recommendations", tags=["Recommendations & Role Matching"])

# GitHub-search-backed endpoints share the server quota: cap each signed-in user.
GITHUB_LIMIT = accounts.rate_limit("github-recs", limit=30, window_seconds=600)

init_db()  # make sure Part 1 tables exist (models are imported above)


class SkillsBody(BaseModel):
    skills: List[CandidateSkill] = Field(default_factory=list, max_length=150)


class RoleMatchBody(SkillsBody):
    limit: Optional[int] = Field(default=None, ge=1, le=50)
    family: Optional[str] = Field(default=None, max_length=40)


class PlanBody(SkillsBody):
    target_role_id: Optional[str] = Field(default=None, max_length=64)
    top_roles: int = Field(default=3, ge=1, le=10)
    max_skills: int = Field(default=8, ge=1, le=20)
    courses_per_skill: int = Field(default=3, ge=1, le=10)
    practice_skills: int = Field(default=4, ge=0, le=10)


@recommendations_router.get("/status")
def status(db: Session = Depends(get_db)) -> Dict[str, Any]:
    n = course_service.catalogue_size(db)
    return {"course_catalogue_size": n, "roles": len(load_catalogue()), "github": github_practice.rate_snapshot(),
            "evidence_weights": ROLE_EVIDENCE_WEIGHTS,
            "warnings": [] if n else ["Course catalogue is empty - run: python -m backend.recommendations.course_import"]}


@recommendations_router.get("/roles/catalogue")
def role_catalogue() -> Dict[str, Any]:
    return {"roles": [r.model_dump() for r in load_catalogue().values()]}


@recommendations_router.post("/roles/match")
def match_roles(body: RoleMatchBody) -> Dict[str, Any]:
    notes: List[dict] = []
    roles = rank_roles(body.skills, limit=body.limit, family=body.family, resolver=semantic.get_resolver(), notes=notes)
    return {"evidence_weights": ROLE_EVIDENCE_WEIGHTS, "roles": roles, "semantic_matches": notes}


@recommendations_router.post("/roles/{role_id}/match")
def match_one_role(role_id: str, body: SkillsBody) -> Dict[str, Any]:
    role = get_role(role_id)
    if role is None:
        raise HTTPException(status_code=404, detail=f"Unknown role '{role_id}'")
    notes: List[dict] = []
    cand = resolve_candidate(body.skills, semantic.get_resolver(), notes)
    return {"evidence_weights": ROLE_EVIDENCE_WEIGHTS, "role": match_role(role, cand), "semantic_matches": notes}


@recommendations_router.get("/courses")
def courses(skill: str = Query(min_length=1, max_length=80), state: Optional[str] = Query(default=None, max_length=16),
            limit: int = Query(default=5, ge=1, le=20), db: Session = Depends(get_db)) -> Dict[str, Any]:
    st = None
    if state:
        full = STATE_ALIASES.get(state.strip().lower())
        if not full:
            raise HTTPException(status_code=422, detail="state must be V/S/C/X or a full state name")
        st = full[0]
    items = course_service.courses_for_skill(db, skill, st, limit=limit)
    return {"skill": skill_map.display_name(skill), "source": "coursera_catalogue", "courses": items,
            "warnings": [] if course_service.catalogue_size(db) else ["Course catalogue is empty - run the import script."]}


@recommendations_router.get("/practice")
def practice(skill: str = Query(min_length=1, max_length=80), limit: int = Query(default=3, ge=1, le=10),
             db: Session = Depends(get_db), _rl: None = Depends(GITHUB_LIMIT)) -> Dict[str, Any]:
    return github_practice.practice_for_skill(db, skill, limit=limit)


@recommendations_router.post("/plan")
def plan(body: PlanBody, db: Session = Depends(get_db), _rl: None = Depends(GITHUB_LIMIT)) -> Dict[str, Any]:
    try:
        return service.build_plan(db, body.skills, body.target_role_id, body.top_roles, body.max_skills,
                                  body.courses_per_skill, body.practice_skills, resolver=semantic.get_resolver())
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown role '{body.target_role_id}'")
    except Exception:
        logger.exception("Recommendation plan failed")
        raise HTTPException(status_code=500, detail="Could not build recommendations")
