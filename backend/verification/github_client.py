"""
Deterministic GitHub REST API Client with Response Caching.
Handles URL parsing, metadata extraction, recursive tree listing, and commit velocity.
"""
from __future__ import annotations

import base64
from urllib.parse import quote
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests

from .models import RepoMetadata


class GitHubAPIError(Exception):
    """Base exception for GitHub API errors."""
    pass


class RepoNotFoundError(GitHubAPIError):
    """Raised when repository is private, non-existent, or 404."""
    pass


class RateLimitError(GitHubAPIError):
    """Raised when GitHub API rate limits are exhausted."""
    pass


def parse_github_url(url: str) -> Tuple[str, str]:
    """
    Parses a GitHub URL into (owner, repo).
    Accepts formats:
        - https://github.com/owner/repo
        - http://github.com/owner/repo/
        - github.com/owner/repo.git
        - git@github.com:owner/repo.git
    """
    url = url.strip()
    if not url:
        raise ValueError("GitHub URL cannot be empty.")

    # Handle SSH git@github.com:owner/repo.git
    ssh_match = re.match(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if ssh_match:
        return ssh_match.group(1), ssh_match.group(2)

    # Prepend schema if missing
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    if "github.com" not in parsed.netloc.lower():
        raise ValueError(f"Invalid GitHub host: {parsed.netloc}")

    path_parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(path_parts) < 2:
        raise ValueError(f"Invalid GitHub repository URL: {url}. Expected owner and repository name.")

    owner = path_parts[0]
    repo = re.sub(r"\.git$", "", path_parts[1])

    if not owner or not repo:
        raise ValueError(f"Cannot parse owner and repo from: {url}")

    return owner, repo


class GitHubClient:
    """
    Cached GitHub REST API client.
    Guards against rate limits with an in-memory TTL cache and handles edge cases.
    """

    BASE_URL = "https://api.github.com"

    def __init__(
        self,
        token: Optional[str] = None,
        cache_ttl_seconds: int = 3600,
        session: Optional[requests.Session] = None,
        prefer_raw_content: bool = False,
    ):
        self.token = token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
        self.cache_ttl = cache_ttl_seconds
        self.session = session or requests.Session()
        self._cache: Dict[str, Tuple[float, Any]] = {}
        # Public file bodies come from raw.githubusercontent.com, which does not spend the REST API quota
        # (60/hour unauthenticated). Without this, one repository scan costs dozens of API calls.
        self.prefer_raw_content = prefer_raw_content

    RAW_URL = "https://raw.githubusercontent.com"
    MAX_RAW_BYTES = 512_000

    def _get_raw(self, owner: str, repo: str, file_path: str, branch: str) -> Tuple[bool, Optional[str]]:
        """(handled, text). handled=False means the caller should fall back to the contents API."""
        key = f"raw:{owner}/{repo}@{branch}:{file_path}"
        now = time.time()
        if key in self._cache and now - self._cache[key][0] < self.cache_ttl:
            return True, self._cache[key][1]
        url = f"{self.RAW_URL}/{owner}/{repo}/{quote(branch, safe='')}/{quote(file_path)}"
        try:
            resp = self.session.get(url, headers={"User-Agent": "ProofPass-VerificationEngine/1.0"}, timeout=15)
        except requests.RequestException:
            return False, None
        if resp.status_code == 404:
            return True, None
        if resp.status_code == 429:
            raise RateLimitError("raw.githubusercontent.com rate limit exceeded")
        if not resp.ok:
            return False, None
        text = resp.content[: self.MAX_RAW_BYTES].decode("utf-8", errors="replace")
        self._cache[key] = (now, text)
        return True, text

    def _headers(self) -> Dict[str, str]:
        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "ProofPass-VerificationEngine/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        cache_key = f"{endpoint}?{sorted((params or {}).items())}"
        now = time.time()

        if cache_key in self._cache:
            ts, val = self._cache[cache_key]
            if now - ts < self.cache_ttl:
                return val

        url = f"{self.BASE_URL}{endpoint}" if endpoint.startswith("/") else f"{self.BASE_URL}/{endpoint}"
        resp = self.session.get(url, headers=self._headers(), params=params, timeout=15)

        if resp.status_code == 404:
            raise RepoNotFoundError(f"Resource not found (or repository is private): {endpoint}")
        if resp.status_code in (403, 429):
            msg = resp.json().get("message", "Rate limit exceeded") if resp.headers.get("Content-Type", "").startswith("application/json") else "Rate limit exceeded"
            raise RateLimitError(f"GitHub API error {resp.status_code}: {msg}")
        if not resp.ok:
            raise GitHubAPIError(f"GitHub API error {resp.status_code}: {resp.text}")

        data = resp.json()
        self._cache[cache_key] = (now, data)
        return data

    def list_user_repos(self, login: str, limit: int = 30) -> List[Dict[str, Any]]:
        """Public repositories of a user, most recently pushed first (raises on API errors)."""
        data = self._get(f"/users/{login}/repos", params={"per_page": min(limit, 100), "sort": "pushed", "type": "owner"})
        return [r for r in data if isinstance(r, dict)]

    def get_repo_metadata(self, owner: str, repo: str) -> RepoMetadata:
        """Fetches repo metadata (fork status, fork source, default branch, size)."""
        data = self._get(f"/repos/{owner}/{repo}")
        is_fork = bool(data.get("fork", False))
        fork_of: Optional[str] = None
        if is_fork and "parent" in data:
            fork_of = data["parent"].get("full_name")

        return RepoMetadata(
            is_fork=is_fork,
            fork_of=fork_of,
            default_branch=data.get("default_branch", "main"),
            size_kb=data.get("size", 0),
        )

    def get_repo_tree(self, owner: str, repo: str, branch: str = "main") -> List[Dict[str, Any]]:
        """
        Recursively fetches the full file tree of the repository.
        Returns a list of dicts with 'path', 'type' ('blob'|'tree'), 'size', 'sha'.
        """
        try:
            data = self._get(f"/repos/{owner}/{repo}/git/trees/{branch}", params={"recursive": "1"})
            return data.get("tree", [])
        except GitHubAPIError:
            # Fallback to master if main branch isn't found
            if branch == "main":
                try:
                    data = self._get(f"/repos/{owner}/{repo}/git/trees/master", params={"recursive": "1"})
                    return data.get("tree", [])
                except GitHubAPIError:
                    pass
            raise

    def get_file_content(self, owner: str, repo: str, file_path: str, branch: str = "main") -> Optional[str]:
        """Fetches and decodes the plain text content of a file."""
        if self.prefer_raw_content:
            handled, text = self._get_raw(owner, repo, file_path, branch)
            if handled:
                return text
        try:
            data = self._get(f"/repos/{owner}/{repo}/contents/{file_path}", params={"ref": branch})
            if "content" in data and data.get("encoding") == "base64":
                raw = base64.b64decode(data["content"])
                return raw.decode("utf-8", errors="replace")
            return None
        except RepoNotFoundError:
            return None

    def get_commit_activity(
        self, owner: str, repo: str, author: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetches commit history to analyze commit count, velocity, and authorship.
        """
        params: Dict[str, Any] = {"per_page": 100}
        if author:
            params["author"] = author

        try:
            commits = self._get(f"/repos/{owner}/{repo}/commits", params=params)
            if not isinstance(commits, list):
                return {"commit_count": 0, "commits": [], "commit_velocity_per_week": 0.0}

            commit_count = len(commits)
            return {
                "commit_count": commit_count,
                "commits": [
                    {
                        "sha": c.get("sha"),
                        "message": c.get("commit", {}).get("message", ""),
                        "date": c.get("commit", {}).get("author", {}).get("date"),
                        "author": c.get("author", {}).get("login") if c.get("author") else None,
                    }
                    for c in commits
                ],
                "commit_velocity_per_week": round(commit_count / 4.0, 2) if commit_count else 0.0,
            }
        except RepoNotFoundError:
            return {"commit_count": 0, "commits": [], "commit_velocity_per_week": 0.0}
