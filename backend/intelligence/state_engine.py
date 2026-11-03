"""
Deterministic claim-state transition logic.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Union

from .models import (
    Claim, Evidence, VerificationResult, SkillAssessment,
    ClaimState, TrustCeiling, QuizStatus, UsageDepth, AuthorshipSignal,
    EvidenceChainItem,
)

# ---------------------------------------------------------------------------
# Platform Trust Ceiling and Weight Configuration
# ---------------------------------------------------------------------------
# When ownership is not verified, platform evidence cannot exceed CANDIDATE_SUPPLIED.
# Turning on ownership verification later changes this single switch.
UNVERIFIED_PLATFORM_CEILING: TrustCeiling = TrustCeiling.CANDIDATE_SUPPLIED
VERIFIED_PLATFORM_CEILING: TrustCeiling = TrustCeiling.THIRD_PARTY_ATTESTED

# Evidence weights mapped from deterministic platform strength
PLATFORM_WEIGHT_SOME: float = 0.5
PLATFORM_WEIGHT_STRONG: float = 0.8

STATE_MULTIPLIERS: Dict[ClaimState, float] = {
    ClaimState.VERIFIED: 1.0,
    ClaimState.SUPPORTED: 0.6,
    ClaimState.CLAIMED: 0.2,
    ClaimState.CONTRADICTED: 0.0,
}

CEILING_MAX_STATE: Dict[TrustCeiling, ClaimState] = {
    TrustCeiling.PLATFORM_VERIFIED: ClaimState.VERIFIED,
    TrustCeiling.THIRD_PARTY_ATTESTED: ClaimState.SUPPORTED,
    TrustCeiling.CANDIDATE_SUPPLIED: ClaimState.SUPPORTED,
    TrustCeiling.UNVERIFIED: ClaimState.CLAIMED,
}

CEILING_RANK: Dict[TrustCeiling, int] = {
    TrustCeiling.UNVERIFIED: 0,
    TrustCeiling.CANDIDATE_SUPPLIED: 1,
    TrustCeiling.THIRD_PARTY_ATTESTED: 2,
    TrustCeiling.PLATFORM_VERIFIED: 3,
}


def determine_claim_state(
    evidence_list: List[Evidence],
    quiz_passed: bool,
    provenance: TrustCeiling = TrustCeiling.PLATFORM_VERIFIED,
    platform_support: Optional[Any] = None,
    platform_conflicts: Optional[List[Any]] = None,
) -> ClaimState:
    """
    Deterministic claim-state transition logic.
    Conflicts from repo or platform checks immediately force Contradicted.
    If no evidence is present from either source, state is Claimed.
    """
    ceiling_max = CEILING_MAX_STATE.get(provenance, ClaimState.CLAIMED)

    # 1. Any conflict forces CONTRADICTED
    has_repo_conflict = any(len(ev.conflicts) > 0 for ev in evidence_list)
    has_platform_conflict = bool(platform_conflicts and len(platform_conflicts) > 0)
    if has_repo_conflict or has_platform_conflict:
        return ClaimState.CONTRADICTED

    # 2. Check presence of evidence
    has_platform_support = bool(platform_support and getattr(platform_support, "strength", "none") != "none")
    if not evidence_list and not has_platform_support:
        return _cap(ClaimState.CLAIMED, ceiling_max)

    # 3. Assess strength
    has_strong_repo = any(
        ev.authorship_signal == AuthorshipSignal.STRONG
        and ev.usage_depth in (UsageDepth.MODERATE, UsageDepth.SUBSTANTIAL)
        for ev in evidence_list
    )
    has_strong_platform = bool(platform_support and getattr(platform_support, "strength", "none") == "strong")
    has_strong_evidence = has_strong_repo or has_strong_platform

    if has_strong_evidence and quiz_passed:
        return _cap(ClaimState.VERIFIED, ceiling_max)
    if has_strong_evidence:
        return _cap(ClaimState.SUPPORTED, ceiling_max)

    return _cap(ClaimState.SUPPORTED, ceiling_max)


def _cap(state: ClaimState, ceiling_max: ClaimState) -> ClaimState:
    order = [ClaimState.CONTRADICTED, ClaimState.CLAIMED, ClaimState.SUPPORTED, ClaimState.VERIFIED]
    return state if order.index(state) <= order.index(ceiling_max) else ceiling_max


def compute_credibility(
    evidence_list: List[Evidence],
    state: ClaimState,
    quiz_passed: bool,
    platform_support: Optional[Any] = None,
) -> float:
    """
    Computes credibility score between 0.0 and 1.0 without double counting.
    Takes max(repo_weight, platform_weight), multiplies by state multiplier,
    and adds 0.2 quiz bonus only when quiz is passed and state is Verified.
    """
    repo_weight = max((ev.authorship_pct for ev in evidence_list), default=0.0)

    platform_weight = 0.0
    if platform_support:
        strength = getattr(platform_support, "strength", "none")
        if strength == "strong":
            platform_weight = PLATFORM_WEIGHT_STRONG
        elif strength == "some":
            platform_weight = PLATFORM_WEIGHT_SOME

    # Combine without double counting: take the stronger weight
    evidence_weight = max(repo_weight, platform_weight)
    base = evidence_weight * STATE_MULTIPLIERS[state]
    bonus = 0.2 if (quiz_passed and state == ClaimState.VERIFIED) else 0.0
    return max(0.0, min(1.0, round(base + bonus, 3)))


def quiz_status_for(state: ClaimState, quiz_passed: Optional[bool]) -> QuizStatus:
    if state == ClaimState.VERIFIED: return QuizStatus.PASSED
    if state == ClaimState.SUPPORTED: return QuizStatus.AVAILABLE
    return QuizStatus.NOT_REQUIRED


def assess_skill(
    claim: Claim,
    verification: VerificationResult,
    quiz_passed: bool = False,
    platform_support: Optional[Any] = None,
    platform_conflicts: Optional[List[Any]] = None,
    platform_evidence_list: Optional[List[Any]] = None,
) -> SkillAssessment:
    """
    Assess a single skill claim against repository evidence and coding platform evidence.
    
    Ceiling Combination Rule:
    - If a skill has only repo evidence: uses verification.provenance.
    - If a skill has only platform evidence: uses UNVERIFIED_PLATFORM_CEILING (or VERIFIED if ownership is verified).
    - If a skill has both repo and platform evidence:
      If repo evidence alone provides strong authorship, the repo's provenance ceiling is preserved.
      If repo evidence is absent or weak, the skill relies on platform evidence, so the lower
      ceiling of the two sources is applied to prevent unproven handles from bypassing ceilings.
    """
    skill_evidence = [ev for ev in verification.evidence if ev.claim_id == claim.claim_id]

    # Filter platform conflicts relevant to this skill or claim
    relevant_conflicts: List[Any] = []
    if platform_conflicts:
        for c in platform_conflicts:
            c_skill = getattr(c, "skill", None)
            c_claim_id = getattr(c, "claim_id", None)
            if (c_claim_id and c_claim_id == claim.claim_id) or (c_skill and c_skill.lower() == claim.skill.lower()):
                relevant_conflicts.append(c)

    # Determine effective ceiling
    has_platform = bool(platform_support and getattr(platform_support, "strength", "none") != "none")
    platform_ceiling = UNVERIFIED_PLATFORM_CEILING
    if platform_support and getattr(platform_support, "ownership_verified", False):
        platform_ceiling = VERIFIED_PLATFORM_CEILING

    has_strong_repo = any(
        ev.authorship_signal == AuthorshipSignal.STRONG
        and ev.usage_depth in (UsageDepth.MODERATE, UsageDepth.SUBSTANTIAL)
        for ev in skill_evidence
    )

    if skill_evidence and has_platform:
        if has_strong_repo:
            effective_ceiling = verification.provenance
        else:
            effective_ceiling = min(verification.provenance, platform_ceiling, key=lambda c: CEILING_RANK[c])
    elif has_platform:
        effective_ceiling = platform_ceiling
    else:
        effective_ceiling = verification.provenance

    state = determine_claim_state(
        skill_evidence,
        quiz_passed,
        effective_ceiling,
        platform_support=platform_support,
        platform_conflicts=relevant_conflicts,
    )
    credibility = compute_credibility(
        skill_evidence,
        state,
        quiz_passed,
        platform_support=platform_support,
    )

    # 1. Repo evidence chain items
    evidence_chain: List[EvidenceChainItem] = [
        EvidenceChainItem(
            file=ev.file_path,
            commit=None,
            author_lines_pct=ev.authorship_pct,
            source="repo" if ev.source_type == "github_code" else "certificate",
            label=ev.repo,
            detail=None,
            url=(f"https://github.com/{ev.repo}/blob/HEAD/{ev.file_path}" if ev.repo and ev.file_path else None),
            fetched_at=None,
            ownership_verified=None,
            ceiling_applied=verification.provenance,
        )
        for ev in skill_evidence
    ]

    # 2. Coding platform evidence chain items
    if has_platform and platform_support:
        contributing = getattr(platform_support, "contributing", [])
        detail_msg = getattr(platform_support, "detail", "")

        # Look up matching platform profiles for url/fetched_at/ownership
        profiles_by_handle = {}
        if platform_evidence_list:
            for p in platform_evidence_list:
                key = (getattr(p, "platform", "").lower(), getattr(p, "handle", "").lower())
                profiles_by_handle[key] = p

        for contrib in contributing:
            plat_name = contrib.get("platform", "").lower()
            handle = contrib.get("handle", "")
            matched_profile = profiles_by_handle.get((plat_name, handle.lower()))

            p_url = getattr(matched_profile, "url", None) if matched_profile else None
            p_fetched_at = getattr(matched_profile, "fetched_at", None) if matched_profile else None
            p_verified = getattr(matched_profile, "ownership_verified", False) if matched_profile else False

            item_ceiling = VERIFIED_PLATFORM_CEILING if p_verified else UNVERIFIED_PLATFORM_CEILING

            evidence_chain.append(
                EvidenceChainItem(
                    file=None,
                    commit=None,
                    author_lines_pct=None,
                    source="coding_platform",
                    label=f"{plat_name.title()} / {handle}",
                    detail=detail_msg,
                    url=p_url,
                    fetched_at=p_fetched_at,
                    ownership_verified=p_verified,
                    ceiling_applied=item_ceiling,
                )
            )

    return SkillAssessment(
        name=claim.skill,
        claim_state=state,
        evidence_ids=[ev.evidence_id for ev in skill_evidence],
        evidence_ceiling=effective_ceiling,
        credibility=credibility,
        quiz_status=quiz_status_for(state, quiz_passed),
        evidence_chain=evidence_chain,
    )


def assess_all(
    claims: List[Claim],
    verification: VerificationResult,
    quiz_results: Optional[Dict[str, bool]] = None,
    platform_support_map: Optional[Dict[str, Any]] = None,
    platform_conflicts: Optional[List[Any]] = None,
    platform_evidence_list: Optional[List[Any]] = None,
) -> List[SkillAssessment]:
    quiz_results = quiz_results or {}
    platform_support_map = platform_support_map or {}
    return [
        assess_skill(
            claim=claim,
            verification=verification,
            quiz_passed=quiz_results.get(claim.claim_id, False),
            platform_support=platform_support_map.get(claim.skill),
            platform_conflicts=platform_conflicts,
            platform_evidence_list=platform_evidence_list,
        )
        for claim in claims
    ]