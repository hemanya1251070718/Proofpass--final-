import time

import httpx
import pytest

from backend.recommendations import config, github_practice as gp
from backend.recommendations.models import GithubCache
from tests.rec_helpers import make_session_factory


def raw_issue(n=1, **kw):
    d = {"title": f"Issue {n}", "html_url": f"https://github.com/o/r/issues/{n}", "state": "open",
         "repository_url": "https://api.github.com/repos/o/r", "body": "A reasonably long description of the problem to fix.",
         "labels": [{"name": "good first issue"}], "comments": 1, "updated_at": "2026-10-30T00:00:00Z", "created_at": "2026-10-01T00:00:00Z",
         "assignee": None}
    d.update(kw)
    return d


class Mock:
    """httpx client whose handler returns queued (status, json, headers) tuples."""
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []
        self.client = httpx.Client(transport=httpx.MockTransport(self._handle))

    def _handle(self, request):
        self.calls.append(request)
        if not self.responses:
            raise AssertionError("unexpected extra HTTP call")
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        status, body, headers = (r + ({},))[:3] if len(r) == 2 else r
        return httpx.Response(status, json=body, headers=headers)


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    gp.reset_rate_state()
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    yield
    gp.reset_rate_state()


@pytest.fixture
def db():
    s = make_session_factory()()
    yield s
    s.close()


def test_query_is_built_from_language_and_keyword():
    assert 'language:Python' in gp.build_query("Python", "good first issue")
    q = gp.build_query("Docker", "good first issue")
    assert "language:" not in q and "docker in:title,body" in q and "is:issue" in q and "no:assignee" in q
    assert gp.build_query("Photoshop", "good first issue") is None


def test_live_then_cache(db):
    m = Mock((200, {"items": [raw_issue(1), raw_issue(2)]}, {"x-ratelimit-remaining": "9", "x-ratelimit-reset": "9999999999"}))
    r1 = gp.practice_for_skill(db, "Python", 5, client=m.client)
    assert r1["source"] == "live" and len(r1["items"]) == 2 and r1["items"][0]["is_fallback"] is False
    assert "hint only" in r1["items"][0]["label_note"]
    r2 = gp.practice_for_skill(db, "Python", 5, client=m.client)   # no extra HTTP call allowed
    assert r2["source"] == "cache" and len(m.calls) == 1
    assert gp.rate_snapshot()["remaining"] == 9


def test_filters_unsuitable_items(db):
    items = [raw_issue(1, pull_request={"url": "x"}), raw_issue(2, body="short"), raw_issue(3, comments=40), raw_issue(4, assignee={"login": "a"}), raw_issue(5)]
    r = gp.practice_for_skill(db, "Python", 5, client=Mock((200, {"items": items})).client)
    assert [i["title"] for i in r["items"]] == ["Issue 5"]


def test_falls_back_to_help_wanted_when_no_good_first_issues(db):
    m = Mock((200, {"items": []}), (200, {"items": [raw_issue(7, labels=[{"name": "help wanted"}])]}))
    r = gp.practice_for_skill(db, "Python", 3, client=m.client)
    assert r["source"] == "live" and r["items"][0]["matched_label"] == "help wanted" and len(m.calls) == 2


def test_rate_limit_returns_labelled_fallback_and_blocks_further_calls(db):
    m = Mock((403, {"message": "rate limit"}, {"retry-after": "60"}))
    r = gp.practice_for_skill(db, "Python", 3, client=m.client)
    assert r["source"] == "fallback" and r["items"][0]["is_fallback"] is True
    assert r["items"][0]["url"].startswith("https://github.com/search?q=") and r["warnings"]
    r2 = gp.practice_for_skill(db, "Docker", 3, client=m.client)   # blocked: must not call GitHub again
    assert r2["source"] == "fallback" and len(m.calls) == 1


def test_quota_exhausted_header_stops_calls(db):
    m = Mock((429, {}, {"x-ratelimit-remaining": "0", "x-ratelimit-reset": str(int(time.time()) + 600)}))
    gp.practice_for_skill(db, "Python", 3, client=m.client)
    r = gp.practice_for_skill(db, "Java", 3, client=m.client)
    assert r["source"] == "fallback" and len(m.calls) == 1


def test_network_error_and_server_error_fall_back(db):
    r = gp.practice_for_skill(db, "Python", 3, client=Mock(httpx.ConnectError("boom")).client)
    assert r["source"] == "fallback" and "network" in r["warnings"][0]
    gp.reset_rate_state()
    r = gp.practice_for_skill(db, "Go", 3, client=Mock((502, {})).client)
    assert r["source"] == "fallback"


def test_stale_cache_served_when_github_unavailable(db):
    gp.practice_for_skill(db, "Python", 3, client=Mock((200, {"items": [raw_issue(1)]})).client)
    row = db.query(GithubCache).first()
    row.expires_at = row.fetched_at  # expire it
    db.commit()
    r = gp.practice_for_skill(db, "Python", 3, client=Mock((503, {})).client)
    assert r["source"] == "stale_cache" and r["items"][0]["title"] == "Issue 1"


def test_unmapped_skill_makes_no_request(db):
    m = Mock()
    r = gp.practice_for_skill(db, "Photoshop", 3, client=m.client)
    assert r["source"] == "unmapped" and r["items"] == [] and not m.calls


def test_token_sent_only_in_backend_header(db, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret")
    m = Mock((200, {"items": [raw_issue(1)]}))
    r = gp.practice_for_skill(db, "Python", 3, client=m.client)
    assert m.calls[0].headers["authorization"] == "Bearer ghp_secret"
    assert "ghp_secret" not in repr(r)               # never leaks into the response
    assert gp.rate_snapshot()["authenticated"] is True


def test_frontend_does_not_reference_github_token():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "frontend"
    # Scoped to Parts 1/3 files. (Pre-existing engine/step1_read.js reads VITE_GITHUB_TOKEN; out of scope.)
    for p in [root / "src/api/recommendations.js", root / "src/components/Recommendations.jsx"]:
        assert "GITHUB_TOKEN" not in p.read_text(encoding="utf-8", errors="ignore"), p


def test_title_keyword_hits_rank_first_and_irrelevant_items_dropped(db):
    items = [raw_issue(1, title="Docs cleanup", body="mentions docker once in the body of a long enough text here"),
             raw_issue(2, title="Add Docker healthcheck", body="A reasonably long description of the problem to fix."),
             raw_issue(3, title="Unrelated", body="A reasonably long description with nothing relevant at all in it.")]
    r = gp.practice_for_skill(db, "Docker", 5, client=Mock((200, {"items": items})).client)
    assert [i["title"] for i in r["items"]] == ["Add Docker healthcheck", "Docs cleanup"]   # title > body, no-hit dropped
