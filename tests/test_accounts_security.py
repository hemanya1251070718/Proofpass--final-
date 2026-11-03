"""
Accounts, sessions, passport ownership/authorization, fake-verification rejection and canonical integrity.
All tests run against an isolated in-memory database.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import accounts
from backend.api.auth import SESSION_COOKIE_NAME, create_session_token
from backend.database import Base, PassportRecord, SessionRecord, UserRecord, get_db
from backend.main import app
from backend.verification.github_client import GitHubAPIError, RateLimitError
from tests.auth_helpers import STRONG_PASSWORD, login, register

A = "/api/v1"
RESUME = "Alex Rivera\nReact, Python, Docker developer.\nBuilt full stack apps."
INTAKE = {"resume_text": RESUME, "github_url": "https://github.com/alexrivera-dev/portfolio",
          "target_role": "Full-Stack Engineer", "consent": True, "allow_network": False}


@pytest.fixture
def env():
    """Fresh DB + two independent browsers; returns (make_client, Session)."""
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=eng)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=eng)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    saved = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override
    yield lambda: TestClient(app), Session
    if saved is not None:
        app.dependency_overrides[get_db] = saved
    else:
        app.dependency_overrides.pop(get_db, None)


def issue(client) -> str:
    r = client.post(f"{A}/analyze", json=INTAKE)
    assert r.status_code == 200, r.text
    return r.json()["passport_id"]


# --------------------------------------------------------------------------- registration / login
def test_register_applicant_and_recruiter(env):
    mk, _ = env
    for role in ("applicant", "recruiter"):
        c = mk()
        u = register(c, role)
        assert u["role"] == role and "password" not in json.dumps(u)
        me = c.get(f"{A}/account/me").json()["user"]
        assert me["id"] == u["id"] and me["role"] == role


def test_register_validation(env):
    mk, _ = env
    c = mk()
    ok = {"role": "applicant", "name": "N", "email": "a@b.co", "password": STRONG_PASSWORD}
    assert c.post(f"{A}/account/register", json={**ok, "role": "admin"}).status_code == 422       # only 2 roles
    assert c.post(f"{A}/account/register", json={**ok, "email": "not-an-email"}).status_code == 422
    assert c.post(f"{A}/account/register", json={**ok, "password": "short"}).status_code == 422
    assert c.post(f"{A}/account/register", json={**ok, "password": "password"}).status_code == 422
    assert c.post(f"{A}/account/register", json={**ok, "name": "  "}).status_code == 422
    assert c.post(f"{A}/account/register", json=ok).status_code == 201
    assert c.post(f"{A}/account/register", json={**ok, "email": "A@B.co"}).status_code == 409    # case-insensitive dup


def test_password_stored_as_argon2id_and_token_hashed(env):
    mk, Session = env
    c = mk()
    register(c, "applicant", email="hash@example.com")
    with Session() as db:
        user = db.query(UserRecord).filter_by(email="hash@example.com").one()
        assert user.password_hash.startswith("$argon2id$")
        assert STRONG_PASSWORD not in user.password_hash
        raw_cookie = c.cookies.get(accounts.ACCOUNT_COOKIE)
        stored = [s.token_hash for s in db.query(SessionRecord).all()]
        assert raw_cookie not in stored and len(stored) == 1 and len(stored[0]) == 64


def test_invalid_credentials_and_throttle(env):
    mk, _ = env
    c = mk()
    register(c, "applicant", email="x@example.com")
    c2 = mk()
    bad = login(c2, "x@example.com", "wrong-password-1")
    unknown = login(c2, "ghost@example.com", "whatever-pass-1")
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["detail"] == unknown.json()["detail"]            # no account enumeration
    for _ in range(4):
        login(c2, "x@example.com", "wrong-password-1")
    assert login(c2, "x@example.com", STRONG_PASSWORD).status_code == 429  # locked out after repeated failures


def test_login_logout_and_session_invalidation(env):
    mk, Session = env
    c = mk()
    register(c, "applicant", email="s@example.com")
    cookie = c.cookies.get(accounts.ACCOUNT_COOKIE)
    assert c.post(f"{A}/account/logout").status_code == 200
    assert c.get(f"{A}/account/me").status_code == 401
    replay = mk()
    replay.cookies.set(accounts.ACCOUNT_COOKIE, cookie)                  # a stolen cookie is useless after logout
    assert replay.get(f"{A}/account/me").status_code == 401
    with Session() as db:
        assert db.query(SessionRecord).count() == 0
    assert login(c, "s@example.com").status_code == 200
    assert c.get(f"{A}/account/me").status_code == 200


def test_session_expiry_and_logout_all(env):
    mk, Session = env
    c, c2 = mk(), mk()
    register(c, "applicant", email="e@example.com")
    assert login(c2, "e@example.com").status_code == 200
    with Session() as db:
        row = db.query(SessionRecord).first()
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    expired = [cl for cl in (c, c2) if cl.get(f"{A}/account/me").status_code == 401]
    assert len(expired) == 1                                             # only the expired one died
    live = c if c not in expired else c2
    assert live.post(f"{A}/account/logout-all").status_code == 200
    assert live.get(f"{A}/account/me").status_code == 401


def test_cookie_flags_dev_and_production(env, monkeypatch):
    mk, _ = env
    c = mk()
    r = c.post(f"{A}/account/register", json={"role": "applicant", "name": "N", "email": "c1@example.com", "password": STRONG_PASSWORD})
    h = r.headers["set-cookie"].lower()
    assert "httponly" in h and "samesite=lax" in h and "path=/" in h and "secure" not in h   # localhost http dev
    monkeypatch.setenv("COOKIE_SECURE", "true")
    r2 = mk().post(f"{A}/account/register", json={"role": "applicant", "name": "N", "email": "c2@example.com", "password": STRONG_PASSWORD})
    assert "secure" in r2.headers["set-cookie"].lower()                                      # production


def test_role_cannot_be_escalated(env):
    mk, Session = env
    c = mk()
    register(c, "applicant", email="r@example.com")
    r = c.patch(f"{A}/account/profile", json={"role": "recruiter", "profile": {"role": "recruiter", "is_admin": True, "company": "X"}})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["role"] == "applicant" and "role" not in user["profile"] and "is_admin" not in user["profile"]
    assert user["profile"]["company"] == "X"
    with Session() as db:
        assert db.query(UserRecord).filter_by(email="r@example.com").one().role == "applicant"
    # a recruiter-only endpoint stays closed to the applicant
    assert c.get(f"{A}/batch/nonexistent").status_code == 403


def test_cross_origin_state_change_rejected(env):
    mk, _ = env
    c = mk()
    r = c.post(f"{A}/account/register", headers={"Origin": "https://evil.example"},
               json={"role": "applicant", "name": "N", "email": "o@example.com", "password": STRONG_PASSWORD})
    assert r.status_code == 403
    r = c.post(f"{A}/account/register", headers={"Origin": "http://localhost:5173"},
               json={"role": "applicant", "name": "N", "email": "o@example.com", "password": STRONG_PASSWORD})
    assert r.status_code == 201


# --------------------------------------------------------------------------- passport authorization
def test_unauthenticated_passport_access_denied(env):
    mk, _ = env
    owner = mk()
    register(owner, "applicant")
    pid = issue(owner)
    anon = mk()
    for method, path, kw in [
        ("get", "/passports", {}), ("get", f"/passports/{pid}", {}), ("delete", f"/passports/{pid}", {}),
        ("get", f"/passports/{pid}/quiz", {}), ("post", f"/passports/{pid}/quiz/answers", {"json": {"answers": [{"question_id": "q", "answer_text": "a"}]}}),
        ("get", f"/passports/{pid}/verify", {}), ("patch", f"/passports/{pid}/sharing", {"json": {"revoked": True}}),
        ("post", "/passports", {"json": {"id": pid}}), ("post", "/analyze", {"json": INTAKE}), ("post", "/verify", {"json": INTAKE}),
        ("post", "/extract-resume", {}), ("get", "/recommendations/status", {}),
    ]:
        r = getattr(anon, method)(A + path, **kw)
        assert r.status_code == 401, (method, path, r.status_code)


def test_applicant_cannot_touch_another_applicants_passport(env):
    mk, Session = env
    a, b = mk(), mk()
    register(a, "applicant"); register(b, "applicant")
    pid = issue(a)
    assert pid not in [p["id"] for p in b.get(f"{A}/passports").json()]
    assert b.get(f"{A}/passports/{pid}").status_code == 404
    assert b.get(f"{A}/passports/{pid}/quiz").status_code == 404
    assert b.get(f"{A}/passports/{pid}/verify").status_code == 404
    assert b.post(f"{A}/passports/{pid}/quiz/answers", json={"answers": [{"question_id": "q", "answer_text": "x"}]}).status_code == 404
    assert b.patch(f"{A}/passports/{pid}/sharing", json={"revoked": True}).status_code == 404
    assert b.delete(f"{A}/passports/{pid}").status_code == 404
    with Session() as db:
        rec = db.query(PassportRecord).filter_by(passport_id=pid).one()
        assert not rec.share_revoked
    assert a.get(f"{A}/passports/{pid}").status_code == 200


def test_recruiter_is_read_only(env):
    mk, Session = env
    a, r = mk(), mk()
    register(a, "applicant"); register(r, "recruiter")
    pid = issue(a)
    listing = r.get(f"{A}/passports").json()
    assert pid in [p["id"] for p in listing]
    assert r.get(f"{A}/passports/{pid}").status_code == 200
    assert r.get(f"{A}/passports/{pid}/verify").json()["valid"] is True
    with Session() as db:
        before = db.query(PassportRecord).filter_by(passport_id=pid).one().payload_json
    assert r.delete(f"{A}/passports/{pid}").status_code == 403
    assert r.patch(f"{A}/passports/{pid}/sharing", json={"revoked": True}).status_code == 403
    assert r.get(f"{A}/passports/{pid}/quiz").status_code == 403
    assert r.post(f"{A}/passports/{pid}/quiz/answers", json={"answers": [{"question_id": "q", "answer_text": "x"}]}).status_code == 403
    assert r.post(f"{A}/analyze", json=INTAKE).status_code == 403         # recruiters cannot create passports
    assert r.post(f"{A}/verify", json=INTAKE).status_code == 403
    assert r.post(f"{A}/passports", json={"id": pid}).status_code == 410  # nobody can overwrite
    with Session() as db:
        assert db.query(PassportRecord).filter_by(passport_id=pid).one().payload_json == before


def test_passport_owner_comes_from_session_not_payload(env):
    mk, Session = env
    a, b = mk(), mk()
    ua = register(a, "applicant"); ub = register(b, "applicant")
    r = a.post(f"{A}/analyze", json={**INTAKE, "owner_id": ub["id"], "userId": ub["id"]})
    assert r.status_code == 200
    with Session() as db:
        assert db.query(PassportRecord).filter_by(passport_id=r.json()["passport_id"]).one().owner_id == ua["id"]


def test_owner_can_delete_and_toggle_sharing(env):
    mk, _ = env
    a, anon = mk(), mk()
    register(a, "applicant")
    pid = issue(a)
    assert anon.get(f"{A}/shared/passports/{pid}").status_code == 200
    shared = anon.get(f"{A}/shared/passports/{pid}").json()
    assert "quiz_questions" not in shared and "userId" not in shared and shared["integrity"]["valid"] is True
    assert a.patch(f"{A}/passports/{pid}/sharing", json={"revoked": True}).json()["revoked"] is True
    assert anon.get(f"{A}/shared/passports/{pid}").status_code == 410
    assert a.delete(f"{A}/passports/{pid}").json()["deleted"] is True
    assert a.get(f"{A}/passports/{pid}").status_code == 404


# --------------------------------------------------------------------------- legacy records
def test_legacy_passports_preserved_and_unassigned(env):
    mk, Session = env
    with Session() as db:
        legacy_payload = json.dumps({"id": "PP-2026-0001", "candidate": "Legacy Person", "skills": [{"skill": "React", "state": "V"}], "hash": "client-hash"})
        db.add(PassportRecord(passport_id="PP-2026-0001", target_role="Dev", role_match_score=0.0, candidate_consent=True,
                              status="issued", sha256_hash="client-hash", payload_json=legacy_payload, claims_json="[]",
                              verification_json="{}", quiz_questions_json="[]", quiz_history_json="{}", is_demo=False))
        db.commit()
        snapshot = db.query(PassportRecord).one().payload_json
    a, r = mk(), mk()
    register(a, "applicant"); register(r, "recruiter")
    assert a.get(f"{A}/passports").json() == []                              # not assigned to any applicant
    assert a.get(f"{A}/passports/PP-2026-0001").status_code == 404
    assert a.delete(f"{A}/passports/PP-2026-0001").status_code == 404
    rec_view = [p for p in r.get(f"{A}/passports").json() if p["id"] == "PP-2026-0001"][0]
    assert rec_view["unassigned"] is True and rec_view["legacy"] is True and rec_view["ownership"] == "legacy"
    assert r.delete(f"{A}/passports/PP-2026-0001").status_code == 403
    with Session() as db:
        rec = db.query(PassportRecord).one()
        assert rec.payload_json == snapshot and rec.owner_id is None          # untouched, still unassigned


def test_migration_adds_columns_without_touching_rows(tmp_path):
    from sqlalchemy import text
    from backend.database import init_db
    eng = create_engine(f"sqlite:///{tmp_path/'old.db'}")
    with eng.begin() as conn:   # the pre-ownership schema
        conn.execute(text("CREATE TABLE passports (passport_id VARCHAR(64) PRIMARY KEY, target_role VARCHAR(255) NOT NULL, "
                          "role_match_score FLOAT NOT NULL, candidate_consent BOOLEAN NOT NULL, status VARCHAR(32) NOT NULL, "
                          "sha256_hash VARCHAR(64) NOT NULL, payload_json TEXT NOT NULL, target_role_json TEXT, claims_json TEXT NOT NULL, "
                          "verification_json TEXT NOT NULL, quiz_questions_json TEXT NOT NULL, quiz_history_json TEXT NOT NULL, "
                          "is_demo BOOLEAN NOT NULL, github_id INTEGER, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)"))
        conn.execute(text("INSERT INTO passports VALUES ('P1','R',1.0,1,'issued','h','{}',NULL,'[]','{}','[]','{}',0,NULL,'2026-01-01','2026-01-01')"))
    init_db(eng)
    init_db(eng)   # idempotent
    with eng.connect() as conn:
        row = conn.execute(text("SELECT passport_id, owner_id, ownership, share_revoked FROM passports")).one()
    assert tuple(row) == ("P1", None, None, 0)


# --------------------------------------------------------------------------- fake verification
def test_verify_commit_is_disabled_and_cannot_upgrade_skills(env):
    mk, Session = env
    a = mk()
    register(a, "applicant")
    pid = issue(a)
    with Session() as db:
        before = db.query(PassportRecord).filter_by(passport_id=pid).one()
        snap = (before.claims_json, before.payload_json, before.role_match_score, before.sha256_hash)
    for client in (a, mk()):  # signed-in owner and anonymous alike
        r = client.post(f"{A}/passports/verify-commit", json={"passport_id": pid, "skill": "React", "repo_url": "x/y",
                                                              "commit_sha": "deadbeefdeadbeef", "commit_message": "m", "lines_authored": 999})
        assert r.status_code == 410
    with Session() as db:
        after = db.query(PassportRecord).filter_by(passport_id=pid).one()
        assert (after.claims_json, after.payload_json, after.role_match_score, after.sha256_hash) == snap


def test_client_cannot_inject_skill_states(env):
    mk, _ = env
    a = mk()
    register(a, "applicant")
    r = a.post(f"{A}/analyze", json={**INTAKE, "skills": [{"skill": "Kubernetes", "state": "V"}], "claim_state": "Verified"})
    states = {s["name"]: s["claim_state"] for s in r.json()["passport"]["skills"]}
    assert "Kubernetes" not in states
    assert "Verified" not in states.values()      # nothing can be Verified before a passed micro-check


# --------------------------------------------------------------------------- GitHub ownership
def test_oauth_path_is_ownership_verified_and_sealed(env):
    mk, Session = env
    a = mk()
    register(a, "applicant")
    a.cookies.set(SESSION_COOKIE_NAME, create_session_token(github_login="alexrivera-dev", github_id=4242))
    r = a.post(f"{A}/verify", json=INTAKE)
    assert r.status_code == 200, r.text
    p = r.json()["passport"]
    assert p["ownership"] == "oauth_verified" and p["github_id"] == 4242 and p["github_login"] == "alexrivera-dev"
    pid = r.json()["passport_id"]
    assert a.get(f"{A}/passports/{pid}/verify").json()["valid"] is True
    detail = a.get(f"{A}/passports/{pid}").json()
    assert detail["ownershipVerified"] is True
    with Session() as db:
        assert db.query(UserRecord).one().github_login == "alexrivera-dev"


def test_verify_requires_github_session(env):
    mk, _ = env
    a = mk()
    register(a, "applicant")
    r = a.post(f"{A}/verify", json=INTAKE)
    assert r.status_code == 401 and "github" in r.json()["detail"].lower()


def test_url_fallback_is_labelled_ownership_unverified_and_capped(env):
    mk, _ = env
    a = mk()
    register(a, "applicant")
    r = a.post(f"{A}/analyze", json=INTAKE)
    assert r.status_code == 200
    p = r.json()["passport"]
    assert p["ownership"] == "unverified" and p["github_id"] is None
    pid = r.json()["passport_id"]
    assert a.get(f"{A}/passports/{pid}").json()["ownershipVerified"] is False
    # Answer every quiz question with a strong answer: still never Verified without proven ownership.
    for q in a.get(f"{A}/passports/{pid}/quiz").json():
        a.post(f"{A}/passports/{pid}/quiz/answers", json={"answers": [{"question_id": q["question_id"], "answer_text":
               "I did not use that; the module handles requests with a reducer, async fetch calls and error handling in the repository."}]})
    after = a.get(f"{A}/passports/{pid}").json()
    assert all(s["claim_state"] != "Verified" for s in after["passport"]["skills"])
    assert after["passport"]["ownership"] == "unverified"
    assert a.get(f"{A}/passports/{pid}/verify").json()["valid"] is True


def test_quiz_update_preserves_oauth_identity(env):
    mk, _ = env
    a = mk()
    register(a, "applicant")
    a.cookies.set(SESSION_COOKIE_NAME, create_session_token(github_login="alexrivera-dev", github_id=4242))
    pid = a.post(f"{A}/verify", json=INTAKE).json()["passport_id"]
    q = a.get(f"{A}/passports/{pid}/quiz").json()[0]
    out = a.post(f"{A}/passports/{pid}/quiz/answers", json={"answers": [{"question_id": q["question_id"], "answer_text":
                 "I wrote this with hooks and a REST client; the commit history shows the iterations and tests."}]}).json()
    assert out["passport"]["ownership"] == "oauth_verified" and out["passport"]["github_id"] == 4242
    assert a.get(f"{A}/passports/{pid}/verify").json()["valid"] is True


def test_github_failure_is_reported_not_faked(env, monkeypatch):
    mk, _ = env
    a = mk()
    register(a, "applicant")

    class Boom:
        def __init__(self, *a, **k): pass
        def get_repo_metadata(self, *a, **k): raise RateLimitError("rate limit exceeded")

    monkeypatch.setattr("backend.verification.verifier.GitHubClient", Boom)
    r = a.post(f"{A}/analyze", json={**INTAKE, "allow_network": True})
    assert r.status_code == 503 and "no verification result" in r.json()["detail"].lower()


def test_offline_fixtures_cannot_be_enabled_by_clients(env, monkeypatch):
    from backend.api import routes
    monkeypatch.delenv("PROOFPASS_OFFLINE_FIXTURES")
    assert routes._effective_allow_network(False) is True      # a client's allow_network=false is ignored in production
    monkeypatch.setenv("PROOFPASS_OFFLINE_FIXTURES", "1")
    assert routes._effective_allow_network(False) is False


def test_profile_url_uses_only_the_users_own_repos(env):
    from backend.verification.models import Claim
    from backend.verification.verifier import merge_verification_results, parse_github_profile, verify_github_source

    class FakeClient:
        def list_user_repos(self, login, limit=30):
            return [{"name": "forked", "fork": True, "size": 10}, {"name": "empty", "size": 0}, {"name": "ok", "size": 5}]
    seen = []
    import backend.verification.verifier as v
    original = v.verify
    v.verify = lambda **kw: seen.append(kw["github_url"]) or original(claims=[], github_url=kw["github_url"], allow_network=False)
    try:
        verify_github_source([Claim(skill="React", resume_pointer="x")], "https://github.com/someone", github_client=FakeClient())
    finally:
        v.verify = original
    assert seen == ["https://github.com/someone/ok"]                   # forks and empty repos are ignored
    assert parse_github_profile("https://github.com/someone") == "someone"
    assert merge_verification_results([], []).evidence == []


# --------------------------------------------------------------------------- canonical integrity
def test_canonical_hash_is_checkable_by_anyone(env):
    mk, _ = env
    a, anyone = mk(), mk()
    register(a, "applicant")
    out = a.post(f"{A}/analyze", json=INTAKE).json()
    payload, sealed = out["passport"], out["sha256_hash"]
    ok = anyone.post(f"{A}/integrity/check", json={"payload": payload, "hash": sealed}).json()
    assert ok["valid"] is True and ok["computed_hash"] == sealed and ok["scheme"] == "canonical-json-sha256-v1"
    payload["skills"][0]["claim_state"] = "Verified" if payload["skills"][0]["claim_state"] != "Verified" else "Claimed"
    bad = anyone.post(f"{A}/integrity/check", json={"payload": payload, "hash": sealed}).json()
    assert bad["valid"] is False and bad["computed_hash"] != sealed
    assert a.get(f"{A}/passports/{out['passport_id']}").json()["sha256_hash"] == sealed


def test_ownership_cap_downgrades_verified_only_without_oauth():
    from backend.api.orchestrator import apply_ownership_cap
    from backend.intelligence.models import ClaimState, SkillAssessment

    def fresh():
        return [SkillAssessment(name="React", claim_state=ClaimState.VERIFIED, credibility=0.95),
                SkillAssessment(name="Go", claim_state=ClaimState.CLAIMED)]
    capped = apply_ownership_cap(fresh(), "unverified")
    assert [a.claim_state for a in capped] == [ClaimState.SUPPORTED, ClaimState.CLAIMED]
    assert capped[0].credibility <= 0.6 and any("Ownership Unverified" in (i.label or "") for i in capped[0].evidence_chain)
    kept = apply_ownership_cap(fresh(), "oauth_verified")
    assert [a.claim_state for a in kept] == [ClaimState.VERIFIED, ClaimState.CLAIMED]
