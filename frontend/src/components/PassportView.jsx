/**
 * Public Read-Only Passport View Component
 * Accessible to applicants and recruiters with SHA-256 seal tamper detection,
 * detailed skill evidence audit trails, and revocation status handling.
 */

import { useEffect, useState } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { getPassport, getSharedPassport, checkPassportTamper } from '../api/passports.js'
import { L, WEIGHTS } from '../data.js'
import { RM } from '../lib.js'
import { EvidenceCard } from './EvidenceCard.jsx'
import { getSkillConfidence } from '../lib/confidence.js'
import { getSkillId } from '../lib/skillsByState.js'
import { buildSkillEvidenceDetails } from '../lib/evidenceDetails.js'

export default function PassportView() {
  const { passportId } = useParams()
  const location = useLocation()
  const [passport, setPassport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tamperResult, setTamperResult] = useState(null)
  const [isCheckingTamper, setIsCheckingTamper] = useState(false)
  const [expandedSkills, setExpandedSkills] = useState({})

  const toggleSkillEvidence = (skillName) => {
    setExpandedSkills((prev) => ({ ...prev, [skillName]: !prev[skillName] }))
  }

  // On load or hash change: scroll to skill row, expand its audit trace, and highlight briefly
  useEffect(() => {
    if (!passport || loading) return

    const handleAnchor = () => {
      const hash = window.location.hash || location.hash
      if (!hash) return
      const targetId = hash.replace(/^#/, '')
      const targetEl = document.getElementById(targetId)

      if (targetEl) {
        // Find matching skill to expand audit trace
        const matchedSkill = (passport.skills || []).find(
          (s) => `skill-${getSkillId(s)}` === targetId
        )
        if (matchedSkill) {
          setExpandedSkills((prev) => ({ ...prev, [matchedSkill.skill]: true }))
        }

        // Scroll into view
        targetEl.scrollIntoView({
          behavior: RM ? 'auto' : 'smooth',
          block: 'center',
        })

        // Highlight briefly using CSS class
        targetEl.classList.remove('skill-row-highlight')
        void targetEl.offsetWidth
        targetEl.classList.add('skill-row-highlight')

        const timer = setTimeout(() => {
          targetEl.classList.remove('skill-row-highlight')
        }, 2500)
        return () => clearTimeout(timer)
      }
    }

    const frameId = requestAnimationFrame(handleAnchor)
    window.addEventListener('hashchange', handleAnchor)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('hashchange', handleAnchor)
    }
  }, [passport, loading, location.hash])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        // Owner / recruiter: full authenticated view. Everyone else: the public share view (honours revocation).
        let found
        try {
          found = await getPassport(passportId)
        } catch {
          found = { ...(await getSharedPassport(passportId)), viaShared: true }
        }
        if (mounted) {
          setPassport(found)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err.message || 'Passport not found.')
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [passportId])

  const handleTamperCheck = async () => {
    if (!passport) return
    setIsCheckingTamper(true)
    try {
      const res = await checkPassportTamper(passport.id, { shared: Boolean(passport.viaShared) })
      setTamperResult(res)
    } catch (err) {
      setTamperResult({ valid: false, message: `Check failed: ${err.message}` })
    } finally {
      setIsCheckingTamper(false)
    }
  }

  if (loading) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="login-notice">
            <span className="notice-dot" aria-hidden="true" />
            <span>Retrieving skill passport record...</span>
          </div>
        </div>
      </main>
    )
  }

  if (error || !passport) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="table-card glass card-pad-36 text-center">
            <span className="k m text-st-x">RECORD NOT FOUND</span>
            <h1 className="section-title-sm mt-12 mb-8">
              Skill Passport Unavailable
            </h1>
            <p className="text-muted-sm max-w-480 mx-auto mb-20">
              The requested passport ID "{passportId}" does not exist in this browser storage or has been permanently removed.
            </p>
            <Link to="/" className="b sm">
              Return to Home
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const skills = passport.skills || []
  const counts = {
    V: skills.filter((s) => s.state === 'V').length,
    S: skills.filter((s) => s.state === 'S').length,
    C: skills.filter((s) => s.state === 'C').length,
    X: skills.filter((s) => s.state === 'X').length,
    total: skills.length,
  }

  return (
    <main id="main" className="dash-page">
      <div className="w read-only-passport">
        {/* Revocation Warning */}
        {passport.revoked && (
          <div className="revoked-banner" role="alert">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span>This passport was revoked by the candidate. Verified claims are preserved for historical audit only.</span>
          </div>
        )}

        {/* Passport Header Card */}
        <div className="table-card glass card-pad-24">
          <div className="passport-seal-header">
            <div className="table-head-row-between gap-14 flex-wrap">
              <div>
                <span className="k m text-accent">
                  VERIFIED CREDIBILITY RECORD
                </span>
                <h1 className="dash-title mt-4 mb-2">
                  {passport.candidate}
                </h1>
                <div className="passport-clean-meta">
                  <span>
                    Target Role: <strong>{passport.targetRole}</strong> · Issued:{' '}
                    {new Date(passport.issuedAt).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="passport-id-label">
                  PASSPORT ID
                </span>
                <span className="passport-id-value">
                  {passport.id}
                </span>
              </div>
            </div>

            {/* Cryptographic Hash & Tamper Button */}
            <div className="table-head-row-between gap-12 mt-16 flex-wrap">
              <div className="flex-1-min-300">
                <span className="passport-hash-mono" title={passport.hash}>
                  SHA-256: {passport.hash}
                </span>
                <p className="text-faint-xs">
                  Excerpts and confidence are display details. The seal covers skill, state and evidence text.
                </p>
              </div>

              <button
                type="button"
                className="b sm g"
                onClick={handleTamperCheck}
                disabled={isCheckingTamper}
              >
                {isCheckingTamper ? 'Verifying seal...' : 'Run tamper check'}
              </button>
            </div>

            {/* Tamper Check Result Toast */}
            {tamperResult && (
              <div
                className={tamperResult.valid ? 'notice-tamper-valid' : 'notice-tamper-invalid'}
                role="status"
              >
                {tamperResult.valid ? '✓ ' : '✗ '}
                {tamperResult.message}
              </div>
            )}
          </div>

          {/* Short plain text skills overview */}
          <div className="passport-skills-plain-summary" aria-label="Skills state overview">
            <span><strong>Verified:</strong> {counts.V}</span>
            <span aria-hidden="true">·</span>
            <span><strong>Supported:</strong> {counts.S}</span>
            <span aria-hidden="true">·</span>
            <span><strong>Claimed:</strong> {counts.C}</span>
            <span aria-hidden="true">·</span>
            <span><strong>Contradicted:</strong> {counts.X}</span>
          </div>

          {/* Skill Proof List */}
          <div>
            <h2 className="section-title-sm mb-14">
              Skill Verification Ledger
            </h2>

            <div className="responsive-table-wrapper" data-lenis-prevent>
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>State</th>
                    <th>Confidence</th>
                    <th>Audit Evidence & Commits</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s) => {
                    const skillId = getSkillId(s)
                    const hasAnyEvidenceDetails = skills.some(
                      (item) => Array.isArray(item.evidenceDetails)
                    )
                    const confInfo = getSkillConfidence(s, hasAnyEvidenceDetails)

                    return (
                      <tr key={s.skill} id={`skill-${skillId}`}>
                        <td data-label="Skill">
                          <strong>{s.skill}</strong>
                        </td>
                        <td data-label="State">
                          <span className={`chip ${s.state}`}>{L[s.state]}</span>
                        </td>
                        <td data-label="Confidence">
                          {confInfo ? (
                            <span
                              className={`conf-badge ${confInfo.label ? confInfo.label.toLowerCase() : 'none'}`}
                              title={confInfo.text}
                            >
                              {confInfo.text}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td data-label="Evidence">
                          <div className="evidence-summary-text">
                            {s.evidence}
                          </div>
                          {s.rationale && (
                            <div className="evidence-rationale-text">
                              {s.rationale}
                            </div>
                          )}
                          {(() => {
                            const details =
                              Array.isArray(s.evidenceDetails) && s.evidenceDetails.length > 0
                                ? s.evidenceDetails
                                : buildSkillEvidenceDetails(s, { passport })

                            return (
                              <div className="evidence-actions-box">
                                <button
                                  type="button"
                                  className="evidence-expand-btn"
                                  onClick={() => toggleSkillEvidence(s.skill)}
                                  aria-expanded={Boolean(expandedSkills[s.skill])}
                                  title={expandedSkills[s.skill] ? 'Hide evidence' : 'Show evidence'}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="16" y1="13" x2="8" y2="13" />
                                    <line x1="16" y1="17" x2="8" y2="17" />
                                  </svg>
                                  <span>
                                    {expandedSkills[s.skill]
                                      ? 'Hide evidence'
                                      : 'Show evidence'}
                                  </span>
                                  <span className="expand-chevron" aria-hidden="true">
                                    {expandedSkills[s.skill] ? '▴' : '▾'}
                                  </span>
                                </button>
                                {expandedSkills[s.skill] && (
                                  <div className="evidence-actions-box">
                                    {details.map((detail, idx) => (
                                      <EvidenceCard key={idx} detail={detail} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-head-row-between gap-12 mt-24 flex-wrap">
            <Link to="/" className="b sm g">
              ← ProofPass Home
            </Link>
            <button type="button" className="b sm" onClick={() => window.print()}>
              Print verified passport
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
