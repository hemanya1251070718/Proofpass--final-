"""
Pydantic models matching the shared contract and blueprint.
"""
from __future__ import annotations
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional, Literal
from datetime import datetime, timezone
from pydantic import BaseModel, Field, field_validator

# --- Enums ---
class ClaimState(str, Enum):
    VERIFIED = "Verified"
    SUPPORTED = "Supported"
    CLAIMED = "Claimed"
    CONTRADICTED = "Contradicted"

class TrustCeiling(str, Enum):
    PLATFORM_VERIFIED = "Platform-Verified"
    THIRD_PARTY_ATTESTED = "Third-Party-Attested"
    CANDIDATE_SUPPLIED = "Candidate-Supplied"
    UNVERIFIED = "Unverified"

class UsageDepth(str, Enum):
    NONE = "none"
    DETECTED = "detected"
    MODERATE = "moderate"
    SUBSTANTIAL = "substantial"

class AuthorshipSignal(str, Enum):
    NONE = "none"
    PARTIAL = "partial"
    STRONG = "strong"

class QuizStatus(str, Enum):
    NOT_REQUIRED = "not_required"
    AVAILABLE = "available"
    PASSED = "passed"
    FAILED = "failed"

class QuestionType(str, Enum):
    FAKE_PREMISE = "fake_premise"
    GIT_HISTORY = "git_history"
    BUSINESS_LOGIC = "business_logic"
    MICRO_MODIFICATION = "micro_modification"

# --- Input Models ---
class Claim(BaseModel):
    claim_id: str = Field(default_factory=lambda: f"cl_{uuid.uuid4().hex[:8]}")
    skill: str = Field(min_length=1)
    resume_pointer: str
    repo_hint: Optional[str] = None
    raw_statement: Optional[str] = None

    @field_validator("skill")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

class Evidence(BaseModel):
    evidence_id: str = Field(default_factory=lambda: f"ev_{uuid.uuid4().hex[:8]}")
    claim_id: str
    skill: str
    source_type: str = "github_code"  # Shared contract default
    file_path: Optional[str] = None
    file_exists: bool
    content_sha256: Optional[str] = None
    usage_depth: UsageDepth = UsageDepth.NONE
    authorship_pct: float = Field(ge=0.0, le=1.0, default=0.0)
    authorship_signal: AuthorshipSignal = AuthorshipSignal.NONE
    commit_count: int = Field(ge=0, default=0)
    conflicts: List[str] = Field(default_factory=list)
    repo: Optional[str] = None

class RepoMetadata(BaseModel):
    is_fork: bool = False
    fork_of: Optional[str] = None
    default_branch: Optional[str] = None  # Shared contract fix
    size_kb: Optional[int] = None         # Shared contract fix

class VerificationResult(BaseModel):
    provenance: TrustCeiling = TrustCeiling.UNVERIFIED
    repo: RepoMetadata = Field(default_factory=RepoMetadata)
    evidence: List[Evidence] = Field(default_factory=list)

# --- Output Models (Blueprint Aligned) ---
class EvidenceChainItem(BaseModel):
    file: Optional[str] = None
    commit: Optional[str] = None
    author_lines_pct: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    source: Literal["repo", "coding_platform", "certificate"]
    label: Optional[str] = None
    detail: Optional[str] = None
    url: Optional[str] = None
    fetched_at: Optional[str] = None
    ownership_verified: Optional[bool] = None
    ceiling_applied: Optional[TrustCeiling] = None


class PlatformProfileSummary(BaseModel):
    platform: str
    handle: str
    url: str
    status: Literal["ok", "cached", "unavailable", "not_found"]
    fetched_at: str
    rating: Optional[int] = None
    rank_title: Optional[str] = None
    global_rank: Optional[int] = None
    solved_total: int = 0
    solved_by_difficulty: Dict[str, int] = Field(default_factory=dict)
    top_topics: List[Dict[str, Any]] = Field(default_factory=list)
    top_languages: List[Dict[str, Any]] = Field(default_factory=list)
    ownership_verified: bool = False
    caveat: Optional[str] = "Handle ownership not verified"

class SkillAssessment(BaseModel):
    name: str
    claim_state: ClaimState
    evidence_ids: List[str] = Field(default_factory=list)
    evidence_ceiling: TrustCeiling = TrustCeiling.UNVERIFIED
    credibility: float = Field(ge=0.0, le=1.0, default=0.0)
    quiz_status: QuizStatus = QuizStatus.NOT_REQUIRED
    evidence_chain: List[EvidenceChainItem] = Field(default_factory=list)

class SkillGap(BaseModel):
    skill: str
    required_weight: float = Field(ge=0.0, le=1.0)
    current_state: ClaimState
    recommended_action: str
    gap_reduction_pct: float = Field(ge=0.0, le=1.0)
    gap_type: Literal["proof_gap", "knowledge_gap"] = "knowledge_gap"

class RoleMatchBreakdown(BaseModel):
    skill: str
    required_weight: float
    current_state: ClaimState
    contribution: float
    evidence_ids: List[str] = Field(default_factory=list)

class LearningPlanItem(BaseModel):
    skill: str
    rank: int = Field(ge=1)
    action: str
    resource_url: str
    resource_type: Literal["imocha_assessment", "free_course", "project"]
    gap_reduction_pct: float = Field(ge=0.0, le=1.0)

class PassportPayload(BaseModel):
    passport_id: str = Field(default_factory=lambda: f"pp_{uuid.uuid4().hex[:12]}")
    candidate_consent: bool = True
    target_role: str
    skills: List[SkillAssessment] = Field(default_factory=list)
    role_match_score: float = Field(ge=0.0, le=1.0, default=0.0)
    skill_gaps: List[SkillGap] = Field(default_factory=list)
    role_breakdown: List[RoleMatchBreakdown] = Field(default_factory=list)
    quiz_questions: List["QuizQuestion"] = Field(default_factory=list)
    learning_plan: List[LearningPlanItem] = Field(default_factory=list)
    platform_profiles: List[PlatformProfileSummary] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)
    signature: Optional[str] = None
    public_key_id: Optional[str] = None
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    github_id: Optional[int] = None
    github_login: Optional[str] = None
    # "oauth_verified": the GitHub account was authenticated via OAuth. "unverified": a public profile/repo URL
    # was supplied without proving ownership - Verified is then impossible (capped at Supported).
    ownership: Literal["oauth_verified", "unverified"] = "unverified"

# --- Quiz Models ---
class QuizQuestion(BaseModel):
    question_id: str = Field(default_factory=lambda: f"qq_{uuid.uuid4().hex[:8]}")
    claim_id: str
    skill: str
    question_type: QuestionType
    question_text: str
    context_snippet: Optional[str] = None
    expected_answer_hints: List[str] = Field(default_factory=list)

class QuizAnswer(BaseModel):
    question_id: str
    answer_text: str = Field(min_length=1)

class QuizResult(BaseModel):
    question_id: str
    passed: bool
    reasoning: str = ""

# --- Target Role Models ---
class RequiredSkill(BaseModel):
    skill: str
    weight: float = Field(ge=0.0, le=1.0)
    importance: Literal["required", "preferred", "bonus"] = "required"

class TargetRole(BaseModel):
    role_name: str
    description: str = ""
    required_skills: List[RequiredSkill] = Field(default_factory=list)

    @field_validator("required_skills")
    @classmethod
    def _weights_sum(cls, v: List[RequiredSkill]) -> List[RequiredSkill]:
        total = sum(s.weight for s in v)
        if total <= 0: return v
        return [s.model_copy(update={"weight": s.weight / total}) for s in v]

PassportPayload.model_rebuild()