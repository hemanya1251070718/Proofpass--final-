/**
 * Passports API Module.
 * Passports are issued and sealed by the backend verification pipeline and stored in the database, owned by the
 * applicant whose session created them. The browser never creates, edits or re-seals a passport; it only reads
 * them (applicants: their own, recruiters: all, read-only) and toggles the owner-only share switch.
 */

import { attachEvidenceDetailsToPassport } from '../lib/evidenceDetails.js'

const API = '/api/v1'

const STATE_CODE = { Verified: 'V', Supported: 'S', Claimed: 'C', Contradicted: 'X' }
const STATE_TEXT = {
  V: 'Verified: authored code was found and the micro-check was passed.',
  S: 'Supported: evidence exists but is not fully proven yet (one micro-check away from Verified).',
  C: 'Claimed: mentioned on the resume with no matching evidence found. Not penalised.',
  X: 'Contradicted: the evidence conflicts with the claim.',
}

async function apiGet(path) {
  let res
  try {
    res = await fetch(`${API}${path}`, { credentials: 'same-origin' })
  } catch {
    throw new Error('Could not reach the ProofPass server.')
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).detail
    } catch {
      detail = ''
    }
    const err = new Error(typeof detail === 'string' && detail ? detail : `Request failed (${res.status}).`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Short, factual evidence line built only from what the backend recorded. */
function evidenceLine(skill) {
  const chain = Array.isArray(skill.evidence_chain) ? skill.evidence_chain : []
  const repo = chain.find((c) => c.source === 'repo' && c.file)
  if (repo) {
    const pct = typeof repo.author_lines_pct === 'number' ? `, ${Math.round(repo.author_lines_pct * 100)}% authored by the candidate` : ''
    return `${repo.label ? `${repo.label}: ` : ''}${repo.file}${pct}`
  }
  const other = chain.find((c) => c.detail || c.label)
  if (other) return other.detail || other.label
  return skill.evidence || (skill.claim_state === 'Claimed' ? 'On resume; no matching evidence found' : '')
}

/**
 * Normalises a backend passport (list or detail response) for the UI. States come from the backend only.
 */
export function normalizePassport(p) {
  if (!p) return null
  const id = p.id || p.passport_id
  if (!id) return null

  const skills = (Array.isArray(p.skills) ? p.skills : []).map((s) => {
    const state = s.state || STATE_CODE[s.claim_state] || 'C'
    const chain = Array.isArray(s.evidence_chain) ? s.evidence_chain : []
    const repo = chain.find((c) => c.source === 'repo' && c.file)
    return {
      skill: s.skill || s.name || '',
      state,
      level: s.level || 2,
      evidence: s.evidence || evidenceLine(s),
      rationale: s.rationale || STATE_TEXT[state],
      lineShare: repo && typeof repo.author_lines_pct === 'number' ? Math.round(repo.author_lines_pct * 100) : undefined,
      filePath: repo?.file,
      repo: repo?.label,
      url: repo?.url,
      credibility: s.credibility,
      quizStatus: s.quiz_status,
      evidenceChain: chain,
      evidenceDetails: [],
    }
  })

  const base = {
    ...p,
    id,
    passport_id: id,
    candidate: p.candidate || 'Applicant',
    targetRole: p.targetRole || p.target_role || 'Software Engineer',
    issuedAt: p.issuedAt || p.created_at || new Date().toISOString(),
    hash: p.hash || p.sha256_hash,
    skills,
    revoked: Boolean(p.revoked),
    ownership: p.ownership || p.passport?.ownership || 'unverified',
    ownershipVerified: Boolean(p.ownershipVerified),
    isDemo: Boolean(p.isDemo || p.is_demo),
  }
  return attachEvidenceDetailsToPassport(base, { evidence: p.evidence || [] })
}

/** Passports visible to the signed-in user (applicant: own; recruiter: all). */
export async function listPassports() {
  const data = await apiGet('/passports')
  return (Array.isArray(data) ? data : []).map(normalizePassport).filter(Boolean)
}

/** One passport visible to the signed-in user. */
export async function getPassport(passportId) {
  const data = await apiGet(`/passports/${encodeURIComponent(passportId)}`)
  return normalizePassport({ ...data.passport, ...data })
}

/** Public, read-only share view (no login). Throws with status 410 when the owner revoked the link. */
export async function getSharedPassport(passportId) {
  const data = await apiGet(`/shared/passports/${encodeURIComponent(passportId)}`)
  return { ...normalizePassport(data), integrity: data.integrity }
}

/** Owner-only: enable or revoke the public share link. */
export async function setPassportRevoked(passportId, revoked = true) {
  const res = await fetch(`${API}/passports/${encodeURIComponent(passportId)}/sharing`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revoked }),
  })
  if (!res.ok) throw new Error('Could not update sharing for this passport.')
  return res.json()
}

/** Server-side integrity check of the stored passport against its canonical SHA-256 seal. */
export async function checkPassportTamper(passportId, { shared = false } = {}) {
  if (shared) {
    const data = await apiGet(`/shared/passports/${encodeURIComponent(passportId)}`)
    const i = data.integrity || {}
    return { valid: i.valid === true, storedHash: i.stored_hash || data.hash, currentHash: i.computed_hash, message: i.message || 'Integrity not available for this record.' }
  }
  const r = await apiGet(`/passports/${encodeURIComponent(passportId)}/verify`)
  return { valid: r.valid, storedHash: r.stored_hash, currentHash: r.computed_hash, message: r.message }
}

/** Stateless canonical-hash check: does this payload still match this hash? */
export async function checkPayloadIntegrity(payload, hash) {
  const res = await fetch(`${API}/integrity/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, hash }),
  })
  if (!res.ok) throw new Error('Integrity check failed to run.')
  return res.json()
}
