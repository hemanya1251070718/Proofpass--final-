
"""
Pipeline Orchestrator for ProofPass M2.

Coordinates M3 verification, M4 intelligence processing, quiz evaluation,
passport generation, SHA-256 integrity sealing, and database persistence.

This module only orchestrates existing M3/M4 interfaces. It does not modify
their implementations.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.verification import extract_resume_text
from backend.verification.github_client import GitHubAPIError
from backend.verification.verifier import verify_github_source
from backend.verification.models import (
    Claim,
    VerificationResult,
    UsageDepth,
)
from backend.intelligence.models import (
    ClaimState,
    EvidenceChainItem,
    PassportPayload,
    SkillAssessment,
    TrustCeiling,
    TargetRole,
    QuizQuestion,
    QuizAnswer,
)
from backend.intelligence import (
    extract_claims,
    parse_target_role,
    assess_all,
    generate_micro_quiz,
    evaluate_answer,
    build_passport,
)
from backend.database import PassportRecord
from backend.schemas import (
    canonical_json_dumps,
    compute_integrity_hash,
    QuizAnswerSubmission,
    QuizEvaluationItem,
)


logger = logging.getLogger(__name__)


class VerificationUnavailable(Exception):
    """GitHub could not be reached or rate-limited us. No evidence is invented in that case."""


OWNERSHIP_NOTE = "Ownership Unverified: GitHub ownership was not authenticated, so no skill can be Verified (maximum Supported)."


def apply_ownership_cap(assessments: List[SkillAssessment], ownership: str) -> List[SkillAssessment]:
    """Without OAuth-proven GitHub ownership a skill can never be Verified. Mutates and returns the list."""
    if ownership == "oauth_verified":
        for a in assessments:
            for item in a.evidence_chain:
                if item.source == "repo":
                    item.ownership_verified = True
        return assessments
    for a in assessments:
        for item in a.evidence_chain:
            if item.source == "repo":
                item.ownership_verified = False
        if a.claim_state == ClaimState.VERIFIED:
            a.claim_state = ClaimState.SUPPORTED
            a.credibility = min(a.credibility, 0.6)
            a.evidence_chain.append(EvidenceChainItem(
                source="repo", label="Ownership Unverified", detail=OWNERSHIP_NOTE,
                ownership_verified=False, ceiling_applied=TrustCeiling.CANDIDATE_SUPPLIED,
            ))
    return assessments


def _seal_passport(passport: PassportPayload) -> Tuple[str, Dict[str, Any]]:
    """
    Generate a canonical SHA-256 digest for a passport.

    The signature field is set to None while calculating the digest so that
    the signature does not become part of its own hash.
    """
    payload = passport.model_dump(mode="json")
    payload["signature"] = None

    digest = compute_integrity_hash(payload)
    passport.signature = f"sha256:{digest}"

    return digest, passport.model_dump(mode="json")


def _persist_new_record(
    db: Optional[Session],
    record: PassportRecord,
) -> None:
    """Persist a new passport record, rolling back if the transaction fails."""
    if db is None:
        return

    try:
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception:
        db.rollback()
        logger.exception(
            "Failed to persist passport %s",
            record.passport_id,
        )
        raise


def run_analyze_pipeline(
    github_url: str,
    target_role: str,
    candidate_consent: bool,
    resume_text: Optional[str] = None,
    resume_bytes: Optional[bytes] = None,
    job_description: Optional[str] = None,
    allow_network: bool = True,
    db: Optional[Session] = None,
    owner_id: Optional[str] = None,
    ownership: str = "unverified",
    github_id: Optional[int] = None,
    github_login: Optional[str] = None,
) -> Tuple[PassportPayload, PassportRecord]:
    """
    Execute the end-to-end passport analysis pipeline.

    Steps:
    1. Validate candidate consent and resume input.
    2. Extract resume text.
    3. Extract skill claims using M4.
    4. Parse the target role using M4.
    5. Verify claims against GitHub using M3.
    6. Generate quizzes only when claim-linked evidence exists.
    7. Assess claims using M4.
    8. Build and seal the passport.
    9. Persist the record when a database session is provided.

    Raises:
        ValueError: If consent or resume input is invalid.
        Exception: Propagates verification, processing, or persistence errors
                   so callers can handle failures without receiving a
                   falsely successful passport.
    """
    if not candidate_consent:
        raise ValueError(
            "Candidate consent is required to process resume and evidence data."
        )

    if resume_bytes:
        extracted_text = extract_resume_text(resume_bytes)
    elif resume_text and resume_text.strip():
        extracted_text = resume_text.strip()
    else:
        raise ValueError(
            "A resume is required. Provide resume text or upload a valid PDF."
        )

    if not github_url or not github_url.strip():
        raise ValueError("A GitHub repository URL is required.")

    if not target_role or not target_role.strip():
        raise ValueError("A target role is required.")

    # 1. Extract candidate skill claims.
    claims = extract_claims(extracted_text)

    # 2. Parse the selected role or supplied job description.
    role_input = (
        job_description.strip()
        if job_description and job_description.strip()
        else target_role.strip()
    )
    target_role_obj = parse_target_role(
        role_input,
        default_role_name=target_role.strip(),
    )

    # 3. Verify claims through the M3 interface.
    try:
        verification_result = verify_github_source(
            claims=claims,
            github_url=github_url.strip(),
            allow_network=allow_network,
        )
    except GitHubAPIError as exc:
        raise VerificationUnavailable(
            f"GitHub could not be queried ({exc}). No verification result was produced; try again later."
        ) from exc

    # 4. Generate quizzes only when the claim has usable, file-backed evidence.
    # A matching claim_id alone is insufficient: M3 can return an Evidence
    # object even when no matching repository file was found.
    quiz_questions: List[QuizQuestion] = []

    evidence_items = verification_result.evidence or []
    for claim in claims:
        claim_evidence = [
            evidence
            for evidence in evidence_items
            if (
                evidence.claim_id == claim.claim_id
                and evidence.file_exists
                and bool(evidence.file_path and evidence.file_path.strip())
                and evidence.usage_depth != UsageDepth.NONE
            )
        ]

        if not claim_evidence:
            continue

        generated_questions = generate_micro_quiz(
            claim,
            claim_evidence,
        )
        if generated_questions:
            quiz_questions.extend(generated_questions)

    # 5. Assess claims. No quiz results exist during initial issuance.
    assessments = assess_all(
        claims=claims,
        verification=verification_result,
        quiz_results={},
    )
    apply_ownership_cap(assessments, ownership)

    # 6. Build the canonical passport.
    passport = build_passport(
        claims=claims,
        assessments=assessments,
        target_role=target_role_obj,
        quiz_questions=quiz_questions,
        candidate_consent=candidate_consent,
    )

    passport.ownership = ownership  # type: ignore[assignment]
    passport.github_id = github_id
    passport.github_login = github_login

    # 7. Seal the passport (ownership and GitHub identity are part of the sealed payload).
    sha256_hash, final_payload = _seal_passport(passport)

    # 8. Build the persistence record.
    now = datetime.utcnow()

    record = PassportRecord(
        passport_id=passport.passport_id,
        target_role=passport.target_role,
        role_match_score=passport.role_match_score,
        candidate_consent=candidate_consent,
        status="issued",
        sha256_hash=sha256_hash,
        payload_json=canonical_json_dumps(final_payload),
        target_role_json=canonical_json_dumps(
            target_role_obj.model_dump(mode="json")
        ),
        claims_json=canonical_json_dumps(
            [claim.model_dump(mode="json") for claim in claims]
        ),
        verification_json=canonical_json_dumps(
            verification_result.model_dump(mode="json")
        ),
        quiz_questions_json=canonical_json_dumps(
            [question.model_dump(mode="json") for question in quiz_questions]
        ),
        quiz_history_json="{}",
        # This flag reflects whether network access was disabled for the run.
        # It does not prove whether M3 used live or fallback evidence.
        is_demo=not allow_network,
        owner_id=owner_id,
        ownership=ownership,
        github_id=github_id,
        created_at=now,
        updated_at=now,
    )

    _persist_new_record(db, record)

    return passport, record


def evaluate_quiz_submission(
    passport_id: str,
    answers: List[QuizAnswerSubmission],
    db: Session,
) -> Tuple[List[QuizEvaluationItem], PassportPayload, PassportRecord]:
    """
    Evaluate quiz answers and update the passport in a database transaction.

    Validates question ownership and duplicate submissions, tracks attempts,
    evaluates answers through M4, recalculates claim assessments, rebuilds
    the passport, and updates its integrity digest.

    A previously passed question remains passed on later attempts.
    """
    record = (
        db.query(PassportRecord)
        .filter(PassportRecord.passport_id == passport_id)
        .first()
    )

    if record is None:
        raise KeyError(f"Passport '{passport_id}' not found.")

    if not answers:
        raise ValueError("At least one quiz answer must be submitted.")

    # Load and validate stored questions before modifying the record.
    stored_questions_data = json.loads(record.quiz_questions_json or "[]")
    stored_questions = [
        QuizQuestion(**question_data)
        for question_data in stored_questions_data
    ]
    question_map = {
        question.question_id: question
        for question in stored_questions
    }

    seen_ids = set()

    for answer in answers:
        if answer.question_id in seen_ids:
            raise ValueError(
                f"Duplicate answer for question_id '{answer.question_id}'."
            )

        seen_ids.add(answer.question_id)

        if answer.question_id not in question_map:
            raise ValueError(
                f"Question '{answer.question_id}' does not belong to "
                f"passport '{passport_id}'."
            )

    history = json.loads(record.quiz_history_json or "{}")

    evaluation_items: List[QuizEvaluationItem] = []

    for answer in answers:
        question = question_map[answer.question_id]
        previous = history.get(
            answer.question_id,
            {"attempts": 0, "passed": False},
        )

        attempt_number = int(previous.get("attempts", 0)) + 1

        result = evaluate_answer(
            question=question,
            answer=QuizAnswer(
                question_id=answer.question_id,
                answer_text=answer.answer_text,
            ),
            attempt_number=attempt_number,
        )

        # Preserve a previous pass even if a later attempt fails.
        passed_before = bool(previous.get("passed", False))
        passed_after = passed_before or bool(result.passed)

        history[answer.question_id] = {
            "attempts": attempt_number,
            "passed": passed_after,
            "claim_id": question.claim_id,
        }

        # Do not return private rubric hints or expected-answer details.
        feedback = (
            "Answer accepted. Technical understanding demonstrated."
            if result.passed
            else (
                "Answer not accepted. Provide more technical detail "
                "and address the question accurately."
            )
        )

        evaluation_items.append(
            QuizEvaluationItem(
                question_id=answer.question_id,
                passed=bool(result.passed),
                feedback=feedback,
            )
        )

    # Any passed question contributes a positive quiz result for its claim.
    quiz_results_by_claim: Dict[str, bool] = {}
    for history_entry in history.values():
        if history_entry.get("passed") and history_entry.get("claim_id"):
            quiz_results_by_claim[history_entry["claim_id"]] = True

    claims = [
        Claim(**claim_data)
        for claim_data in json.loads(record.claims_json or "[]")
    ]

    verification = VerificationResult(
        **json.loads(record.verification_json or "{}")
    )

    if record.target_role_json:
        target_role_obj = TargetRole(
            **json.loads(record.target_role_json)
        )
    else:
        target_role_obj = TargetRole(role_name=record.target_role)

    # Recalculate the passport with updated quiz results.
    assessments = assess_all(
        claims=claims,
        verification=verification,
        quiz_results=quiz_results_by_claim,
    )
    previous_payload = json.loads(record.payload_json or "{}")
    ownership = record.ownership or previous_payload.get("ownership") or "unverified"
    apply_ownership_cap(assessments, ownership)

    updated_passport = build_passport(
        claims=claims,
        assessments=assessments,
        target_role=target_role_obj,
        quiz_questions=stored_questions,
        candidate_consent=record.candidate_consent,
    )

    # Preserve the original externally issued passport ID and sealed identity fields.
    updated_passport.passport_id = record.passport_id
    updated_passport.ownership = ownership
    updated_passport.github_id = previous_payload.get("github_id")
    updated_passport.github_login = previous_payload.get("github_login")
    if previous_payload.get("generated_at"):
        updated_passport.generated_at = previous_payload["generated_at"]

    new_hash, final_payload = _seal_passport(updated_passport)

    # Update and commit together. Roll back on persistence failure.
    try:
        record.payload_json = canonical_json_dumps(final_payload)
        record.sha256_hash = new_hash
        record.role_match_score = updated_passport.role_match_score
        record.status = "quiz_updated"
        record.quiz_history_json = canonical_json_dumps(history)
        record.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(record)

    except Exception:
        db.rollback()
        logger.exception(
            "Failed to persist quiz update for passport %s",
            passport_id,
        )
        raise

    return evaluation_items, updated_passport, record


def verify_passport_integrity(
    passport_id: str,
    db: Session,
) -> Dict[str, Any]:
    """
    Verify the stored passport payload against its persisted SHA-256 digest.

    A matching digest establishes consistency with the stored digest; it
    does not establish that the underlying claims are objectively true or
    that the stored digest itself was issued by a trusted external authority.
    """
    record = (
        db.query(PassportRecord)
        .filter(PassportRecord.passport_id == passport_id)
        .first()
    )

    if record is None:
        raise KeyError(f"Passport '{passport_id}' not found.")

    payload = json.loads(record.payload_json)
    payload["signature"] = None

    computed_hash = compute_integrity_hash(payload)
    is_valid = computed_hash == record.sha256_hash

    message = (
        "Passport payload integrity verified: SHA-256 digest matches. "
        "The stored payload is authentic relative to its recorded digest; "
        "this does not independently verify the truth of its claims."
        if is_valid
        else (
            "SHA-256 digest mismatch. The stored payload may have changed "
            "or been corrupted."
        )
    )
    return {
        "passport_id": passport_id,
        "valid": is_valid,
        "stored_hash": record.sha256_hash,
        "computed_hash": computed_hash,
        "message": message,
    }


def check_payload_integrity(payload: Dict[str, Any], claimed_hash: str) -> Dict[str, Any]:
    """Stateless canonical integrity check: anyone holding a passport payload and its hash can run this.

    Scheme `canonical-json-sha256-v1`: set `signature` to null, serialize with sorted keys and compact
    separators (UTF-8, no ASCII escaping), take SHA-256 of that text.
    """
    body = dict(payload)
    body["signature"] = None
    computed = compute_integrity_hash(body)
    sig = payload.get("signature")
    return {
        "valid": computed == claimed_hash and (sig in (None, f"sha256:{computed}")),
        "computed_hash": computed,
        "claimed_hash": claimed_hash,
        "scheme": "canonical-json-sha256-v1",
    }
