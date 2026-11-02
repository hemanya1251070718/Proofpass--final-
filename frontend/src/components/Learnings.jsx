/**
 * Learnings Page (/learnings)
 * Displays step-by-step roadmaps strictly for the applicant's current target role's non-Verified skills.
 * Features overall step progress, status filters, interactive step checklist, and resource links.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { getLatestRoleKey, listRoadmaps, updateRoadmapStep } from '../api/roadmaps.js'
import Seg from './Seg.jsx'
import { L } from '../data.js'
import { getStandardRoadmap } from '../data/standardRoadmaps.js'
import { generateSkillMilestones } from '../api/gemini.js'

export default function Learnings() {
  const { user } = useAuth()
  const [roleInfo, setRoleInfo] = useState(null)
  const [roadmaps, setRoadmaps] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'active' | 'completed'
  const [pastedLinks, setPastedLinks] = useState({})
  const [saveStatus, setSaveStatus] = useState(null)
  const [expandedStandard, setExpandedStandard] = useState({}) // keyed by skillId; default collapsed
  const [aiMilestones, setAiMilestones] = useState({}) // keyed by skillId: { status, items, source }; local only

  // Load current target role and its roadmaps
  useEffect(() => {
    let mounted = true
    async function loadData() {
      try {
        setLoading(true)
        const latest = await getLatestRoleKey(user?.id)
        if (!latest) {
          if (mounted) {
            setRoleInfo(null)
            setRoadmaps([])
            setLoading(false)
          }
          return
        }

        const data = await listRoadmaps(user?.id, latest.roleKey)
        if (mounted) {
          setRoleInfo(latest)
          setRoadmaps(data || [])
          setLoading(false)
        }
      } catch (err) {
        console.error('Failed to load roadmaps:', err)
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadData()
    return () => {
      mounted = false
    }
  }, [user?.id])

  // Compute overall progress metrics
  const { totalSteps, completedSteps, progressPct } = useMemo(() => {
    let total = 0
    let completed = 0
    roadmaps.forEach((r) => {
      (r.steps || []).forEach((s) => {
        total += 1
        if (s.done) completed += 1
      })
    })
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { totalSteps: total, completedSteps: completed, progressPct: pct }
  }, [roadmaps])

  // Filter roadmaps based on status
  const filteredRoadmaps = useMemo(() => {
    if (statusFilter === 'all') return roadmaps
    return roadmaps.filter((r) => r.status === statusFilter)
  }, [roadmaps, statusFilter])

  // Toggle step done status
  const handleToggleStep = async (roadmap, step) => {
    try {
      const nextDone = !step.done
      const updated = await updateRoadmapStep(user?.id, roadmap.roleKey, roadmap.skillId, step.id, {
        done: nextDone,
      })

      setRoadmaps((prev) =>
        prev.map((r) => (r.skillId === roadmap.skillId ? updated : r))
      )
      setSaveStatus(`Updated "${step.title}"`)
      setTimeout(() => setSaveStatus(null), 2500)
    } catch (err) {
      console.error('Failed to update step:', err)
    }
  }

  // Save pasted assessment link
  const handleSaveResultLink = async (roadmap, step) => {
    const link = (pastedLinks[step.id] ?? step.resultLink ?? '').trim()
    if (!link) return

    try {
      const updated = await updateRoadmapStep(user?.id, roadmap.roleKey, roadmap.skillId, step.id, {
        resultLink: link,
        done: true, // Auto-mark assessment done once result link is submitted
      })

      setRoadmaps((prev) =>
        prev.map((r) => (r.skillId === roadmap.skillId ? updated : r))
      )
      setSaveStatus(`Saved verification link for ${roadmap.skillName}`)
      setTimeout(() => setSaveStatus(null), 2500)
    } catch (err) {
      console.error('Failed to save assessment link:', err)
    }
  }

  // Generate read-only AI milestones for one card, on click only
  const handleGenerateMilestones = async (roadmap) => {
    const setResult = (result) =>
      setAiMilestones((prev) => ({ ...prev, [roadmap.skillId]: result }))

    setResult({ status: 'loading' })
    try {
      const { items, source } = await generateSkillMilestones(roadmap.skillName, roadmap.state)
      setResult({ status: 'done', items, source })
    } catch (err) {
      console.error('Failed to generate milestones:', err)
      setResult({ status: 'error' })
    }
  }

  return (
    <main id="main" className="dash-page page">
      <div className="w">
        {/* Page Header */}
        <div className="dash-header" data-rv>
          {roleInfo?.roleName && (
            <div className="k m" style={{ marginBottom: 6, opacity: 0.85 }}>
              Target role: <strong style={{ color: 'var(--ink)' }}>{roleInfo.roleName}</strong>
            </div>
          )}
          <div className="dash-header-row">
            <div>
              <h1 className="dash-title">Learning roadmaps</h1>
              <p className="dash-subtitle">
                Targeted course modules and verification assessments for skills your target role requires that are not yet Verified.
              </p>
            </div>
            <Link to="/verify" className="b sm">
              Re-verify skills <span className="btn-arrow" aria-hidden="true">-&gt;</span>
            </Link>
          </div>
        </div>

        {/* Global Save Notice */}
        {saveStatus && (
          <div className="login-notice" style={{ marginBottom: 20 }} role="status">
            <span className="notice-dot" aria-hidden="true" />
            <span>{saveStatus}</span>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="table-card glass" style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div className="login-notice" style={{ margin: '0 auto', maxWidth: 280 }}>
              <span className="notice-dot" aria-hidden="true" />
              <span>Loading role roadmaps...</span>
            </div>
          </div>
        )}

        {/* Empty State: No verification yet */}
        {!loading && !roleInfo && (
          <div className="table-card glass" style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ maxWidth: 540, margin: '0 auto' }}>
              <span className="k m" style={{ display: 'block', marginBottom: 10, color: 'var(--faint)' }}>
                NO ACTIVE ROADMAPS
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: 10 }}>No roadmaps yet</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.95rem', marginBottom: 24, lineHeight: 1.5 }}>
                Run a verification to get a step-by-step plan for the skills your target role needs.
              </p>
              <Link to="/verify" className="b">
                Start verification <span className="btn-arrow" aria-hidden="true">-&gt;</span>
              </Link>
            </div>
          </div>
        )}

        {/* Empty State: All required skills verified */}
        {!loading && roleInfo && roadmaps.length === 0 && (
          <div className="table-card glass" style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ maxWidth: 540, margin: '0 auto' }}>
              <span className="k m" style={{ display: 'block', marginBottom: 10, color: 'var(--st-v)' }}>
                ALL REQUIREMENTS MET
              </span>
              <h3 style={{ fontSize: '1.25rem', marginBottom: 10 }}>Role requirements completed</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.95rem', marginBottom: 24, lineHeight: 1.5 }}>
                Every skill your target role needs is Verified. No roadmap needed.
              </p>
              <Link to="/dashboard" className="b g sm">
                View passport on dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Content View */}
        {!loading && roleInfo && roadmaps.length > 0 && (
          <>
            {/* Overall Progress Strip */}
            <div className="table-card glass" style={{ padding: '24px', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 14 }}>
                <div>
                  <span className="k m" style={{ fontSize: '0.75rem', opacity: 0.8 }}>OVERALL GAP CLOSURE</span>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                    {completedSteps} of {totalSteps} steps completed ({progressPct}%)
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="m" style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                    {roadmaps.filter((r) => r.status === 'completed').length} of {roadmaps.length} skills closed
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ width: '100%', height: 8, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    background: 'var(--accent)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>

              {/* Filter Tabs */}
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-start' }}>
                <Seg
                  items={[
                    { id: 'all', label: `All (${roadmaps.length})` },
                    { id: 'active', label: `In progress (${roadmaps.filter((r) => r.status !== 'completed').length})` },
                    { id: 'completed', label: `Completed (${roadmaps.filter((r) => r.status === 'completed').length})` },
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  label="Filter Roadmaps"
                />
              </div>
            </div>

            {/* Roadmaps List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {filteredRoadmaps.map((roadmap) => {
                const steps = roadmap.steps || []
                const doneCount = steps.filter((s) => s.done).length
                const isFinished = roadmap.status === 'completed' || (steps.length > 0 && doneCount === steps.length)

                return (
                  <div key={roadmap.skillId} className="table-card glass" style={{ padding: '24px' }}>
                    {/* Skill Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700 }}>{roadmap.skillName}</h2>
                          <span className={`chip sm ${roadmap.state}`}>{L[roadmap.state] || roadmap.state}</span>
                          <span className="m" style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                            Weight {roadmap.importance}
                          </span>
                          {isFinished && (
                            <span className="chip sm V" style={{ marginLeft: 4 }}>
                              Ready for Re-verification
                            </span>
                          )}
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                          {roadmap.state === 'C'
                            ? 'Claimed skill: Take the standardized proctored assessment to advance directly to Verified.'
                            : 'Supported/Contradicted skill: Complete foundational module first, followed by proctored assessment.'}
                        </p>
                      </div>

                      <div className="m" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                        {doneCount} / {steps.length} steps done
                      </div>
                    </div>

                    {/* Step Checklist */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {steps.map((step, idx) => (
                        <div
                          key={step.id}
                          style={{
                            padding: '16px',
                            borderRadius: '10px',
                            background: step.done ? 'rgba(16, 185, 129, 0.05)' : 'var(--surface)',
                            border: `1px solid ${step.done ? 'rgba(16, 185, 129, 0.25)' : 'var(--line)'}`,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', flex: 1 }}>
                              <input
                                type="checkbox"
                                checked={Boolean(step.done)}
                                onChange={() => handleToggleStep(roadmap, step)}
                                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                              />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.95rem', textDecoration: step.done ? 'line-through' : 'none', color: step.done ? 'var(--muted)' : 'var(--ink)' }}>
                                    {idx + 1}. {step.title}
                                  </span>
                                  <span className="chip sm" style={{ textTransform: 'capitalize', fontSize: '0.72rem' }}>
                                    {step.type}
                                  </span>
                                  <span className="m" style={{ fontSize: '0.78rem', color: 'var(--faint)' }}>
                                    {step.platform}
                                  </span>
                                </div>
                                <p style={{ margin: '4px 0 0', fontSize: '0.84rem', color: 'var(--muted)' }}>
                                  {step.description}
                                </p>
                              </div>
                            </label>

                            {step.url && (
                              <a
                                href={step.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="b g sm"
                                style={{ flexShrink: 0, textDecoration: 'none' }}
                              >
                                Open resource <span className="btn-arrow" aria-hidden="true">↗</span>
                              </a>
                            )}
                          </div>

                          {/* Self-submission link for assessment steps */}
                          {step.type === 'assessment' && (
                            <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <input
                                  type="text"
                                  className="form-input"
                                  placeholder="Paste your assessment result or completion URL"
                                  value={pastedLinks[step.id] ?? step.resultLink ?? ''}
                                  onChange={(e) =>
                                    setPastedLinks((prev) => ({
                                      ...prev,
                                      [step.id]: e.target.value,
                                    }))
                                  }
                                  style={{ flex: 1, minWidth: 220, fontSize: '0.85rem' }}
                                />
                                <button
                                  type="button"
                                  className="b sm"
                                  onClick={() => handleSaveResultLink(roadmap, step)}
                                >
                                  Save link
                                </button>
                              </div>
                              {step.resultLink && (
                                <span className="m" style={{ fontSize: '0.75rem', color: 'var(--st-s)', marginTop: 4, display: 'inline-block' }}>
                                  ✓ Result link recorded (self-submitted evidence)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Standard Roadmap (read-only reference) */}
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--line)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="b g sm"
                          aria-expanded={Boolean(expandedStandard[roadmap.skillId])}
                          onClick={() =>
                            setExpandedStandard((prev) => ({
                              ...prev,
                              [roadmap.skillId]: !prev[roadmap.skillId],
                            }))
                          }
                        >
                          Standard Roadmap for {roadmap.skillName}{' '}
                          <span aria-hidden="true">{expandedStandard[roadmap.skillId] ? '▴' : '▾'}</span>
                        </button>
                        <button
                          type="button"
                          className="b g sm"
                          disabled={aiMilestones[roadmap.skillId]?.status === 'loading'}
                          onClick={() => handleGenerateMilestones(roadmap)}
                        >
                          Generate AI milestones
                        </button>
                        {aiMilestones[roadmap.skillId]?.status === 'loading' && (
                          <span className="m" role="status" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Generating...
                          </span>
                        )}
                        {aiMilestones[roadmap.skillId]?.status === 'error' && (
                          <span className="m" role="alert" style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Couldn't generate milestones right now
                          </span>
                        )}
                      </div>
                      {expandedStandard[roadmap.skillId] && (
                        <ol style={{ margin: '12px 0 0', paddingLeft: 22, listStyle: 'decimal', display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.88rem', color: 'var(--muted)' }}>
                          {getStandardRoadmap(roadmap.skillName).map((milestone) => (
                            <li key={milestone.id}>{milestone.label}</li>
                          ))}
                        </ol>
                      )}

                      {/* AI-suggested milestones (read-only, not persisted) */}
                      {aiMilestones[roadmap.skillId]?.status === 'done' && (
                        <div style={{ marginTop: 14, padding: '16px', borderRadius: '10px', background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: '3px solid var(--accent)' }}>
                          <span className="chip sm" style={{ fontSize: '0.72rem' }}>
                            {aiMilestones[roadmap.skillId].source === 'ai' ? 'AI-suggested milestones' : 'Suggested milestones'}
                          </span>
                          <ol style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.88rem', color: 'var(--ink)' }}>
                            {aiMilestones[roadmap.skillId].items.map((item, idx) => (
                              <li key={idx}>{item.step}. {item.title}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
