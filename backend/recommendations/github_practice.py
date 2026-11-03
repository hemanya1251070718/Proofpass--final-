"""
Practice recommendations from the GitHub public Issues Search API (backend-side only).

Result ``source`` values (always reported, never hidden):
  live         - fresh response from api.github.com
  cache        - unexpired SQLite cache entry of an earlier live response
  stale_cache  - expired cache entry served because GitHub was unavailable/rate-limited
  fallback     - NO live data: a GitHub search link only (is_fallback=true)
  unmapped     - the skill has no language/keyword mapping
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

import httpx
from sqlalchemy.orm import Session

from . import config, skill_map
from .models import GithubCache

logger = logging.getLogger("proofpass.github_practice")

LABELS = ("good first issue", "help wanted")
LABEL_NOTE = "Maintainer label '{label}' is a hint only - check scope and activity before starting."
_lock = threading.Lock()
_rate = {"remaining": None, "reset": 0.0, "blocked_until": 0.0}


def _utcnow() -> datetime:
    return datetime.utcnow()


def reset_rate_state() -> None:
    with _lock:
        _rate.update(remaining=None, reset=0.0, blocked_until=0.0)


def rate_snapshot() -> Dict[str, Any]:
    with _lock:
        return {"remaining": _rate["remaining"], "reset_epoch": _rate["reset"] or None, "authenticated": config.github_token() is not None}


def build_query(skill: str, label: str, recent_days: int = 365) -> Optional[str]:
    m = skill_map.github_mapping(skill)
    if not m:
        return None
    language, keywords = m
    since = (_utcnow() - timedelta(days=recent_days)).strftime("%Y-%m-%d")
    parts = ["is:issue", "is:open", "archived:false", "no:assignee", f'label:"{label}"', f"updated:>{since}"]
    if language:
        parts.append(f'language:"{language}"' if " " in language else f"language:{language}")
    for kw in keywords[:1]:
        parts.append(f'"{kw}" in:title,body' if " " in kw else f"{kw} in:title,body")
    return " ".join(parts)


def _fallback_item(skill: str) -> Dict[str, Any]:
    name = skill_map.display_name(skill)
    m = skill_map.github_mapping(skill)
    q = 'is:issue is:open label:"good first issue" no:assignee'
    if m and m[0]:
        q += f" language:{m[0]}"
    if m and m[1]:
        q += f" {m[1][0]}"
    elif not m:
        q += f" {name}"
    return {
        "title": f"Browse open 'good first issue' tasks for {name} on GitHub",
        "url": "https://github.com/search?q=" + quote_plus(q) + "&type=issues",
        "repo": None, "labels": [], "comments": 0, "updated_at": None, "excerpt": "",
        "is_fallback": True, "label_note": "Search link only - no live issue data was available.",
    }


def _relevance(raw: Dict[str, Any], keywords: List[str], language: Optional[str]) -> float:
    """Skill relevance of an issue: keyword in title (3) / in a label (2) / in body (1). Language-only
    skills rely on GitHub's repository-language filter and get a flat 1."""
    if not keywords:
        return 1.0 if language else 0.0
    title = (raw.get("title") or "").lower()
    labels = " ".join(l.get("name", "") for l in raw.get("labels", []) if isinstance(l, dict)).lower()
    body = (raw.get("body") or "").lower()
    best = 0.0
    for kw in keywords:
        k = kw.lower()
        best = max(best, 3.0 if k in title else 2.0 if k in labels else 1.0 if k in body else 0.0)
    return best


