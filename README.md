# ProofPass

Deterministic Evidence Verification, Skill Passport, and Recruiter Intelligence Platform.

ProofPass checks every technical skill claim against authentic evidence (GitHub repositories, coding platform profiles like LeetCode and Codeforces, and commit histories) to issue verifiable, tamper-evident skill passports with transparent audit trails.

---

## Architecture Overview

- **Frontend**: Vite + React single-page application with 3D passports, interactive applicant verification workflow, recruiter candidate ranking, and side-by-side candidate comparison.
- **Backend API**: Python FastAPI application (`backend/main.py`) providing resume text extraction, coding platform evidence collection, deterministic skill state assignment, cheat-resistant micro-quizzes, tamper-proof SHA-256 passport signing, and GitHub OAuth verification.
- **Persistence**: SQLite database via SQLAlchemy (`proofpass.db` at repo root).

---

## Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 18+ and npm

### 2. Backend Setup

```bash
# 1. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install Python dependencies
pip install -r requirements.txt

# 3. Create your local environment configuration
cp .env.example .env
```

### 3. Frontend Setup

```bash
# 1. Install frontend dependencies
npm --prefix frontend install

# 2. (Optional) Configure frontend environment variables
cp frontend/.env.example frontend/.env
```

### 4. Running the Application

In terminal 1 (Backend API):
```bash
# Start backend server with uvicorn reloader
npm run backend
# Alternatively: python3 -m uvicorn backend.main:app --reload --port 8000
```
- API Base URL: `http://localhost:8000`
- API Health Check: `http://localhost:8000/api/v1/health`
- Interactive Swagger Docs: `http://localhost:8000/docs`
- OpenAPI Specification: `http://localhost:8000/openapi.json`

In terminal 2 (Frontend Dev Server):
```bash
# Start Vite development server
npm run dev
# Alternatively: npm --prefix frontend run dev
```
- Web Application: `http://localhost:5173`
- The Vite dev server automatically proxies `/api` requests to `http://localhost:8000`.

---

## Accounts, Roles and Passport Access

- Two account types, chosen at registration and fixed server-side: **Applicant** and **Recruiter** (open sign-up, no approval).
- Passwords are hashed with **Argon2id**. Login creates a **server-side session** stored in SQLite; the browser only holds an opaque `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true` or the frontend origin is https). Logout deletes the session. Nothing credential-like is kept in localStorage.
- Every passport belongs to the applicant whose session created it. Applicants can read, delete and toggle sharing on **their own** passports only. Recruiters have **read-only** access to all passports and cannot create, overwrite, verify or delete any.
- Existing passports from before accounts (no owner) are kept untouched and stay unassigned; only recruiters can read them and they are not used in rankings.

## Verification (backend is the single authority)

- The eight-step Verify screen collects input and shows progress, but the **backend** reads the resume, inspects GitHub, assigns every skill state, grades the micro-checks and seals the passport. The browser never decides a state.
- **Connect GitHub** (OAuth) proves ownership of the account. A **public GitHub URL** is accepted as a fallback and is labelled **Ownership Unverified**: no skill can then exceed *Supported*.
- A skill becomes *Verified* only when the backend finds authored code **and** the micro-check is passed (and ownership is OAuth-verified).
- Verification weights: Verified 1.0, Supported 0.6, Claimed 0.2, Contradicted 0.0 (role-matching in Part 3 uses its own 1.0/0.7/0.35/0.0).
- If GitHub is unreachable or rate-limited the request fails with a clear message. No evidence is ever substituted. Set `GITHUB_TOKEN` (backend `.env`) to raise the limit from 60 to 5,000 requests/hour.
- Coding-platform profiles, certificates and ZIP uploads are not verified by the backend and are not accepted.
- Canonical integrity: `signature = null`, serialise with sorted keys and compact separators (UTF-8), SHA-256. Anyone can re-check a payload with `POST /api/v1/integrity/check`.

## Course catalogue (Part 1)

The Coursera CSV is not committed (licence unverified). Place it at `backend/data/CourseraDataset-Clean.csv`, then run `python -m backend.recommendations.course_import` (idempotent).

## Deployment notes (Render Free plan, zero cost)

ProofPass is a college project with a strict zero-cost budget, so `render.yaml` uses Render's **Free** plan only: no paid instance, no persistent disk, no paid database or API.

