/**
 * Evidence Details Builder
 *
 * Builds the audit panel for each passport skill ONLY from what the backend verification engine recorded
 * (evidence chain + stored evidence summary). Nothing is invented: no placeholder commit hashes, no synthetic
 * code excerpts, no default line shares. Fields the backend did not record stay null and the UI omits them.
 */

import { getConfidence } from './confidence.js'

/**
 * @param {Object} skill - normalised passport skill ({ skill, state, rationale, evidenceChain, credibility, ... })
 * @param {Object} context - { passport, evidence } where evidence is the backend evidence summary list
 * @returns {Array<Object>}
 */
export function buildSkillEvidenceDetails(skill, context = {}) {
  const { passport, evidence = [] } = context
  const name = skill.skill || skill.name || ''
  const norm = name.toLowerCase().trim()
  const fetchedAt = passport?.issuedAt || null
  const unverifiedOwner = passport && passport.ownershipVerified === false
  const chain = Array.isArray(skill.evidenceChain) ? skill.evidenceChain : []
  const stored = evidence.filter((e) => e && String(e.skill || '').toLowerCase().trim() === norm)

  const details = chain
    .filter((c) => c.source === 'repo' && c.file)
    .map((c) => {
      const rec = stored.find((e) => e.file_path === c.file) || {}
      const lineShare = typeof c.author_lines_pct === 'number' ? Math.round(c.author_lines_pct * 100) : null
      const conflict = Array.isArray(rec.conflicts) && rec.conflicts.length > 0 ? rec.conflicts.join('; ') : null
      return {
        source: 'github',
        label: skill.state === 'X' ? 'Why it conflicts' : unverifiedOwner ? 'Repository file evidence (Ownership Unverified)' : 'Repository file evidence',
        file: c.file,
        commit: null,
        url: c.url || null,
        excerpt: null,
        excerptSource: 'none',
        matchedTerm: null,
        contentHash: null,
        flagReason: conflict,
        rationale: conflict || skill.rationale || null,
        authorLineShare: lineShare,
        commitCount: typeof rec.commit_count === 'number' ? rec.commit_count : null,
        confidence: getConfidence({ source: 'github', lineShare: lineShare ?? 0, credibility: skill.credibility }),
        fetchedAt,
      }
    })

  if (details.length > 0) return details

  // No code evidence recorded for this skill: say so plainly.
  return [
    {
      source: 'resume',
      label: skill.state === 'X' ? 'Why it conflicts' : 'Resume claim',
      file: null,
      commit: null,
      url: null,
      excerpt: `${name} appears on the resume. No matching code evidence was found by the verification engine.`,
      excerptSource: 'resume',
      matchedTerm: null,
      contentHash: null,
      flagReason: skill.state === 'X' ? skill.rationale || null : null,
      rationale: skill.rationale || null,
      authorLineShare: null,
      commitCount: null,
      confidence: getConfidence({ source: 'resume' }),
      fetchedAt,
    },
  ]
}

/** Attach evidenceDetails to every skill of a normalised passport. */
export function attachEvidenceDetailsToPassport(passport, context = {}) {
  if (!passport || !Array.isArray(passport.skills)) return passport
  const evidence = context.evidence || passport.evidence || []
  return {
    ...passport,
    skills: passport.skills.map((s) => ({
      ...s,
      evidenceDetails:
        Array.isArray(s.evidenceDetails) && s.evidenceDetails.length > 0
          ? s.evidenceDetails
          : buildSkillEvidenceDetails(s, { ...context, passport, evidence }),
    })),
  }
}
