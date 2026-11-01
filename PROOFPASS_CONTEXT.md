# ProofPass: Project Context

Source: github.com/saitamaxayush-art/Proofpass--final- (commit f242aa3, 25 Oct 2026)
Hackathon: IM-03 "Skill Passport: Verified Skills from Real Work" (AISF / VIT)
Purpose of this file: paste it into any new Claude, Antigravity or Manus chat so the tool knows exactly what exists before you ask for changes.

---

## 1. What ProofPass is

ProofPass checks every technical skill on a resume against real evidence (GitHub repos and commit history, LeetCode, Codeforces, certificates) and issues a "skill passport". Each skill gets one of four states:

| Code | State | Weight in role match | Meaning |
|---|---|---|---|
| V | Verified | 100 | Code exists, candidate authored it, micro-check passed |
| S | Supported | 60 | Evidence exists (certificate, platform, code) but not fully proven |
| C | Claimed | 20 | Resume only, nothing to check against. Not penalised |
| X | Contradicted | 0 | Evidence conflicts (e.g. forked tutorial with 0 original commits, inflated rank) |

Trust ceilings: resume 20, certificate or LeetCode 60, authored code 80, forked tutorial 0. The passport is sealed with a SHA-256 hash over `[skill, state, evidence]` so tampering is detectable. The LLM never assigns final scores; all state logic is deterministic.

Two user roles: **Applicant** and **Recruiter**. Job application itself is out of scope.

---

## 2. Repository layout

```
/                     package.json (workspace scripts), requirements.txt, .env.example, rundemo.py, README.md
/frontend             React 18 + Vite SPA (the part you build via Antigravity)
/backend              Python FastAPI API (teammates' part)
/tests                pytest suite for the backend (10 test files + platform fixtures)
/docs                 api-contract.md, verification-notes.md
```

Root scripts: `npm run dev` (frontend, port 5173), `npm run backend` (uvicorn, port 8000), `npm run test:backend`, `npm run demo`. Vite proxies `/api` to `localhost:8000`.

---

## 3. Frontend

**Stack:** React 18.3, Vite, React Router 7, GSAP + ScrollTrigger, Lenis smooth scroll, three.js (3D passport), JSZip (repo zip upload). Plain CSS: `styles.css`, `verify.css`, `dashboard.css` (~6,800 lines total). Light and dark theme via `ThemeToggle`.

**Design tokens:** accent burnt orange `#b54610` (light) / `#e8803f` (dark), warm ivory and soft black base.

### Routes (`src/App.jsx`)

| Route | Access | Component |
|---|---|---|
| `/` | public | Home (landing: States, Scoring, Pipeline, Views sections) |
| `/login` (`?tab=signup`) | public | Login (login + signup, role picker) |
| `/privacy`, `/terms` | public | Legal |
| `/passport/:passportId` | public, read-only | PassportView |
| `/dashboard` | applicant | ApplicantDashboard |
| `/verify` | applicant | Verify (8-step pipeline) |
| `/learnings` | applicant | Learnings (roadmaps) |
| `/recommendations` | applicant | Recommendations (courses, practice and tests) |
| `/recruiter` | recruiter | RecruiterDashboard (roles table) |
| `/recruiter/role/:roleId` | recruiter | RecruiterRoleDetail (leaderboard, tabs) |
| `/recruiter/role/:roleId/compare` | recruiter | CandidateCompare |

Header nav changes by state: logged out shows landing anchors, applicant sees Dashboard / Verify / Learnings / Recommendations, recruiter sees Dashboard. Header hides on scroll down, scroll progress bar, nav intro animation on first load.

### Applicant features (built)

