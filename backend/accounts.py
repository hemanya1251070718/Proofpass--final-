"""
Account security for ProofPass: Argon2id password hashing, server-side sessions and
authorization dependencies. The GitHub OAuth flow in backend/api/auth.py is reused as-is for
GitHub ownership; this module only establishes *who the ProofPass user is*.

Rules enforced here (and nowhere else):
  - roles are `applicant` or `recruiter`, chosen once at registration and never accepted afterwards
  - the cookie holds a random token; only its SHA-256 is stored, so a database leak cannot be replayed
  - protected endpoints derive identity from the cookie, never from a client-supplied user id
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from backend.api import auth as github_auth
from backend.database import SessionRecord, UserRecord, get_db

ROLES = ("applicant", "recruiter")
ACCOUNT_COOKIE = "proofpass_account"
SESSION_TTL = timedelta(days=int(os.getenv("ACCOUNT_SESSION_DAYS", "7")))
IDLE_REFRESH = timedelta(minutes=10)

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$")
MIN_PASSWORD, MAX_PASSWORD = 8, 128

# Argon2id with the library's RFC 9106 "low memory" profile defaults; tunable via env for slow hosts.
_hasher = PasswordHasher(
    type=Type.ID,
    time_cost=int(os.getenv("ARGON2_TIME_COST", "3")),
    memory_cost=int(os.getenv("ARGON2_MEMORY_KIB", "65536")),
    parallelism=int(os.getenv("ARGON2_PARALLELISM", "2")),
)
_DUMMY_HASH = _hasher.hash("proofpass-dummy-password")  # equalises timing for unknown emails


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def validate_password(pw: str) -> None:
    if not isinstance(pw, str) or not (MIN_PASSWORD <= len(pw) <= MAX_PASSWORD):
        raise ValueError(f"Password must be {MIN_PASSWORD}-{MAX_PASSWORD} characters.")
    if pw.strip() == "" or pw.lower() in {"password", "12345678", "password1", "qwertyui"}:
        raise ValueError("Password is too weak.")


def hash_password(pw: str) -> str:
    return _hasher.hash(pw)


def verify_password(stored_hash: Optional[str], pw: str) -> bool:
    try:
        return _hasher.verify(stored_hash or _DUMMY_HASH, pw) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def normalize_email(email: str) -> str:
    e = (email or "").strip().lower()
    if len(e) > 254 or not EMAIL_RE.match(e):
        raise ValueError("A valid email address is required.")
    return e


# ---------------------------------------------------------------------------
# Login throttling (in-memory, per email + client; enough to stop online guessing on one instance)
# ---------------------------------------------------------------------------
_FAIL_LIMIT, _FAIL_WINDOW = 5, 15 * 60
_fails: Dict[str, List[float]] = {}
_fails_lock = threading.Lock()


def _throttle_key(request: Request, email: str) -> str:
    return f"{email}|{request.client.host if request.client else '?'}"


def throttle_check(request: Request, email: str) -> None:
    key, now = _throttle_key(request, email), time.time()
    with _fails_lock:
        recent = [t for t in _fails.get(key, []) if now - t < _FAIL_WINDOW]
        _fails[key] = recent
        if len(recent) >= _FAIL_LIMIT:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed sign-in attempts. Try again later.")


def throttle_fail(request: Request, email: str) -> None:
    with _fails_lock:
        _fails.setdefault(_throttle_key(request, email), []).append(time.time())


def throttle_reset(request: Request, email: str) -> None:
    with _fails_lock:
        _fails.pop(_throttle_key(request, email), None)


def reset_throttle_for_tests() -> None:
    with _fails_lock:
        _fails.clear()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: UserRecord) -> str:
    now = datetime.utcnow()
    db.query(SessionRecord).filter(SessionRecord.expires_at < now).delete(synchronize_session=False)  # lazy cleanup
    token = secrets.token_urlsafe(32)
    db.add(SessionRecord(token_hash=_hash_token(token), user_id=user.id, created_at=now,
                         expires_at=now + SESSION_TTL, last_seen_at=now))
    user.last_login_at = now
    db.commit()
    return token


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ACCOUNT_COOKIE, value=token, max_age=int(SESSION_TTL.total_seconds()),
        httponly=True, samesite="lax", secure=github_auth._is_secure_cookie(), path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=ACCOUNT_COOKIE, path="/")


def destroy_session(db: Session, token: Optional[str]) -> None:
    if token:
        db.query(SessionRecord).filter(SessionRecord.token_hash == _hash_token(token)).delete(synchronize_session=False)
        db.commit()


def destroy_all_sessions(db: Session, user_id: str) -> int:
    n = db.query(SessionRecord).filter(SessionRecord.user_id == user_id).delete(synchronize_session=False)
    db.commit()
    return n


def lookup_user(db: Session, token: Optional[str]) -> Optional[UserRecord]:
    if not token:
        return None
    row = db.query(SessionRecord).filter(SessionRecord.token_hash == _hash_token(token)).first()
    if row is None:
        return None
    now = datetime.utcnow()
    if row.expires_at < now:
        db.delete(row)
        db.commit()
        return None
    if now - row.last_seen_at > IDLE_REFRESH:
        row.last_seen_at = now
        db.commit()
    return db.query(UserRecord).filter(UserRecord.id == row.user_id).first()


# ---------------------------------------------------------------------------
# CSRF: browsers always send Origin on cross-site POST/PUT/PATCH/DELETE. Cookie auth + SameSite=Lax
# already blocks most cross-site writes; this rejects any state change whose Origin is not ours.
# ---------------------------------------------------------------------------
def _allowed_origins(request: Request) -> set:
    raw = os.getenv("CORS_ORIGINS") or os.getenv("FRONTEND_ORIGIN") or "http://localhost:5173,http://127.0.0.1:5173"
    allowed = {o.strip().rstrip("/") for o in raw.split(",") if o.strip()}
    host = request.headers.get("host")
    if host:
        allowed.add(f"{request.url.scheme}://{host}")
        allowed.add(f"https://{host}")  # behind a TLS-terminating proxy the scheme may read as http
    return allowed


def enforce_same_origin(request: Request) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    origin = request.headers.get("origin")
    if origin is None:
        return  # non-browser client; it cannot ride a victim's cookie
    parts = urlsplit(origin)
    normalized = f"{parts.scheme}://{parts.netloc}"
    if normalized not in _allowed_origins(request):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-origin request rejected.")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------
def current_user_optional(request: Request, db: Session = Depends(get_db)) -> Optional[UserRecord]:
    enforce_same_origin(request)
    return lookup_user(db, request.cookies.get(ACCOUNT_COOKIE))


def require_user(user: Optional[UserRecord] = Depends(current_user_optional)) -> UserRecord:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required.")
    return user


def require_role(*roles: str) -> Callable[..., UserRecord]:
    def dep(user: UserRecord = Depends(require_user)) -> UserRecord:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action requires the {' or '.join(roles)} role.")
        return user
    return dep


require_applicant = require_role("applicant")
require_recruiter = require_role("recruiter")


# ---------------------------------------------------------------------------
# Per-user rate limit for endpoints that spend the shared GitHub search quota
# ---------------------------------------------------------------------------
_calls: Dict[str, List[float]] = {}
_calls_lock = threading.Lock()


def rate_limit(name: str, limit: int, window_seconds: int) -> Callable[..., None]:
    def dep(user: UserRecord = Depends(require_user)) -> None:
        key, now = f"{name}|{user.id}", time.time()
        with _calls_lock:
            recent = [t for t in _calls.get(key, []) if now - t < window_seconds]
            if len(recent) >= limit:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please slow down.")
            recent.append(now)
            _calls[key] = recent
    return dep


def reset_rate_limits_for_tests() -> None:
    with _calls_lock:
        _calls.clear()
