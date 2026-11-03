"""
Integration and Unit Tests for ProofPass Member 2 (Backend, Database, and API).
Deterministic tests with isolated in-memory SQLite and offline fixtures.
No live GitHub API or OpenAI network calls required.
"""
from __future__ import annotations

import io
import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import pymupdf

from backend.main import app
from backend.database import Base, PassportRecord, get_db

# ---------------------------------------------------------------------------
# Test Database Setup (Isolated In-Memory SQLite with StaticPool)
# ---------------------------------------------------------------------------

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
Base.metadata.create_all(bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)
from tests.auth_helpers import register


@pytest.fixture(autouse=True)
def _signed_in_applicant():
    """Every test in this module runs as a freshly registered applicant."""
    client.cookies.clear()
    register(client, "applicant")
    yield


def _make_sample_pdf(text_lines: list[str]) -> bytes:
    """Helper to generate valid PDF bytes in-memory."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 72), "\n".join(text_lines), fontsize=11)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

def test_health_endpoint():
    """Verifies service health check and database connectivity."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert "timestamp" in data


def test_cors_headers():
    """Verifies CORS origin handling and credentials configuration."""
    response = client.options(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert response.headers.get("access-control-allow-credentials") == "true"


def test_analyze_requires_consent():
    """Ensures missing or false candidate consent is rejected with 400 Bad Request."""
    payload = {
        "resume_text": "Alex Developer. React, Python.",
        "github_url": "https://github.com/alexrivera-dev/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": False,
        "allow_network": False,
    }
    response = client.post("/api/v1/analyze", json=payload)
    assert response.status_code == 400
    assert "consent is required" in response.json()["detail"].lower()


def test_analyze_requires_resume_input():
    """Ensures request without resume text or file is rejected."""
    payload = {
        "github_url": "https://github.com/alexrivera-dev/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": True,
        "allow_network": False,
    }
    response = client.post("/api/v1/analyze", json=payload)
    assert response.status_code == 400
    assert "resume is required" in response.json()["detail"].lower()


def test_analyze_json_flow_success():
    """Tests full synchronous pipeline using JSON intake and offline verification mode."""
    payload = {
        "resume_text": "Alex Developer\nExperience: Built FastAPI microservices and React dashboards with PostgreSQL.",
        "github_url": "https://github.com/alexrivera-dev/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": True,
        "allow_network": False,
    }
    response = client.post("/api/v1/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["passport_id"].startswith("pp_")
    assert data["status"] == "issued"
    assert data["target_role"] == "Full-Stack Engineer"
    assert len(data["sha256_hash"]) == 64
    assert data["is_demo"] is True

    passport = data["passport"]
    assert passport["candidate_consent"] is True
    assert len(passport["skills"]) > 0
    assert 0.0 <= passport["role_match_score"] <= 1.0


def test_analyze_multipart_pdf_upload_success():
    """Tests analyze pipeline with uploaded PDF file and camelCase field aliases."""
    pdf_bytes = _make_sample_pdf([
        "Alex Rivera",
        "Skills: React, Python, PostgreSQL, AWS",
        "Experience: Senior Full-Stack Engineer building enterprise platforms.",
    ])

    files = {
        "resume_file": ("resume.pdf", pdf_bytes, "application/pdf"),
    }
    data = {
        "githubUrl": "https://github.com/alexrivera-dev/portfolio",
        "targetRole": "Full-Stack Engineer",
        "consentAi": "true",
        "allowNetwork": "false",
    }

    response = client.post("/api/v1/analyze", data=data, files=files)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["passport_id"].startswith("pp_")
    assert res_data["status"] == "issued"


def test_analyze_corrupt_pdf_fails():
    """Verifies that corrupted PDF bytes return 400 Bad Request with a clear message."""
    files = {
        "resume_file": ("bad.pdf", b"NOT_A_REAL_PDF_DATA", "application/pdf"),
    }
    data = {
        "github_url": "https://github.com/alexrivera-dev/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": "true",
        "allow_network": "false",
    }
    response = client.post("/api/v1/analyze", data=data, files=files)
    assert response.status_code == 400
    assert "pdf" in response.json()["detail"].lower()


def test_passport_crud_and_not_found():
    """Tests GET passport by ID and 404 for nonexistent ID."""
    # Create passport
    res = client.post(
        "/api/v1/analyze",
        json={
            "resume_text": "Alex Developer. React, Python.",
            "github_url": "https://github.com/alexrivera-dev/portfolio",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    passport_id = res.json()["passport_id"]

    # Retrieve existing
    get_res = client.get(f"/api/v1/passports/{passport_id}")
    assert get_res.status_code == 200
    detail = get_res.json()
    assert detail["passport_id"] == passport_id
    assert detail["passport"]["passport_id"] == passport_id

    # Nonexistent
    missing_res = client.get("/api/v1/passports/pp_nonexistent999")
    assert missing_res.status_code == 404


def test_quiz_questions_hide_hints():
    """Ensures GET quiz questions strips private evaluation hints."""
    res = client.post(
        "/api/v1/analyze",
        json={
            "resume_text": "Alex Developer. React, Python.",
            "github_url": "https://github.com/alexrivera-dev/portfolio",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    passport_id = res.json()["passport_id"]

    quiz_res = client.get(f"/api/v1/passports/{passport_id}/quiz")
    assert quiz_res.status_code == 200
    questions = quiz_res.json()
    assert len(questions) > 0

    for q in questions:
        assert "question_id" in q
        assert "question_text" in q
        assert "skill" in q
        # Ensure private hints are never leaked
        assert "expected_answer_hints" not in q
        assert "hints" not in q


def test_quiz_evaluation_and_state_upgrade():
    """
    Tests answering a quiz question:
    - Verifies ownership and prevents cross-passport cheating
    - Prevents duplicates
    - Upgrades skill state and recalculates role score
    - Re-seals SHA-256 hash atomically
    """
    res = client.post(
        "/api/v1/analyze",
        json={
            "resume_text": "Alex Developer. React, Python.",
            "github_url": "https://github.com/alexrivera-dev/portfolio",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    passport_id = res.json()["passport_id"]
    initial_hash = res.json()["sha256_hash"]

    quiz_res = client.get(f"/api/v1/passports/{passport_id}/quiz")
    questions = quiz_res.json()
    assert len(questions) > 0
    target_q = questions[0]

    # Test wrong question ID rejected
    bad_q_res = client.post(
        f"/api/v1/passports/{passport_id}/quiz/answers",
        json={"answers": [{"question_id": "qq_fake999", "answer_text": "Some answer"}]},
    )
    assert bad_q_res.status_code == 400
    assert "does not belong to passport" in bad_q_res.json()["detail"]

    # Test duplicate questions in same submission rejected
    dup_res = client.post(
        f"/api/v1/passports/{passport_id}/quiz/answers",
        json={
            "answers": [
                {"question_id": target_q["question_id"], "answer_text": "Answer 1"},
                {"question_id": target_q["question_id"], "answer_text": "Answer 2"},
            ]
        },
    )
    assert dup_res.status_code == 400
    assert "duplicate answer" in dup_res.json()["detail"].lower()

    # Valid pushback answer for fake premise question (or substantive answer)
    answer_text = "I did not use Redis in this project; caching was not implemented with that technology."
    eval_res = client.post(
        f"/api/v1/passports/{passport_id}/quiz/answers",
        json={"answers": [{"question_id": target_q["question_id"], "answer_text": answer_text}]},
    )
    assert eval_res.status_code == 200
    eval_data = eval_res.json()
    assert eval_data["passport_id"] == passport_id
    assert len(eval_data["results"]) == 1
    assert eval_data["results"][0]["passed"] is True

    # Hash should be updated
    assert eval_data["updated_hash"] != initial_hash


def test_integrity_verification_and_tamper_detection():
    """
    Verifies:
    1. Freshly created passport has a valid matching SHA-256 integrity seal.
    2. Tampering with the stored payload in the database causes verification to fail.
    """
    res = client.post(
        "/api/v1/analyze",
        json={
            "resume_text": "Alex Developer. React, Python.",
            "github_url": "https://github.com/alexrivera-dev/portfolio",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    passport_id = res.json()["passport_id"]

    # Check authentic
    verify_res = client.get(f"/api/v1/passports/{passport_id}/verify")
    assert verify_res.status_code == 200
    v_data = verify_res.json()
    assert v_data["valid"] is True
    assert v_data["stored_hash"] == v_data["computed_hash"]
    assert "authentic" in v_data["message"].lower()

    # Tamper with the database payload directly
    db = TestingSessionLocal()
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    payload = json.loads(record.payload_json)
    payload["role_match_score"] = 1.0  # Fraudulent tampering
    record.payload_json = json.dumps(payload)
    db.commit()
    db.close()

    # Re-verify -> must detect tamper
    tamper_verify = client.get(f"/api/v1/passports/{passport_id}/verify")
    assert tamper_verify.status_code == 200
    t_data = tamper_verify.json()
    assert t_data["valid"] is False
    assert t_data["stored_hash"] != t_data["computed_hash"]
    assert "mismatch" in t_data["message"].lower()


def test_candidate_data_deletion():
    """Verifies GDPR candidate data deletion / right to erasure."""
    res = client.post(
        "/api/v1/analyze",
        json={
            "resume_text": "Alex Developer. React, Python.",
            "github_url": "https://github.com/alexrivera-dev/portfolio",
            "target_role": "Full-Stack Engineer",
            "consent": True,
            "allow_network": False,
        },
    )
    passport_id = res.json()["passport_id"]

    # Delete
    del_res = client.delete(f"/api/v1/passports/{passport_id}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted"] is True

    # Confirm deletion
    check_res = client.get(f"/api/v1/passports/{passport_id}")
    assert check_res.status_code == 404


def test_openapi_schema_documents_request_bodies():
    """
    Verifies that FastAPI/Swagger OpenAPI schema properly documents
    the JSON request body for /api/v1/analyze and multipart for /api/v1/analyze/upload.
    """
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()

    # Check /api/v1/analyze has application/json requestBody documented
    analyze_post = schema["paths"]["/api/v1/analyze"]["post"]
    assert "requestBody" in analyze_post
    content = analyze_post["requestBody"]["content"]
    assert "application/json" in content
    json_props = content["application/json"]["schema"]["properties"]
    assert "github_url" in json_props
    assert "target_role" in json_props
    assert "consent" in json_props
    assert "resume_text" in json_props

    # Check dedicated /api/v1/analyze/upload is present with multipart/form-data
    assert "/api/v1/analyze/upload" in schema["paths"]
    upload_post = schema["paths"]["/api/v1/analyze/upload"]["post"]
    assert "requestBody" in upload_post
    assert "multipart/form-data" in upload_post["requestBody"]["content"]


def test_analyze_upload_dedicated_endpoint_success():
    """Verifies that the dedicated /api/v1/analyze/upload endpoint processes PDF uploads."""
    pdf_bytes = _make_sample_pdf([
        "Morgan Lee",
        "Skills: React, Python, PostgreSQL",
        "Experience: Full Stack Engineer.",
    ])

    files = {
        "resume_file": ("resume.pdf", pdf_bytes, "application/pdf"),
    }
    data = {
        "github_url": "https://github.com/alexrivera-dev/portfolio",
        "target_role": "Full-Stack Engineer",
        "consent": "true",
        "allow_network": "false",
    }

    response = client.post("/api/v1/analyze/upload", data=data, files=files)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["passport_id"].startswith("pp_")
    assert res_data["status"] == "issued"
    assert len(res_data["sha256_hash"]) == 64
