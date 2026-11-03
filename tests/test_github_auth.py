"""
Tests for GitHub OAuth and authenticated verification flow:
- State mismatch rejected
- User cancellation handled
- Token never appears in logs, responses, or cookies
- Expired session rejected (401)
- Verify without session rejected (401)
- Verify rejects repo owned by someone else (400)
- Verify ignores spoofed github_url, sets ownership_verified=True, and puts github_id into passport
- Logout clears session cookie
"""
from __future__ import annotations

import logging
import os
import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.api.auth import (
    STATE_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    create_session_token,
    create_state_token,
)

@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def applicant(client):
    from tests.auth_helpers import register
    return register(client, "applicant")


@pytest.fixture(autouse=True)
def setup_auth_env(monkeypatch):
    monkeypatch.setenv("GITHUB_CLIENT_ID", "test_client_id_123")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "test_client_secret_456")
    monkeypatch.setenv("GITHUB_REDIRECT_URI", "http://localhost:8000/api/v1/auth/github/callback")
    monkeypatch.setenv("SESSION_SECRET", "test_session_secret_789")
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:5173")
    monkeypatch.setenv("INTELLIGENCE_LLM_API_KEY", "")


def test_auth_config_endpoint(client):
    res = client.get("/api/v1/auth/config")
    assert res.status_code == 200
    data = res.json()
    assert "github_oauth_configured" in data
    assert data["github_oauth_configured"] is True



def test_oauth_start_redirects_with_state_cookie(client):
    res = client.get("/api/v1/auth/github/start", follow_redirects=False)
    assert res.status_code == 302
    location = res.headers["location"]
    assert "https://github.com/login/oauth/authorize" in location
    assert "client_id=test_client_id_123" in location
    assert "scope=read%3Auser" in location or "scope=read:user" in location
    assert "state=" in location
    assert STATE_COOKIE_NAME in res.cookies


def test_callback_state_mismatch_rejected(client):
    # Provide mismatched state
    state, signed = create_state_token()
    client.cookies.set(STATE_COOKIE_NAME, signed)

    res = client.get(
        "/api/v1/auth/github/callback?code=testcode&state=wrong_state",
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert "auth_error=state_mismatch" in res.headers["location"]


def test_callback_user_cancelled(client):
    res = client.get(
        "/api/v1/auth/github/callback?error=access_denied&error_description=The+user+has+denied+your+application",
        follow_redirects=False,
    )
    assert res.status_code == 302
    assert "auth_error=cancelled" in res.headers["location"]


def test_callback_successful_exchange_and_token_never_in_logs_or_responses(client, caplog):
    caplog.set_level(logging.DEBUG)

    state, signed = create_state_token()
    client.cookies.set(STATE_COOKIE_NAME, signed)

    secret_token = "gho_SUPER_SECRET_GITHUB_TOKEN_DO_NOT_LEAK"

    import httpx
    mock_token_resp = httpx.Response(
        200,
        json={"access_token": secret_token, "token_type": "bearer"},
    )
    mock_user_resp = httpx.Response(
        200,
        json={
            "login": "verified_candidate",
            "id": 12345678,
            "avatar_url": "https://avatars.githubusercontent.com/u/12345678",
        },
    )

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_token_resp), \
         patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_user_resp):

        res = client.get(
            f"/api/v1/auth/github/callback?code=valid_code&state={state}",
            follow_redirects=False,
        )

    assert res.status_code == 302
    assert "auth_success=1" in res.headers["location"]
    assert SESSION_COOKIE_NAME in res.cookies

    # CRITICAL: Token must never appear in response body, headers, cookies, or logs
    assert secret_token not in res.text
    assert secret_token not in str(res.headers)
    assert secret_token not in str(res.cookies)
    assert secret_token not in caplog.text


def test_auth_me_valid_session(client):
    token = create_session_token(github_login="octocat", github_id=583231, avatar_url="https://example.com/a.png")
    client.cookies.set(SESSION_COOKIE_NAME, token)

    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    data = res.json()
    assert data["github_login"] == "octocat"
    assert data["github_id"] == 583231
    assert data["avatar_url"] == "https://example.com/a.png"


def test_expired_session_rejected_by_auth_me_and_verify(client):
    # Session expired 60 seconds ago
    expired_token = create_session_token(github_login="octocat", github_id=583231, expires_in=-60)
    client.cookies.set(SESSION_COOKIE_NAME, expired_token)

    # 1. auth/me rejects
    res_me = client.get("/api/v1/auth/me")
    assert res_me.status_code == 401

    # 2. verify rejects
    res_verify = client.post(
        "/api/v1/verify",
        json={
            "resume_text": "Alex Rivera\nReact, Python Developer",
            "target_role": "Full-Stack Engineer",
            "consent": True,
        },
    )
    assert res_verify.status_code == 401
    assert "Authentication required" in res_verify.json()["detail"]


def test_verify_without_session_returns_401(client):
    client.cookies.clear()
    res = client.post(
        "/api/v1/verify",
        json={
            "resume_text": "Alex Rivera\nReact, Python Developer",
            "target_role": "Full-Stack Engineer",
            "consent": True,
        },
    )
    assert res.status_code == 401
    assert "Authentication required" in res.json()["detail"]


def test_verify_rejects_repo_owned_by_someone_else(client, applicant):
    token = create_session_token(github_login="alexrivera", github_id=987654)
    client.cookies.set(SESSION_COOKIE_NAME, token)

    res = client.post(
        "/api/v1/verify",
        json={
            "resume_text": "Alex Rivera\nReact, Python Developer with 5 years experience",
            "github_url": "https://github.com/torvalds/linux",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "not owned by authenticated user @alexrivera" in detail


def test_verify_ignores_spoofed_github_url_and_sets_ownership_and_id(client, applicant):
    token = create_session_token(github_login="alexrivera", github_id=987654)
    client.cookies.set(SESSION_COOKIE_NAME, token)

    payload = {
        "resume_text": "Alex Rivera\nReact and Python engineer.\nBuilt full stack apps.",
        "github_url": "https://github.com/alexrivera/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": True,
        "allow_network": False,
    }

    res = client.post("/api/v1/verify", json=payload)
    assert res.status_code == 200
    data = res.json()

    passport = data["passport"]
    # github_id and github_login must be present in passport
    assert passport.get("github_id") == 987654
    assert passport.get("github_login") == "alexrivera"

    # Evidence derived from repo must have ownership_verified = True
    skills = passport.get("skills", [])
    assert len(skills) > 0
    repo_ev_found = False
    for skill in skills:
        for ev in skill.get("evidence_chain", []):
            if ev.get("source") == "repo":
                repo_ev_found = True
                assert ev.get("ownership_verified") is True
    assert repo_ev_found


def test_auth_logout_clears_session(client):
    token = create_session_token(github_login="octocat", github_id=583231)
    client.cookies.set(SESSION_COOKIE_NAME, token)

    res = client.post("/api/v1/auth/logout")
    assert res.status_code == 200
    # Cookie should be deleted via Set-Cookie header
    set_cookie_headers = res.headers.get_list("set-cookie")
    assert any(SESSION_COOKIE_NAME in h for h in set_cookie_headers)
