"""
FastAPI routes for ProofPass (/api/v1).

Authorization model
  - Passports are issued ONLY by the backend verification pipeline (/verify, /analyze*); clients cannot
    create, overwrite or "sync" passports, and cannot set verification states.
  - Every passport is owned by the applicant whose session created it (owner derived from the cookie).
  - Applicants may read/delete/share-toggle/answer quizzes on their own passports only.
  - Recruiters have read-only access to all passports. Records without an owner (legacy or batch
    screening) are visible to recruiters only and are never modified.
  - A public, read-only, share-revocable view exists at /shared/passports/{id}.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend import accounts
from backend.api.account_routes import account_router
from backend.api.auth import auth_router, get_current_session
from backend.api.batch import batch_router
from backend.api.orchestrator import (
    VerificationUnavailable,
    check_payload_integrity,
    evaluate_quiz_submission,
    run_analyze_pipeline,
    verify_passport_integrity,
)
from backend.api.radar import radar_router
from backend.api.recommendations import recommendations_router
from backend.api.resume import resume_router
from backend.database import PassportRecord, UserRecord, get_db, persistence_status
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
)
from backend.intelligence.models import PassportPayload
from backend.verification.github_client import parse_github_url

router = APIRouter(prefix="/api/v1", tags=["ProofPass Core"])


def _require_fixture_backed_feature() -> None:
    """Batch ingestion scores resumes against synthetic fixture repositories (no live GitHub verification),
    so it is unavailable unless fixtures are explicitly enabled (tests / local development)."""
    if os.getenv("PROOFPASS_OFFLINE_FIXTURES", "").strip() != "1":
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED,
                            "Batch ingestion is unavailable: it has no live verification backend yet.")


router.include_router(account_router)
router.include_router(auth_router)
router.include_router(batch_router, dependencies=[Depends(accounts.require_recruiter), Depends(_require_fixture_backed_feature)])
router.include_router(resume_router, dependencies=[Depends(accounts.require_user)])
router.include_router(radar_router)  # public job/transit reads; the commit-stamping endpoint is disabled
router.include_router(recommendations_router, dependencies=[Depends(accounts.require_user)])


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
        version="2.0.0",
        timestamp=datetime.utcnow().isoformat(),
        persistent_storage=persistence_status()["persistent"],
        storage_note=persistence_status()["reason"],
    )


# ---------------------------------------------------------------------------
# Verification (backend is the only authority)
# ---------------------------------------------------------------------------
def _offline_fixtures_enabled() -> bool:
    """Synthetic fixture evidence exists only for automated tests / local development, never by default."""
    return os.getenv("PROOFPASS_OFFLINE_FIXTURES", "").strip() == "1"


def _effective_allow_network(requested: bool) -> bool:
    return True if not _offline_fixtures_enabled() else bool(requested)


def _truthy(v: Any) -> bool:
    return str(v).lower() in ("true", "1", "yes")


async def _parse_intake(request: Request) -> Dict[str, Any]:
    """Normalises JSON or multipart intake into one dict (client-supplied identity is never read)."""
    ctype = request.headers.get("content-type", "")
    out: Dict[str, Any] = {"resume_text": None, "resume_bytes": None, "github_url": "", "target_role": "",
                           "job_description": None, "consent": False, "allow_network": True}
    try:
        if "multipart/form-data" in ctype:
            form = await request.form()
            f = form.get("resume_file") or form.get("resumeFile")
            if f and hasattr(f, "read"):
                out["resume_bytes"] = await f.read()
            raw = form.get("resume_text") or form.get("resumeText")
            out["resume_text"] = str(raw) if raw else None
            out["github_url"] = str(form.get("github_url") or form.get("githubUrl") or "").strip()
            out["target_role"] = str(form.get("target_role") or form.get("targetRole") or "").strip()
            jd = form.get("job_description") or form.get("jobDescription")
            out["job_description"] = str(jd) if jd else None
            out["consent"] = _truthy(form.get("consent") or form.get("consentAi") or form.get("consent_ai") or form.get("candidate_consent"))
            if form.get("allow_network") is not None or form.get("allowNetwork") is not None:
                out["allow_network"] = _truthy(form.get("allow_network") if form.get("allow_network") is not None else form.get("allowNetwork"))
        else:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("JSON object expected.")
            out["resume_text"] = body.get("resume_text") or body.get("resumeText")
            out["github_url"] = str(body.get("github_url") or body.get("githubUrl") or "").strip()
            out["target_role"] = str(body.get("target_role") or body.get("targetRole") or "").strip()
            out["job_description"] = body.get("job_description") or body.get("jobDescription")
            out["consent"] = bool(body.get("consent") or body.get("consentAi") or body.get("consent_ai") or body.get("candidate_consent"))
            out["allow_network"] = _truthy(body.get("allow_network", True)) if "allow_network" in body else _truthy(body.get("allowNetwork", True))
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Invalid request data: {exc}")
    return out


def _validate_intake(i: Dict[str, Any], need_github_url: bool) -> None:
    if not i["consent"]:
        raise HTTPException(400, "Candidate consent is required to process resume and evidence data.")
    if need_github_url and not i["github_url"]:
        raise HTTPException(400, "A valid GitHub repository or profile URL is required.")
    if not i["target_role"]:
        raise HTTPException(400, "A target role is required.")
    if not i["resume_bytes"] and (not i["resume_text"] or not str(i["resume_text"]).strip()):
        raise HTTPException(400, "A resume is required. Please provide resume text or upload a PDF document.")


def evidence_summary(record: PassportRecord) -> Dict[str, List[Dict[str, Any]]]:
    """Claims and per-claim code evidence read back from the stored verification record (not sealed)."""
    try:
        claims = [{"claim_id": c.get("claim_id"), "skill": c.get("skill")} for c in json.loads(record.claims_json or "[]") if isinstance(c, dict)]
        raw = json.loads(record.verification_json or "{}")
        evidence = [
            {k: e.get(k) for k in ("claim_id", "skill", "repo", "file_path", "usage_depth", "authorship_pct",
                                   "authorship_signal", "commit_count", "conflicts")}
            for e in (raw.get("evidence") or []) if isinstance(e, dict)
        ]
    except (ValueError, AttributeError):
        claims, evidence = [], []
    return {"claims": claims, "evidence": evidence}


def _issue(db: Session, user: UserRecord, i: Dict[str, Any], github_url: str, ownership: str,
           github_id: Optional[int] = None, github_login: Optional[str] = None) -> AnalyzeResponse:
    if github_id:
        other = db.query(UserRecord).filter(UserRecord.github_id == github_id, UserRecord.id != user.id).first()
        if other is not None:
            # One GitHub identity can back only one ProofPass account, so it cannot vouch for several applicants.
            raise HTTPException(status.HTTP_409_CONFLICT, "This GitHub account is already linked to another ProofPass account.")
    try:
        passport, record = run_analyze_pipeline(
            resume_text=i["resume_text"], resume_bytes=i["resume_bytes"], github_url=github_url,
            target_role=i["target_role"], job_description=i["job_description"], candidate_consent=i["consent"],
            allow_network=_effective_allow_network(i["allow_network"]), db=db,
            owner_id=user.id, ownership=ownership, github_id=github_id, github_login=github_login,
        )
    except VerificationUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Pipeline execution error: {exc}")
    if github_id and (user.github_id != github_id or user.github_login != github_login):
        user.github_id, user.github_login = github_id, github_login
        db.commit()
    return AnalyzeResponse(
        passport_id=record.passport_id, status=record.status, role_match_score=record.role_match_score,
        target_role=record.target_role, sha256_hash=record.sha256_hash, is_demo=record.is_demo,
        passport=passport, created_at=record.created_at.isoformat(), **evidence_summary(record),
    )


@router.post(
    "/verify", response_model=AnalyzeResponse,
    summary="Verify skills with an authenticated GitHub session (OAuth ownership)",
    description=(
        "Applicant-only. Requires the ProofPass login AND a GitHub OAuth session. The client-supplied URL "
        "is ignored (repos not owned by the OAuth login are rejected); evidence comes from that account's own "
        "public repositories. Skills reach Verified only after the quiz is passed."
    ),
)
@router.post("/verify/upload", response_model=AnalyzeResponse, include_in_schema=False)
async def verify_candidate(request: Request, user: UserRecord = Depends(accounts.require_applicant),
                           db: Session = Depends(get_db)):
    session = get_current_session(request)
    if not session:
        raise HTTPException(401, "Connect your GitHub account to verify with authenticated ownership.")
    login, gh_id = session["github_login"], session["github_id"]
    i = await _parse_intake(request)
    _validate_intake(i, need_github_url=False)
    if i["github_url"]:
        try:
            owner, _ = parse_github_url(i["github_url"])
            if owner.lower() != login.lower():
                raise HTTPException(400, f"Repository '{i['github_url']}' is not owned by authenticated user @{login}.")
        except ValueError:
            pass
    return _issue(db, user, i, f"https://github.com/{login}", "oauth_verified", gh_id, login)


@router.post(
    "/analyze", response_model=AnalyzeResponse,
    summary="Analyze from a public GitHub URL (Ownership Unverified fallback)",
    description=(
        "Applicant-only fallback when GitHub OAuth is unavailable. Ownership of the URL is NOT proven, so the "
        "passport is labelled `ownership: unverified` and no skill can exceed Supported."
    ),
    openapi_extra={"requestBody": {"required": True, "content": {"application/json": {"schema": AnalyzeRequest.model_json_schema()}}}},
)
async def analyze_intake(request: Request, user: UserRecord = Depends(accounts.require_applicant),
                         db: Session = Depends(get_db)):
    i = await _parse_intake(request)
    _validate_intake(i, need_github_url=True)
    return _issue(db, user, i, i["github_url"], "unverified")


@router.post("/analyze/upload", response_model=AnalyzeResponse,
             summary="Analyze with a PDF resume (Ownership Unverified fallback)")
async def analyze_upload(
    resume_file: UploadFile = File(...),
    github_url: str = Form(...),
    target_role: str = Form(...),
    job_description: Optional[str] = Form(None),
    consent: bool = Form(...),
    allow_network: bool = Form(True),
    user: UserRecord = Depends(accounts.require_applicant),
    db: Session = Depends(get_db),
):
    data = await resume_file.read()
    if not data:
        raise HTTPException(400, "Uploaded PDF file is empty.")
    i = {"resume_text": None, "resume_bytes": data, "github_url": github_url.strip(), "target_role": target_role.strip(),
         "job_description": job_description, "consent": consent, "allow_network": allow_network}
    _validate_intake(i, need_github_url=True)
    return _issue(db, user, i, i["github_url"], "unverified")


# ---------------------------------------------------------------------------
# Passports
# ---------------------------------------------------------------------------
def _owner_name(db: Session, record: PassportRecord) -> Optional[str]:
    if not record.owner_id:
        return None
    u = db.query(UserRecord).filter(UserRecord.id == record.owner_id).first()
    return u.display_name if u else None


def passport_view(db: Session, record: PassportRecord) -> Dict[str, Any]:
    """Sealed payload plus presentation fields. The sealed fields are returned untouched."""
    payload = json.loads(record.payload_json)
    if not isinstance(payload, dict):
        payload = {}
    legacy = "signature" not in payload
    view = dict(payload)
    view.update({
        "id": record.passport_id, "passport_id": record.passport_id,
        "candidate": _owner_name(db, record) or payload.get("candidate") or "Unassigned",
        "targetRole": record.target_role, "hash": record.sha256_hash,
        "issuedAt": record.created_at.isoformat(), "status": record.status,
        "userId": record.owner_id, "ownership": record.ownership or ("legacy" if legacy else "unverified"),
        "ownershipVerified": record.ownership == "oauth_verified",
        "isDemo": bool(record.is_demo), "revoked": bool(record.share_revoked),
        "unassigned": record.owner_id is None, "legacy": legacy,
        "integrityScheme": "legacy-client-sealed" if legacy else "canonical-json-sha256-v1",
    })
    return view


def _public_view(db: Session, record: PassportRecord) -> Dict[str, Any]:
    v = passport_view(db, record)
    for k in ("quiz_questions", "userId", "notes", "unassigned"):
        v.pop(k, None)
    v["integrity"] = {"valid": None} if v["legacy"] else verify_passport_integrity(record.passport_id, db)
    return v


def _visible(user: UserRecord, record: PassportRecord) -> bool:
    return user.role == "recruiter" or record.owner_id == user.id


def _get_visible(db: Session, user: UserRecord, passport_id: str) -> PassportRecord:
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    # 404 (not 403) for other applicants' passports so ids cannot be probed.
    if record is None or not _visible(user, record):
        raise HTTPException(404, f"Passport '{passport_id}' not found.")
    return record


def _get_owned(db: Session, user: UserRecord, passport_id: str) -> PassportRecord:
    if user.role != "applicant":
        raise HTTPException(403, "Only the applicant who owns a passport can do this.")
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if record is None or record.owner_id != user.id:
        raise HTTPException(404, f"Passport '{passport_id}' not found.")
    return record


@router.get("/passports")
def list_passports(user: UserRecord = Depends(accounts.require_user), db: Session = Depends(get_db)):
    """Applicants: their own passports. Recruiters: every passport (read-only)."""
    q = db.query(PassportRecord).order_by(PassportRecord.created_at.desc())
    if user.role == "applicant":
        q = q.filter(PassportRecord.owner_id == user.id)
    return [passport_view(db, r) for r in q.all()]


@router.post("/passports", include_in_schema=False)
async def create_passport_disabled(user: UserRecord = Depends(accounts.require_user)):
    raise HTTPException(status.HTTP_410_GONE, "Passports cannot be created or overwritten by clients. "
                                              "They are issued by the verification pipeline (POST /verify).")


@router.get("/passports/{passport_id}")
def get_passport(passport_id: str, user: UserRecord = Depends(accounts.require_user), db: Session = Depends(get_db)):
    """Detail contract (passport_id, sha256_hash, passport, ...) plus the presentation fields of the list view."""
    record = _get_visible(db, user, passport_id)
    view = passport_view(db, record)
    view.update({
        "role_match_score": record.role_match_score, "sha256_hash": record.sha256_hash, "is_demo": bool(record.is_demo),
        "passport": json.loads(record.payload_json), "created_at": record.created_at.isoformat(),
        "updated_at": record.updated_at.isoformat(), **evidence_summary(record),
        "integrity_note": "SHA-256 seal guarantees payload integrity against post-issuance tampering. "
                          "It does not verify candidate identity or prove claim accuracy.",
    })
    return view


class SharingBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    revoked: bool


@router.patch("/passports/{passport_id}/sharing")
def set_sharing(passport_id: str, body: SharingBody, user: UserRecord = Depends(accounts.require_applicant),
                db: Session = Depends(get_db)):
    """Owner toggles the public share link. This is not part of the sealed payload and not a verification status."""
    record = _get_owned(db, user, passport_id)
    record.share_revoked = body.revoked
    db.commit()
    return {"passport_id": passport_id, "revoked": record.share_revoked}


@router.get("/shared/passports/{passport_id}")
def get_shared_passport(passport_id: str, db: Session = Depends(get_db)):
    """Public read-only view for share links. No quiz material, no owner id; honours revocation."""
    record = db.query(PassportRecord).filter(PassportRecord.passport_id == passport_id).first()
    if record is None:
        raise HTTPException(404, f"Passport '{passport_id}' not found.")
    if record.share_revoked:
        raise HTTPException(status.HTTP_410_GONE, "The owner has revoked this share link.")
    return _public_view(db, record)


class IntegrityCheckBody(BaseModel):
    payload: Dict[str, Any]
    hash: str


@router.post("/integrity/check")
def integrity_check(body: IntegrityCheckBody):
    """Stateless, public: recompute the canonical SHA-256 of any passport payload and compare."""
    return check_payload_integrity(body.payload, body.hash)


@router.get("/passports/{passport_id}/quiz", response_model=List[PublicQuizQuestion])
def get_passport_quiz(passport_id: str, user: UserRecord = Depends(accounts.require_applicant),
                      db: Session = Depends(get_db)):
    """Micro-verification questions (private hints omitted). Owner only."""
    record = _get_owned(db, user, passport_id)
    return [
        PublicQuizQuestion(question_id=q["question_id"], claim_id=q["claim_id"], skill=q["skill"],
                           question_type=q["question_type"], question_text=q["question_text"],
                           context_snippet=q.get("context_snippet"))
        for q in json.loads(record.quiz_questions_json)
    ]


@router.post("/passports/{passport_id}/quiz/answers", response_model=QuizEvaluationResponse)
def submit_quiz_answers(passport_id: str, submission: QuizSubmissionRequest,
                        user: UserRecord = Depends(accounts.require_applicant), db: Session = Depends(get_db)):
    """Owner only. States are recomputed by the backend; the client never supplies a state."""
    _get_owned(db, user, passport_id)
    try:
        results, updated_passport, record = evaluate_quiz_submission(passport_id=passport_id, answers=submission.answers, db=db)
    except KeyError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Quiz evaluation failed: {exc}")
    return QuizEvaluationResponse(passport_id=record.passport_id, results=results,
                                  updated_role_match_score=record.role_match_score,
                                  updated_hash=record.sha256_hash, passport=updated_passport)


@router.get("/passports/{passport_id}/verify", response_model=IntegrityVerifyResponse)
def verify_passport(passport_id: str, user: UserRecord = Depends(accounts.require_user), db: Session = Depends(get_db)):
    """Integrity check of the stored payload against its SHA-256 seal (owner or recruiter)."""
    _get_visible(db, user, passport_id)
    try:
        res = verify_passport_integrity(passport_id=passport_id, db=db)
    except KeyError as exc:
        raise HTTPException(404, str(exc))
    return IntegrityVerifyResponse(**{k: res[k] for k in ("passport_id", "valid", "stored_hash", "computed_hash", "message")})


@router.delete("/passports/{passport_id}", response_model=DeletePassportResponse)
def delete_passport(passport_id: str, user: UserRecord = Depends(accounts.require_applicant),
                    db: Session = Depends(get_db)):
    """Right to erasure: the owning applicant only. Recruiters and other applicants cannot delete."""
    record = _get_owned(db, user, passport_id)
    db.delete(record)
    db.commit()
    return DeletePassportResponse(passport_id=passport_id, deleted=True,
                                  message="Passport and associated verification records permanently deleted.")
