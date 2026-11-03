import sys
from pathlib import Path

# Put repo root on sys.path so `from backend...` works
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import os

import pytest
from backend.intelligence.fixtures import (
    MOCK_CLAIMS, MOCK_VERIFICATION_STRONG, MOCK_VERIFICATION_CONFLICT,
    MOCK_VERIFICATION_WEAK, MOCK_TARGET_ROLE, MOCK_CODE_SNIPPETS, MOCK_COMMIT_MESSAGES,
)


@pytest.fixture
def claims():
    return MOCK_CLAIMS


@pytest.fixture
def verification_strong():
    return MOCK_VERIFICATION_STRONG


@pytest.fixture
def verification_conflict():
    return MOCK_VERIFICATION_CONFLICT


@pytest.fixture
def verification_weak():
    return MOCK_VERIFICATION_WEAK


@pytest.fixture
def target_role():
    return MOCK_TARGET_ROLE


@pytest.fixture
def code_snippets():
    return MOCK_CODE_SNIPPETS


@pytest.fixture
def commit_messages():
    return MOCK_COMMIT_MESSAGES

# Synthetic fixture repositories exist for tests only; production leaves this flag unset.
os.environ["PROOFPASS_OFFLINE_FIXTURES"] = "1"


@pytest.fixture(autouse=True)
def _reset_security_state():
    from backend import accounts
    accounts.reset_throttle_for_tests()
    accounts.reset_rate_limits_for_tests()
    yield


@pytest.fixture(autouse=True)
def _isolated_database():
    """Each test gets an empty in-memory database unless the test module installs its own get_db override."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from backend.main import app
    from backend.database import Base, get_db
    import backend.recommendations.models  # noqa: F401  (registers Part 1 tables)

    installed = False
    if get_db not in app.dependency_overrides:
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=eng)
        Session = sessionmaker(autocommit=False, autoflush=False, bind=eng)

        def _override():
            db = Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override
        installed = True
    yield
    if installed:
        app.dependency_overrides.pop(get_db, None)
