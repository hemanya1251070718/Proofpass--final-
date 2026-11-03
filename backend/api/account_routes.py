"""Account endpoints: register, login, logout, session restore, profile. Mounted at /api/v1/account."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import accounts
from backend.database import UserRecord, get_db

logger = logging.getLogger("proofpass.account")
account_router = APIRouter(prefix="/account", tags=["Accounts"])

MAX_PROFILE_BYTES = 64_000
# Profile keys the UI may store. `role`, `id`, `email` and similar can never be set through the profile.
FORBIDDEN_PROFILE_KEYS = {"role", "id", "user_id", "userId", "email", "password", "password_hash", "is_admin"}


def _clean_profile(profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    profile = dict(profile or {})
    for k in list(profile):
        if k in FORBIDDEN_PROFILE_KEYS:
            profile.pop(k)
    if len(json.dumps(profile)) > MAX_PROFILE_BYTES:
        raise ValueError("Profile is too large.")
    return profile


class RegisterBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    role: Literal["applicant", "recruiter"]
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254)
    password: str = Field(max_length=accounts.MAX_PASSWORD)
    profile: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required.")
        return v


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: str = Field(max_length=254)
    password: str = Field(max_length=accounts.MAX_PASSWORD)


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="ignore")  # a "role" field in this body is silently ignored
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    profile: Dict[str, Any] = Field(default_factory=dict)


def serialize_user(u: UserRecord) -> Dict[str, Any]:
    return {
        "id": u.id, "name": u.display_name, "email": u.email, "role": u.role,
        "profile": json.loads(u.profile_json or "{}"),
        "githubLogin": u.github_login,
        "createdAt": u.created_at.isoformat() if u.created_at else None,
    }


@account_router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterBody, request: Request, response: Response, db: Session = Depends(get_db)):
    accounts.enforce_same_origin(request)
    try:
        email = accounts.normalize_email(body.email)
        accounts.validate_password(body.password)
        profile = _clean_profile(body.profile)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    user = UserRecord(id=uuid.uuid4().hex, email=email, password_hash=accounts.hash_password(body.password),
                      role=body.role, display_name=body.name, profile_json=json.dumps(profile))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")
    accounts.set_session_cookie(response, accounts.create_session(db, user))
    return {"user": serialize_user(user)}


@account_router.post("/login")
def login(body: LoginBody, request: Request, response: Response, db: Session = Depends(get_db)):
    accounts.enforce_same_origin(request)
    try:
        email = accounts.normalize_email(body.email)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    accounts.throttle_check(request, email)
    user = db.query(UserRecord).filter(UserRecord.email == email).first()
    if not accounts.verify_password(user.password_hash if user else None, body.password):
        accounts.throttle_fail(request, email)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    accounts.throttle_reset(request, email)
    accounts.set_session_cookie(response, accounts.create_session(db, user))
    return {"user": serialize_user(user)}


@account_router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    accounts.enforce_same_origin(request)
    accounts.destroy_session(db, request.cookies.get(accounts.ACCOUNT_COOKIE))
    accounts.clear_session_cookie(response)
    return {"ok": True}


@account_router.post("/logout-all")
def logout_all(response: Response, user: UserRecord = Depends(accounts.require_user), db: Session = Depends(get_db)):
    n = accounts.destroy_all_sessions(db, user.id)
    accounts.clear_session_cookie(response)
    return {"ok": True, "sessions_closed": n}


@account_router.get("/session")
def session_probe(user: Optional[UserRecord] = Depends(accounts.current_user_optional)):
    """Session restore for the SPA: always 200 (user is null when signed out), so signed-out visits log no 401."""
    return {"user": serialize_user(user) if user else None}


@account_router.get("/me")
def me(user: UserRecord = Depends(accounts.require_user)):
    return {"user": serialize_user(user)}


@account_router.patch("/profile")
def update_profile(body: ProfileBody, user: UserRecord = Depends(accounts.require_user), db: Session = Depends(get_db)):
    try:
        merged = {**json.loads(user.profile_json or "{}"), **_clean_profile(body.profile)}
        _clean_profile(merged)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    user.profile_json = json.dumps(merged)
    if body.name:
        user.display_name = body.name.strip()
    db.commit()
    return {"user": serialize_user(user)}
