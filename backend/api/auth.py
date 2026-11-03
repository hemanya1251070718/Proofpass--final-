"""
GitHub OAuth and Session Management Module for ProofPass.
Provides OAuth start, callback, session verification, and logout routes.
Never stores or logs raw GitHub access tokens.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from typing import Optional, Tuple
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Environment configuration
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = os.getenv(
    "GITHUB_REDIRECT_URI",
    "http://localhost:8000/api/v1/auth/github/callback",
)

_session_secret_env = os.getenv("SESSION_SECRET")
if _session_secret_env and _session_secret_env.strip():
    SESSION_SECRET = _session_secret_env.strip()
else:
    SESSION_SECRET = secrets.token_urlsafe(48)
    logger.warning("SESSION_SECRET is unset. Generated a random session secret; sessions will reset on restart.")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",")[0].strip()

SESSION_COOKIE_NAME = "proofpass_session"
STATE_COOKIE_NAME = "proofpass_oauth_state"
SESSION_DURATION_SECONDS = 1800  # 30 minutes
STATE_DURATION_SECONDS = 600     # 10 minutes


def _is_secure_cookie() -> bool:
    return FRONTEND_ORIGIN.startswith("https://") or os.getenv("COOKIE_SECURE", "false").lower() == "true"


def _get_session_secret() -> str:
    return os.getenv("SESSION_SECRET") or SESSION_SECRET


def _sign_data(data: str, secret: Optional[str] = None) -> str:
    """Signs arbitrary string with HMAC-SHA256."""
    s = secret or _get_session_secret()
    sig = hmac.new(s.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{data}.{sig}"


def _verify_and_unpack(signed_data: str, secret: Optional[str] = None) -> Optional[str]:
    """Verifies HMAC-SHA256 signature and returns original string."""
    if not signed_data or "." not in signed_data:
        return None
    data, sig = signed_data.rsplit(".", 1)
    s = secret or _get_session_secret()
    expected = hmac.new(s.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected):
        return data
    return None


def create_session_token(
    github_login: str,
    github_id: int,
    avatar_url: Optional[str] = None,
    expires_in: int = SESSION_DURATION_SECONDS,
    secret: Optional[str] = None,
) -> str:
    """Creates a signed, time-limited session token."""
    payload = {
        "github_login": github_login,
        "github_id": int(github_id),
        "avatar_url": avatar_url or "",
        "exp": int(time.time()) + expires_in,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii")
    return _sign_data(b64, secret)


def decode_session_token(token: str, secret: Optional[str] = None) -> Optional[dict]:
    """Decodes and validates signed session token, checking expiry."""
    b64 = _verify_and_unpack(token, secret)
    if not b64:
        return None
    try:
        raw = base64.urlsafe_b64decode(b64.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def create_state_token(secret: Optional[str] = None) -> Tuple[str, str]:
    """Creates a random OAuth state and its signed cookie representation."""
    state = secrets.token_urlsafe(32)
    raw = f"{state}:{int(time.time())}"
    signed = _sign_data(raw, secret)
    return state, signed


def verify_state_token(state: str, signed_cookie: str, secret: Optional[str] = None) -> bool:
    """Verifies that the state parameter matches the signed state cookie within TTL."""
    raw = _verify_and_unpack(signed_cookie, secret)
    if not raw or ":" not in raw:
        return False
    cookie_state, ts_str = raw.split(":", 1)
    try:
        ts = int(ts_str)
        if int(time.time()) - ts > STATE_DURATION_SECONDS:
            return False
    except ValueError:
        return False
    return hmac.compare_digest(state, cookie_state)


def get_current_session(request: Request) -> Optional[dict]:
    """Retrieves authenticated GitHub session from request cookie."""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return decode_session_token(token)


class AuthMeResponse(BaseModel):
    github_login: str
    github_id: int
    avatar_url: Optional[str] = None


auth_router = APIRouter(prefix="/auth", tags=["GitHub Authentication"])


@auth_router.get("/github/start")
def github_auth_start(request: Request):
    """
    Initiates GitHub OAuth flow with scope read:user only.
    Generates cryptographic state and sets signed httpOnly cookie.
    """
    client_id = os.getenv("GITHUB_CLIENT_ID", GITHUB_CLIENT_ID)
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI", GITHUB_REDIRECT_URI)

    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GitHub OAuth is not configured. Missing GITHUB_CLIENT_ID.",
        )

    state, signed_state = create_state_token()
    authorize_url = (
        "https://github.com/login/oauth/authorize"
        f"?client_id={quote(client_id)}"
        f"&redirect_uri={quote(redirect_uri)}"
        "&scope=read:user"
        f"&state={quote(state)}"
    )

    response = RedirectResponse(url=authorize_url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        key=STATE_COOKIE_NAME,
        value=signed_state,
        max_age=STATE_DURATION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_is_secure_cookie(),
        path="/",
    )
    return response


@auth_router.get("/github/callback")
async def github_auth_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    """
    Handles GitHub OAuth callback:
    - Validates state cookie against parameter
    - Exchanges code for access token
    - Fetches user login, numeric id, and avatar_url
    - Discards access token immediately without logging or storing
    - Sets signed 30-minute httpOnly session cookie and redirects to frontend intake
    """
    intake_page = f"{FRONTEND_ORIGIN}/verify"

    # User cancelled on GitHub or access was denied
    if error:
        err_msg = error_description or error
        logger.info(f"GitHub OAuth authorization cancelled or denied by user: {err_msg}")
        return RedirectResponse(
            url=f"{intake_page}?auth_error=cancelled&desc={quote(err_msg)}",
            status_code=status.HTTP_302_FOUND,
        )

    if not code or not state:
        return RedirectResponse(
            url=f"{intake_page}?auth_error=state_missing",
            status_code=status.HTTP_302_FOUND,
        )

    cookie_state = request.cookies.get(STATE_COOKIE_NAME)
    if not cookie_state or not verify_state_token(state, cookie_state):
        logger.warning("GitHub OAuth callback state mismatch or expired cookie.")
        return RedirectResponse(
            url=f"{intake_page}?auth_error=state_mismatch",
            status_code=status.HTTP_302_FOUND,
        )

    client_id = os.getenv("GITHUB_CLIENT_ID", GITHUB_CLIENT_ID)
    client_secret = os.getenv("GITHUB_CLIENT_SECRET", GITHUB_CLIENT_SECRET)
    redirect_uri = os.getenv("GITHUB_REDIRECT_URI", GITHUB_REDIRECT_URI)

    # Exchange authorization code for token
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            token_res = await client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json"},
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
            )
            token_data = token_res.json()
            access_token = token_data.get("access_token")

            if not access_token:
                err_detail = token_data.get(
                    "error_description",
                    token_data.get("error", "Failed to retrieve access token"),
                )
                logger.warning(f"OAuth code exchange failed: {err_detail}")
                return RedirectResponse(
                    url=f"{intake_page}?auth_error=token_exchange_failed",
                    status_code=status.HTTP_302_FOUND,
                )

            # Retrieve profile using the temporary token
            user_res = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "ProofPass-Auth/2.0",
                },
            )

            # DISCARD ACCESS TOKEN IMMEDIATELY: never log, store, or serialize it.
            del access_token

            if user_res.status_code != 200:
                logger.error(f"GitHub user profile fetch failed with status {user_res.status_code}")
                return RedirectResponse(
                    url=f"{intake_page}?auth_error=github_down",
                    status_code=status.HTTP_302_FOUND,
                )

            user_data = user_res.json()
            login = str(user_data.get("login", "")).strip()
            gh_id = int(user_data.get("id", 0))
            avatar_url = str(user_data.get("avatar_url", "")).strip()

            if not login or not gh_id:
                return RedirectResponse(
                    url=f"{intake_page}?auth_error=invalid_user",
                    status_code=status.HTTP_302_FOUND,
                )

    except Exception as exc:
        logger.error(f"GitHub API communication failure: {exc}")
        return RedirectResponse(
            url=f"{intake_page}?auth_error=github_down",
            status_code=status.HTTP_302_FOUND,
        )

    # Create signed session cookie (30 min TTL)
    session_token = create_session_token(
        github_login=login,
        github_id=gh_id,
        avatar_url=avatar_url,
    )

    response = RedirectResponse(
        url=f"{intake_page}?auth_success=1",
        status_code=status.HTTP_302_FOUND,
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        max_age=SESSION_DURATION_SECONDS,
        httponly=True,
        samesite="lax",
        secure=_is_secure_cookie(),
        path="/",
    )
    # Clear one-time state cookie
    response.delete_cookie(key=STATE_COOKIE_NAME, path="/")
    return response


@auth_router.get("/me", response_model=AuthMeResponse)
def auth_me(request: Request):
    """Returns active authenticated GitHub identity or 401."""
    session = get_current_session(request)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated or session expired.",
        )
    return AuthMeResponse(
        github_login=session["github_login"],
        github_id=session["github_id"],
        avatar_url=session.get("avatar_url"),
    )


class GitHubSessionProbe(BaseModel):
    connected: bool
    github_login: Optional[str] = None
    github_id: Optional[int] = None
    avatar_url: Optional[str] = None


@auth_router.get("/github/session", response_model=GitHubSessionProbe)
def github_session_probe(request: Request):
    """Always 200: whether a GitHub OAuth session exists (avoids a 401 on every Verify visit)."""
    session = get_current_session(request)
    if not session:
        return GitHubSessionProbe(connected=False)
    return GitHubSessionProbe(connected=True, github_login=session["github_login"],
                              github_id=session["github_id"], avatar_url=session.get("avatar_url"))


@auth_router.post("/logout")
def auth_logout(response: Response):
    """Terminates active session and clears httpOnly session cookie."""
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"ok": True, "message": "Logged out successfully."}


class AuthConfigResponse(BaseModel):
    github_oauth_configured: bool


@auth_router.get("/config", response_model=AuthConfigResponse)
def auth_config():
    """Returns whether GitHub OAuth is configured on this server. Never returns secrets."""
    client_id = os.getenv("GITHUB_CLIENT_ID", GITHUB_CLIENT_ID)
    client_secret = os.getenv("GITHUB_CLIENT_SECRET", GITHUB_CLIENT_SECRET)
    configured = bool(client_id and client_id.strip() and client_secret and client_secret.strip())
    return {"github_oauth_configured": configured}

