/**
 * Applicant Dashboard Component
 * Displays applicant skill passport overview, verified skill breakdown with rationale,
 * share links, tamper verification, best-matching roles, and iMocha gap closing.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { listPassports, setPassportRevoked, savePassport } from '../api/passports.js'
import { fetchRoleMatches, getRecommendedRoles } from '../api/recommendations.js'
import { getLatestRoleKey, listRoadmaps } from '../api/roadmaps.js'
import { imochaLink } from '../data/resources.js'
import { L, WEIGHTS } from '../data.js'
import { EvidenceCard } from './EvidenceCard.jsx'
import { getSkillConfidence } from '../lib/confidence.js'
import { buildSkillEvidenceDetails } from '../lib/evidenceDetails.js'

export default function ApplicantDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [passport, setPassport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [stateFilter, setStateFilter] = useState('ALL')
  const [expandedEvidence, setExpandedEvidence] = useState({})
  const [recommendedRoles, setRecommendedRoles] = useState([])
  const [careerRoles, setCareerRoles] = useState([])
  const [roleRoadmaps, setRoleRoadmaps] = useState([])
  const [latestRole, setLatestRole] = useState(null)
  const [selfSubmittedLinks, setSelfSubmittedLinks] = useState({})
  const [copiedLink, setCopiedLink] = useState(false)
  const [notice, setNotice] = useState(null)

  // Catalogue-based career role matches (Part 3, backend). Failure just hides the section.
  const passportSkillsKey = JSON.stringify((passport?.skills || []).map((s) => [s.skill, s.state]))
  useEffect(() => {
    if (!passport?.skills?.length) {
      setCareerRoles([])
      return undefined
    }
    let live = true
    fetchRoleMatches(passport.skills)
      .then((rs) => live && setCareerRoles(rs.slice(0, 3)))
      .catch(() => live && setCareerRoles([]))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passportSkillsKey])

  // Fetch candidate passport and best-matching roles
  useEffect(() => {
    let mounted = true
    async function loadData() {
      try {
        const userPassports = await listPassports(user?.id)
        let active = userPassports[0] || null

        // If no user-specific passport, check demo applicant passport in storage
        if (!active) {
          const all = await listPassports()
          active = all.find((p) => p.candidate === user?.name || p.userId === user?.id) || null
        }

        // Load latest target role and its roadmaps
        let role = await getLatestRoleKey(user?.id)
        let rms = []
        if (role) {
          rms = await listRoadmaps(user?.id, role.roleKey)
        } else if (active?.targetRole) {
          const roleKey = active.targetRole.toLowerCase().trim()
          role = { roleKey, roleName: active.targetRole }
          rms = await listRoadmaps(user?.id, roleKey)
        }

        if (mounted) {
          setPassport(active)
          setLatestRole(role)
          setRoleRoadmaps(rms || [])
          if (active && active.skills) {
            const roles = await getRecommendedRoles(active.skills)
            setRecommendedRoles(roles)
          } else {
            // Load sample roles with zero skills
            const roles = await getRecommendedRoles([])
            setRecommendedRoles(roles)
          }
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setNotice(`Failed to load passport: ${err.message}`)
          setLoading(false)
        }
      }
    }
    loadData()
    return () => {
      mounted = false
    }
  }, [user])

  // Toggle evidence drawer per skill row
  const toggleEvidence = (skill) => {
    setExpandedEvidence((prev) => ({
      ...prev,
      [skill]: !prev[skill],
    }))
  }

  // Revoke toggle handler
  const handleToggleRevoke = async () => {
    if (!passport) return
    const nextRevoked = !passport.revoked
    try {
      const updated = await setPassportRevoked(passport.id, nextRevoked)
      setPassport(updated)
      setNotice(nextRevoked ? 'Passport share revoked.' : 'Passport share re-activated.')
    } catch (err) {
      setNotice(err.message)
    }
  }

  // Copy share link
  const handleCopyShareLink = () => {
    if (!passport) return
    const url = `${window.location.origin}/passport/${passport.id}`
    navigator.clipboard?.writeText(url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2200)
  }

  // Self-submit iMocha assessment link
  const handleSelfSubmitLink = async (skill) => {
    const link = selfSubmittedLinks[skill]?.trim()
    if (!link) return

    try {
      // Lift skill to Supported at most with label "not yet checked"
      const updatedSkills = passport.skills.map((s) => {
        if (s.skill === skill && (s.state === 'C' || s.state === 'X')) {
          return {
            ...s,
            state: 'S',
            evidence: `Self-submitted assessment link: ${link} (not yet checked)`,
            rationale: 'Supported: External assessment link submitted by candidate (not yet checked). Capped at Supported.',
          }
        }
        return s
      })

      const updated = await savePassport({ ...passport, skills: updatedSkills }, user?.id)
      setPassport(updated)
      setSelfSubmittedLinks((prev) => ({ ...prev, [skill]: '' }))
      setNotice(`Result link for ${skill} submitted. Skill elevated to Supported (not yet checked).`)

      // Recompute role match
      const roles = await getRecommendedRoles(updatedSkills)
      setRecommendedRoles(roles)
    } catch (err) {
      setNotice(err.message)
    }
  }

  if (loading) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="login-notice">
            <span className="notice-dot" aria-hidden="true" />
            <span>Loading applicant credibility passport...</span>
          </div>
        </div>
      </main>
    )
  }

  // EMPTY STATE: Before any passport exists
  if (!passport) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="dash-header">
            <span className="k m">APPLICANT DASHBOARD</span>
            <div className="dash-header-row">
              <div>
                <h1 className="dash-title">Welcome, {user?.name}</h1>
                <p className="dash-subtitle">
                  Target role: {user?.profile?.targetRole || 'Software Engineer'}
                </p>
              </div>
            </div>
          </div>

          <div className="table-card glass" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <span className="k m" style={{ color: 'var(--accent)' }}>NO PASSPORT GENERATED YET</span>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--ink)', margin: '10px 0 8px' }}>
              Verify your skills with verifiable evidence
            </h2>
            <p style={{ color: 'var(--muted)', maxWidth: '520px', margin: '0 auto 24px', fontSize: '0.92rem' }}>
              Run the ProofPass verification pipeline to link your resume claims to GitHub commits, LeetCode solutions, and credentials.
            </p>
            <Link to="/verify" className="b">
              Start verification <span className="btn-arrow" aria-hidden="true">-&gt;</span>
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // Calculate State Counts
  const skills = passport.skills || []
  const counts = {
    V: skills.filter((s) => s.state === 'V').length,
    S: skills.filter((s) => s.state === 'S').length,
    C: skills.filter((s) => s.state === 'C').length,
    X: skills.filter((s) => s.state === 'X').length,
    total: skills.length,
  }

  // Filter skills by state
  const filteredSkills =
    stateFilter === 'ALL'
      ? skills
      : skills.filter((s) => s.state === stateFilter)

  // Verify the rest: Claimed or Contradicted skills
  const skillsToVerifyRest = skills.filter((s) => s.state === 'C' || s.state === 'X')

  // Extract up to 3 next incomplete steps across active roadmaps
  const nextSteps = []
  for (const r of roleRoadmaps) {
    if (r.status !== 'completed') {
      for (const s of r.steps || []) {
        if (!s.done) {
          nextSteps.push({ ...s, skillName: r.skillName, roleKey: r.roleKey, skillId: r.skillId })
          if (nextSteps.length >= 3) break
        }
      }
    }
    if (nextSteps.length >= 3) break
  }

  return (
    <main id="main" className="dash-page">
      <div className="w">
        {/* Header & Overview */}
        <div className="dash-header">
          <span className="k m">SKILL CREDIBILITY PASSPORT</span>
          <div className="dash-header-row">
            <div>
              <h1 className="dash-title">{passport.candidate || user?.name}</h1>
              <p className="dash-subtitle">
                Target Role: <strong>{passport.targetRole}</strong> · Last Verified:{' '}
                {new Date(passport.issuedAt).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </p>
            </div>
            <div>
              <Link to="/verify" className="b sm">
                Re-verify passport
              </Link>
            </div>
          </div>
        </div>

        {/* Global Notice Toast */}
        {notice && (
          <div className="login-notice" style={{ marginBottom: '20px' }} role="status">
            <span className="notice-dot" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {/* Overview Strip */}
        <div className="overview-strip">
          <div className="overview-card">
            <span className="overview-card-label">Verified (100w)</span>
            <div className="overview-card-val" style={{ color: 'var(--st-v)' }}>
              {counts.V} <span style={{ fontSize: '0.85rem', color: 'var(--faint)' }}>skills</span>
            </div>
            <div className="state-chip-row">
              <span className="chip V">Verified</span>
            </div>
          </div>

          <div className="overview-card">
            <span className="overview-card-label">Supported (60w)</span>
            <div className="overview-card-val" style={{ color: 'var(--st-s)' }}>
              {counts.S} <span style={{ fontSize: '0.85rem', color: 'var(--faint)' }}>skills</span>
            </div>
            <div className="state-chip-row">
              <span className="chip S">Supported</span>
            </div>
          </div>

          <div className="overview-card">
            <span className="overview-card-label">Claimed (20w)</span>
            <div className="overview-card-val" style={{ color: 'var(--st-c)' }}>
              {counts.C} <span style={{ fontSize: '0.85rem', color: 'var(--faint)' }}>skills</span>
            </div>
            <div className="state-chip-row">
              <span className="chip C">Claimed</span>
            </div>
          </div>

          <div className="overview-card">
            <span className="overview-card-label">Contradicted (0w)</span>
            <div className="overview-card-val" style={{ color: 'var(--st-x)' }}>
              {counts.X} <span style={{ fontSize: '0.85rem', color: 'var(--faint)' }}>skills</span>
            </div>
            <div className="state-chip-row">
              <span className="chip X">Contradicted</span>
            </div>
          </div>
        </div>

        {/* My Passport Card */}
        <div className="passport-banner-card glass">
          <div className="passport-banner-top">
            <div>
              <div className="passport-id-box">
                <span className="k m" style={{ color: 'var(--accent)' }}>
                  OFFICIAL PASSPORT
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--ink)' }}>
                  {passport.id}
                </span>
                {passport.revoked && (
                  <span className="chip X" style={{ fontSize: '0.7rem' }}>
                    REVOKED
                  </span>
                )}
              </div>
              <div style={{ marginTop: '8px' }}>
                <span className="seal-hash-display" title={passport.hash}>
                  SHA-256: {passport.hash}
                </span>
                <p style={{ fontSize: '0.76rem', color: 'var(--muted)', margin: '4px 0 0' }}>
                  Excerpts and confidence are display details. The seal covers skill, state and evidence text.
                </p>
              </div>
            </div>

            <div className="passport-banner-actions">
              <label className="revoke-switch-label" title="Toggle public access for this share link">
                <input
                  type="checkbox"
                  checked={!passport.revoked}
                  onChange={handleToggleRevoke}
                />
                <span>{passport.revoked ? 'Share Revoked' : 'Share Active'}</span>
              </label>

              <button
                type="button"
                className="b sm g"
                onClick={handleCopyShareLink}
                disabled={passport.revoked}
              >
                {copiedLink ? '✓ Link copied' : 'Copy share link'}
              </button>

              <Link to={`/passport/${passport.id}`} className="b sm">
                Open passport view
              </Link>
            </div>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
            <span>
              Total Skills Audited: <strong>{counts.total}</strong>
            </span>
            <span>
              Evidence Coverage Ratio:{' '}
              <strong>
                {counts.total > 0 ? Math.round(((counts.V + counts.S) / counts.total) * 100) : 0}%
              </strong>
            </span>
            <span>
              Trust Status:{' '}
              <strong style={{ color: passport.revoked ? 'var(--st-x)' : 'var(--st-v)' }}>
                {passport.revoked ? 'Share Disabled' : 'Verifiable Public Seal'}
              </strong>
            </span>
          </div>
        </div>

        {/* Learning Roadmaps Card */}
        <div className="table-card glass" style={{ padding: '24px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
            <div>
              <div className="k m" style={{ color: 'var(--accent)', marginBottom: '4px' }}>
                {latestRole?.roleName ? `TARGET ROLE: ${latestRole.roleName.toUpperCase()}` : 'SKILL GAP ROADMAPS'}
              </div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
                Learning Roadmaps
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '4px 0 0' }}>
                {latestRole?.roleName
                  ? `Curated courses and assessments for required skills not yet Verified for ${latestRole.roleName}.`
                  : 'Targeted course modules and verification assessments for skills your target role needs.'}
              </p>
            </div>

            <Link to="/learnings" className="b sm">
              View all roadmaps <span className="btn-arrow" aria-hidden="true">-&gt;</span>
            </Link>
          </div>

          {roleRoadmaps.length === 0 ? (
            <div style={{ padding: '12px 0', color: 'var(--muted)', fontSize: '0.88rem' }}>
              {latestRole
                ? 'Every skill your target role needs is Verified. No roadmap needed.'
                : 'No roadmaps yet. Run verification to build a plan for your target role.'}
            </div>
          ) : (
            <div>
              {/* Counts summary */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--muted)' }}>Active Roadmaps: </span>
                  <strong>{roleRoadmaps.filter((r) => r.status !== 'completed').length}</strong>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--muted)' }}>Completed: </span>
                  <strong style={{ color: 'var(--st-v)' }}>{roleRoadmaps.filter((r) => r.status === 'completed').length}</strong>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--muted)' }}>Steps Progress: </span>
                  <strong>
                    {roleRoadmaps.reduce((acc, r) => acc + (r.steps?.filter((s) => s.done).length || 0), 0)} of{' '}
                    {roleRoadmaps.reduce((acc, r) => acc + (r.steps?.length || 0), 0)} done
                  </strong>
                </div>
              </div>

              {/* Next 3 recommended steps */}
              {nextSteps.length > 0 ? (
                <div>
                  <span className="k m" style={{ fontSize: '0.72rem', display: 'block', marginBottom: '8px', opacity: 0.75 }}>
                    NEXT 3 RECOMMENDED STEPS
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {nextSteps.map((step) => (
                      <div
                        key={step.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          gap: '12px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span className="chip sm" style={{ fontSize: '0.7rem' }}>
                            {step.skillName}
                          </span>
                          <span style={{ fontSize: '0.88rem', fontWeight: 500, color: 'var(--ink)' }}>
                            {step.title}
                          </span>
                          <span className="m" style={{ fontSize: '0.75rem', color: 'var(--faint)' }}>
                            ({step.platform})
                          </span>
                        </div>
                        {step.url && (
                          <a
                            href={step.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="b g sm"
                            style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}
                          >
                            Open ↗
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--st-v)' }}>
                  ✓ All current steps completed! You are ready to re-verify your passport.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Skills Breakdown Table */}
        <div className="table-card glass">
          <div className="table-card-head">
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--ink)', margin: 0 }}>
                Audited Technical Skills
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '4px 0 0' }}>
                Every skill extracted from your resume, matched against ground-truth code and credentials.
              </p>
            </div>

            {/* Filter by State */}
            <div className="table-filters" role="group" aria-label="Filter skills by state">
              {['ALL', 'V', 'S', 'C', 'X'].map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`filter-btn ${stateFilter === st ? 'active' : ''}`}
                  onClick={() => setStateFilter(st)}
                >
                  {st === 'ALL' ? 'All Skills' : L[st]}
                </button>
              ))}
            </div>
          </div>

          <div className="responsive-table-wrapper" data-lenis-prevent>
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>State</th>
                  <th>Confidence</th>
                  <th>Why This Status</th>
                  <th>Evidence Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkills.map((item) => {
                  const hasAnyEvidenceDetails = (passport?.skills || []).some(
                    (s) => Array.isArray(s.evidenceDetails)
                  )
                  const confInfo = getSkillConfidence(item, hasAnyEvidenceDetails)

                  return (
                    <tr key={item.skill}>
                      <td data-label="Skill">
                        <strong>{item.skill}</strong>
                      </td>
                      <td data-label="State">
                        <span className={`chip ${item.state}`}>{L[item.state]}</span>
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
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    <td data-label="Rationale" style={{ maxWidth: '340px' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--ink)' }}>
                        {item.rationale || 'State assigned via deterministic evidence inspection.'}
                      </span>
                    </td>
                    <td data-label="Evidence" style={{ maxWidth: '320px' }}>
                      <div>
                        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block' }}>
                          {item.evidence || 'No repository evidence attached'}
                        </span>
                        <button
                          type="button"
                          className="evidence-expand-btn"
                          onClick={() => toggleEvidence(item.skill)}
                          aria-expanded={Boolean(expandedEvidence[item.skill])}
                          title={expandedEvidence[item.skill] ? 'Hide evidence' : 'Show evidence'}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          <span>
                            {expandedEvidence[item.skill] ? 'Hide evidence' : 'Show evidence'}
                          </span>
                          <span className="expand-chevron" aria-hidden="true">
                            {expandedEvidence[item.skill] ? '▴' : '▾'}
                          </span>
                        </button>
                        {expandedEvidence[item.skill] && (
                          <div style={{ marginTop: '8px' }}>
                            {(() => {
                              const details =
                                Array.isArray(item.evidenceDetails) && item.evidenceDetails.length > 0
                                  ? item.evidenceDetails
                                  : buildSkillEvidenceDetails(item, { passport })

                              return details.map((detail, idx) => (
                                <EvidenceCard key={idx} detail={detail} />
                              ))
                            })()}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </div>

        {/* Best-Matching Roles (No Apply Button) */}
        <section style={{ marginBottom: '36px' }}>
          <div style={{ marginBottom: '16px' }}>
            <span className="k m">ROLE ALIGNMENT</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
              Best-Matching Open Roles
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '4px 0 0' }}>
              Ranked by your evidence weights (100 / 60 / 20 / 0). Evaluated against live job requirements.
            </p>
          </div>

          <div className="cards-grid">
            {recommendedRoles.slice(0, 4).map(({ role, score, matchedSkills, gaps }) => (
              <div key={role.id} className="role-match-card">
                <div>
                  <div className="role-card-head">
                    <div>
                      <h3 className="role-card-title">{role.title}</h3>
                      <p className="role-card-company">{role.company}</p>
                    </div>
                    <div className="match-gauge">
                      <div className="match-pct">{score}%</div>
                      <div className="match-label">Match</div>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.84rem', color: 'var(--muted)', lineHeight: '1.45', margin: '8px 0' }}>
                    {role.description.length > 120
                      ? `${role.description.slice(0, 120)}...`
                      : role.description}
                  </p>

                  <div className="role-card-skills">
                    {matchedSkills.map((m) => (
                      <span key={m.skill} className={`chip sm ${m.state}`}>
                        {m.skill}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: '12px', marginTop: '10px' }}>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'var(--mono)', color: 'var(--faint)' }}>
                    {gaps.length > 0 ? `${gaps.length} evidence gap${gaps.length > 1 ? 's' : ''} to reach 100%` : 'All required skills verified'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {careerRoles.length > 0 && (
          <section style={{ marginBottom: '36px' }}>
            <div style={{ marginBottom: '16px' }}>
              <span className="k m">CAREER FIT</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
                Best-Matching Career Roles
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '4px 0 0' }}>
                Deterministic match against a technical role catalogue (Verified 1.00 · Supported 0.70 · Claimed 0.35).{' '}
                <Link to="/recommendations">See full breakdown and learning plan →</Link>
              </p>
            </div>
            <div className="cards-grid">
              {careerRoles.map((r) => (
                <div key={r.role_id} className="role-match-card">
                  <div className="role-card-head">
                    <div>
                      <h3 className="role-card-title">{r.title}</h3>
                      <p className="role-card-company">{r.family} · core {r.core_coverage}</p>
                    </div>
                    <div className="match-gauge">
                      <div className="match-pct">{Math.round(r.score)}%</div>
                      <div className="match-label">Match</div>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--muted)', lineHeight: 1.45, margin: '8px 0' }}>{r.explanation}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Verify the Rest (Close Gaps with iMocha) */}
        {skillsToVerifyRest.length > 0 && (
          <section style={{ marginBottom: '40px' }}>
            <div style={{ marginBottom: '16px' }}>
              <span className="k m" style={{ color: 'var(--accent)' }}>CLOSE EVIDENCE GAPS</span>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
                Verify the Rest
              </h2>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '4px 0 0' }}>
                These skills currently have no code proof (Claimed) or have repository conflicts (Contradicted). Take a skill assessment on iMocha to earn Supported status.
              </p>
            </div>

            <div className="verify-rest-grid">
              {skillsToVerifyRest.map((item) => (
                <div key={item.skill} className="verify-rest-card">
                  <div>
                    <div className="verify-rest-head">
                      <strong>{item.skill}</strong>
                      <span className={`chip ${item.state}`}>{L[item.state]}</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--muted)', margin: '6px 0 12px', lineHeight: '1.4' }}>
                      {item.rationale}
                    </p>

                    <a
                      href={imochaLink(item.skill)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="b sm g"
                      style={{ width: '100%', textAlign: 'center', display: 'block', marginBottom: '10px' }}
                    >
                      Take assessment on iMocha ↗
                    </a>
                  </div>

                  <div className="self-submit-form">
                    <label htmlFor={`imocha-${item.skill}`} className="form-label" style={{ fontSize: '0.74rem' }}>
                      Paste verified result link
                    </label>
                    <input
                      id={`imocha-${item.skill}`}
                      type="url"
                      className="form-input sm self-submit-input"
                      placeholder="https://app.imocha.io/test/result/..."
                      value={selfSubmittedLinks[item.skill] || ''}
                      onChange={(e) =>
                        setSelfSubmittedLinks((prev) => ({
                          ...prev,
                          [item.skill]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="b sm"
                      onClick={() => handleSelfSubmitLink(item.skill)}
                      disabled={!selfSubmittedLinks[item.skill]?.trim()}
                    >
                      Submit for audit
                    </button>
                    <span className="self-submit-note">
                      Stored as candidate-submitted evidence, marked "not yet checked", elevates to Supported at most.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
