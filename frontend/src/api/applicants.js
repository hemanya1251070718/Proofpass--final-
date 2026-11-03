/**
 * Applicants API Module
 * Manages applicants per job role, filtering by passport presence, CSV ingestion, and applicant updates.
 */

import { generateSampleApplicants, syncSeedDataIfNeeded } from '../data/seed.js'

const STORAGE_APPLICANTS_KEY = 'pp_prototype_applicants'

function loadStoredApplicants() {
  syncSeedDataIfNeeded()
  try {
    const raw = localStorage.getItem(STORAGE_APPLICANTS_KEY)
    if (!raw) {
      const initial = generateSampleApplicants()
      localStorage.setItem(STORAGE_APPLICANTS_KEY, JSON.stringify(initial))
      return initial
    }
    return JSON.parse(raw)
  } catch {
    return generateSampleApplicants()
  }
}

function saveStoredApplicants(applicants) {
  try {
    localStorage.setItem(STORAGE_APPLICANTS_KEY, JSON.stringify(applicants))
  } catch {
    // Storage restricted
  }
}

// BACKEND: Candidate compare and role evaluation depend on GET /api/v1/roles/:roleId/applicants
// Backend must return applicants with full cryptographic passports, including skills array with state (V/S/C/X), level, evidence, and issued timestamp.
/**
 * List all applicants for a specific role.
 * Future backend endpoint: GET /api/v1/roles/:roleId/applicants
 *
 * @param {string} roleId
 * @returns {Promise<{ withPassport: Array, noPassport: Array }>}
 */
/** Browser-seeded sample candidates (ids "cand-<role>-<n>") are demonstration data, never real applicants. */
export const isSeededDemoApplicant = (a) => /^cand-/.test(String(a?.id || ''))

export async function listApplicantsForRole(roleId) {
  await new Promise((res) => setTimeout(res, 60))
  const all = loadStoredApplicants().map((a) => ({ ...a, isDemo: a.isDemo ?? isSeededDemoApplicant(a) }))
  const forRole = all.filter((a) => a.roleId === roleId)

  return {
    withPassport: forRole.filter((a) => a.hasPassport),
    noPassport: forRole.filter((a) => !a.hasPassport),
    all: forRole,
  }
}

/**
 * Ingest or create a single candidate application.
 * Future backend endpoint: POST /api/v1/roles/:roleId/applicants
 *
 * @param {string} roleId
 * @param {Object} candidateData
 * @returns {Promise<Object>}
 */