def _map_item(raw: Dict[str, Any], label: str, keywords: Optional[List[str]] = None, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if raw.get("pull_request") or raw.get("state") != "open" or raw.get("assignee"):
        return None
    body = (raw.get("body") or "").strip()
    if len(body) < 40 or (raw.get("comments") or 0) > 15:
        return None
    repo = (raw.get("repository_url") or "").replace("https://api.github.com/repos/", "") or None
    excerpt = " ".join(body.split())[:240]
    return {
        "title": (raw.get("title") or "")[:200], "url": raw.get("html_url"), "repo": repo,
        "labels": [l.get("name") for l in raw.get("labels", []) if isinstance(l, dict)][:6],
        "comments": raw.get("comments", 0), "updated_at": raw.get("updated_at"),
        "created_at": raw.get("created_at"), "excerpt": excerpt, "is_fallback": False,
        "relevance": _relevance(raw, keywords or [], language), "matched_label": label, "label_note": LABEL_NOTE.format(label=label),
    }


def _cache_get(db: Session, key: str) -> Optional[GithubCache]:
    return db.query(GithubCache).filter(GithubCache.cache_key == key).first()


def _cache_put(db: Session, key: str, items: List[Dict[str, Any]]) -> None:
    now = _utcnow()
    row = _cache_get(db, key)
    payload = json.dumps(items)
    exp = now + timedelta(seconds=config.GITHUB_CACHE_TTL_SECONDS)
    if row:
        row.payload_json, row.fetched_at, row.expires_at = payload, now, exp
    else:
        db.add(GithubCache(cache_key=key, payload_json=payload, fetched_at=now, expires_at=exp))
    db.commit()


class _Unavailable(Exception):
    pass


def _record_rate_headers(resp: httpx.Response) -> None:
    with _lock:
        try:
            if "x-ratelimit-remaining" in resp.headers:
                _rate["remaining"] = int(resp.headers["x-ratelimit-remaining"])
            if "x-ratelimit-reset" in resp.headers:
                _rate["reset"] = float(resp.headers["x-ratelimit-reset"])
        except ValueError:
            pass


def _request(client: httpx.Client, q: str, per_page: int) -> List[Dict[str, Any]]:
    now = time.time()
    with _lock:
        if _rate["blocked_until"] > now:
            raise _Unavailable(f"rate limited for another {int(_rate['blocked_until'] - now)}s")
        if _rate["remaining"] == 0 and _rate["reset"] > now:
            raise _Unavailable("GitHub search quota exhausted until reset")
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ProofPass-Recommendations"}
    token = config.github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = client.get(f"{config.GITHUB_API_BASE}/search/issues", params={"q": q, "sort": "updated", "order": "desc", "per_page": per_page}, headers=headers, timeout=config.GITHUB_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        raise _Unavailable(f"network error: {type(exc).__name__}") from exc
    _record_rate_headers(resp)
    if resp.status_code in (403, 429):
        retry = resp.headers.get("retry-after")
        with _lock:
            if retry and retry.isdigit():
                _rate["blocked_until"] = time.time() + int(retry)
            elif _rate["remaining"] == 0 and _rate["reset"]:
                _rate["blocked_until"] = _rate["reset"]
            else:
                _rate["blocked_until"] = time.time() + 60  # secondary limit: back off one minute
        raise _Unavailable(f"GitHub rate limit / forbidden ({resp.status_code})")
    if resp.status_code != 200:
        raise _Unavailable(f"GitHub returned HTTP {resp.status_code}")
    try:
        return list(resp.json().get("items", []))
    except ValueError as exc:
        raise _Unavailable("invalid JSON from GitHub") from exc


def practice_for_skill(db: Session, skill: str, limit: int = 3, client: Optional[httpx.Client] = None,
                       exclude_urls: Optional[set] = None) -> Dict[str, Any]:
    """Practice issues for one skill with cache, rate-limit handling and labelled fallback."""
    limit = max(1, min(limit, 10))
    name = skill_map.display_name(skill)
    base = {"skill": name, "items": [], "source": "unmapped", "fetched_at": None, "warnings": [], "query": None}
    if skill_map.github_mapping(skill) is None:
        base["warnings"].append(f"No GitHub language/topic mapping for '{name}'.")
        return base

    language, keywords = skill_map.github_mapping(skill)
    exclude_urls = exclude_urls or set()
    owns_client = client is None
    client = client or httpx.Client()
    items: List[Dict[str, Any]] = []
    source, fetched_at, warnings, used_query = "fallback", None, [], None
    try:
        for label in LABELS:
            q = build_query(skill, label)
            used_query = q
            # the date in the query moves daily, so key on the stable skill+label instead
            key = hashlib.sha256(f"v2|{skill_map.canonical(skill)}|{label}".encode()).hexdigest()
            row = _cache_get(db, key)
            if row and row.expires_at > _utcnow():
                got, src, ts = json.loads(row.payload_json), "cache", row.fetched_at
            else:
                try:
                    raw = _request(client, q, config.GITHUB_MAX_PER_PAGE)
                    got = [m for m in (_map_item(r, label, keywords, language) for r in raw) if m and m["relevance"] > 0]
                    _cache_put(db, key, got)
                    src, ts = "live", _utcnow()
                except _Unavailable as exc:
                    warnings.append(str(exc))
                    logger.warning("GitHub search unavailable for %s: %s", name, exc)
                    if row:
                        got, src, ts = json.loads(row.payload_json), "stale_cache", row.fetched_at
                    else:
                        break  # no data for this label and GitHub is unreachable: stop querying
            fresh = [g for g in got if g["url"] not in exclude_urls]
            if fresh:
                # most skill-relevant first (title > label > body), then fewest comments; GitHub's recency order breaks ties
                items = sorted(fresh, key=lambda g: (-g["relevance"], g["comments"] or 0))
                source, fetched_at = src, ts
                break
        if not items:
            if source == "fallback" and not warnings:
                warnings.append("No open matching issues found; showing a GitHub search link instead.")
            items = [_fallback_item(skill)]
            source = "fallback"
    finally:
        if owns_client:
            client.close()
    base.update(items=items[:limit], source=source, query=used_query, warnings=warnings,
                fetched_at=(fetched_at.replace(tzinfo=timezone.utc).isoformat() if fetched_at else None))
    return base
