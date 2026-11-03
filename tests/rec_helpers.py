"""Shared helpers for Part 1/3 tests: isolated SQLite DB + small Coursera-style CSV."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
import backend.recommendations.models  # noqa: F401  (registers tables)

HEADER = "Course Title,Rating,Level,Schedule,What you will learn,Skill gain,Modules,Instructor,Offered By,Keyword,Course Url,Duration to complete (Approx.),Number of Review"

ROWS = [
    # tech course with Skill gain
    'Python for Everybody,4.8,Beginner level,Flexible,Learn Python basics,"Python Programming, Data Structure",M1,Chuck,UMich,Computer Science,https://www.coursera.org/learn/python,30.0,1000',
    # duplicate of the above (different casing / query string / trailing slash), fewer reviews
    'Python for Everybody (dup),4.8,Beginner level,Flexible,Learn Python basics,"Python Programming",M1,Chuck,UMich,Computer Science,HTTPS://WWW.coursera.org/learn/python/?utm=x,30.0,10',
    # rating 0 -> unavailable, missing skill gain but tech category
    'Docker Essentials,0.0,Intermediate level,Flexible,Not specified,Not specified,M1,Bob,IBM,Information Technology,https://www.coursera.org/learn/docker,10.0,0',
    'Docker Deep Dive,4.6,Intermediate level,Flexible,Not specified,"Docker, Kubernetes",M1,Bob,IBM,Information Technology,https://www.coursera.org/learn/docker-deep,12.0,300',
    # non-technical
    'Pixel Art for Video Games,4.5,Beginner level,Flexible,Not specified,"Art, Creativity",M1,Ann,MSU,Arts and Humanities,https://www.coursera.org/learn/pixel-art,9.0,227',
    # non-tech category but real technical skill in Skill gain -> kept
    'Analytics in Python for Marketers,4.2,Intermediate level,Flexible,Not specified,"Python Programming, Marketing",M1,Zed,X,Business,https://www.coursera.org/learn/mkt-python,8.0,50',
    # weak-only skill in non-tech category -> dropped
    'Public Health Statistics,4.4,Beginner level,Flexible,Not specified,"Statistics, Public Health",M1,Zed,X,Health,https://www.coursera.org/learn/ph-stats,8.0,50',
    # invalid rows
    ',4.0,Beginner level,Flexible,x,Python,M1,A,B,Computer Science,https://www.coursera.org/learn/notitle,1.0,1',
    'Bad URL Course,4.0,Beginner level,Flexible,x,Python,M1,A,B,Computer Science,not-a-url,1.0,1',
    # non-English
    'Programación en Python para principiantes,4.9,Beginner level,Flexible,x,Python Programming,M1,A,B,Computer Science,https://www.coursera.org/learn/py-es,1.0,500',
    # malformed numerics must not crash
    'Linux Basics,abc,Not specified,Flexible,Not specified,Linux,M1,A,B,Computer Science,https://www.coursera.org/learn/linux,xx,yy',
]


def write_csv(path: Path, rows=ROWS, header: str = HEADER) -> Path:
    path.write_text(header + "\n" + "\n".join(rows) + "\n", encoding="utf-8")
    return path


def make_session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)
