/**
 * Candidate Comparison Engine
 * Pure deterministic functions for comparing 2 to 3 candidates against role requirements.
 * Evaluates strengths, concerns, evidence freshness, and skill-by-skill matrices.
 */

import { WEIGHTS } from '../data.js'
import { rankApplicants } from './rank.js'
import { getSkillConfidence } from './confidence.js'

/**
 * Importance weight helper for sorting
 * Must: 3, Should: 2, Nice: 1
 */
function getImportanceRank(importance) {
  if (importance === 'Must') return 3
  if (importance === 'Should') return 2
  return 1
}

/**
 * State weight rank helper for determining the strongest state
 * V (100) > S (60) > C (20) > X (0) > missing (-1)
 */
function getStateRank(state) {
  if (state === 'V') return 4
  if (state === 'S') return 3
  if (state === 'C') return 2
  if (state === 'X') return 1
  return 0 // missing or undefined
}

/**
 * Format date nicely for evidence freshness
 */
function formatFreshnessDate(timestampOrIso) {
  if (!timestampOrIso) return 'No timestamp'
  try {
    const d = new Date(timestampOrIso)
    if (isNaN(d.getTime())) return 'No timestamp'
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return 'No timestamp'
  }
}

/**
 * Find the latest evidence date from passport skills or issuedAt
 */
function getLatestEvidenceDate(passport) {
  if (!passport) return { iso: null, label: 'No evidence recorded' }

  let latestTime = 0
  let latestStr = passport.issuedAt || null

  if (passport.issuedAt) {
    const t = new Date(passport.issuedAt).getTime()
    if (!isNaN(t) && t > latestTime) {
      latestTime = t
      latestStr = passport.issuedAt
    }
  }

  // Scan skills for any evidence dates if available
  if (Array.isArray(passport.skills)) {
    passport.skills.forEach((s) => {
      if (s.date) {
        const t = new Date(s.date).getTime()
        if (!isNaN(t) && t > latestTime) {
          latestTime = t
          latestStr = s.date
        }
      }
    })
  }

  return {
    iso: latestStr,
    label: latestStr ? formatFreshnessDate(latestStr) : 'No evidence date',
    timestamp: latestTime,
  }
}

/**
 * Pure comparison function comparing candidates for a specific role.
 *
 * @param {Object} role - Role object with title and requiredSkills [{ skill, importance, weight }]
 * @param {Array} applicants - Array of 2 or 3 applicant objects with passports
 * @returns {Object} Comparison report containing candidate columns, rows, and skill comparison matrix
 */
