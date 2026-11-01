"""
FastAPI Routes for ProofPass Member 2 (/api/v1).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import PassportRecord, get_db
from backend.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    DeletePassportResponse,
    HealthResponse,
    IntegrityVerifyResponse,
    PassportDetailResponse,
    PublicQuizQuestion,
    QuizEvaluationResponse,
    QuizSubmissionRequest,
    canonical_json_dumps,
)
from backend.api.orchestrator import (
    evaluate_quiz_submission,
    run_analyze_pipeline,
    verify_passport_integrity,
    _seal_passport,
)
from backend.intelligence.models import PassportPayload, QuizQuestion
from backend.api.auth import auth_router, get_current_session
from backend.verification.github_client import parse_github_url
from backend.api.batch import batch_router
from backend.api.resume import resume_router
from backend.api.radar import radar_router

router = APIRouter(prefix="/api/v1", tags=["ProofPass Core"])
router.include_router(auth_router)
router.include_router(batch_router)
router.include_router(resume_router)
router.include_router(radar_router)


@router.get("/health", response_model=HealthResponse)
def health_check(db: Session = Depends(get_db)):
    """Health status and database connectivity check."""
    try:
        db.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as exc:
        db_status = f"unhealthy: {exc}"

    return HealthResponse(
        status="ok" if db_status == "connected" else "degraded",
        database=db_status,
        version="1.0.0",
        timestamp=datetime.utcnow().isoformat(),
    )


@router.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Intake and Analyze Skill Passport (JSON or Multipart)",
    description=(
        "Analyze candidate skills from resume text or PDF, cross-verifying with GitHub repository code.\n\n"
        "- **JSON input**: Provide `resume_text`, `github_url`, `target_role`, and `consent: true`.\n"
        "- **Multipart input**: Upload `resume_file` (PDF) or `resume_text` along with form fields."
    ),
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "schema": AnalyzeRequest.model_json_schema()
                },
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            "resume_file": {
                                "type": "string",
                                "format": "binary",
                                "description": "Candidate resume PDF document",
                            },
                            "resume_text": {
                                "type": "string",
                                "description": "Candidate resume plain text (if not uploading a PDF)",
                            },
                            "github_url": {
                                "type": "string",
                                "description": "Public GitHub repository URL or profile",
                                "example": "https://github.com/alexrivera-dev/portfolio",
                            },
                            "target_role": {
                                "type": "string",
                                "description": "Target job title or role name",
                                "example": "Full-Stack Engineer",
                            },
                            "job_description": {
                                "type": "string",
                                "description": "Optional job description text",
                                "example": "Seeking Full-Stack Engineer with React and Python experience.",
                            },
                            "consent": {
                                "type": "boolean",
                                "description": "Explicit candidate consent (required, must be true)",
                                "default": True,
                            },
                            "allow_network": {
                                "type": "boolean",
                                "description": "Allow real GitHub API network calls (default: true)",
                                "default": True,
                            },
                        },
                        "required": ["github_url", "target_role", "consent"],
                    }
                },
            },
        }
    },
)
async def analyze_intake(
    request: Request,
    db: Session = Depends(get_db),
):
    content_type = request.headers.get("content-type", "")

    resume_text: Optional[str] = None
    resume_bytes: Optional[bytes] = None
    github_url: str = ""
    target_role: str = ""
    job_description: Optional[str] = None
    consent: bool = False
    allow_network: bool = True

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()

            # Check for file
            file_field = form.get("resume_file") or form.get("resumeFile")
            if file_field and hasattr(file_field, "read"):
                resume_bytes = await file_field.read()

            raw_text = form.get("resume_text") or form.get("resumeText")
            if raw_text:
                resume_text = str(raw_text)

            github_url = str(form.get("github_url") or form.get("githubUrl") or "").strip()
            target_role = str(form.get("target_role") or form.get("targetRole") or "").strip()
            jd_raw = form.get("job_description") or form.get("jobDescription")
            job_description = str(jd_raw) if jd_raw else None

            consent_raw = (
                form.get("consent")
                or form.get("consentAi")
                or form.get("consent_ai")
                or form.get("candidate_consent")
            )
            consent = str(consent_raw).lower() in ("true", "1", "yes")

            allow_net_raw = form.get("allow_network") or form.get("allowNetwork")
            if allow_net_raw is not None:
                allow_network = str(allow_net_raw).lower() in ("true", "1", "yes")
        else:
            body = await request.json()
            req = AnalyzeRequest.model_validate(body)
            resume_text = req.resume_text
            github_url = req.github_url
            target_role = req.target_role
            job_description = req.job_description
            consent = req.consent
            allow_network = req.allow_network
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid request data: {exc}",
        )

    if not consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate consent is required to process resume and evidence data.",
        )

    if not github_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid GitHub repository URL or profile is required.",
        )

    if not target_role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A target role is required.",
        )

    if not resume_bytes and (not resume_text or not resume_text.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A resume is required. Please provide resume text or upload a PDF document.",
        )

    try:
        passport, record = run_analyze_pipeline(
            resume_text=resume_text,
            resume_bytes=resume_bytes,
            github_url=github_url,
            target_role=target_role,
            job_description=job_description,
            candidate_consent=consent,
            allow_network=allow_network,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline execution error: {exc}",
        )

    return AnalyzeResponse(
        passport_id=record.passport_id,
        status=record.status,
        role_match_score=record.role_match_score,
        target_role=record.target_role,
        sha256_hash=record.sha256_hash,
        is_demo=record.is_demo,
        passport=passport,
        created_at=record.created_at.isoformat(),
    )


@router.post(
    "/analyze/upload",
    response_model=AnalyzeResponse,
    summary="Intake and Analyze via PDF File Upload",
    description="Upload a candidate PDF resume file along with GitHub URL and target role for verification.",
)
async def analyze_upload(
    resume_file: UploadFile = File(..., description="PDF resume file to upload"),
    github_url: str = Form(..., description="Public GitHub repository URL or profile"),
    target_role: str = Form(..., description="Target role name (e.g. 'Full-Stack Engineer')"),
    job_description: Optional[str] = Form(None, description="Optional job description text"),
    consent: bool = Form(..., description="Candidate consent (must be true)"),
    allow_network: bool = Form(True, description="Whether to allow live GitHub network calls"),
    db: Session = Depends(get_db),
):
    """
    Dedicated multipart/form-data endpoint for uploading a PDF resume document.
    """
    if not consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate consent is required to process resume and evidence data.",
        )

    github_url_clean = github_url.strip()
    if not github_url_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid GitHub repository URL or profile is required.",
        )

    target_role_clean = target_role.strip()
    if not target_role_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A target role is required.",
        )

    try:
        resume_bytes = await resume_file.read()
        if not resume_bytes:
            raise ValueError("Uploaded PDF file is empty.")

        passport, record = run_analyze_pipeline(
            resume_text=None,
            resume_bytes=resume_bytes,
            github_url=github_url_clean,
            target_role=target_role_clean,
            job_description=job_description,
            candidate_consent=consent,
            allow_network=allow_network,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline execution error: {exc}",
        )

    return AnalyzeResponse(
        passport_id=record.passport_id,
        status=record.status,
        role_match_score=record.role_match_score,
        target_role=record.target_role,
        sha256_hash=record.sha256_hash,
        is_demo=record.is_demo,
        passport=passport,
        created_at=record.created_at.isoformat(),
    )


@router.post(
    "/verify",
    response_model=AnalyzeResponse,
    summary="Verify Candidate Skills with Authenticated GitHub Session",
    description=(
        "Verifies candidate skill claims against public GitHub repositories owned by "
        "the authenticated GitHub session. Client-supplied github_url is ignored, "
        "repos not owned by the session login are rejected, and ownership_verified is set."
    ),
)
@router.post("/verify/upload", response_model=AnalyzeResponse, include_in_schema=False)
async def verify_candidate(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Candidate verification endpoint.
    Requires an active GitHub OAuth session cookie.
    Ignores client-supplied github_url, rejects repos not owned by authenticated login,
    sets ownership_verified=True on repo evidence, and puts github_id into passport.
    """
    session = get_current_session(request)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please connect your GitHub account to verify.",
        )

    github_login = session["github_login"]
    github_id = session["github_id"]

    content_type = request.headers.get("content-type", "")
    resume_text: Optional[str] = None
    resume_bytes: Optional[bytes] = None
    client_supplied_github_url: str = ""
    target_role: str = ""
    job_description: Optional[str] = None
    consent: bool = False
    allow_network: bool = True

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            file_field = form.get("resume_file") or form.get("resumeFile")
            if file_field and hasattr(file_field, "read"):
                resume_bytes = await file_field.read()
            raw_text = form.get("resume_text") or form.get("resumeText")
            if raw_text:
                resume_text = str(raw_text)

            client_supplied_github_url = str(
                form.get("github_url") or form.get("githubUrl") or ""
            ).strip()
            target_role = str(form.get("target_role") or form.get("targetRole") or "").strip()
            jd_raw = form.get("job_description") or form.get("jobDescription")
            job_description = str(jd_raw) if jd_raw else None

            consent_raw = (
                form.get("consent")
                or form.get("consentAi")
                or form.get("consent_ai")
                or form.get("candidate_consent")
            )
            consent = str(consent_raw).lower() in ("true", "1", "yes")

            allow_net_raw = form.get("allow_network") or form.get("allowNetwork")
            if allow_net_raw is not None:
                allow_network = str(allow_net_raw).lower() in ("true", "1", "yes")
        else:
            body = await request.json()
            resume_text = body.get("resume_text") or body.get("resumeText")
            client_supplied_github_url = str(
                body.get("github_url") or body.get("githubUrl") or ""
            ).strip()
            target_role = str(body.get("target_role") or body.get("targetRole") or "").strip()
            job_description = body.get("job_description") or body.get("jobDescription")
            consent = bool(body.get("consent") or body.get("consentAi"))
            allow_network = body.get("allow_network", True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid request data: {exc}",
        )

    if not consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate consent is required to process resume and evidence data.",
        )

    if not target_role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A target role is required.",
        )

    if not resume_bytes and (not resume_text or not resume_text.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A resume is required. Please provide resume text or upload a PDF document.",
        )

    # Reject repos not owned by authenticated login with a clear error
    if client_supplied_github_url:
        try:
            owner, repo_name = parse_github_url(client_supplied_github_url)
            if owner.lower() != github_login.lower():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Repository '{client_supplied_github_url}' is not owned by authenticated user @{github_login}.",
                )
        except ValueError:
            pass

    # Ignore client-supplied github_url and build repo URL from session login
    session_github_url = f"https://github.com/{github_login}"

    try:
        passport, record = run_analyze_pipeline(
            resume_text=resume_text,
            resume_bytes=resume_bytes,
            github_url=session_github_url,
            target_role=target_role,
            job_description=job_description,
            candidate_consent=consent,
            allow_network=allow_network,
            db=db,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pipeline execution error: {exc}",
        )

    # Set ownership_verified = True for GitHub evidence derived from this session
    for skill in passport.skills:
        for ev in skill.evidence_chain:
            if ev.source == "repo":
                ev.ownership_verified = True

    # Put github_id and github_login in passport so a rename does not break the link
    passport.github_id = github_id
    passport.github_login = github_login

    # Re-seal the passport so that github_id and ownership_verified are sealed cryptographically
    sha256_hash, final_payload = _seal_passport(passport)
    record.sha256_hash = sha256_hash
    record.payload_json = canonical_json_dumps(final_payload)
    if hasattr(record, "github_id"):
        record.github_id = github_id
    if db:
        db.commit()

    return AnalyzeResponse(
        passport_id=record.passport_id,
        status=record.status,
        role_match_score=record.role_match_score,
        target_role=record.target_role,
        sha256_hash=record.sha256_hash,
        is_demo=record.is_demo,
        passport=passport,
        created_at=record.created_at.isoformat(),
    )


