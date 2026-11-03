# ProofPass REST API Contract (v1)

This document specifies the REST API contract for **ProofPass Member 2 (Backend, Database, and Integration)**.

---

## 1. Core Principles & Architecture

ProofPass provides an evidence-first technical credibility passport. The backend coordinates:
1. **Intake & Extraction**: PyMuPDF-based PDF resume text extraction or raw text intake.
2. **Claim Identification**: M4 Intelligence extracts technical skill claims (LLM proposal with heuristic fallback).
3. **Repository Verification**: M3 Evidence Engine verifies claims deterministically against public GitHub repositories.
4. **Micro-Quiz Generation**: Evidence-grounded quiz generation to verify claimed authorship and technical depth.
5. **Deterministic State Assignment**: Deterministic claim-state transitions (`Verified`, `Supported`, `Claimed`, `Contradicted`) and role-match scoring.
6. **Cryptographic Integrity Sealing**: Canonical JSON formatting (RFC 8785) and SHA-256 digest computation.
7. **SQLite Persistence**: Stored via SQLAlchemy with support for candidate data erasure (right to deletion).

> **Important Security & Integrity Note**:
> The SHA-256 digest serves purely as a **tamper-detection integrity seal** over the canonical serialized payload. It confirms that a stored passport has not been altered since issuance. It does **not** constitute an asymmetric digital signature (such as Ed25519) and does **not** assert candidate legal identity or warranty external truth.

---

## 2. Server Configuration & CORS

- **Default Base URL**: `http://localhost:8000`
- **API Prefix**: `/api/v1`
- **CORS Policy**: Configurable via `CORS_ORIGINS`.
  - Allowed default origins: `http://localhost:5173`, `http://localhost:3000`, `http://127.0.0.1:5173`.
  - Credentials are only permitted when explicit origins are specified (never combined with `*`).

---

## 3. Endpoints Specification

### 3.1 Health Check
- **Route**: `GET /api/v1/health`
- **Description**: Verifies service availability and SQLite database connectivity.
- **Response** (`200 OK`):
```json
{
  "status": "ok",
  "database": "connected",
  "version": "1.0.0",
  "timestamp": "2026-10-24T10:00:00.000000"
}
```

---

### 3.2 Candidate Intake & Analysis (JSON or Multipart)
- **Route**: `POST /api/v1/analyze`
- **Content-Types**:
  - `application/json` (Primary JSON intake route, fully documented in Swagger)
  - `multipart/form-data` (Supports file upload and form fields)
- **Parameters / Fields**:
  - `resume_text` (or `resumeText`): Raw string containing resume content (optional if PDF uploaded).
  - `resume_file` (or `resumeFile`): Uploaded `.pdf` binary file (optional if `resume_text` provided).
  - `github_url` (or `githubUrl`): Public GitHub repository or profile URL (required).
  - `target_role` (or `targetRole`): Desired position name, e.g. `"Full-Stack Engineer"` (required).
  - `job_description` (or `jobDescription`): Job description text used for role weightings (optional).
  - `consent` (or `consentAi`, `candidate_consent`): Boolean explicit candidate consent (required, must be `true`).
  - `allow_network` (or `allowNetwork`): Boolean controlling external GitHub calls (default: `true`).

- **JSON Request Example**:
```json
{
  "resume_text": "Alex Developer\nExperience: Built FastAPI microservices and React dashboards.",
  "github_url": "https://github.com/alexrivera-dev/portfolio",
  "target_role": "Full-Stack Engineer",
  "consent": true
}
```

- **Response** (`200 OK`): `AnalyzeResponse` containing `passport_id`, `role_match_score`, `sha256_hash`, and full `PassportPayload`.

---

### 3.3 Candidate Intake via PDF File Upload
- **Route**: `POST /api/v1/analyze/upload`
- **Content-Type**: `multipart/form-data`
- **Description**: Dedicated multipart endpoint tailored for interactive file uploads in Swagger UI and form clients.
- **Form Fields**:
  - `resume_file`: Uploaded `.pdf` binary file (required).
  - `github_url`: Public GitHub repository or profile URL (required).
  - `target_role`: Target role name, e.g. `"Full-Stack Engineer"` (required).
  - `job_description`: Optional job description text.
  - `consent`: Explicit candidate consent boolean (required, must be `true`).
  - `allow_network`: Boolean controlling external GitHub calls (default: `true`).
- **Response** (`200 OK`): `AnalyzeResponse` matching `POST /api/v1/analyze`.

---

### 3.3 Get Passport
- **Route**: `GET /api/v1/passports/{id}`
- **Description**: Retrieves full passport by ID.
- **Response** (`200 OK`): `PassportDetailResponse` containing metadata and full `PassportPayload`.
- **Errors**:
  - `404 Not Found`: Passport ID does not exist.

---

### 3.4 Get Micro-Verification Quiz
- **Route**: `GET /api/v1/passports/{id}/quiz`
- **Description**: Returns micro-verification quiz questions generated for this passport's evidence.
- **Privacy & Anti-Cheat Guarantee**: Expected answer hints (`expected_answer_hints`) are strictly stripped from the response.
- **Response** (`200 OK`):
```json
[
  {
    "question_id": "qq_1a2b3c4d",
    "claim_id": "cl_98765432",
    "skill": "React",
    "question_type": "fake_premise",
    "question_text": "In your React work, you mentioned using Redis. Why did you choose Redis over Memcached?",
    "context_snippet": null
  }
]
```

---

