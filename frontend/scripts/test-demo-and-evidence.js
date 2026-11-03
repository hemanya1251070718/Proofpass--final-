import assert from 'node:assert/strict'
import { isSeededDemoApplicant } from '../src/api/applicants.js'
import { generateSampleApplicants } from '../src/data/seed.js'
import { buildSkillEvidenceDetails } from '../src/lib/evidenceDetails.js'
import { normalizePassport } from '../src/api/passports.js'

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS: ${name}`) }

check('every browser-seeded candidate is flagged as demonstration data', () => {
  const seeded = generateSampleApplicants()
  assert.ok(seeded.length > 20)
  assert.ok(seeded.every((a) => isSeededDemoApplicant(a)))
})

check('recruiter-added and backend-backed candidates are not flagged', () => {
  assert.equal(isSeededDemoApplicant({ id: 'cand_1730000000_ab12' }), false)
  assert.equal(isSeededDemoApplicant({ id: 'live_pp_abc' }), false)
})

check('evidence details come only from recorded backend data (no invented hashes, excerpts or shares)', () => {
  const skill = { skill: 'React', state: 'S', evidenceChain: [{ source: 'repo', file: 'src/App.tsx', label: 'u/r', author_lines_pct: 0.4, url: 'https://github.com/u/r/blob/HEAD/src/App.tsx' }], credibility: 0.5 }
  const [d] = buildSkillEvidenceDetails(skill, { passport: { ownershipVerified: false, issuedAt: '2026-01-01T00:00:00Z' }, evidence: [{ skill: 'React', file_path: 'src/App.tsx', commit_count: 7, conflicts: [] }] })
  assert.equal(d.file, 'src/App.tsx')
  assert.equal(d.authorLineShare, 40)
  assert.equal(d.commitCount, 7)
  assert.equal(d.commit, null)
  assert.equal(d.contentHash, null)
  assert.equal(d.excerpt, null)
  assert.match(d.label, /Ownership Unverified/)
})

check('a skill with no recorded code evidence is shown as a resume claim, not given default figures', () => {
  const [d] = buildSkillEvidenceDetails({ skill: 'Rust', state: 'C', evidenceChain: [] }, {})
  assert.equal(d.source, 'resume')
  assert.equal(d.authorLineShare, null)
  assert.equal(d.commitCount, null)
  assert.equal(d.commit, null)
})

check('normalizePassport takes states from the backend claim_state only', () => {
  const p = normalizePassport({ passport_id: 'pp_1', sha256_hash: 'h', skills: [{ name: 'Go', claim_state: 'Supported', evidence_chain: [], credibility: 0.6 }], ownership: 'unverified' })
  assert.equal(p.skills[0].state, 'S')
  assert.equal(p.ownershipVerified, false)
  assert.equal(p.hash, 'h')
})

console.log(`\nResults: ${passed} passed, 0 failed.`)