@router.get("/passports")
def list_all_passports(db: Session = Depends(get_db)):
    """
    Lists all stored skill passports across all candidates, browsers, and sessions.
    Allows real-time cross-browser synchronization for recruiter leaderboards.
    """
    records = db.query(PassportRecord).order_by(PassportRecord.created_at.desc()).all()
    results = []
    for record in records:
        try:
            payload = json.loads(record.payload_json)
            if isinstance(payload, dict):
                payload["id"] = payload.get("id") or record.passport_id
                payload["passport_id"] = record.passport_id
                payload["targetRole"] = payload.get("targetRole") or record.target_role
                payload["candidate"] = payload.get("candidate") or payload.get("candidate_name") or "Applicant"
                payload["hash"] = payload.get("hash") or record.sha256_hash
                payload["status"] = payload.get("status") or record.status
                payload["issuedAt"] = payload.get("issuedAt") or record.created_at.isoformat()
                results.append(payload)
        except Exception:
            continue
    return results


@router.post("/passports")
async def save_or_sync_passport(request: Request, db: Session = Depends(get_db)):
    """
    Saves or updates a candidate skill passport into the persistent database.
    Ensures that when a passport is generated in one browser, any recruiter dashboard
    running in another browser dynamically sees it in the leaderboard.
    """
    body = await request.json()
    passport_id = body.get("id") or body.get("passport_id") or f"PP-{int(datetime.utcnow().timestamp())}"
    target_role = body.get("targetRole") or body.get("target_role") or "Software Engineer"
    candidate = body.get("candidate") or body.get("candidate_name") or "Applicant"
    skills = body.get("skills") or []
    hash_val = body.get("hash") or body.get("sha256_hash") or f"hash_{passport_id}"

    body["id"] = passport_id
    body["passport_id"] = passport_id
    body["candidate"] = candidate
    body["targetRole"] = target_role
    body["hash"] = hash_val

    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if record:
        record.target_role = target_role
        record.sha256_hash = hash_val
        record.payload_json = json.dumps(body)
        record.claims_json = json.dumps(skills)
        record.updated_at = datetime.utcnow()
    else:
        record = PassportRecord(
            passport_id=passport_id,
            target_role=target_role,
            role_match_score=float(body.get("role_match_score", 0.0) or 0.0),
            candidate_consent=True,
            status=body.get("status", "issued"),
            sha256_hash=hash_val,
            payload_json=json.dumps(body),
            claims_json=json.dumps(skills),
            verification_json=json.dumps({
                "verified_skills": [s.get("skill") for s in skills if isinstance(s, dict) and s.get("state") in ("V", "S")]
            }),
            quiz_questions_json="[]",
            quiz_history_json="{}",
            is_demo=bool(body.get("is_demo", False)),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(record)
    db.commit()
    return body


@router.get("/passports/{passport_id}", response_model=PassportDetailResponse)
def get_passport(passport_id: str, db: Session = Depends(get_db)):
    """Retrieves a stored skill passport by ID."""
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Passport '{passport_id}' not found.",
        )

    raw_payload = json.loads(record.payload_json)
    try:
        passport_payload = PassportPayload(**raw_payload)
    except Exception:
        passport_payload = raw_payload

    return PassportDetailResponse(
        passport_id=record.passport_id,
        target_role=record.target_role,
        role_match_score=record.role_match_score,
        status=record.status,
        sha256_hash=record.sha256_hash,
        is_demo=record.is_demo,
        passport=passport_payload,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


@router.get("/passports/{passport_id}/quiz", response_model=List[PublicQuizQuestion])
def get_passport_quiz(passport_id: str, db: Session = Depends(get_db)):
    """
    Returns micro-verification quiz questions for a passport.
    Private expected answer hints are strictly omitted.
    """
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Passport '{passport_id}' not found.",
        )

    stored_questions = json.loads(record.quiz_questions_json)
    public_questions = [
        PublicQuizQuestion(
            question_id=q["question_id"],
            claim_id=q["claim_id"],
            skill=q["skill"],
            question_type=q["question_type"],
            question_text=q["question_text"],
            context_snippet=q.get("context_snippet"),
        )
        for q in stored_questions
    ]
    return public_questions


