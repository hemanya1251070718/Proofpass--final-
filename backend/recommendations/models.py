"""SQLAlchemy models for Part 1 (registered on the shared ``Base``)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text

from backend.database import Base


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    url_norm = Column(String(512), nullable=False, unique=True, index=True)
    url = Column(String(512), nullable=False)
    title = Column(String(512), nullable=False)
    provider = Column(String(255), nullable=True)
    category = Column(String(128), nullable=True, index=True)
    level = Column(String(32), nullable=True)  # Beginner | Intermediate | Advanced | None
    rating = Column(Float, nullable=True)  # None = unavailable (CSV 0 / invalid)
    review_count = Column(Integer, nullable=False, default=0)
    duration_hours = Column(Float, nullable=True)
    skills_json = Column(Text, nullable=False, default="[]")  # raw "Skill gain" items
    outcomes = Column(Text, nullable=True)
    tech_score = Column(Float, nullable=False, default=0.0, index=True)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class CourseSkill(Base):
    """Canonical ProofPass skill -> course link with the strength of the evidence for it."""

    __tablename__ = "course_skills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    course_id = Column(Integer, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
    skill = Column(String(64), nullable=False)
    source = Column(String(16), nullable=False)  # skill_gain | outcomes | title
    strength = Column(Float, nullable=False)

    __table_args__ = (
        Index("ix_course_skills_skill", "skill"),
        Index("ix_course_skills_course", "course_id"),
    )


class GithubCache(Base):
    __tablename__ = "github_cache"

    cache_key = Column(String(64), primary_key=True)
    payload_json = Column(Text, nullable=False)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
