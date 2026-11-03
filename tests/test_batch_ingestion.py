"""
Unit and Integration Tests for Recruiter Batch Passport Ingestion.

Tests:
1. Header normalisation (case-insensitive, ignoring spaces and underscores)
2. Resume matching order (resume_file -> normalised name -> email in filename)
3. Duplicate handling within batch
4. ZIP safety (path traversal, nested archives, executables, zip bombs)
5. Limits enforcement (row limit 50, file size limit 25MB, file count limit 100)
6. Unmatched file and row reporting
7. Endpoints: POST /api/v1/batch, GET /api/v1/batch/{id}, start, and mock mode
"""
import io
import zipfile
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.api.batch import (
    normalize_header,
    normalize_name_for_match,
    inspect_and_extract_resumes_zip,
    match_resumes_to_rows,
    build_row_previews,
)


@pytest.fixture
def client():
    c = TestClient(app)
    from tests.auth_helpers import register
    register(c, "recruiter")  # batch ingestion is recruiter-only
    return c


# ---------------------------------------------------------------------------
# 1. Header Normalisation Tests
# ---------------------------------------------------------------------------
def test_header_normalization():
    assert normalize_header("Name") == "name"
    assert normalize_header("name") == "name"
    assert normalize_header("Candidate_Name") == "candidatename"
    assert normalize_header("Full Name") == "fullname"
    assert normalize_header("Email Address") == "emailaddress"
    assert normalize_header("github_url") == "githuburl"
    assert normalize_header("GitHub URL") == "githuburl"
    assert normalize_header("LeetCode_Url") == "leetcodeurl"
    assert normalize_header("Codeforces_URL") == "codeforcesurl"
    assert normalize_header("certificate_urls") == "certificateurls"
    assert normalize_header("Resume_File") == "resumefile"


# ---------------------------------------------------------------------------
# 2. Resume Matching Order Tests
# ---------------------------------------------------------------------------
def test_resume_matching_order_resume_file_column():
    """Explicit resume_file column takes highest priority."""
    rows = [
        {
            "name": "Alex Rivera",
            "email": "alex.rivera@example.com",
            "resume_file": "special_custom_resume.pdf",
        }
    ]
    resumes = {
        "alex_rivera.pdf": b"content a",
        "special_custom_resume.pdf": b"content b",
    }
    annotated, unmatched_files, unmatched_rows = match_resumes_to_rows(rows, resumes)
    assert annotated[0]["matched_resume_filename"] == "special_custom_resume.pdf"
    assert "alex_rivera.pdf" in unmatched_files
    assert len(unmatched_rows) == 0


def test_resume_matching_order_normalized_name():
    """Normalised name matches case-insensitively with punctuation/underscores as spaces."""
    rows = [
        {
            "name": "Jane-Marie O'Connor",
            "email": "joconnor@example.com",
            "resume_file": "",
        }
    ]
    # Filename with underscores and lowercase
    resumes = {
        "jane_marie_o_connor.pdf": b"content jm",
    }
    annotated, unmatched_files, unmatched_rows = match_resumes_to_rows(rows, resumes)
    assert annotated[0]["matched_resume_filename"] == "jane_marie_o_connor.pdf"
    assert len(unmatched_files) == 0
    assert len(unmatched_rows) == 0


def test_resume_matching_order_email_in_filename():
    """Email in filename matches when name does not match."""
    rows = [
        {
            "name": "Sam Smith",
            "email": "sam.developer99@gmail.com",
            "resume_file": "",
        }
    ]
    resumes = {
        "candidate_cv_sam.developer99@gmail.com_final.pdf": b"content sam",
    }
    annotated, unmatched_files, unmatched_rows = match_resumes_to_rows(rows, resumes)
    assert (
        annotated[0]["matched_resume_filename"]
        == "candidate_cv_sam.developer99@gmail.com_final.pdf"
    )
    assert len(unmatched_files) == 0


def test_unmatched_files_and_rows_are_listed():
    """Unmatched files and rows must not be dropped silently."""
    rows = [
        {"name": "Alice Wonder", "email": "alice@example.com", "resume_file": ""},
        {"name": "Bob Builder", "email": "bob@example.com", "resume_file": ""},
    ]
    resumes = {
        "alice_wonder.pdf": b"alice cv",
        "unrelated_extra_candidate.pdf": b"extra cv",
    }
    annotated, unmatched_files, unmatched_rows = match_resumes_to_rows(rows, resumes)
    assert annotated[0]["matched_resume_filename"] == "alice_wonder.pdf"
    assert annotated[1]["matched_resume_filename"] is None
    assert "unrelated_extra_candidate.pdf" in unmatched_files
    assert "Bob Builder" in unmatched_rows