@router.post("/passports/{passport_id}/quiz/answers", response_model=QuizEvaluationResponse)
def submit_quiz_answers(
    passport_id: str,
    submission: QuizSubmissionRequest,
    db: Session = Depends(get_db),
):
    """
    Submits candidate quiz answers:
    - Verifies question ownership and disallows duplicate submissions
    - Evaluates answers using deterministic M4 rubrics
    - Recalculates skill assessments, role match, and updates SHA-256 seal atomically
    """
    try:
        results, updated_passport, record = evaluate_quiz_submission(
            passport_id=passport_id,
            answers=submission.answers,
            db=db,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Quiz evaluation failed: {exc}",
        )

    return QuizEvaluationResponse(
        passport_id=record.passport_id,
        results=results,
        updated_role_match_score=record.role_match_score,
        updated_hash=record.sha256_hash,
        passport=updated_passport,
    )


@router.get("/passports/{passport_id}/verify", response_model=IntegrityVerifyResponse)
def verify_passport(passport_id: str, db: Session = Depends(get_db)):
    """
    Verifies stored payload integrity using canonical JSON and SHA-256 digest.
    Confirms payload has not been modified since issuance.
    """
    try:
        res = verify_passport_integrity(passport_id=passport_id, db=db)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    return IntegrityVerifyResponse(
        passport_id=res["passport_id"],
        valid=res["valid"],
        stored_hash=res["stored_hash"],
        computed_hash=res["computed_hash"],
        message=res["message"],
    )


@router.delete("/passports/{passport_id}", response_model=DeletePassportResponse)
def delete_passport(passport_id: str, db: Session = Depends(get_db)):
    """
    Candidate data deletion / right-to-erasure endpoint.
    Permanently removes passport record and all intermediate data.
    """
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Passport '{passport_id}' not found.",
        )

    db.delete(record)
    db.commit()

    return DeletePassportResponse(
        passport_id=passport_id,
        deleted=True,
        message="Candidate passport and verification data permanently deleted.",
    )