- **Signup:** name, email, password, target role, experience entries (job or project mode), GitHub URL, LeetCode URL, certifications.
- **Verify page (`Verify.jsx`, ~2,050 lines):** 8 steps run in the browser by `src/engine/`:
  0 Intake (form and consent) → 1 Read (resume + repo; PDF text via backend `/extract-resume`, repos via GitHub public API or zip) → 2 Propose (skill rules matrix matches skills to files) → 3 Check evidence (file hashes) → 4 Authorship (blame and usage depth) → 5 Assign states (trust ceilings) → 6 Micro-checks (keyword-graded code trade-off questions per skill) → 7 Role match (evidence-weighted) → 8 Issue passport (SHA-256 seal).
  Extras: HalfStepper progress, LockedStage canvas chain animation, VerifyBackground, live log panel (`VerificationChatbot`, filters for steps/hashes/alerts), 3D passport, GitHub OAuth connect or "Use sample GitHub account" fallback, coding profiles field, tamper simulation.
- **Step 7 gap handling:** non-verified skills required by the target role get a dropdown. Claimed skills get an iMocha assessment link; other states get a roadmap (course first, then assessment). Roadmaps save to Learnings.
- **Applicant dashboard:** passport overview, per-skill breakdown with rationale and EvidenceCard, share link, tamper check, revoke, best-matching roles, iMocha "close the gaps" section.
- **Learnings:** per-skill roadmaps for the current target role's non-verified skills only, step checklist, progress, filters. Stored per user in localStorage (`pp-roadmaps-v2`), survives logout/login.
- **Recommendations:** courses and practice/tests prioritised by skill gaps (`data/resources.js`).
- **PassportView:** public read-only passport, seal check, evidence audit trail, revoked state.

### Recruiter features (built)

- **Signup:** company, role hiring for, description, required skills (Must / Should / Nice, weights 3/2/1), demo CV.
- **Dashboard:** roles table (role, company, applicants, with passport, average match, updated), search, add new role, **Job Description Import** (upload .docx / .pdf / .txt / .md or paste; parsed in browser into title, location, work mode, min experience, up to 15 skills with importance).
- **Role detail, tab 1 Leaderboard:** RoleHeader, RoleSummary (4 stat blocks), toolbar (search, filter, sort, anonymous names toggle, reset, states info), states explainer, CandidateRow with 4 clickable state count tiles that open an in-row StatePanel listing skills in that state, tie notes explaining the differentiator, CandidateDrawer quick view, link to passport.
- **Tab 2 No passport attached:** resume-only applicants kept out of the leaderboard; select and generate passports instantly.
- **Tab 3 Requirements:** edit role fields, skills and weights, demo CV.
- **Compare:** 2 to 3 candidates side by side: rank, score, state mix, evidence freshness, top 3 strengths, top 3 concerns, competency matrix with "Strongest" tags, "only differences" filter.
- **Evidence details on passports:** source badge, file, commit, verbatim excerpt (never generated), content hash, flag reason, confidence % with factor breakdown (resume capped at 20).

### Sample data (`src/data/seed.js`, SEED_VERSION 3)

4 sample roles with different applicant counts: Full Stack TS (14, 11 with passport), Backend Python (9, 6), Frontend React (18, 12), DevOps (6, 5). Deterministic, unique names, includes score ties. Demo logins: any email containing "alex" (applicant) or "recruiter"/"hiring" (recruiter), any 6+ char password.

### Where frontend data lives

Almost everything is a **browser-only prototype** stored in localStorage: accounts and session (`api/auth.js`), roles, applicants, passports, roadmaps. Each API module has a "Future backend endpoint" comment showing the intended REST route. Calls that actually reach the backend: `/extract-resume` (PDF text), `/auth/github/*` (OAuth), `/passports` (list/get/save, merged with localStorage).

---

## 4. Backend (FastAPI, Python 3.10+)

Entry: `backend/main.py`. SQLite via SQLAlchemy (`proofpass.db`, table `passports`). Optional LLM (OpenAI-compatible, default `gpt-4o-mini`) with automatic mock fallback when no key is set.

Modules:
- `verification/` (M3): resume extraction (PyMuPDF), GitHub client, shallow clone + git blame authorship, platform evidence for LeetCode (unofficial GraphQL) and Codeforces, skill alias matching, contradiction rules.
- `intelligence/` (M4): claim extraction, target role parsing, state engine with trust ceilings, credibility, quiz engine (fake-premise questions, answer hints never returned), role matcher and gaps, learning planner, passport builder.
- `api/`: routes, orchestrator, GitHub OAuth with signed session cookies, recruiter batch ingestion, resume/role parsing.

