"""
Top-level Evidence Verification Engine Orchestrator.
Coordinates URL parsing, GitHub metadata, recursive tree discovery, regex usage depth,
authorship signals, and anti-fraud heuristics. No LLM calls.
"""
from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from .detector import locate_evidence_for_claim
from .fixtures import CONFLICT_REPO_FILES, STRONG_REPO_FILES
from .github_client import (
    GitHubAPIError,
    GitHubClient,
    RateLimitError,
    RepoNotFoundError,
    parse_github_url,
)
from .git_engine import shallow_clone_and_blame
from .heuristics import compute_provenance, detect_conflicts_for_evidence
from .models import (
    AuthorshipSignal,
    Claim,
    Evidence,
    RepoMetadata,
    TrustCeiling,
    UsageDepth,
    VerificationResult,
)

logger = logging.getLogger(__name__)


def _run_offline_verification(
    claims: List[Claim],
    owner: str,
    repo_name: str,
    candidate_identity: str,
) -> VerificationResult:
    """Deterministic offline verification against synthetic test repositories."""
    is_conflict = "tutorial" in repo_name.lower() or "conflict" in repo_name.lower()
    files_map = CONFLICT_REPO_FILES if is_conflict else STRONG_REPO_FILES

    repo_meta = RepoMetadata(
        is_fork=is_conflict,
        fork_of="facebook/react-tutorial" if is_conflict else None,
        default_branch="main",
        size_kb=850 if is_conflict else 1200,
        commit_count=1 if is_conflict else 15,
    )

    file_tree = [{"path": p, "type": "blob"} for p in files_map.keys()]
    candidate_commits = 0 if is_conflict else 12
    total_commits = 1 if is_conflict else 15

    evidence_list: List[Evidence] = []
    for claim in claims:
        ev = locate_evidence_for_claim(claim, file_tree, lambda p: files_map.get(p))
        if ev.file_exists:
            ev.commit_count = 0 if is_conflict else 10
            ev.authorship_pct = 0.0 if is_conflict else 0.85
            ev.authorship_signal = AuthorshipSignal.NONE if is_conflict else AuthorshipSignal.STRONG
            ev.conflicts = detect_conflicts_for_evidence(
                repo_meta, ev, candidate_commit_count=candidate_commits, total_commits=total_commits
            )
        evidence_list.append(ev)

    prov = compute_provenance(repo_meta, evidence_list, is_github_repo=True)
    # Only claims with actual corroborating evidence are included in the evidence payload
    evidenced = [ev for ev in evidence_list if ev.file_exists]
    return VerificationResult(provenance=prov, repo=repo_meta, evidence=evidenced)


