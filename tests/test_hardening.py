"""
Final hardening: legacy passports, cookie/CORS/CSRF together, quota failures (never synthetic evidence),
persistence guard, dataset start-up, session probes and raw-content fetching.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import database
from backend.api.auth import SESSION_COOKIE_NAME, create_session_token
from backend.database import Base, PassportRecord, get_db
from backend.main import app
from backend.recommendations import course_import
from backend.verification.github_client import GitHubClient, RateLimitError
from backend.verification.models import Claim
from tests.auth_helpers import register
from tests.rec_helpers import write_csv

A = "/api/v1"
REPO = Path(__file__).resolve().parents[1]
INTAKE = {"resume_text": "Alex Rivera\nReact, Python, Docker developer.", "github_url": "https://github.com/alexrivera-dev/portfolio",
          "target_role": "Full-Stack Engineer", "consent": True, "allow_network": False}


@pytest.fixture
def env():
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
    yield (lambda: TestClient(app)), Session
    if saved is not None:
        app.dependency_overrides[get_db] = saved
    else:
        app.dependency_overrides.pop(get_db, None)


# ------------------------------------------------------------------ 4. legacy unowned passports
def _legacy(Session):
    with Session() as db:
        db.add(PassportRecord(passport_id="PP-LEGACY-1", target_role="Dev", role_match_score=0.0, candidate_consent=True, status="issued",
                              sha256_hash="client-hash", payload_json=json.dumps({"id": "PP-LEGACY-1", "candidate": "Old", "skills": []}),
                              claims_json="[]", verification_json="{}", quiz_questions_json="[]", quiz_history_json="{}", is_demo=False))
        db.commit()
        return db.query(PassportRecord).one().payload_json


def test_applicant_cannot_access_modify_or_claim_a_legacy_passport(env):
    mk, Session = env
    snapshot = _legacy(Session)
    a = mk()
    register(a, "applicant")
    pid = "PP-LEGACY-1"
    assert a.get(f"{A}/passports").json() == []
    for method, path, kw in [("get", f"/passports/{pid}", {}), ("get", f"/passports/{pid}/quiz", {}), ("get", f"/passports/{pid}/verify", {}),
                             ("delete", f"/passports/{pid}", {}), ("patch", f"/passports/{pid}/sharing", {"json": {"revoked": True}}),
                             ("post", f"/passports/{pid}/quiz/answers", {"json": {"answers": [{"question_id": "q", "answer_text": "x"}]}})]:
        assert getattr(a, method)(A + path, **kw).status_code == 404, path
    # "claiming" by re-posting the same id, or by asking the pipeline to reuse it, is impossible
    assert a.post(f"{A}/passports", json={"id": pid, "passport_id": pid, "skills": []}).status_code == 410
    r = a.post(f"{A}/analyze", json={**INTAKE, "passport_id": pid, "id": pid})
    assert r.status_code == 200 and r.json()["passport_id"] != pid
    with Session() as db:
        rec = db.query(PassportRecord).filter_by(passport_id=pid).one()
        assert rec.owner_id is None and rec.payload_json == snapshot


def test_no_code_path_assigns_an_owner_to_an_existing_passport():
    """Static guard: owner_id is only ever set when a record is constructed by the verification pipeline."""
    hits = []
    for path in (REPO / "backend").rglob("*.py"):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(r"\.owner_id\s*=(?!=)", line) or re.search(r"update\(\{[^}]*owner_id", line):
                hits.append(f"{path.name}:{n}")
    assert hits == []


# ------------------------------------------------------------------ 5. cookie + CORS + CSRF together
def test_cors_preflight_only_allows_configured_origins(env):
    mk, _ = env
    c = mk()
    ok = c.options(f"{A}/passports/x/sharing", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH"})
    evil = c.options(f"{A}/passports/x/sharing", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "PATCH"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert ok.headers.get("access-control-allow-credentials") == "true"
    assert "access-control-allow-origin" not in evil.headers


def test_cross_origin_protected_writes_are_rejected_even_with_a_valid_cookie(env):
    mk, Session = env
    victim = mk()
    register(victim, "applicant")
    pid = victim.post(f"{A}/analyze", json=INTAKE).json()["passport_id"]
    evil = {"Origin": "https://evil.example"}
    attempts = [("delete", f"/passports/{pid}", {}), ("patch", f"/passports/{pid}/sharing", {"json": {"revoked": True}}),
                ("post", "/account/logout", {}), ("patch", "/account/profile", {"json": {"profile": {"x": 1}}}),
                ("post", "/analyze", {"json": INTAKE}), ("post", "/account/logout-all", {})]
    for method, path, kw in attempts:
        assert getattr(victim, method)(A + path, headers=evil, **kw).status_code == 403, path
    assert victim.get(f"{A}/passports/{pid}", headers=evil).status_code == 200    # reads are not state changes
    assert victim.get(f"{A}/account/me").status_code == 200                          # session survived every forged request
    with Session() as db:
        assert db.query(PassportRecord).filter_by(passport_id=pid).one().share_revoked is False
    # opaque origins (sandboxed iframes, some redirects) are rejected too
    assert victim.delete(f"{A}/passports/{pid}", headers={"Origin": "null"}).status_code == 403
    # a legitimate same-site browser request still works
    assert victim.patch(f"{A}/passports/{pid}/sharing", headers={"Origin": "http://localhost:5173"}, json={"revoked": True}).status_code == 200


def test_login_and_register_are_protected_against_login_csrf(env):
    mk, _ = env
    c = mk()
    body = {"role": "applicant", "name": "N", "email": "csrf@example.com", "password": "correct-horse-battery-9"}
    assert c.post(f"{A}/account/register", json=body, headers={"Origin": "https://evil.example"}).status_code == 403
    assert c.post(f"{A}/account/login", json={"email": "csrf@example.com", "password": "x" * 9}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert not c.cookies.get("proofpass_account")


def test_same_origin_deployment_origin_matches_host_even_behind_tls_proxy(env):
    mk, _ = env
    c = mk()
    c.post(f"{A}/account/register", json={"role": "applicant", "name": "N", "email": "h@example.com", "password": "correct-horse-battery-9"})
    r = c.post(f"{A}/account/logout", headers={"Origin": "https://proof.example.com", "Host": "proof.example.com"})
    assert r.status_code == 200      # SPA served by the backend: Origin == https://<Host>


def test_production_cookie_is_secure_httponly_lax(env, monkeypatch):
    mk, _ = env
    monkeypatch.setenv("COOKIE_SECURE", "true")
    r = mk().post(f"{A}/account/register", json={"role": "applicant", "name": "N", "email": "p@example.com", "password": "correct-horse-battery-9"})
    flags = r.headers["set-cookie"].lower()
    assert "secure" in flags and "httponly" in flags and "samesite=lax" in flags


def test_wildcard_cors_origin_is_dropped_when_credentials_are_enabled():
    code = ("import os; os.environ['CORS_ORIGINS']='*,https://ok.example';"
            "from backend.main import app;"
            "m=[x for x in app.user_middleware if x.cls.__name__=='CORSMiddleware'][0];"
            "print(m.kwargs['allow_origins'])")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=REPO, env={**__import__('os').environ, "DATABASE_URL": "sqlite://"})
    assert "['https://ok.example']" in out.stdout, out.stdout + out.stderr


# ------------------------------------------------------------------ 8. quota failures never produce evidence
def test_rate_limited_github_returns_503_and_persists_nothing(env, monkeypatch):
    mk, Session = env
    import backend.verification.verifier as v

    class Limited:
        def __init__(self, *a, **k): pass
        def get_repo_metadata(self, *a, **k): raise RateLimitError("API rate limit exceeded")
        def list_user_repos(self, *a, **k): raise RateLimitError("API rate limit exceeded")

    monkeypatch.setattr(v, "GitHubClient", Limited)
    monkeypatch.setattr(v, "_run_offline_verification", lambda *a, **k: (_ for _ in ()).throw(AssertionError("synthetic fixture used")))
    a = mk()
    register(a, "applicant")
    for url in ("https://github.com/someone/repo", "https://github.com/someone"):
        r = a.post(f"{A}/analyze", json={**INTAKE, "github_url": url, "allow_network": True})
        assert r.status_code == 503, url
        assert "no verification result" in r.json()["detail"].lower()
    with Session() as db:
        assert db.query(PassportRecord).count() == 0


def test_partial_quota_failure_keeps_only_real_evidence(monkeypatch):
    import backend.verification.verifier as v
    from backend.verification.models import Evidence, RepoMetadata, TrustCeiling, UsageDepth, VerificationResult

    claims = [Claim(skill="React", resume_pointer="x")]
    good = VerificationResult(provenance=TrustCeiling.PLATFORM_VERIFIED, repo=RepoMetadata(),
                              evidence=[Evidence(claim_id=claims[0].claim_id, skill="React", file_exists=True, file_path="src/App.tsx", usage_depth=UsageDepth.MODERATE, repo="u/ok")])
    calls = []

    def fake_verify(**kw):
        calls.append(kw["github_url"])
        if kw["github_url"].endswith("/first"):
            raise RateLimitError("limit")
        return good

    class Client:
        def list_user_repos(self, login, limit=30):
            return [{"name": "first", "size": 5}, {"name": "ok", "size": 5}]

    monkeypatch.setattr(v, "verify", fake_verify)
    monkeypatch.setattr(v, "_run_offline_verification", lambda *a, **k: (_ for _ in ()).throw(AssertionError("synthetic fixture used")))
    res = v.verify_github_source(claims, "https://github.com/u", github_client=Client())
    assert [e.file_path for e in res.evidence] == ["src/App.tsx"] and len(calls) == 2


def test_raw_file_fetch_does_not_spend_the_api_quota():
    sess = MagicMock()
    ok = MagicMock(status_code=200, ok=True, content=b"print('hi')")
    sess.get.return_value = ok
    c = GitHubClient(session=sess, prefer_raw_content=True)
    assert c.get_file_content("o", "r", "src/a b.py", "main") == "print('hi')"
    url = sess.get.call_args[0][0]
    assert url.startswith("https://raw.githubusercontent.com/o/r/main/src/a%20b.py") and "api.github.com" not in url
    assert c.get_file_content("o", "r", "src/a b.py", "main") == "print('hi')" and sess.get.call_count == 1   # cached
    sess.get.return_value = MagicMock(status_code=404, ok=False)
    assert c.get_file_content("o", "r", "missing.py", "main") is None
    sess.get.return_value = MagicMock(status_code=429, ok=False)
    with pytest.raises(RateLimitError):
        c.get_file_content("o", "r", "other.py", "main")


def test_raw_fetch_falls_back_to_contents_api_on_unexpected_status():
    import base64
    sess = MagicMock()
    raw_fail = MagicMock(status_code=500, ok=False)
    api = MagicMock(status_code=200, ok=True, headers={"Content-Type": "application/json"})
    api.json.return_value = {"content": base64.b64encode(b"data").decode(), "encoding": "base64"}
    sess.get.side_effect = [raw_fail, api]
    assert GitHubClient(token="t", session=sess, prefer_raw_content=True).get_file_content("o", "r", "f.txt", "main") == "data"


# ------------------------------------------------------------------ 7. free-plan persistence honesty
def test_render_free_plan_starts_on_ephemeral_sqlite_and_says_so(monkeypatch, caplog):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("RENDER_DISK_PATH", raising=False)
    monkeypatch.setattr(database, "DATABASE_URL", "sqlite:///./proofpass.db")
    st = database.persistence_status()
    assert st["persistent"] is False and "erased" in st["reason"]
    database.warn_if_ephemeral()          # must not raise: the Free plan has to start
    assert "EPHEMERAL DATABASE" in caplog.text


@pytest.mark.parametrize("url,disk,persistent", [("sqlite:///./proofpass.db", "", False), ("sqlite:////tmp/x.db", "", False),
                                                  ("sqlite:////data/proofpass.db", "/data", True), ("postgresql://u:p@h/db", "", True)])
def test_persistence_is_only_claimed_when_true(monkeypatch, url, disk, persistent):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("RENDER_DISK_PATH", disk) if disk else monkeypatch.delenv("RENDER_DISK_PATH", raising=False)
    monkeypatch.setattr(database, "DATABASE_URL", url)
    assert database.persistence_status()["persistent"] is persistent


def test_local_sqlite_is_fine_and_health_reports_it(env, monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("RENDER_SERVICE_ID", raising=False)
    mk, _ = env
    assert mk().get(f"{A}/health").json()["persistent_storage"] is True


def test_health_reports_ephemeral_storage_on_render_free(env, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("RENDER_DISK_PATH", raising=False)
    monkeypatch.setattr(database, "DATABASE_URL", "sqlite:///./proofpass.db")
    mk, _ = env
    h = mk().get(f"{A}/health").json()
    assert h["persistent_storage"] is False and "erased" in h["storage_note"]


def test_render_blueprint_is_free_plan_with_no_paid_resources():
    text = (REPO / "render.yaml").read_text(encoding="utf-8")
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    assert "plan: free" in code
    for paid in ("plan: starter", "plan: standard", "plan: pro", "disk:", "mountPath", "databases:", "type: pserv", "type: redis", "type: keyvalue"):
        assert paid not in code, paid
    assert "sqlite:///./proofpass.db" in code
    for secret in ("GITHUB_CLIENT_SECRET", "GITHUB_TOKEN"):
        block = code[code.index(secret):code.index(secret) + 120]
        assert "sync: false" in block and "value:" not in block.split("sync: false")[0]


def test_dockerfile_does_not_require_persistent_storage_or_a_paid_service():
    docker = (REPO / "Dockerfile").read_text(encoding="utf-8")
    assert "ALLOW_EPHEMERAL_DB" not in docker and "/data" not in docker.replace("backend/data", "")


# ------------------------------------------------------------------ 6. dataset in the container
def test_startup_without_dataset_never_fails(tmp_path, monkeypatch):
    monkeypatch.delenv("COURSE_CSV_URL", raising=False)
    assert course_import.ensure_catalogue(tmp_path / "missing.csv") is None


def test_startup_imports_a_baked_in_dataset(tmp_path, monkeypatch):
    from tests.rec_helpers import make_session_factory
    Session = make_session_factory()
    monkeypatch.setattr(course_import, "SessionLocal", Session)
    stats = course_import.ensure_catalogue(write_csv(tmp_path / "c.csv"))
    assert stats is not None and stats.technical == 5
    with Session() as db:
        assert db.query(course_import.Course).count() == 5


def test_dataset_download_rules(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="https"):
        course_import.download_csv("http://insecure.example/c.csv", tmp_path / "c.csv")

    class FakeResp:
        def __init__(self, data): self.data = data
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def raise_for_status(self): pass
        def iter_bytes(self): yield self.data

    import httpx
    payload = b"a,b\n1,2\n"
    monkeypatch.setattr(httpx, "stream", lambda *a, **k: FakeResp(payload))
    import hashlib
    good = hashlib.sha256(payload).hexdigest()
    assert course_import.download_csv("https://x.example/c.csv", tmp_path / "ok.csv", good).read_bytes() == payload
    with pytest.raises(ValueError, match="SHA256"):
        course_import.download_csv("https://x.example/c.csv", tmp_path / "bad.csv", "0" * 64)
    assert not (tmp_path / "bad.csv").exists()
    # the failure path of the start-up hook swallows the error instead of killing the container
    monkeypatch.setenv("COURSE_CSV_URL", "https://x.example/c.csv")
    monkeypatch.setenv("COURSE_CSV_SHA256", "0" * 64)
    assert course_import.ensure_catalogue(tmp_path / "later.csv") is None


def test_dockerfile_installs_git_and_runs_dataset_startup():
    docker = (REPO / "Dockerfile").read_text(encoding="utf-8")
    ignore = (REPO / ".dockerignore").read_text(encoding="utf-8")
    assert "git" in docker.split("apt-get install")[1].split("&&")[0]            # blame needs git
    assert "course_import --startup" in docker
    assert "backend/data/*" in ignore and "!backend/data/CourseraDataset-Clean.csv" in ignore


# ------------------------------------------------------------------ 10. session probes
def test_session_probes_do_not_return_401_when_signed_out(env):
    mk, _ = env
    c = mk()
    r = c.get(f"{A}/account/session")
    assert r.status_code == 200 and r.json() == {"user": None}
    assert c.get(f"{A}/account/me").status_code == 401                            # strict endpoint unchanged
    g = c.get(f"{A}/auth/github/session")
    assert g.status_code == 200 and g.json()["connected"] is False
    assert c.get(f"{A}/auth/me").status_code == 401
    register(c, "applicant")
    assert c.get(f"{A}/account/session").json()["user"]["role"] == "applicant"
    c.cookies.set(SESSION_COOKIE_NAME, create_session_token(github_login="octo", github_id=7))
    g2 = c.get(f"{A}/auth/github/session").json()
    assert g2["connected"] is True and g2["github_login"] == "octo"
    assert "token" not in json.dumps(g2).lower()


# ------------------------------------------------------------------ 1. OAuth identity binding (mocked GitHub)
def test_one_github_identity_cannot_back_two_accounts(env):
    mk, _ = env
    a, b = mk(), mk()
    register(a, "applicant"); register(b, "applicant")
    for client in (a, b):
        client.cookies.set(SESSION_COOKIE_NAME, create_session_token(github_login="octo", github_id=99))
    assert a.post(f"{A}/verify", json={k: v for k, v in INTAKE.items() if k != "github_url"}).status_code == 200
    r = b.post(f"{A}/verify", json={k: v for k, v in INTAKE.items() if k != "github_url"})
    assert r.status_code == 409 and "already linked" in r.json()["detail"]
    assert a.post(f"{A}/verify", json={k: v for k, v in INTAKE.items() if k != "github_url"}).status_code == 200    # the owner can verify again


def test_oauth_state_and_callback_rejections(env, monkeypatch):
    mk, _ = env
    monkeypatch.setenv("GITHUB_CLIENT_ID", "cid")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")
    c = mk()
    start = c.get(f"{A}/auth/github/start", follow_redirects=False)
    assert start.status_code == 302 and "state=" in start.headers["location"] and "proofpass_oauth_state" in start.headers["set-cookie"]
    assert "httponly" in start.headers["set-cookie"].lower()
    no_cookie = mk().get(f"{A}/auth/github/callback?code=abc&state=forged", follow_redirects=False)
    assert "auth_error=state_mismatch" in no_cookie.headers["location"]
    assert "proofpass_session" not in no_cookie.headers.get("set-cookie", "")        # no session without a valid state
    assert "auth_error=state_missing" in c.get(f"{A}/auth/github/callback", follow_redirects=False).headers["location"]


def test_oauth_callback_to_verified_passport_with_mocked_github(env, monkeypatch):
    """Full code path start -> callback -> session -> /verify. GitHub itself is MOCKED here (no credentials available)."""
    from urllib.parse import parse_qs, urlsplit
    mk, _ = env
    monkeypatch.setenv("GITHUB_CLIENT_ID", "cid")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "test-secret")

    class FakeResp:
        def __init__(self, data, status=200): self._d, self.status_code = data, status
        def json(self): return self._d

    class FakeAsyncClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, **k):
            assert url == "https://github.com/login/oauth/access_token" and k["data"]["code"] == "good-code"
            return FakeResp({"access_token": "gho_FAKE_TOKEN_NEVER_STORED"})
        async def get(self, url, **k):
            assert url == "https://api.github.com/user" and k["headers"]["Authorization"] == "Bearer gho_FAKE_TOKEN_NEVER_STORED"
            return FakeResp({"login": "alexrivera-dev", "id": 8847291, "avatar_url": "https://a/x.png"})

    monkeypatch.setattr("backend.api.auth.httpx.AsyncClient", FakeAsyncClient)
    c = mk()
    register(c, "applicant")
    start = c.get(f"{A}/auth/github/start", follow_redirects=False)
    state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
    bad = c.get(f"{A}/auth/github/callback?code=good-code&state=WRONG", follow_redirects=False)
    assert "auth_error=state_mismatch" in bad.headers["location"] and c.get(f"{A}/auth/github/session").json()["connected"] is False
    ok = c.get(f"{A}/auth/github/callback?code=good-code&state={state}", follow_redirects=False)
    assert ok.status_code == 302 and "auth_success=1" in ok.headers["location"]
    session = c.get(f"{A}/auth/github/session").json()
    assert session["connected"] and session["github_login"] == "alexrivera-dev" and session["github_id"] == 8847291
    assert "gho_FAKE" not in json.dumps(session) and "gho_FAKE" not in "".join(ok.headers.values())     # token never stored or sent on
    r = c.post(f"{A}/verify", json={k: v for k, v in INTAKE.items() if k != "github_url"})
    assert r.status_code == 200
    p = r.json()["passport"]
    assert p["ownership"] == "oauth_verified" and p["github_id"] == 8847291
    assert c.get(f"{A}/account/me").json()["user"]["githubLogin"] == "alexrivera-dev"      # identity bound to the ProofPass account