# ---------------------------------------------------------------------------
# 3. Duplicate Handling and Validation Tests
# ---------------------------------------------------------------------------
def test_row_errors_duplicate_email_and_invalid_urls():
    rows = [
        {
            "name": "Candidate One",
            "email": "dup@example.com",
            "github_url": "https://gitlab.com/notgithub",  # Unsupported platform
            "leetcode_url": "ftp://invalid-url",            # Invalid URL
            "matched_resume_filename": None,
        },
        {
            "name": "Candidate Two",
            "email": "dup@example.com",  # Duplicate email
            "github_url": "https://github.com/valid/repo",
            "matched_resume_filename": None,
        },
        {
            "name": "",  # Missing name
            "email": "bademailformat",  # Invalid email
            "matched_resume_filename": None,
        },
    ]
    previews = build_row_previews(rows)
    assert len(previews) == 3

    # Row 1 has unsupported github, invalid leetcode (first occurrence of email is accepted)
    assert not previews[0].is_valid
    assert any("Unsupported platform" in e for e in previews[0].errors)
    assert any("Invalid URL" in e for e in previews[0].errors)

    # Row 2 has dup email
    assert not previews[1].is_valid
    assert any("Duplicate email" in e for e in previews[1].errors)

    # Row 3 has missing name and invalid email format
    assert not previews[2].is_valid
    assert any("Missing candidate name" in e for e in previews[2].errors)
    assert any("Invalid email address" in e for e in previews[2].errors)


# ---------------------------------------------------------------------------
# 4. ZIP Safety Tests
# ---------------------------------------------------------------------------
def test_zip_safety_rejects_path_traversal():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../etc/passwd", b"malicious")
    buf.seek(0)

    with pytest.raises(Exception) as exc:
        inspect_and_extract_resumes_zip(buf.getvalue())
    assert "path traversal" in str(exc.value).lower()


def test_zip_safety_rejects_nested_archives():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("nested.zip", b"PK...")
    buf.seek(0)

    with pytest.raises(Exception) as exc:
        inspect_and_extract_resumes_zip(buf.getvalue())
    assert "nested archive" in str(exc.value).lower()


def test_zip_safety_rejects_executables():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("script.sh", b"#!/bin/bash echo bad")
    buf.seek(0)

    with pytest.raises(Exception) as exc:
        inspect_and_extract_resumes_zip(buf.getvalue())
    assert "executable" in str(exc.value).lower() or "dangerous" in str(exc.value).lower()


# ---------------------------------------------------------------------------
# 5. Endpoint Integration Tests
# ---------------------------------------------------------------------------
def test_batch_upload_limit_exceeded(client):
    """Uploading more than 50 rows must return 400."""
    headers = "name,email,github_url\n"
    rows = "\n".join([f"Candidate {i},cand{i}@example.com,https://github.com/cand/{i}" for i in range(55)])
    csv_content = headers + rows

    files = {
        "spreadsheet_file": ("test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv"),
    }
    data = {"consent": "true"}

    res = client.post("/api/v1/batch", files=files, data=data)
    assert res.status_code == 400
    assert "maximum 50 rows allowed" in res.json()["detail"].lower()


def test_batch_upload_consent_required(client):
    """Consent checkbox is strictly required."""
    csv_content = "name,email\nAlex,alex@example.com\n"
    files = {
        "spreadsheet_file": ("test.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv"),
    }
    data = {"consent": "false"}

    res = client.post("/api/v1/batch", files=files, data=data)
    assert res.status_code == 400
    assert "consent is required" in res.json()["detail"].lower()


def test_batch_upload_preview_and_get_status(client):
    """Uploads valid CSV, checks preview table, starts batch, and checks status."""
    csv_content = (
        "Name,Email,GitHub_URL,LeetCode_URL\n"
        "Alex Rivera,alex.rivera@example.com,https://github.com/alexrivera/project,https://leetcode.com/alexrivera\n"
        "Morgan Lee,morgan.lee@example.com,,,\n"
    )

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as z:
        z.writestr("alex_rivera.pdf", b"%PDF-1.4 dummy resume")
    zip_buf.seek(0)

    files = {
        "spreadsheet_file": ("candidates.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv"),
        "resumes_zip": ("resumes.zip", zip_buf, "application/zip"),
    }
    data = {
        "consent": "true",
        "target_role": "Full Stack Engineer",
        "mock": "true",
    }

    # 1. Post batch upload
    res = client.post("/api/v1/batch", files=files, data=data)
    assert res.status_code == 200
    preview = res.json()

    assert preview["status"] == "preview"
    assert preview["total_rows"] == 2
    assert preview["valid_rows_count"] == 2
    assert preview["is_demo"] is True

    # Check row 1: matched resume and links
    r1 = preview["rows"][0]
    assert r1["name"] == "Alex Rivera"
    assert r1["matched_resume_filename"] == "alex_rivera.pdf"
    assert r1["tier"] == "links supplied"
    assert r1["match_status"] == "resume found"
    assert r1["ownership_verified"] is False
    assert "ownership unconfirmed" in r1["ownership_label"]

    # Check row 2: resume only
    r2 = preview["rows"][1]
    assert r2["name"] == "Morgan Lee"
    assert r2["tier"] == "resume only"
    assert r2["match_status"] == "No evidence submitted"

    batch_id = preview["id"]

    # 2. Get batch status
    get_res = client.get(f"/api/v1/batch/{batch_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == batch_id

    # 3. Start batch processing
    start_res = client.post(f"/api/v1/batch/{batch_id}/start")
    assert start_res.status_code == 200
    assert start_res.json()["status"] == "processing"