Endpoints (prefix `/api/v1`):
`GET /health` · `POST /analyze` (+ `/analyze/upload`) · `POST /verify` (+ `/verify/upload`, uses GitHub session identity) · `GET|POST /passports` · `GET /passports/{id}` · `GET /passports/{id}/quiz` · `POST /passports/{id}/quiz/answers` · `GET /passports/{id}/verify` (integrity) · `DELETE /passports/{id}` · `GET /auth/github/start` · `GET /auth/github/callback` · `GET /auth/me` · `POST /auth/logout` · `GET /auth/config` · `POST /batch` · `GET /batch/{id}` · `POST /batch/{id}/start` · `POST /batch/{id}/retry/{row}` · `POST /extract-resume` · `POST /parse-role`

Platform rules (from `docs/verification-notes.md`): unverified handles can reach Supported at most; "some" = 10+ solves (weight 0.5), "strong" = 40+ solves with difficulty gating (weight 0.8); contradictions for Codeforces title inflation, solve count below 80% of claim, LeetCode badge claims, handle mismatch; missing data never counts as a contradiction; repo and platform evidence take the max, never summed.

Env (`.env.example`): `INTELLIGENCE_LLM_*`, `GITHUB_CLIENT_ID/SECRET/REDIRECT_URI`, `SESSION_SECRET`, `COOKIE_SECURE`, `CORS_ORIGINS`, `DATABASE_URL`, `PORT`. Frontend: `VITE_USE_MOCK`, `VITE_GITHUB_TOKEN`.

---

## 5. Gaps and issues found in the code

1. **Fresh install fails.** `npm ci` errors: `@vitejs/plugin-react@4.7.0` supports Vite up to 7, but `package.json` pins `vite ^8.3.4`. Fix: upgrade the plugin to a Vite 8 compatible version, or set `vite` to `^7`.
2. **Two separate verification pipelines.** The Verify page runs the JavaScript engine in the browser. The backend's Python pipeline (`/verify`, `/analyze`, quiz endpoints) is not called by the UI. `api/client.js` (`submitIntake`) is unused.
3. **Recruiter batch is not wired.** Backend `/batch` exists and `api/batch.js` exists, but the No Passport tab generates passports client-side instead.
4. **Sample passports are hand-written.** `seed.js` does not run the real engine, which was the plan for the demo.
5. **Auth is localStorage only.** No real accounts or password checks; any 6+ char password works.
6. **Custom target role roadmap** section (planned for later) is not built; Learnings only covers the current target role.
7. **Dead code:** `components/Verifier.jsx` is not imported anywhere; `api/client.js` and `api/batch.js` are unused.
8. **Style rule slips:** pill-shaped buttons in `verify.css` (`.log-toggle-header-btn`, `.chatbot-launcher-btn`, `.filter-pill`); em dash characters used as empty-value placeholders in RecruiterDashboard, CandidateCompare, ApplicantDashboard, PassportView.
9. **Footer copy is inaccurate:** says "nothing you type leaves this page", but the app calls the GitHub API and the backend.

Not checked: whether the app runs, how it looks, and whether tests pass. Nothing was executed during this review.

---

## 6. Rules to give any AI tool working on this

- Keep existing design patterns, animations and component structure.
- Palette: burnt orange, warm ivory, soft black, 60-30-10, never explained on the site. Must work in light and dark mode.
- Banned: purple gradients, pill buttons, fake reviews/metrics/counters, vague hero text, emoji icons, em dashes, stock-photo slop, filler copy, "made with AI" labels.
- Always keep `/privacy` and `/terms`.
- Verify and recommendation features only visible after login.
- Excerpts are always verbatim; never generate evidence text.
- Frontend changes go through Antigravity prompts; teammates own the backend.