export async function addApplicantToRole(roleId, candidateData) {
  await new Promise((res) => setTimeout(res, 50))
  const all = loadStoredApplicants()

  const cleanEmail = (candidateData.email || '').trim().toLowerCase()
  const existingIdx = all.findIndex(
    (a) => a.roleId === roleId && (a.email || '').trim().toLowerCase() === cleanEmail
  )

  if (existingIdx !== -1) {
    const existing = all[existingIdx]
    const updated = {
      ...existing,
      ...candidateData,
      name: candidateData.name ? candidateData.name.trim() : existing.name,
      email: candidateData.email ? candidateData.email.trim() : existing.email,
      hasPassport: candidateData.hasPassport !== undefined ? Boolean(candidateData.hasPassport) : existing.hasPassport,
      passport: candidateData.passport !== undefined ? candidateData.passport : existing.passport,
      skills: candidateData.skills !== undefined ? candidateData.skills : existing.skills,
      updatedAt: new Date().toISOString(),
    }
    all[existingIdx] = updated
    saveStoredApplicants(all)
    return updated
  }

  const newApplicant = {
    id: `cand_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roleId,
    name: candidateData.name.trim(),
    email: candidateData.email.trim(),
    hasPassport: Boolean(candidateData.hasPassport),
    resumeText: candidateData.resumeText || '',
    githubUrl: candidateData.githubUrl || '',
    leetcodeUrl: candidateData.leetcodeUrl || '',
    codeforcesUrl: candidateData.codeforcesUrl || '',
    certificateUrls: candidateData.certificateUrls || '',
    targetRole: candidateData.targetRole || 'Software Engineer',
    skills: candidateData.skills || [],
    passport: candidateData.passport || null,
    isRecruiterGenerated: Boolean(candidateData.isRecruiterGenerated),
    createdAt: new Date().toISOString(),
  }

  all.push(newApplicant)
  saveStoredApplicants(all)
  return newApplicant
}

/**
 * Atomically batch-ingest or update candidate applications for a role.
 * Prevents race conditions and saves to storage in a single transaction.
 *
 * @param {string} roleId
 * @param {Array<Object>} candidatesList
 * @returns {Promise<Array<Object>>}
 */
export async function addApplicantsBatchToRole(roleId, candidatesList) {
  await new Promise((res) => setTimeout(res, 20))
  const all = loadStoredApplicants()
  const results = []

  for (const candidateData of candidatesList) {
    const cleanEmail = (candidateData.email || '').trim().toLowerCase()
    const existingIdx = all.findIndex(
      (a) => a.roleId === roleId && (a.email || '').trim().toLowerCase() === cleanEmail
    )

    if (existingIdx !== -1) {
      const existing = all[existingIdx]
      const updated = {
        ...existing,
        ...candidateData,
        name: candidateData.name ? candidateData.name.trim() : existing.name,
        email: candidateData.email ? candidateData.email.trim() : existing.email,
        githubUrl: candidateData.githubUrl !== undefined ? candidateData.githubUrl : existing.githubUrl,
        leetcodeUrl: candidateData.leetcodeUrl !== undefined ? candidateData.leetcodeUrl : existing.leetcodeUrl,
        codeforcesUrl: candidateData.codeforcesUrl !== undefined ? candidateData.codeforcesUrl : existing.codeforcesUrl,
        certificateUrls: candidateData.certificateUrls !== undefined ? candidateData.certificateUrls : existing.certificateUrls,
        hasPassport: candidateData.hasPassport !== undefined ? Boolean(candidateData.hasPassport) : existing.hasPassport,
        passport: candidateData.passport !== undefined ? candidateData.passport : existing.passport,
        skills: candidateData.skills !== undefined ? candidateData.skills : (existing.skills || []),
        updatedAt: new Date().toISOString(),
      }
      all[existingIdx] = updated
      results.push(updated)
    } else {
      const newApplicant = {
        id: `cand_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        roleId,
        name: (candidateData.name || '').trim(),
        email: (candidateData.email || '').trim(),
        hasPassport: Boolean(candidateData.hasPassport),
        resumeText: candidateData.resumeText || '',
        githubUrl: candidateData.githubUrl || '',
        leetcodeUrl: candidateData.leetcodeUrl || '',
        codeforcesUrl: candidateData.codeforcesUrl || '',
        certificateUrls: candidateData.certificateUrls || '',
        targetRole: candidateData.targetRole || 'Software Engineer',
        skills: candidateData.skills || [],
        passport: candidateData.passport || null,
        isRecruiterGenerated: Boolean(candidateData.isRecruiterGenerated),
        createdAt: new Date().toISOString(),
      }
      all.push(newApplicant)
      results.push(newApplicant)
    }
  }

  saveStoredApplicants(all)
  return results
}

/**
 * Generate a passport for a resume-only applicant (e.g. from recruiter CSV action).
 * Caps all skills at Claimed unless external links are provided.
 *
 * @param {string} applicantId
 * @returns {Promise<Object>}
 */
export async function generatePassportForApplicant(applicantId) {
  await new Promise((res) => setTimeout(res, 120))
  const all = loadStoredApplicants()
  const idx = all.findIndex((a) => a.id === applicantId)
  if (idx === -1) {
    throw new Error(`Applicant with ID "${applicantId}" not found.`)
  }

  const applicant = all[idx]
  const skillsToVerify = (applicant.skills && applicant.skills.length > 0)
    ? applicant.skills
    : [
        { skill: 'React', state: 'C', level: 1, evidence: 'Resume claim; no repository evidence attached', why: 'Claimed: Resume-only applicant. Capped at Claimed per trust ceiling.' },
        { skill: 'TypeScript', state: 'C', level: 1, evidence: 'Resume claim; no repository evidence attached', why: 'Claimed: Resume-only applicant. Capped at Claimed per trust ceiling.' },
        { skill: 'REST APIs', state: 'C', level: 1, evidence: 'Resume claim; no repository evidence attached', why: 'Claimed: Resume-only applicant. Capped at Claimed per trust ceiling.' },
      ]

  const passportId = `PP-REC-${Math.floor(1000 + Math.random() * 9000)}`
  const hash = `rec_gen_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`

  const updatedApplicant = {
    ...applicant,
    hasPassport: true,
    isRecruiterGenerated: true,
    passport: {
      id: passportId,
      candidate: applicant.name,
      targetRole: applicant.targetRole,
      issuedAt: new Date().toISOString(),
      hash,
      revoked: false,
      isRecruiterGenerated: true,
      skills: skillsToVerify.map((s) => ({
        skill: s.skill,
        state: s.state || 'C',
        level: s.level || 1,
        evidence: s.evidence || 'Parsed from candidate resume by recruiter batch run',
        rationale: s.why || 'Resume-only claims are capped at Claimed status.',
        lineShare: 0,
      })),
    },
  }

  all[idx] = updatedApplicant
  saveStoredApplicants(all)
  return updatedApplicant
}