export function buildComparison(role, applicants = []) {
  if (!role || !Array.isArray(applicants) || applicants.length === 0) {
    return {
      candidates: [],
      skillsMatrix: [],
      differingSkillsCount: 0,
      totalSkillsCount: 0,
    }
  }

  // 1. Rank the subset of applicants in the context of the role
  const ranked = rankApplicants(role, applicants)
  const rankMap = new Map()
  ranked.forEach((r) => rankMap.set(r.id, r))

  // 2. Prepare sorted role requirements (Must, then Should, then Nice)
  const rawSkills = role.requiredSkills || []
  const sortedRequirements = [...rawSkills].sort((a, b) => {
    const impDiff = getImportanceRank(b.importance) - getImportanceRank(a.importance)
    if (impDiff !== 0) return impDiff
    return (a.skill || '').localeCompare(b.skill || '')
  })

  // 3. Build each candidate's summary column
  const candidateSummaries = applicants.map((applicant) => {
    const rankedInfo = rankMap.get(applicant.id) || {}
    const passport = applicant.passport || {}
    const skills = passport.skills || []
    const skillMap = new Map()
    skills.forEach((s) => skillMap.set(s.skill.toLowerCase(), s))

    // State counts
    const counts = rankedInfo.counts || {
      V: skills.filter((s) => s.state === 'V').length,
      S: skills.filter((s) => s.state === 'S').length,
      C: skills.filter((s) => s.state === 'C').length,
      X: skills.filter((s) => s.state === 'X').length,
      total: skills.length,
    }

    const totalCount = Math.max(1, counts.V + counts.S + counts.C + counts.X)
    const stateShares = {
      V: (counts.V / totalCount) * 100,
      S: (counts.S / totalCount) * 100,
      C: (counts.C / totalCount) * 100,
      X: (counts.X / totalCount) * 100,
    }

    // Freshness
    const freshness = getLatestEvidenceDate(passport)

    // Key Strengths: up to 3 required skills in state V, ordered by importance then freshness
    const verifiedRequired = []
    sortedRequirements.forEach((req) => {
      const match = skillMap.get(req.skill.toLowerCase())
      if (match && match.state === 'V') {
        const itemFreshness = match.date ? new Date(match.date).getTime() : freshness.timestamp
        verifiedRequired.push({
          skill: req.skill,
          importance: req.importance || 'Nice',
          importanceRank: getImportanceRank(req.importance),
          freshnessTime: itemFreshness,
        })
      }
    })

    verifiedRequired.sort((a, b) => {
      if (b.importanceRank !== a.importanceRank) {
        return b.importanceRank - a.importanceRank
      }
      return b.freshnessTime - a.freshnessTime
    })

    const strengths = verifiedRequired.slice(0, 3).map((item) => {
      return `Verified: ${item.skill} (${item.importance})`
    })

    // Concerns: up to 3 required skills, Contradicted first, then Claimed, then not on the passport,
    // ordered by importance
    const contradictedList = []
    const claimedList = []
    const missingList = []

    sortedRequirements.forEach((req) => {
      const match = skillMap.get(req.skill.toLowerCase())
      const impRank = getImportanceRank(req.importance)
      const imp = req.importance || 'Nice'

      if (!match) {
        missingList.push({
          text: `Not on passport: ${req.skill} (${imp})`,
          impRank,
        })
      } else if (match.state === 'X') {
        contradictedList.push({
          text: `Contradicted: ${req.skill} (${imp})`,
          impRank,
        })
      } else if (match.state === 'C') {
        claimedList.push({
          text: `Claimed only: ${req.skill} (${imp})`,
          impRank,
        })
      }
    })

    // Sort each concerns bucket by importance descending
    contradictedList.sort((a, b) => b.impRank - a.impRank)
    claimedList.sort((a, b) => b.impRank - a.impRank)
    missingList.sort((a, b) => b.impRank - a.impRank)

    const allConcerns = [
      ...contradictedList.map((c) => c.text),
      ...claimedList.map((c) => c.text),
      ...missingList.map((c) => c.text),
    ]
    const concerns = allConcerns.slice(0, 3)

    return {
      applicant,
      id: applicant.id,
      name: applicant.name,
      email: applicant.email,
      passportId: passport.id || null,
      rank: rankedInfo.rank || 1,
      score: rankedInfo.score ?? 0,
      counts,
      stateShares,
      freshness,
      strengths,
      concerns,
      isLiveDemo: Boolean(applicant.isLiveDemo),
      isDemo: Boolean(applicant.isDemo),
      isRecruiterGenerated: Boolean(applicant.isRecruiterGenerated || passport.isRecruiterGenerated),
    }
  })

  // 4. Build Required Skills Comparison Matrix
  let differingSkillsCount = 0

  const skillsMatrix = sortedRequirements.map((req) => {
    const candidateStates = candidateSummaries.map((cand) => {
      const passport = cand.applicant.passport || {}
      const skills = passport.skills || []
      const match = skills.find((s) => s.skill.toLowerCase() === req.skill.toLowerCase())

      if (match) {
        const hasAnyEvidenceDetails = skills.some((s) => Array.isArray(s.evidenceDetails))
        const confInfo = getSkillConfidence(match, hasAnyEvidenceDetails)
        const confidenceText = confInfo && confInfo.value != null ? confInfo.text : null

        return {
          applicantId: cand.id,
          candidateName: cand.name,
          state: match.state, // 'V' | 'S' | 'C' | 'X'
          level: match.level || 1,
          evidence: match.evidence || '',
          stateRank: getStateRank(match.state),
          confidenceText,
        }
      }

      return {
        applicantId: cand.id,
        candidateName: cand.name,
        state: 'missing',
        level: 0,
        evidence: 'Not present on passport',
        stateRank: 0,
      }
    })

    // Determine strongest candidate in this row
    // State ranking: V (4) > S (3) > C (2) > X (1) > missing (0)
    let maxRank = -1
    candidateStates.forEach((cs) => {
      if (cs.stateRank > maxRank) {
        maxRank = cs.stateRank
      }
    })

    // Check for ties: ties get NO strongest tag
    const topCandidates = candidateStates.filter((cs) => cs.stateRank === maxRank && cs.stateRank > 0)
    const uniqueWinnerId = topCandidates.length === 1 ? topCandidates[0].applicantId : null

    // Determine if candidates differ in state
    const firstState = candidateStates[0]?.state
    const hasDifference = candidateStates.some((cs) => cs.state !== firstState)
    if (hasDifference) {
      differingSkillsCount += 1
    }

    const statesWithTag = candidateStates.map((cs) => ({
      ...cs,
      isStrongest: uniqueWinnerId !== null && cs.applicantId === uniqueWinnerId,
    }))

    return {
      skill: req.skill,
      importance: req.importance || 'Nice',
      weight: req.weight || (req.importance === 'Must' ? 3 : req.importance === 'Should' ? 2 : 1),
      states: statesWithTag,
      hasDifference,
    }
  })

  return {
    candidates: candidateSummaries,
    skillsMatrix,
    differingSkillsCount,
    totalSkillsCount: skillsMatrix.length,
  }
}
