"""Shared helpers for tests that need a signed-in ProofPass user."""
from __future__ import annotations

import itertools

_counter = itertools.count(1)
STRONG_PASSWORD = "correct-horse-battery-9"


def register(client, role: str = "applicant", email: str | None = None, name: str = "Test User", password: str = STRONG_PASSWORD):
    """Registers a user and leaves the session cookie on `client`. Returns the user dict."""
    email = email or f"user{next(_counter)}-{role}@example.com"
    r = client.post("/api/v1/account/register", json={"role": role, "name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    return r.json()["user"]


def login(client, email: str, password: str = STRONG_PASSWORD):
    return client.post("/api/v1/account/login", json={"email": email, "password": password})