def verify(
    claims: List[Claim],
    github_url: str,
    candidate_identity: Optional[str] = None,
    allow_network: bool = True,
    github_client: Optional[GitHubClient] = None,
    max_repo_size_kb: int = 150_000,
) -> VerificationResult:
    """
    Main entry point for Evidence Verification (Member 3).

    Validates candidate claims against a public GitHub repository without any LLM calls.

    Args:
        claims: Skill claims to verify.
        github_url: Target public GitHub repository URL.
        candidate_identity: Expected author login/name/email (defaults to repo owner).
        allow_network: When False, uses deterministic offline fixture mode.
        github_client: Optional custom or mocked GitHubClient.
        max_repo_size_kb: Maximum repository size in KB before skipping deep shallow clones.

    Returns:
        VerificationResult with provenance ceiling, repository metadata, and evidence items.
    """
    if not claims:
        return VerificationResult(
            provenance=TrustCeiling.UNVERIFIED,
            repo=RepoMetadata(),
            evidence=[],
        )

    # 1. Parse GitHub URL
    try:
        owner, repo_name = parse_github_url(github_url)
    except ValueError as exc:
        logger.warning(f"Invalid GitHub URL provided: {github_url} ({exc})")
        # Graceful return with unverified claims
        return VerificationResult(
            provenance=TrustCeiling.UNVERIFIED,
            repo=RepoMetadata(),
            evidence=[
                Evidence(
                    claim_id=c.claim_id,
                    skill=c.skill,
                    file_path=c.repo_hint,
                    file_exists=False,
                    usage_depth=UsageDepth.NONE,
                )
                for c in claims
            ],
        )

    candidate = candidate_identity or owner

    # 2. Check offline mode
    if not allow_network:
        return _run_offline_verification(claims, owner, repo_name, candidate)

    # 3. Initialize GitHub client
    client = github_client or GitHubClient(prefer_raw_content=True)

    # 4. Fetch repo metadata
    try:
        repo_metadata = client.get_repo_metadata(owner, repo_name)
    except RepoNotFoundError:
        logger.warning(f"Repository not found or private: {github_url}")
        return VerificationResult(
            provenance=TrustCeiling.UNVERIFIED,
            repo=RepoMetadata(),
            evidence=[
                Evidence(
                    claim_id=c.claim_id,
                    skill=c.skill,
                    file_path=c.repo_hint,
                    file_exists=False,
                    usage_depth=UsageDepth.NONE,
                )
                for c in claims
            ],
        )
    except (RateLimitError, GitHubAPIError) as exc:
        # Never substitute synthetic fixture evidence for a live failure: report it to the caller.
        logger.error(f"GitHub API error during metadata fetch: {exc}")
        raise

    # 5. Fetch recursive file tree
    try:
        tree = client.get_repo_tree(owner, repo_name, branch=repo_metadata.default_branch)
    except Exception as exc:
        logger.warning(f"Could not fetch tree for {github_url}: {exc}")
        tree = []

    # Handle empty repo edge case
    if not tree:
        return VerificationResult(
            provenance=TrustCeiling.UNVERIFIED,
            repo=repo_metadata,
            evidence=[
                Evidence(
                    claim_id=c.claim_id,
                    skill=c.skill,
                    file_path=c.repo_hint,
                    file_exists=False,
                    usage_depth=UsageDepth.NONE,
                )
                for c in claims
            ],
        )

    # 6. Fetch commit activity & velocity
    commit_activity = client.get_commit_activity(owner, repo_name, author=candidate)
    candidate_commits = commit_activity.get("commit_count", 0)

    # Total commits approximation
    total_commits = candidate_commits
    # RepoMetadata carries no commit total from the live API; fall back to the candidate's own commit count.
    repo_total = getattr(repo_metadata, "commit_count", 0) or 0
    if repo_total > 0:
        total_commits = repo_total

    # 7. Locate evidence for each claim
    evidence_list: List[Evidence] = []
    file_fetcher = lambda p: client.get_file_content(owner, repo_name, p, branch=repo_metadata.default_branch)

    files_to_blame: List[str] = []

    for claim in claims:
        ev = locate_evidence_for_claim(claim, tree, file_fetcher)
        if ev.file_exists and ev.file_path:
            files_to_blame.append(ev.file_path)
        evidence_list.append(ev)

    # 8. Compute authorship via shallow clone if repo size allows
    blame_results: Dict[str, tuple[float, AuthorshipSignal]] = {}
    if files_to_blame and repo_metadata.size_kb <= max_repo_size_kb:
        try:
            blame_results = shallow_clone_and_blame(
                github_url=github_url,
                file_paths=files_to_blame,
                candidate_username=candidate,
                token=client.token,
            )
        except Exception as exc:
            logger.warning(f"Shallow blame failed: {exc}")

    # 9. Update evidence with blame metrics & anti-fraud conflicts
    for ev in evidence_list:
        if ev.file_exists and ev.file_path:
            if ev.file_path in blame_results:
                pct, signal = blame_results[ev.file_path]
                ev.authorship_pct = pct
                ev.authorship_signal = signal
            elif candidate_commits > 0:
                # Heuristic fallback if shallow blame wasn't run
                ev.authorship_pct = min(1.0, candidate_commits / 10.0)
                ev.authorship_signal = AuthorshipSignal.STRONG if ev.authorship_pct > 0.6 else AuthorshipSignal.PARTIAL
            else:
                ev.authorship_pct = 0.0
                ev.authorship_signal = AuthorshipSignal.NONE

            ev.commit_count = candidate_commits
            ev.conflicts = detect_conflicts_for_evidence(
                repo_metadata=repo_metadata,
                evidence=ev,
                candidate_commit_count=candidate_commits,
                total_commits=total_commits,
            )

    # 10. Compute provenance trust level
    prov = compute_provenance(repo_metadata, evidence_list, is_github_repo=True)
    evidenced = [ev for ev in evidence_list if ev.file_exists]
    for ev in evidenced:
        ev.repo = f"{owner}/{repo_name}"

    return VerificationResult(
        provenance=prov,
        repo=repo_metadata,
        evidence=evidenced,
    )


