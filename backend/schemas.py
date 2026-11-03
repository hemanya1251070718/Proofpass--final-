"""
Pydantic schemas and serialization utilities for Member 2 API.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, AliasChoices

from backend.verification.models import QuestionType
from backend.intelligence.models import PassportPayload


def canonical_json_dumps(obj: Any) -> str:
    """
    Serializes a dictionary or Pydantic model to canonical JSON
    (RFC 8785 style: sorted keys, compact separators, UTF-8).
    """
    if hasattr(obj, "model_dump"):
        data = obj.model_dump(mode="json")
    elif isinstance(obj, dict):
        data = obj
    else:
        data = obj

    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_integrity_hash(data: Any) -> str:
    """
    Computes a SHA-256 digest of canonical JSON.
    This digest serves purely as a cryptographic tamper-detection seal
    for the payload, not as a digital identity signature or factual warranty.
    """
    canonical_str = canonical_json_dumps(data)
    return hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Intake & Analyze Request / Response
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    resume_text: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("resume_text", "resumeText"),
        description="Candidate resume plain text (required if not uploading a PDF)",
        examples=["Alex Rivera\nSkills: React, Python, PostgreSQL, AWS\nExperience: Senior Full-Stack Engineer building enterprise platforms."],
    )
    github_url: str = Field(
        ...,
        validation_alias=AliasChoices("github_url", "githubUrl"),
        description="Public GitHub repository URL or profile",
        examples=["https://github.com/alexrivera-dev/portfolio"],
    )
    target_role: str = Field(
        ...,
        validation_alias=AliasChoices("target_role", "targetRole"),
        description="Target job title or role name",
        examples=["Full-Stack Engineer"],
    )
    job_description: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("job_description", "jobDescription"),
        description="Optional job description text used to calculate skill weights and match score",
        examples=["Seeking Full-Stack Engineer with React and Python experience."],
    )
    consent: bool = Field(
        ...,
        validation_alias=AliasChoices("consent", "consentAi", "consent_ai", "candidate_consent"),
        description="Explicit candidate consent to process resume and repository data (must be true)",
        examples=[True],
    )
    allow_network: bool = Field(
        default=True,
        validation_alias=AliasChoices("allow_network", "allowNetwork"),
        description="Whether to perform live GitHub network verification (false for offline test fixtures)",
        examples=[True],
    )

    @field_validator("github_url")
    @classmethod
    def validate_github(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("A GitHub repository URL or profile is required.")
        return s

    @field_validator("target_role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("A target role must be specified.")
        return s


class AnalyzeResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passport_id: str
    status: str
    role_match_score: float
    target_role: str
    sha256_hash: str
    integrity_note: str = (
        "SHA-256 seal guarantees payload integrity against post-issuance tampering. "
        "It does not verify candidate identity or prove claim accuracy."
    )
    is_demo: bool = False
    passport: PassportPayload
    created_at: str
    # Unsealed, derived from the stored verification record, for the step-by-step UI.
    claims: List[Dict[str, Any]] = Field(default_factory=list)
    evidence: List[Dict[str, Any]] = Field(default_factory=list)


class PassportDetailResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passport_id: str
    target_role: str
    role_match_score: float
    status: str
    sha256_hash: str
    integrity_note: str = (
        "SHA-256 seal guarantees payload integrity against post-issuance tampering. "
        "It does not verify candidate identity or prove claim accuracy."
    )
    is_demo: bool = False
    passport: PassportPayload | Dict[str, Any]
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Quiz Models (Public Safe - Private Hints Stripped)
# ---------------------------------------------------------------------------

class PublicQuizQuestion(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    question_id: str
    claim_id: str
    skill: str
    question_type: QuestionType
    question_text: str
    context_snippet: Optional[str] = None


class QuizAnswerSubmission(BaseModel):
    question_id: str = Field(..., min_length=1)
    answer_text: str = Field(..., min_length=1)


class QuizSubmissionRequest(BaseModel):
    answers: List[QuizAnswerSubmission] = Field(..., min_length=1)


class QuizEvaluationItem(BaseModel):
    question_id: str
    passed: bool
    feedback: str


class QuizEvaluationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passport_id: str
    results: List[QuizEvaluationItem]
    updated_role_match_score: float
    updated_hash: str
    integrity_note: str = (
        "SHA-256 seal recalculated and updated. "
        "This digest detects tampering and does not certify external truth."
    )
    passport: PassportPayload


# ---------------------------------------------------------------------------
# Integrity Verification
# ---------------------------------------------------------------------------

class IntegrityVerifyResponse(BaseModel):
    passport_id: str
    valid: bool
    stored_hash: str
    computed_hash: str
    message: str
    integrity_note: str = (
        "SHA-256 verifies that the stored passport payload is authentic and unaltered since issuance. "
        "It is an integrity check, not a digital signature or factual warranty."
    )


# ---------------------------------------------------------------------------
# Health & Management
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    database: str
    version: str = "1.0.0"
    timestamp: str
    persistent_storage: Optional[bool] = None
    storage_note: Optional[str] = None


class DeletePassportResponse(BaseModel):
    passport_id: str
    deleted: bool
    message: str
