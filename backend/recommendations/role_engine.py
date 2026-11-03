"""
Deterministic, explainable role matching (Part 3). No LLM, no randomness.

score = sum(tier_weight * evidence_weight(state)) / sum(tier_weight) * 100

Evidence weights here (1.0/0.7/0.35/0.0) are deliberately separate from the verification
engine's STATE_MULTIPLIERS (1.0/0.6/0.2/0.0), which are left untouched.
Skill-name resolution may use semantic similarity (optional) but a candidate's evidence
state always comes from their own passport entry - similarity never awards evidence.
"""
from __future__ import annotations

from typing import Callable, Dict, Iterable, List, Optional, Tuple

from pydantic import BaseModel, Field, field_validator

from . import skill_map
from .config import ROLE_EVIDENCE_WEIGHTS
from .role_catalogue import Role, load_catalogue

STATE_ALIASES = {"v": "Verified", "verified": "Verified", "s": "Supported", "supported": "Supported",
                 "c": "Claimed", "claimed": "Claimed", "x": "Contradicted", "contradicted": "Contradicted"}
STATE_CODE = {"Verified": "V", "Supported": "S", "Claimed": "C", "Contradicted": "X"}


class CandidateSkill(BaseModel):
    skill: str = Field(min_length=1, max_length=80)
    state: str

    @field_validator("skill")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("skill must not be blank")
        return v

    @field_validator("state")
    @classmethod
    def _state(cls, v: str) -> str:
        s = STATE_ALIASES.get(str(v).strip().lower())
        if not s:
            raise ValueError("state must be one of V/S/C/X or Verified/Supported/Claimed/Contradicted")
        return s


def resolve_candidate(skills: Iterable[CandidateSkill], resolver: Optional[Callable] = None,
                      notes: Optional[List[dict]] = None) -> Dict[str, Tuple[str, str]]:
    """canonical key -> (state, original name). Duplicates keep the strongest evidence.

    ``resolver`` (optional semantic name matcher) is only consulted for names that exact/alias
    matching does not recognise. Such a skill is capped at Claimed: similarity of names is not
    evidence, so it can never contribute more than claim-level weight. Matches are reported in ``notes``.
    """
    out: Dict[str, Tuple[str, str]] = {}
    for cs in skills:
        key, state = skill_map.canonical(cs.skill), cs.state
        if resolver is not None and not skill_map.is_known(cs.skill):
            hit = resolver(cs.skill)
            if hit:
                key = hit[0]
                capped = state if state in ("Claimed", "Contradicted") else "Claimed"
                if notes is not None:
                    notes.append({"input": cs.skill, "matched_skill": skill_map.display_name(key), "similarity": round(hit[1], 3),
                                  "submitted_state": STATE_CODE[state], "applied_state": STATE_CODE[capped], "match_type": "semantic"})
                state = capped
        prev = out.get(key)
        if prev is None or ROLE_EVIDENCE_WEIGHTS[state] > ROLE_EVIDENCE_WEIGHTS[prev[0]]:
            out[key] = (state, cs.skill)
    return out


def _action(status: str, state: Optional[str], skill: str) -> Tuple[str, str]:
    if status == "missing":
        return "learn", f"Learn {skill} - it is absent from your passport."
    if state == "Contradicted":
        return "resolve", f"Resolve the contradicting evidence for {skill}, then re-verify."
    if state == "Claimed":
        return "prove", f"Back your {skill} claim with real work (a public repo or platform profile)."
    return "upgrade", f"Complete the micro-check to upgrade {skill} from Supported to Verified."


def match_role(role: Role, candidate: Dict[str, Tuple[str, str]]) -> dict:
    total = sum(s.weight for s in role.skills)
    matched, weak, missing, priorities = [], [], [], []
    earned = 0.0
    for rs in role.skills:
        hit = candidate.get(rs.key)
        state = hit[0] if hit else None
        ev = ROLE_EVIDENCE_WEIGHTS[state] if state else 0.0
        contribution = rs.weight * ev
        earned += contribution
        entry = {"skill": rs.skill, "tier": rs.tier, "weight": rs.weight,
                 "state": STATE_CODE[state] if state else None, "evidence_weight": ev,
                 "contribution_points": round(contribution / total * 100, 2)}
        if state in ("Verified", "Supported"):
            matched.append(entry)
        elif state in ("Claimed", "Contradicted"):
            weak.append(entry)
        else:
            missing.append(entry)
        if state != "Verified":
            kind, text = _action("missing" if state is None else "weak", state, rs.skill)
            priorities.append({"skill": rs.skill, "tier": rs.tier, "current_state": entry["state"],
                               "gain_points": round(rs.weight * (1.0 - ev) / total * 100, 2),
                               "action": kind, "recommendation": text})
    # biggest achievable gain first; core before nice on ties; then name for stability
    tier_rank = {"core": 0, "important": 1, "nice": 2}
    priorities.sort(key=lambda p: (-p["gain_points"], tier_rank[p["tier"]], p["skill"]))
    for i, p in enumerate(priorities, 1):
        p["rank"] = i
    core = [s for s in role.skills if s.tier == "core"]
    core_evidenced = sum(1 for s in core if (candidate.get(s.key) or (None,))[0] in ("Verified", "Supported"))
    score = round(earned / total * 100, 1) if total else 0.0
    return {
        "role_id": role.id, "title": role.title, "family": role.family, "summary": role.summary,
        "score": score, "core_coverage": f"{core_evidenced}/{len(core)}",
        "core_evidenced": core_evidenced, "core_total": len(core),
        "matched_skills": matched, "weak_skills": weak, "missing_skills": missing,
        "improvement_priorities": priorities, "explanation": _explain(role, score, matched, weak, missing, priorities),
    }


def _explain(role: Role, score: float, matched, weak, missing, priorities) -> str:
    bits = [f"{score:.0f}% match for {role.title}."]
    if matched:
        bits.append("Evidenced: " + ", ".join(f"{m['skill']} ({m['state']})" for m in matched[:5]) + ".")
    if weak:
        bits.append("Weak evidence: " + ", ".join(f"{w['skill']} ({w['state']})" for w in weak[:4]) + ".")
    core_missing = [m["skill"] for m in missing if m["tier"] == "core"]
    if core_missing:
        bits.append("Missing core skills: " + ", ".join(core_missing) + ".")
    elif missing:
        bits.append("Missing: " + ", ".join(m["skill"] for m in missing[:4]) + ".")
    if priorities:
        top = priorities[0]
        bits.append(f"Biggest gain: {top['skill']} (+{top['gain_points']:.0f} points).")
    return " ".join(bits)


def rank_roles(skills: List[CandidateSkill], limit: Optional[int] = None, family: Optional[str] = None,
               resolver: Optional[Callable] = None, notes: Optional[List[dict]] = None) -> List[dict]:
    cand = resolve_candidate(skills, resolver, notes)
    results = [match_role(r, cand) for r in load_catalogue().values() if not family or r.family.lower() == family.lower()]
    results.sort(key=lambda r: (-r["score"], -r["core_evidenced"], r["title"]))
    return results[:limit] if limit else results
