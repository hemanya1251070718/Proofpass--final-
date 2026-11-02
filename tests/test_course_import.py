import json

import pytest

from backend.recommendations import course_import as ci
from backend.recommendations import course_service
from backend.recommendations.models import Course, CourseSkill
from tests.rec_helpers import make_session_factory, write_csv


@pytest.fixture
def db(tmp_path):
    Session = make_session_factory()
    s = Session()
    yield s
    s.close()


@pytest.fixture
def csv_path(tmp_path):
    return write_csv(tmp_path / "c.csv")


def test_normalize_url():
    assert ci.normalize_url("HTTPS://WWW.coursera.org/learn/python/?utm=x#a") == "https://coursera.org/learn/python"
    assert ci.normalize_url("not-a-url") is None
    assert ci.normalize_url("") is None
    assert ci.normalize_url("https://coursera.org/") is None


def test_import_stats_and_filters(db, csv_path):
    st = ci.import_courses(csv_path, session=db)
    assert st.rows_read == 11
    assert st.rejected == {"missing_title": 1, "invalid_url": 1}
    assert st.non_english == 1
    assert st.rows_read == sum(st.rejected.values()) + st.duplicates_removed + st.unique_courses
    assert st.unique_courses == st.non_english + st.non_technical + st.technical
    assert st.duplicates_removed == 1
    titles = {c.title for c in db.query(Course).all()}
    assert "Pixel Art for Video Games" not in titles           # non-technical
    assert "Public Health Statistics" not in titles            # weak-only skill outside tech category
    assert "Analytics in Python for Marketers" in titles       # real tech skill outside tech category
    assert "Python for Everybody" in titles and "Python for Everybody (dup)" not in titles  # best duplicate kept
    assert db.query(Course).count() == st.inserted == 5


def test_rating_zero_and_bad_numbers_are_unavailable(db, csv_path):
    ci.import_courses(csv_path, session=db)
    docker = db.query(Course).filter(Course.title == "Docker Essentials").one()
    assert docker.rating is None and docker.review_count == 0
    linux = db.query(Course).filter(Course.title == "Linux Basics").one()
    assert linux.rating is None and linux.duration_hours is None and linux.level is None


def test_skill_gain_is_primary_signal(db, csv_path):
    ci.import_courses(csv_path, session=db)
    py = db.query(Course).filter(Course.title == "Python for Everybody").one()
    links = {(l.skill, l.source, l.strength) for l in db.query(CourseSkill).filter_by(course_id=py.id)}
    assert ("python", "skill_gain", 1.0) in links and ("dsa", "skill_gain", 0.85) in links
    assert json.loads(py.skills_json) == ["Python Programming", "Data Structure"]


def test_import_is_idempotent_and_syncs(db, tmp_path, csv_path):
    ci.import_courses(csv_path, session=db)
    first = db.query(Course).count(), db.query(CourseSkill).count()
    st2 = ci.import_courses(csv_path, session=db)
    assert (db.query(Course).count(), db.query(CourseSkill).count()) == first
    assert st2.inserted == 0 and st2.updated == first[0] and st2.removed == 0
    # removing a row from the file removes it from the DB
    rows = [r for r in __import__("tests.rec_helpers", fromlist=["ROWS"]).ROWS if "Docker Deep Dive" not in r]
    ci.import_courses(write_csv(tmp_path / "c2.csv", rows), session=db)
    assert db.query(Course).filter(Course.title == "Docker Deep Dive").count() == 0


def test_missing_columns_and_file(db, tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError):
        ci.import_courses(bad, session=db)
    with pytest.raises(FileNotFoundError):
        ci.import_courses(tmp_path / "nope.csv", session=db)


def test_dry_run_writes_nothing(db, csv_path):
    st = ci.import_courses(csv_path, session=db, dry_run=True)
    assert st.technical == 5 and db.query(Course).count() == 0


def test_course_ranking_and_levels(db, csv_path):
    ci.import_courses(csv_path, session=db)
    res = course_service.courses_for_skill(db, "Docker", "C", limit=5)
    assert [c["title"] for c in res][0] == "Docker Deep Dive"     # rated + reviewed beats unrated
    assert all(c["source"] == "coursera_catalogue" for c in res)
    unrated = next(c for c in res if c["title"] == "Docker Essentials")
    assert unrated["rating"] is None and "No rating available" in unrated["reasons"]
    # deterministic
    assert res == course_service.courses_for_skill(db, "Docker", "C", limit=5)


def test_rating_confidence_prefers_reviewed_courses():
    few = course_service.rating_confidence(5.0, 3)
    many = course_service.rating_confidence(4.7, 20000)
    assert many > few
    assert course_service.rating_confidence(None, 0) < course_service.rating_confidence(4.0, 100)


def test_level_fit():
    assert course_service.level_fit("Beginner", "Beginner") == 1.0
    assert course_service.level_fit("Advanced", "Beginner") < course_service.level_fit("Intermediate", "Beginner")


def test_sql_injection_and_wildcards_are_inert(db, csv_path):
    ci.import_courses(csv_path, session=db)
    assert course_service.courses_for_skill(db, "'; DROP TABLE courses; --", None) == []
    assert db.query(Course).count() == 5
    assert course_service.courses_for_skill(db, "%%%", None) == []


def test_skill_link_strength_tiers_and_exclusions():
    d = lambda skills, title, out="": {k: (src, st) for k, src, st in ci.derive_skill_links(skills, title, out)}
    # title names the skill -> strongest; early Skill-gain item -> 0.85; late -> 0.6; broad survey list -> 0.45
    assert d(["Python Programming"], "Python for Everybody")["python"] == ("skill_gain", 1.0)
    assert d(["Docker", "Linux"], "Intro to Containers")["docker"] == ("skill_gain", 0.85)
    assert d(["a", "b", "c", "Docker"], "Intro")["docker"] == ("skill_gain", 0.6)
    assert d(["x"] * 9 + ["Docker"], "Intro")["docker"] == ("skill_gain", 0.45)
    # "React Native" must not count as React in a title; NoSQL must not count as SQL
    assert "react" not in d([], "React Native Basics") and "react native" in d([], "React Native Basics")
    assert "sql" not in d([], "Intro to NoSQL Databases")
    # outcomes-only mentions are weak (0.4) and below the recommendation threshold
    assert d([], "Intro", "you will learn docker")["docker"] == ("outcomes", 0.4)
    assert 0.4 < course_service.MIN_RELEVANCE


def test_weak_links_not_recommended_and_known_skill_has_no_text_fallback(db, tmp_path):
    rows = ['Cloud Databases,4.5,Beginner level,Flex,Learn about redis caching,Not specified,M,A,B,Computer Science,https://www.coursera.org/learn/clouddb,5.0,500']
    ci.import_courses(write_csv(tmp_path / "w.csv", rows), session=db)
    assert db.query(CourseSkill).filter_by(skill="redis").one().strength == 0.4
    assert course_service.courses_for_skill(db, "Redis", "C") == []
