/**
 * Candidate Ranking Engine
 * Pure deterministic function sorting applicants with a passport against role requirements.
 * Implements tie-breaking logic and explains the deciding factor between adjacent candidates.
 */

import { WEIGHTS } from '../data.js'

/**
 * Pure ranking function for applicants with a passport.
 *
 * @param {Object} role - Role object with requiredSkills [{ skill, importance, weight }]
 * @param {Array} applicants - Array of applicant objects (filtered to hasPassport === true)
 * @returns {Array} Ranked list of candidate summaries with rank, match score, and tie-break rationale
 */
export function rankApplicants(role, applicants = []) {
  if (!role || !applicants || applicants.length === 0) {
    return []
  }

  const requiredSkills = role.requiredSkills || []
  const reqMap = new Map()
  let totalMaxWeight = 0

  requiredSkills.forEach((req) => {
    const weight = req.weight || (req.importance === 'Must' ? 3 : req.importance === 'Should' ? 2 : 1)
    reqMap.set(req.skill.toLowerCase(), { ...req, weight })
    totalMaxWeight += weight * 100
  })

  // 1. Calculate metrics for each applicant
  const evaluated = applicants.map((applicant) => {
    const skills = applicant.passport?.skills || []
    const skillMap = new Map()
    skills.forEach((s) => {
      const name = (s.skill || s.name || '').toLowerCase().trim()
      if (name) {
        const rawState = s.state || s.claim_state || 'C'
        const stateKey = rawState.length > 1 ? rawState[0].toUpperCase() : rawState
        skillMap.set(name, {
          ...s,
          skill: s.skill || s.name,
          state: stateKey,
        })
      }
    })

    let earnedScore = 0
    let verifiedReqCount = 0
    let contradictedCount = 0
    const matched = []
    const missing = []

    // Check role requirements
    requiredSkills.forEach((req) => {
      const match = skillMap.get(req.skill.toLowerCase())
      const weight = req.weight || (req.importance === 'Must' ? 3 : req.importance === 'Should' ? 2 : 1)

      if (match) {
        const stateWeight = WEIGHTS[match.state] ?? 0
        earnedScore += weight * stateWeight
        matched.push({ skill: req.skill, state: match.state, level: match.level })
        if (match.state === 'V') {
          verifiedReqCount += 1
        }
      } else {
        missing.push({ skill: req.skill, importance: req.importance })
      }
    })

    // Check total contradicted skills across the entire passport
    skills.forEach((s) => {
      if (s.state === 'X') {
        contradictedCount += 1
      }
    })

    const score = totalMaxWeight > 0 ? Math.round((earnedScore / totalMaxWeight) * 100) : 0
    const issuedTime = applicant.passport?.issuedAt ? new Date(applicant.passport.issuedAt).getTime() : 0

    // Count states for state mix bar
    const counts = {
      V: skills.filter((s) => s.state === 'V').length,
      S: skills.filter((s) => s.state === 'S').length,
      C: skills.filter((s) => s.state === 'C').length,
      X: skills.filter((s) => s.state === 'X').length,
      total: skills.length,
    }

    return {
      applicant,
      id: applicant.id,
      name: applicant.name,
      email: applicant.email,
      score,
      verifiedReqCount,
      totalReqCount: requiredSkills.length,
      contradictedCount,
      issuedTime,
      matched,
      missing,
      counts,
      passport: applicant.passport,
      isLiveDemo: Boolean(applicant.isLiveDemo),
      isDemo: Boolean(applicant.isDemo),
      isRecruiterGenerated: Boolean(applicant.isRecruiterGenerated || applicant.passport?.isRecruiterGenerated),
    }
  })

  // 2. Sort candidates deterministically:
  // - Match % descending
  // - More Verified required skills descending
  // - Fewer Contradicted skills ascending
  // - Fresher evidence timestamp descending
  evaluated.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    if (b.verifiedReqCount !== a.verifiedReqCount) {
      return b.verifiedReqCount - a.verifiedReqCount
    }
    if (a.contradictedCount !== b.contradictedCount) {
      return a.contradictedCount - b.contradictedCount
    }
    return b.issuedTime - a.issuedTime
  })

  // 3. Assign ranks and compute tie-breaking explanation for adjacent tied candidates
  return evaluated.map((item, idx, arr) => {
    let decidingFactor = null
    const prev = arr[idx - 1]

    if (prev && prev.score === item.score) {
      if (prev.verifiedReqCount > item.verifiedReqCount) {
        decidingFactor = `Ranked above: ${prev.verifiedReqCount} of ${item.totalReqCount} required skills Verified versus ${item.verifiedReqCount}`
      } else if (prev.contradictedCount < item.contradictedCount) {
        decidingFactor = `Ranked above: ${prev.contradictedCount} Contradicted skills versus ${item.contradictedCount}`
      } else if (prev.issuedTime > item.issuedTime) {
        decidingFactor = 'Ranked above: fresher verification timestamp'
      }
    }

    return {
      ...item,
      rank: idx + 1,
      decidingFactor,
    }
  })
}