# ---------------------------------------------------------------------------
# Profile-level verification (OAuth login or public profile URL)
# ---------------------------------------------------------------------------
import re as _re

_PROFILE_RE = _re.compile(r"^https?://(?:www\.)?github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/?$")
_DEPTH_RANK = {UsageDepth.NONE: 0, UsageDepth.DETECTED: 1, UsageDepth.MODERATE: 2, UsageDepth.SUBSTANTIAL: 3}
_AUTH_RANK = {AuthorshipSignal.NONE: 0, AuthorshipSignal.PARTIAL: 1, AuthorshipSignal.STRONG: 2}
_PROV_RANK = {TrustCeiling.UNVERIFIED: 0, TrustCeiling.CANDIDATE_SUPPLIED: 1, TrustCeiling.THIRD_PARTY_ATTESTED: 2, TrustCeiling.PLATFORM_VERIFIED: 3}


def parse_github_profile(url: str) -> Optional[str]:
    m = _PROFILE_RE.match((url or "").strip())
    return m.group(1) if m else None


def _evidence_score(ev: Evidence) -> tuple:
    return (
        0 if ev.conflicts else 1,
        _AUTH_RANK[ev.authorship_signal], _DEPTH_RANK[ev.usage_depth], ev.authorship_pct, ev.commit_count,
    )


def merge_verification_results(claims: List[Claim], results: List[VerificationResult]) -> VerificationResult:
    """Per claim keep the best evidence across repositories. Provenance is the *lowest* ceiling among
    the repositories that supplied kept evidence, so one strong repo cannot lift another's evidence."""
    best: Dict[str, Evidence] = {}
    prov_of: Dict[str, TrustCeiling] = {}
    repo_meta: Optional[RepoMetadata] = None
    for res in results:
        for ev in res.evidence:
            if not ev.file_exists:
                continue
            if ev.claim_id not in best or _evidence_score(ev) > _evidence_score(best[ev.claim_id]):
                best[ev.claim_id] = ev
                prov_of[ev.claim_id] = res.provenance
                repo_meta = repo_meta or res.repo
    if not best:
        return VerificationResult(provenance=TrustCeiling.UNVERIFIED, repo=RepoMetadata(), evidence=[])
    provenance = min(prov_of.values(), key=lambda p: _PROV_RANK[p])
    return VerificationResult(provenance=provenance, repo=repo_meta or RepoMetadata(), evidence=list(best.values()))


def verify_github_source(
    claims: List[Claim],
    github_url: str,
    allow_network: bool = True,
    github_client: Optional[GitHubClient] = None,
    max_repos: int = 5,
) -> VerificationResult:
    """Verify claims against a repository URL, or against a user's own public repositories when a
    profile URL is given. A profile never proves skills by itself: only code found in its repos counts.

    Raises GitHubAPIError / RateLimitError when GitHub cannot be reached (no synthetic fallback).
    """
    login = parse_github_profile(github_url)
    if login is None:
        return verify(claims=claims, github_url=github_url, allow_network=allow_network, github_client=github_client)
    if not claims:
        return VerificationResult(provenance=TrustCeiling.UNVERIFIED, repo=RepoMetadata(), evidence=[])
    if not allow_network:  # explicit offline fixture mode (tests / local demos only)
        return _run_offline_verification(claims, login, "portfolio", login)

    client = github_client or GitHubClient(prefer_raw_content=True)
    repos = client.list_user_repos(login)
    usable = [r for r in repos if not r.get("fork") and not r.get("archived") and (r.get("size") or 0) > 0 and r.get("name")]
    results: List[VerificationResult] = []
    errors: List[Exception] = []
    for r in usable[:max_repos]:
        try:
            results.append(verify(claims=claims, github_url=f"https://github.com/{login}/{r['name']}",
                                  candidate_identity=login, github_client=client, allow_network=True))
        except (RateLimitError, GitHubAPIError) as exc:
            errors.append(exc)
    if not results and errors:
        raise errors[0]
    return merge_verification_results(claims, results)
