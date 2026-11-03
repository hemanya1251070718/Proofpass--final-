"""
ProofPass M2: Database and Persistence Layer.
SQLite persistence using SQLAlchemy.
"""
from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Generator

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, create_engine, event, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "proofpass.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)


def _enable_sqlite_foreign_keys(dbapi_conn, _record) -> None:
    """SQLite ignores foreign keys unless this pragma is set on every connection."""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


if DATABASE_URL.startswith("sqlite"):
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class UserRecord(Base):
    """Registered account. The role is assigned once at registration and never accepted from later requests."""
    __tablename__ = "users"

    id = Column(String(32), primary_key=True)
    email = Column(String(254), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False)  # applicant | recruiter
    display_name = Column(String(120), nullable=False)
    profile_json = Column(Text, nullable=False, default="{}")
    github_id = Column(Integer, nullable=True)
    github_login = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)


class SessionRecord(Base):
    """Server-side login session. Only the SHA-256 of the cookie token is stored."""
    __tablename__ = "sessions"

    token_hash = Column(String(64), primary_key=True)
    user_id = Column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False, index=True)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class PassportRecord(Base):
    """
    SQLAlchemy model storing candidate passports, verification states, and integrity hashes.
    """
    __tablename__ = "passports"

    passport_id = Column(String(64), primary_key=True, index=True)
    target_role = Column(String(255), nullable=False)
    role_match_score = Column(Float, nullable=False, default=0.0)
    candidate_consent = Column(Boolean, nullable=False, default=True)
    status = Column(String(32), nullable=False, default="issued")
    sha256_hash = Column(String(64), nullable=False)
    payload_json = Column(Text, nullable=False)
    target_role_json = Column(Text, nullable=True)
    claims_json = Column(Text, nullable=False)
    verification_json = Column(Text, nullable=False)
    quiz_questions_json = Column(Text, nullable=False)
    quiz_history_json = Column(Text, nullable=False, default="{}")
    is_demo = Column(Boolean, nullable=False, default=False)
    github_id = Column(Integer, nullable=True, index=True)
    # Ownership. NULL = unassigned (legacy / batch-screening records): visible to recruiters only.
    owner_id = Column(String(32), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    ownership = Column(String(24), nullable=True)  # oauth_verified | unverified | NULL (legacy)
    share_revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


def persistence_status() -> dict:
    """Whether user data survives a restart/redeploy.

    ProofPass is deployed on Render's Free plan with SQLite on the container filesystem, which is EPHEMERAL:
    accounts and passports are lost on every deploy and whenever the free instance restarts or spins down after
    idling. This is reported honestly (health endpoint, startup log, login notice) instead of being hidden.
    Persistence is only claimed for a non-SQLite URL, a local run, or a path under RENDER_DISK_PATH (a mounted disk).
    """
    on_render = bool(os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))
    if not DATABASE_URL.startswith("sqlite"):
        return {"persistent": True, "reason": "external database", "on_render": on_render}
    if not on_render:
        return {"persistent": True, "reason": "local sqlite file", "on_render": False}
    disk = os.getenv("RENDER_DISK_PATH", "").rstrip("/")
    path = DATABASE_URL.split("///", 1)[-1]
    if disk and path.startswith(disk + "/"):
        return {"persistent": True, "reason": f"sqlite on mounted disk {disk}", "on_render": True}
    return {"persistent": False,
            "reason": "Demo storage: data is kept on an ephemeral filesystem and is erased on every redeploy or restart.",
            "on_render": True}


def warn_if_ephemeral() -> None:
    """Never blocks startup (the Free plan must run); logs loudly so nobody mistakes it for durable storage."""
    st = persistence_status()
    if not st["persistent"]:
        import logging
        logging.getLogger("proofpass").error("EPHEMERAL DATABASE: %s Accounts and passports do not survive restarts.", st["reason"])


def get_db() -> Generator[Session, None, None]:
    """Dependency that yields a database session and closes it afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first release: (table, column, DDL type). Applied only if missing; never destructive.
_ADDITIVE_COLUMNS = [
    ("passports", "github_id", "INTEGER"),
    ("passports", "owner_id", "VARCHAR(32) REFERENCES users(id)"),
    ("passports", "ownership", "VARCHAR(24)"),
    ("passports", "share_revoked", "BOOLEAN NOT NULL DEFAULT 0"),
]


def migrate_schema(target_engine=None) -> None:
    """Additive, idempotent migration for databases created by earlier versions. Never drops or rewrites data."""
    eng = target_engine or engine
    insp = inspect(eng)
    for table, column, ddl in _ADDITIVE_COLUMNS:
        if not insp.has_table(table):
            continue
        if column in {c["name"] for c in insp.get_columns(table)}:
            continue
        with eng.begin() as conn:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}'))


def init_db(target_engine=None) -> None:
    """Creates tables if they do not exist, then applies additive column migrations."""
    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)
    migrate_schema(eng)


init_db()
