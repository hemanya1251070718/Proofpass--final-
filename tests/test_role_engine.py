import pytest
from pydantic import ValidationError

from backend.intelligence.state_engine import STATE_MULTIPLIERS
from backend.recommendations import skill_map
from backend.recommendations.config import ROLE_EVIDENCE_WEIGHTS
from backend.recommendations.role_catalogue import get_role, load_catalogue
from backend.recommendations.role_engine import CandidateSkill, match_role, rank_roles, resolve_candidate


def cs(*pairs):
    return [CandidateSkill(skill=s, state=st) for s, st in pairs]


def full(role_id, state):
    return [CandidateSkill(skill=s.skill, state=state) for s in get_role(role_id).skills]


def test_catalogue_size_and_validity():
    cat = load_catalogue()
    assert 15 <= len(cat) <= 20
    titles = {r.title for r in cat.values()}
    assert len(titles) == len(cat)
    for r in cat.values():
        keys = [s.key for s in r.skills]
        assert len(keys) == len(set(keys)), r.id               # no duplicate skills
        assert any(s.tier == "core" for s in r.skills), r.id
        for s in r.skills:
            assert skill_map.is_known(s.skill), (r.id, s.skill)  # every skill resolves (courses/GitHub mapping)


def test_part3_weights_differ_from_verification_engine():
    assert ROLE_EVIDENCE_WEIGHTS == {"Verified": 1.0, "Supported": 0.7, "Claimed": 0.35, "Contradicted": 0.0}
    from backend.intelligence.models import ClaimState
    assert STATE_MULTIPLIERS[ClaimState.SUPPORTED] == 0.6 and STATE_MULTIPLIERS[ClaimState.CLAIMED] == 0.2


@pytest.mark.parametrize("state,expected", [("V", 100.0), ("S", 70.0), ("C", 35.0), ("X", 0.0)])
def test_uniform_state_score(state, expected):
    res = match_role(get_role("frontend-developer"), resolve_candidate(full("frontend-developer", state)))
    assert res["score"] == expected


def test_empty_passport_scores_zero_and_everything_missing():
    res = match_role(get_role("data-analyst"), resolve_candidate([]))
    assert res["score"] == 0.0 and not res["matched_skills"] and not res["weak_skills"]
    assert len(res["missing_skills"]) == len(get_role("data-analyst").skills)
    assert all(p["action"] == "learn" for p in res["improvement_priorities"])


def test_weighted_by_tier_and_hand_computed():
    role = get_role("data-analyst")  # core SQL, Data Analysis, Data Visualization, Statistics (3 each); Python, Pandas (2); R, Databases, Git (1)
    total = 4 * 3 + 2 * 2 + 3 * 1
    res = match_role(role, resolve_candidate(cs(("SQL", "V"), ("Python", "S"), ("R", "C"))))
    expected = (3 * 1.0 + 2 * 0.7 + 1 * 0.35) / total * 100
    assert res["score"] == round(expected, 1)
    assert [m["skill"] for m in res["matched_skills"]] == ["SQL", "Python"]
    assert [w["skill"] for w in res["weak_skills"]] == ["R"]
    assert res["core_coverage"] == "1/4"


def test_contradicted_is_weak_and_scores_zero():
    res = match_role(get_role("backend-python"), resolve_candidate(cs(("Python", "X"))))
    assert res["weak_skills"][0]["skill"] == "Python" and res["weak_skills"][0]["contribution_points"] == 0
    top = next(p for p in res["improvement_priorities"] if p["skill"] == "Python")
    assert top["action"] == "resolve"


def test_priorities_ordered_by_gain_and_exclude_verified():
    res = match_role(get_role("backend-python"), resolve_candidate(cs(("Python", "V"), ("SQL", "S"))))
    pri = res["improvement_priorities"]
    assert "Python" not in [p["skill"] for p in pri]
    gains = [p["gain_points"] for p in pri]
    assert gains == sorted(gains, reverse=True)
    assert [p["rank"] for p in pri] == list(range(1, len(pri) + 1))
    sql = next(p for p in pri if p["skill"] == "SQL")
    assert sql["action"] == "upgrade" and sql["current_state"] == "S"


def test_aliases_and_state_names():
    cand = resolve_candidate(cs(("react.js", "Verified"), ("Postgres", "supported"), ("k8s", "c")))
    assert set(cand) == {"react", "postgresql", "kubernetes"}
    assert cand["postgresql"][0] == "Supported"


def test_duplicate_skill_keeps_strongest_evidence():
    cand = resolve_candidate(cs(("Python", "C"), ("python3", "V")))
    assert cand["python"][0] == "Verified"


def test_ranking_is_deterministic_and_sorted():
    skills = cs(("Python", "V"), ("SQL", "V"), ("Pandas", "S"), ("Statistics", "S"), ("Machine Learning", "C"))
    a, b = rank_roles(skills), rank_roles(skills)
    assert a == b
    assert [r["score"] for r in a] == sorted([r["score"] for r in a], reverse=True)
    assert a[0]["family"] == "Data"
    assert rank_roles(skills, limit=3).__len__() == 3
    assert all(r["family"] == "Web" for r in rank_roles(skills, family="web"))


def test_explanation_mentions_key_facts():
    res = match_role(get_role("devops-engineer"), resolve_candidate(cs(("Docker", "V"), ("Linux", "C"))))
    ex = res["explanation"]
    assert "DevOps Engineer" in ex and "Docker (V)" in ex and "Linux (C)" in ex and "Missing core skills" in ex


def test_validation_rejects_bad_state_and_blank_skill():
    with pytest.raises(ValidationError):
        CandidateSkill(skill="Python", state="maybe")
    with pytest.raises(ValidationError):
        CandidateSkill(skill="   ", state="V")


def test_semantic_resolver_never_awards_evidence():
    fake = lambda text: ("kubernetes", 0.91) if "orchestration" in text.lower() else None
    notes = []
    cand = resolve_candidate(cs(("Container orchestration", "V"), ("Python", "V")), fake, notes)
    assert cand["kubernetes"][0] == "Claimed"           # Verified is capped at Claimed
    assert cand["python"][0] == "Verified"              # exact matches untouched
    assert notes == [{"input": "Container orchestration", "matched_skill": "Kubernetes", "similarity": 0.91,
                      "submitted_state": "V", "applied_state": "C", "match_type": "semantic"}]
    res = match_role(get_role("devops-engineer"), cand)
    kube = next(w for w in res["weak_skills"] if w["skill"] == "Kubernetes")
    assert kube["evidence_weight"] == 0.35
    # contradicted stays contradicted; known names never go through the resolver
    assert resolve_candidate(cs(("Container orchestration", "X")), fake)["kubernetes"][0] == "Contradicted"
    calls = []
    resolve_candidate(cs(("Docker", "V")), lambda t: calls.append(t))
    assert calls == []


def test_semantic_disabled_by_default(monkeypatch):
    from backend.recommendations import semantic
    monkeypatch.delenv("SEMANTIC_SKILL_MATCHING", raising=False)
    assert semantic.get_resolver() is None
