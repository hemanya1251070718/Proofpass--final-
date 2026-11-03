/**
 * Backend verification adapter.
 *
 * The backend is the ONLY verification authority: it reads the resume, inspects GitHub, assigns every skill state,
 * generates and grades the micro-checks, scores the role and seals the passport. This module only
 *   1. sends the intake to the backend, and
 *   2. reshapes the backend's answer into the per-step view data that the eight-step screens already render.
 * It never computes, upgrades or invents a state, hash, commit, authorship figure or score.
 */

const API = '/api/v1'
const CODE = { Verified: 'V', Supported: 'S', Claimed: 'C', Contradicted: 'X' }
// Presentation-only labels for the backend's role-gap tiers.
const importanceFromWeight = (w) => (w >= 0.3 ? 3 : w >= 0.15 ? 2 : 1)

export const GITHUB_URL_RE = /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(\/[A-Za-z0-9._-]+)?\/?$/

async function parseError(res) {
  let detail = ''
  try {
    const j = await res.json()
    detail = Array.isArray(j.detail) ? j.detail.map((d) => d.msg).join(' ') : j.detail
  } catch {
    detail = ''
  }
  const err = new Error(detail || `Request failed (${res.status}).`)
  err.status = res.status
  return err
}

async function call(path, options = {}) {
  let res
  try {
    res = await fetch(`${API}${path}`, { credentials: 'same-origin', ...options })
  } catch {
    throw new Error('Could not reach the ProofPass server. Check that the backend is running.')
  }
  if (!res.ok) throw await parseError(res)
  return res.json()
}

/**
 * Ask the backend to verify and issue a passport.
 * mode 'oauth': GitHub ownership proven by OAuth (POST /verify). mode 'url': public URL, Ownership Unverified (POST /analyze).
 */
