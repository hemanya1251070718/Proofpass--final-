import pytest
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app
from backend.recommendations import course_import, github_practice as gp
from tests.rec_helpers import make_session_factory, write_csv
from tests.test_github_practice import raw_issue

P = "/api/v1/recommendations"


@pytest.fixture
def client(tmp_path, monkeypatch):
    Session = make_session_factory()
    with Session() as s:
        course_import.import_courses(write_csv(tmp_path / "c.csv"), session=s)

    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    gp.reset_rate_state()
    calls = []

    def fake_request(client, q, per_page):
        calls.append(q)
        n = len(calls) * 10
        kw = "docker sql postgresql rest api git testing ci/cd python"
        return [raw_issue(n + 1, title=f"{kw} {n + 1}"), raw_issue(n + 2, title=f"{kw} {n + 2}")]

    monkeypatch.setattr(gp, "_request", fake_request)
    c = TestClient(app)
    from tests.auth_helpers import register
    register(c, "applicant")
    c.github_calls = calls
    yield c
    app.dependency_overrides.pop(get_db, None)
    gp.reset_rate_state()


def test_status(client):
    j = client.get(f"{P}/status").json()
    assert j["course_catalogue_size"] == 5 and j["roles"] >= 15 and j["evidence_weights"]["Supported"] == 0.7


def test_catalogue(client):
    roles = client.get(f"{P}/roles/catalogue").json()["roles"]
    assert 15 <= len(roles) <= 20 and roles[0]["skills"][0]["tier"] in ("core", "important", "nice")


def test_roles_match_reflects_input(client):
    body = {"skills": [{"skill": "Python", "state": "V"}, {"skill": "SQL", "state": "V"}, {"skill": "Pandas", "state": "S"}], "limit": 3}
    j = client.post(f"{P}/roles/match", json=body).json()
    assert len(j["roles"]) == 3 and j["roles"][0]["score"] >= j["roles"][1]["score"]
    # changing evidence changes the score
    body["skills"][0]["state"] = "C"
    j2 = client.post(f"{P}/roles/match", json=body).json()
    assert {r["role_id"]: r["score"] for r in j2["roles"]} != {r["role_id"]: r["score"] for r in j["roles"]}


def test_single_role_match_and_404(client):
    r = client.post(f"{P}/roles/data-analyst/match", json={"skills": [{"skill": "SQL", "state": "V"}]})
    assert r.status_code == 200
    role = r.json()["role"]
    assert [m["skill"] for m in role["matched_skills"]] == ["SQL"] and role["score"] > 0
    assert client.post(f"{P}/roles/nope/match", json={"skills": []}).status_code == 404


def test_validation_errors(client):
    assert client.post(f"{P}/roles/match", json={"skills": [{"skill": "Python", "state": "Z"}]}).status_code == 422
    assert client.get(f"{P}/courses", params={"skill": ""}).status_code == 422
    assert client.get(f"{P}/courses", params={"skill": "Docker", "limit": 999}).status_code == 422
    assert client.get(f"{P}/courses", params={"skill": "Docker", "state": "?"}).status_code == 422
    assert client.post(f"{P}/plan", json={"skills": [], "top_roles": 0}).status_code == 422


def test_courses_come_from_catalogue(client):
    j = client.get(f"{P}/courses", params={"skill": "docker", "state": "C"}).json()
    assert j["source"] == "coursera_catalogue"
    assert [c["title"] for c in j["courses"]][:2] == ["Docker Deep Dive", "Docker Essentials"]


def test_practice_endpoint_labels_source(client):
    j = client.get(f"{P}/practice", params={"skill": "Python"}).json()
    assert j["source"] == "live" and len(j["items"]) == 2
    assert client.get(f"{P}/practice", params={"skill": "Photoshop"}).json()["source"] == "unmapped"


def test_plan_combines_passport_and_role_gaps(client):
    body = {"skills": [{"skill": "Python", "state": "V"}, {"skill": "Docker", "state": "C"}],
            "target_role_id": "backend-python", "max_skills": 10, "practice_skills": 2}
    j = client.post(f"{P}/plan", json=body).json()
    assert j["target_role"]["role_id"] == "backend-python"
    recs = {r["skill"]: r for r in j["recommendations"]}
    assert "Python" not in recs                                  # verified: no recommendation
    docker = recs["Docker"]
    types = {x["type"] for x in docker["reasons"]}
    assert types == {"passport_gap", "role_gap"}                 # both signals on the same skill
    assert docker["courses"][0]["title"] == "Docker Deep Dive"
    assert "SQL" in recs and all(x["type"] == "role_gap" for x in recs["SQL"]["reasons"])  # missing role skill
    priorities = [r["priority"] for r in j["recommendations"]]
    assert priorities == sorted(priorities, reverse=True)
    assert sum(1 for r in j["recommendations"] if r["practice"]) <= 2
    assert all(r["practice"]["source"] in ("live", "cache") for r in j["recommendations"] if r["practice"])


def test_plan_does_not_repeat_the_same_issue_across_skills(client, monkeypatch):
    monkeypatch.setattr(gp, "_request", lambda c, q, n: [raw_issue(1, title="python sql task"), raw_issue(2, title="python sql task 2")])   # identical results for every skill
    body = {"skills": [{"skill": "Python", "state": "C"}, {"skill": "SQL", "state": "C"}], "practice_skills": 4, "max_skills": 4}
    j = client.post(f"{P}/plan", json=body).json()
    urls = [i["url"] for r in j["recommendations"] if r["practice"] for i in r["practice"]["items"] if not i["is_fallback"]]
    assert len(urls) == len(set(urls)) and urls                    # no duplicates across skills
    assert any(r["practice"]["source"] == "fallback" for r in j["recommendations"] if r["practice"])  # exhausted -> labelled fallback


def test_plan_unknown_role_and_empty_passport(client):
    assert client.post(f"{P}/plan", json={"skills": [], "target_role_id": "ghost"}).status_code == 404
    j = client.post(f"{P}/plan", json={"skills": []}).json()
    assert j["target_role"] is None and j["roles"]  # still returns role list, no crash


def test_existing_health_route_still_works(client):
    assert client.get("/api/v1/health").status_code == 200