### 3.5 Submit Quiz Answers
- **Route**: `POST /api/v1/passports/{id}/quiz/answers`
- **Description**: Submits candidate answers. Evaluates responses with M4 rubric, updates skill claim states (e.g., from `Supported` to `Verified`), updates role match scores, and recalculates the SHA-256 integrity seal atomically.
- **Request Body**:
```json
{
  "answers": [
    {
      "question_id": "qq_1a2b3c4d",
      "answer_text": "I did not use Redis in this frontend React repository."
    }
  ]
}
```
- **Validation**:
  - Each `question_id` must belong to the passport record.
  - Duplicate question answers in the same submission are rejected.
- **Response** (`200 OK`):
```json
{
  "passport_id": "pp_a1b2c3d4e5f6",
  "results": [
    {
      "question_id": "qq_1a2b3c4d",
      "passed": true,
      "feedback": "Answer accepted. Technical understanding demonstrated."
    }
  ],
  "updated_role_match_score": 0.95,
  "updated_hash": "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
  "passport": { ... }
}
```

---

### 3.6 Verify Integrity
- **Route**: `GET /api/v1/passports/{id}/verify`
- **Description**: Recomputes SHA-256 over stored canonical JSON payload and compares with the stored seal to prove the record has not been tampered with.
- **Response** (`200 OK`):
```json
{
  "passport_id": "pp_a1b2c3d4e5f6",
  "valid": true,
  "stored_hash": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
  "computed_hash": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
  "message": "Hash matches. Passport payload is authentic and unaltered since issuance.",
  "integrity_note": "SHA-256 verifies that the stored passport payload is authentic and unaltered since issuance. It is an integrity check, not a digital signature or factual warranty."
}
```

---

### 3.7 Candidate Data Deletion
- **Route**: `DELETE /api/v1/passports/{id}`
- **Description**: Erases candidate passport and all related verification records from the database.
- **Response** (`200 OK`):
```json
{
  "passport_id": "pp_a1b2c3d4e5f6",
  "deleted": true,
  "message": "Candidate passport and verification data permanently deleted."
}
```

---

## Recommendations & Role Matching (Parts 1 and 3)

Base: `/api/v1/recommendations`. Skills are posted by the client (`[{skill, state}]`, state = `V|S|C|X` or full name); the backend is stateless about passports. Part 3 evidence weights are **Verified 1.00 / Supported 0.70 / Claimed 0.35 / Contradicted 0.00** (the verification engine keeps 1.0/0.6/0.2/0.0).

| Method | Route | Purpose |
|---|---|---|
| GET | `/status` | catalogue size, role count, GitHub auth/rate snapshot |
| GET | `/roles/catalogue` | the 20 technical roles with tiered skills |
| POST | `/roles/match` | `{skills, limit?, family?}` -> ranked roles with score, matched / weak / missing skills, improvement priorities, explanation |
| POST | `/roles/{role_id}/match` | same for one role (404 if unknown) |
| GET | `/courses?skill=&state=&limit=` | ranked courses from the imported SQLite Coursera catalogue |
| GET | `/practice?skill=&limit=` | GitHub issues; `source` = `live` / `cache` / `stale_cache` / `fallback` / `unmapped` |
| POST | `/plan` | `{skills, target_role_id?}` -> prioritised skills (passport gaps + role gaps) each with courses and practice |

Setup: `python -m backend.recommendations.course_import` (idempotent; CSV at `backend/data/CourseraDataset-Clean.csv`, not committed). Optional env: `GITHUB_TOKEN` (backend only), `GITHUB_CACHE_TTL_SECONDS`, `SEMANTIC_SKILL_MATCHING` (off by default; semantically-resolved skills are capped at Claimed).


---

## Accounts and Authorization (v2)

| Method | Route | Access | Notes |
|---|---|---|---|
| POST | `/account/register` | public | `{role: applicant\|recruiter, name, email, password(8-128), profile?}` -> 201 + session cookie. 409 duplicate email. |
| POST | `/account/login` | public | 401 identical message for unknown email / wrong password; 429 after 5 failures. |
| POST | `/account/logout`, `/account/logout-all` | session | Deletes the server-side session(s). |
| GET | `/account/me` | session | Session restore. |
| PATCH | `/account/profile` | session | Merges profile fields; `role`/`email`/`id` are ignored. |
| POST | `/verify` | applicant + GitHub OAuth session | Ownership verified. 503 if GitHub is unavailable. |
| POST | `/analyze`, `/analyze/upload` | applicant | Public URL fallback; `ownership: "unverified"`, max Supported. |
| GET | `/passports` | session | Applicant: own. Recruiter: all (read-only). |
| GET | `/passports/{id}` | owner or recruiter | 404 for other applicants. |
| GET/POST | `/passports/{id}/quiz`, `/quiz/answers` | owner applicant | Backend grades and re-seals. |
| GET | `/passports/{id}/verify` | owner or recruiter | Canonical integrity check. |
| PATCH | `/passports/{id}/sharing` | owner applicant | `{revoked: bool}`; not part of the sealed payload. |
| DELETE | `/passports/{id}` | owner applicant | 403 for recruiters, 404 for others. |
| POST | `/passports` | - | **410**: passports are issued only by the verification pipeline. |
| POST | `/passports/verify-commit` | - | **410**: disabled (it trusted client-supplied commits). |
| GET | `/shared/passports/{id}` | public | Read-only share view without quiz/owner data; 410 when revoked. |
| POST | `/integrity/check` | public | `{payload, hash}` -> recomputed canonical SHA-256. |
| * | `/batch*` | recruiter | 501 unless `PROOFPASS_OFFLINE_FIXTURES=1` (no live verification backend). |
| * | `/extract-resume`, `/parse-role`, `/recommendations/*` | session | `/recommendations/plan` and `/practice` are rate limited per user. |