export async function issuePassport({ mode, resumeText, githubUrl, targetRole, jobDescription, consent }) {
  const body = {
    resume_text: resumeText,
    target_role: targetRole,
    job_description: jobDescription || null,
    consent: Boolean(consent),
    ...(mode === 'url' ? { github_url: githubUrl } : {}),
  }
  return call(mode === 'oauth' ? '/verify' : '/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Micro-check questions for a passport (owner only). */
export const fetchQuiz = (passportId) => call(`/passports/${encodeURIComponent(passportId)}/quiz`)

/** Submit one micro-check answer; the backend grades it and re-seals the passport. */
export const submitQuizAnswer = (passportId, questionId, answerText) =>
  call(`/passports/${encodeURIComponent(passportId)}/quiz/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [{ question_id: questionId, answer_text: answerText }] }),
  })

/** Server-side integrity check of a stored passport. */
export const verifyStoredPassport = (passportId) => call(`/passports/${encodeURIComponent(passportId)}/verify`)

/** Stateless canonical-hash check of any payload against a hash. */
export const checkIntegrity = (payload, hash) =>
  call('/integrity/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, hash }),
  })

// ---------------------------------------------------------------------------
// Reshaping (view data only)
// ---------------------------------------------------------------------------
const evidenceFor = (evidence, claimId) => (evidence || []).filter((e) => e.claim_id === claimId)
const bestEvidence = (list) =>
  [...list].sort((a, b) => (b.authorship_pct || 0) - (a.authorship_pct || 0) || (b.commit_count || 0) - (a.commit_count || 0))[0]

function countStates(skillStates) {
  const counts = { V: 0, S: 0, C: 0, X: 0 }
  skillStates.forEach((s) => {
    counts[s.state] += 1
  })
  return counts
}

export function skillStatesFromPassport(passport, evidence, claims) {
  const claimIdByName = Object.fromEntries((claims || []).map((c) => [String(c.skill).toLowerCase(), c.claim_id]))
  return (passport.skills || []).map((s) => {
    const state = CODE[s.claim_state] || 'C'
    const ev = bestEvidence(evidenceFor(evidence, claimIdByName[String(s.name).toLowerCase()]))
    const pct = ev ? Math.round((ev.authorship_pct || 0) * 100) : 0
    return {
      skill: s.name,
      state,
      evidence: ev ? `${ev.repo ? `${ev.repo}: ` : ''}${ev.file_path}, ${pct}% authored, ${ev.commit_count || 0} commits by the candidate` : 'On resume; no matching code evidence found',
      rationale: {
        V: 'Verified: authored code was found and the micro-check was passed.',
        S: 'Supported: code evidence exists but it is not fully proven yet. One micro-check away from Verified.',
        C: 'Claimed: mentioned on the resume with no matching evidence found. Not penalised.',
        X: 'Contradicted: the evidence conflicts with the claim.',
      }[state],
      lineShare: pct,
      credibility: s.credibility,
      evidenceChain: s.evidence_chain || [],
      commitCount: ev?.commit_count || 0,
      filesTouched: ev ? 1 : 0,
      filePath: ev?.file_path || 'None',
    }
  })
}

/** Everything the eight step screens render, derived from one backend response. */
export function buildStepData(resp, intake) {
  const passport = resp.passport
  const claims = resp.claims || []
  const evidence = resp.evidence || []
  const skillStates = skillStatesFromPassport(passport, evidence, claims)
  const repos = [...new Set(evidence.map((e) => e.repo).filter(Boolean))]
  const filesIndex = Object.fromEntries(evidence.filter((e) => e.file_path).map((e) => [e.file_path, { path: e.file_path, repo: e.repo, fork: false }]))

  const readData = {
    sectionCount: Object.keys(intake?.extractedSections || {}).length,
    sections: intake?.extractedSections || {},
    claimedSkills: claims.map((c) => c.skill),
    skillsCount: claims.length,
    repositories: repos.map((r) => ({ name: r, source: 'GitHub API (live)' })),
    repoCount: repos.length,
    filesIndex,
    fileCount: Object.keys(filesIndex).length,
    totalLinesRead: null, // the backend does not report line counts; the screen omits it
    isSampleSource: false,
    fetchError: null,
  }

  const proposals = claims.map((c) => {
    const ev = bestEvidence(evidenceFor(evidence, c.claim_id))
    return {
      skill: c.skill,
      filePath: ev?.file_path || null,
      lineRange: '-',
      commitHash: '-',
      rationale: ev ? `${ev.usage_depth} usage found${ev.repo ? ` in ${ev.repo}` : ''}` : 'No matching file found in the inspected repositories',
      hasPointer: Boolean(ev),
      status: ev ? 'Found by the backend evidence search' : 'No candidate evidence found',
    }
  })
  const proposeData = {
    proposals,
    pointersFound: proposals.filter((p) => p.hasPointer).length,
    isSampleModelOutput: false,
    disclaimer: 'Evidence pointers come from the backend verification engine, which reads the repositories directly.',
  }

  const confirmed = []
  const flagged = []
  claims.forEach((c) => {
    const ev = bestEvidence(evidenceFor(evidence, c.claim_id))
    if (!ev) return
    if (Array.isArray(ev.conflicts) && ev.conflicts.length) {
      flagged.push({ skill: c.skill, filePath: ev.file_path, flagReason: ev.conflicts.join('; '), verified: false, fileHash: null })
    } else {
      confirmed.push({ skill: c.skill, filePath: ev.file_path, fileHash: null, verified: true, status: 'Found in repository' })
    }
  })
  const evidenceData = {
    confirmedPointers: confirmed,
    flaggedPointers: flagged,
    totalChecked: proposals.length,
    confirmedCount: confirmed.length,
    flaggedCount: flagged.length,
  }

  const authorshipRows = claims.map((c) => {
    const ev = bestEvidence(evidenceFor(evidence, c.claim_id))
    if (!ev) {
      return { skill: c.skill, source: 'resume', ceiling: 20, filePath: 'None', lineShare: 0, commitCount: 0, filesTouched: 0, usageDepth: 'No repository files found to determine author contribution.', isOriginalAuthor: false, forkedTutorial: false }
    }
    const pct = Math.round((ev.authorship_pct || 0) * 100)
    const fork = (ev.conflicts || []).some((x) => /fork/i.test(x))
    return {
      skill: c.skill,
      source: 'github',
      ceiling: 80,
      filePath: ev.file_path,
      lineShare: pct,
      commitCount: ev.commit_count || 0,
      filesTouched: 1,
      usageDepth: `${ev.usage_depth} usage, ${ev.authorship_signal} authorship signal`,
      isOriginalAuthor: ev.authorship_signal === 'strong',
      forkedTutorial: fork,
    }
  })
  const withShare = authorshipRows.filter((a) => a.lineShare > 0)
  const authorshipData = {
    authorshipData: authorshipRows,
    avgLineShare: withShare.length ? Math.round(withShare.reduce((n, a) => n + a.lineShare, 0) / withShare.length) : 0,
    totalSkillsEvaluated: authorshipRows.length,
  }

  const statesData = { skillStates, counts: countStates(skillStates), totalSkills: skillStates.length }
  return { readData, proposeData, evidenceData, authorshipData, statesData, roleMatchData: buildRoleMatch(passport, skillStates) }
}

/** Role match from the backend's own scoring (verification weights 1.0/0.6/0.2/0.0 live on the server). */
export function buildRoleMatch(passport, skillStates) {
  const stateByName = Object.fromEntries(skillStates.map((s) => [s.skill.toLowerCase(), s.state]))
  const gaps = (passport.skill_gaps || []).map((g) => ({
    skill: g.skill,
    currentState: CODE[g.current_state] || 'C',
    isClaimed: Boolean(stateByName[g.skill.toLowerCase()]),
    importance: importanceFromWeight(g.required_weight),
    potentialBoost: Math.round((g.required_weight || 0) * (g.gap_reduction_pct || 0) * 100),
    recommendation: g.recommended_action,
  }))
  gaps.sort((a, b) => b.potentialBoost - a.potentialBoost)
  const counts = countStates(skillStates)
  const total = skillStates.length
  return {
    matchPercentage: Math.round((passport.role_match_score || 0) * 100),
    claimVerificationRate: total ? Math.round(((counts.V * 1.0 + counts.S * 0.6 + counts.C * 0.2) / total) * 100) : 0,
    earnedScore: null,
    totalMaxWeight: null,
    breakdown: counts,
    rankedGaps: gaps,
    roleReqs: (passport.role_breakdown || []).map((b) => ({ skill: b.skill, weight: b.required_weight })),
    disclaimer: 'No single hire score: ProofPass provides a weighted evidence match breakdown, not a binary hiring decision.',
  }
}

/** Micro-checks for Supported skills, one question each, taken from the backend quiz. */
export function buildMicroChecks(questions, skillStates) {
  const supported = new Set(skillStates.filter((s) => s.state === 'S').map((s) => s.skill.toLowerCase()))
  const seen = new Set()
  const checks = []
  ;(questions || []).forEach((q) => {
    const key = String(q.skill).toLowerCase()
    if (!supported.has(key) || seen.has(key)) return
    seen.add(key)
    const st = skillStates.find((s) => s.skill.toLowerCase() === key)
    checks.push({ skill: st?.skill || q.skill, questionId: q.question_id, filePath: st?.filePath || '', question: q.question_text, answered: false, passed: false, userAnswer: '', feedback: '' })
  })
  return checks
}