**Important limitation - data is NOT persistent.** The database is SQLite on the container's ephemeral filesystem. On the Free plan all **accounts, passports, sessions and sharing settings are erased** on every redeploy and whenever the free instance restarts or spins down after about 15 minutes of inactivity. The app deliberately still starts and says so: `GET /api/v1/health` returns `persistent_storage: false`, the login page shows a notice, and the startup log contains `EPHEMERAL DATABASE`. Treat the hosted instance as a live demo; register fresh accounts for each session. Security protections (Argon2id, server-side sessions, ownership checks, CSRF/Origin checks, no synthetic evidence) are unchanged. Data persistence would need a paid disk or database, which is out of scope for this project (locally, `proofpass.db` is a normal file and does persist).

- **Course dataset:** the Coursera CSV is not committed (licence unverified). Two zero-cost ways to get it into the app:
  1. *Baked into the image (local `docker build`):* put the file at `backend/data/CourseraDataset-Clean.csv` first. It is the only file from `backend/data` that enters the image (`.dockerignore`), and it is imported at every container start.
  2. *Downloaded at start-up (Render):* host the file at any free https URL you control (for example a **GitHub Release asset** on your repository) and set `COURSE_CSV_URL` (optionally `COURSE_CSV_SHA256`) in the Render dashboard. The container downloads it (https only, 50 MB cap, checksum verified), imports it, and still starts if the download fails. Because the database is ephemeral, it is re-imported on every start (a few seconds).
- **GitHub quota:** unauthenticated live verification is limited to 60 REST calls/hour per IP. File contents are read from `raw.githubusercontent.com` (not counted), but set a free `GITHUB_TOKEN` for real use. If GitHub is rate-limited the request fails with 503 and nothing is stored.
- **Same-origin hosting:** the backend serves the built SPA, so cookies, CORS and the Origin check line up. Set `FRONTEND_ORIGIN`/`CORS_ORIGINS` only for a separately hosted frontend; wildcards are ignored.
- **Demonstration data:** the recruiter screens contain browser-seeded sample candidates, always tagged **DEMO DATA**. They are not real applicants.

## GitHub OAuth App Setup

To enable real GitHub sign-in and OAuth-verified repository authorship:

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) -> **OAuth Apps** -> **New OAuth App**.
2. Fill in the application details:
   - **Application name**: `ProofPass Local Dev`
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:8000/api/v1/auth/github/callback`
3. Click **Register application**.
4. Generate a **Client Secret**.
5. Copy your Client ID and Client Secret into your root `.env`:
   ```bash
   GITHUB_CLIENT_ID=your_client_id_here
   GITHUB_CLIENT_SECRET=your_client_secret_here
   GITHUB_REDIRECT_URI=http://localhost:8000/api/v1/auth/github/callback
   ```
6. Restart the backend server.

### Offline & Mock Mode (`VITE_USE_MOCK`)
- If GitHub OAuth is not configured on the backend, the verification screen automatically detects this via `GET /api/v1/auth/config` and offers a **"Use sample GitHub account"** button.
- You can also force mock mode in the frontend at any time by setting `VITE_USE_MOCK=true` in `frontend/.env`. In mock mode, the app uses simulated GitHub data without contacting external servers.

---

## Testing

Run the automated backend test suite:

```bash
# Run all backend unit and integration tests
npm run test:backend

# Or directly with pytest
python3 -m pytest -q

# Run an individual test file
python3 -m pytest tests/test_backend_api.py -v
```

Run demo pipeline CLI:
```bash
npm run demo
# Alternatively: python3 rundemo.py
```

Run frontend build check:
```bash
npm run build
```

---

## Troubleshooting

### 1. Only 3 API routes mounted in `/openapi.json`
- **Cause**: Missing `httpx` or `python-dotenv` in virtual environment, causing `backend/api/auth.py` import failure which was silently caught.
- **Fix**: Run `pip install -r requirements.txt`. Startup errors in `backend/main.py` are now loud and will output full tracebacks rather than failing silently.

### 2. `ModuleNotFoundError: No module named 'intelligence'` during pytest
- **Cause**: Folder casing discrepancy (`backend/Intelligence` vs `backend/intelligence`) on case-insensitive filesystems like macOS.
- **Fix**: The folder is canonically named `backend/intelligence` with `backend` as an explicit package (`backend/__init__.py`), and all imports use the absolute style `from backend.intelligence...`.

### 3. Session tokens resetting on restart
- **Cause**: `SESSION_SECRET` is unset in `.env`, triggering automatic generation of an ephemeral random secret at startup.
- **Fix**: Define a static secret in `.env` (e.g. `SESSION_SECRET=my_long_random_secret_string`).

### 4. Database schema missing columns (e.g. `github_id`)
- **Cause**: An older `proofpass.db` file without recent schema migrations.
- **Fix**: `backend/database.py` defaults to `proofpass.db` at the repository root and runs `init_db()` automatically on module load to guarantee table and column existence. To start completely fresh, delete `proofpass.db` and restart the backend.