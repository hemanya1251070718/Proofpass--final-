# frontend/src/engine

Verification authority lives on the **backend**. The browser never computes a skill state, hash or score.

| File | Purpose |
|---|---|
| `backendVerification.js` | Sends the intake to `/api/v1/verify` or `/analyze`, then only reshapes the backend result for the eight step screens. |
| `intake.js` | Form validation and the sample resume text used by "Load sample candidate input". |
| `step6_micro_checks.js` | **Legacy, not used by the app.** Kept only because `npm run test:microchecks` (`scripts/test-micro-checks.js`) covers its answer-quality heuristics. Micro-checks are graded by the backend (`/passports/{id}/quiz/answers`). |

The former client-side pipeline (read / propose / evidence / authorship / states / role match / issue passport, and the LeetCode and certificate adapters) was removed; it could assign states and compute hashes in the browser and conflicted with the backend engine. `src/api/batch.js` is the client for the recruiter batch endpoints, which return 501 unless `PROOFPASS_OFFLINE_FIXTURES=1` (they have no live verification backend).
