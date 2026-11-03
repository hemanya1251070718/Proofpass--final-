/**
 * Role matching (Part 3) + course/practice plan (Part 1), driven by the backend.
 * Shows deterministic role scores with matched / weak / missing skills, and recommendations
 * that cover both passport gaps and the selected role's gaps.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchRecommendationPlan, fetchRoleMatches } from '../api/recommendations.js'

const SOURCE_LABEL = {
  live: { text: 'Live GitHub', tone: 'var(--accent)' },
  cache: { text: 'Cached GitHub result', tone: 'var(--muted)' },
  stale_cache: { text: 'Stale cache (GitHub unavailable)', tone: 'var(--muted)' },
  fallback: { text: 'Fallback link - no live data', tone: 'var(--muted)' },
  unmapped: { text: 'No GitHub mapping', tone: 'var(--muted)' },
}

const STATE_NAME = { V: 'Verified', S: 'Supported', C: 'Claimed', X: 'Contradicted' }

function SkillChip({ skill, state, extra }) {
  return (
    <span className={`chip sm ${state || ''}`} title={state ? STATE_NAME[state] : 'Missing from passport'}>
      {skill}
      {extra ? ` ${extra}` : ''}
    </span>
  )
}

function RoleDetail({ role }) {
  return (
    <div className="rec-card" style={{ marginBottom: 20 }} data-testid="role-detail">
      <div>
        <div className="rec-card-top">
          <span className="rec-platform-tag">{role.family} · core skills evidenced {role.core_coverage}</span>
          <span className="rec-gap-badge">{role.score}% match</span>
        </div>
        <h3 className="rec-title">{role.title}</h3>
        <p style={{ fontSize: '0.86rem', color: 'var(--muted)', margin: '6px 0' }}>{role.explanation}</p>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <span className="k m">MATCHED (Verified / Supported)</span>
          <div className="role-card-skills">
            {role.matched_skills.length ? role.matched_skills.map((m) => <SkillChip key={m.skill} skill={m.skill} state={m.state} extra={`· ${m.tier}`} />) : <em style={{ color: 'var(--faint)' }}>None yet</em>}
          </div>
        </div>
        <div>
          <span className="k m">WEAK EVIDENCE (Claimed / Contradicted)</span>
          <div className="role-card-skills">
            {role.weak_skills.length ? role.weak_skills.map((m) => <SkillChip key={m.skill} skill={m.skill} state={m.state} extra={`· ${m.tier}`} />) : <em style={{ color: 'var(--faint)' }}>None</em>}
          </div>
        </div>
        <div>
          <span className="k m">MISSING</span>
          <div className="role-card-skills">
            {role.missing_skills.length ? role.missing_skills.map((m) => <SkillChip key={m.skill} skill={m.skill} extra={`· ${m.tier}`} />) : <em style={{ color: 'var(--faint)' }}>None</em>}
          </div>
        </div>
        {role.improvement_priorities.length > 0 && (
          <div>
            <span className="k m">IMPROVEMENT PRIORITIES</span>
            <ol style={{ margin: '6px 0 0 18px', padding: 0, fontSize: '0.84rem', color: 'var(--ink)', lineHeight: 1.5 }}>
              {role.improvement_priorities.slice(0, 5).map((p) => (
                <li key={p.skill}>
                  {p.recommendation} <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>+{p.gain_points.toFixed(0)} pts</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}

function PracticeBlock({ practice }) {
  if (!practice) return null
  const label = SOURCE_LABEL[practice.source] || SOURCE_LABEL.fallback
  return (
    <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span className="k m">PRACTICE (GITHUB ISSUES)</span>
        <span style={{ fontSize: '0.72rem', fontFamily: 'var(--mono)', color: label.tone }}>{label.text}</span>
      </div>
      {practice.items.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{practice.warnings?.[0] || 'No practice items found.'}</p>}
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6 }}>
        {practice.items.map((it) => (
          <li key={it.url} style={{ fontSize: '0.84rem' }}>
            <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title} ↗</a>
            {it.repo && <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '0.74rem' }}> {it.repo}</span>}
            {!it.is_fallback && it.label_note && <div style={{ fontSize: '0.72rem', color: 'var(--faint)' }}>{it.label_note}</div>}
          </li>
        ))}
      </ul>
      {practice.source === 'fallback' && practice.warnings?.length > 0 && (
        <p style={{ fontSize: '0.72rem', color: 'var(--faint)', margin: '6px 0 0' }}>{practice.warnings[0]}</p>
      )}
    </div>
  )
}

function RecCard({ rec }) {
  return (
    <div className="rec-card" data-testid="plan-card">
      <div>
        <div className="rec-card-top">
          <h3 className="rec-title" style={{ marginTop: 0 }}>{rec.skill}</h3>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {rec.current_state ? <SkillChip skill={STATE_NAME[rec.current_state]} state={rec.current_state} /> : <span className="chip sm">Missing</span>}
            <span className="rec-gap-badge" title="Higher = closes more gap">priority {rec.priority.toFixed(1)}</span>
          </span>
        </div>
        <ul style={{ margin: '8px 0 0 16px', padding: 0, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
          {rec.reasons.map((r, i) => <li key={i}>{r.text}</li>)}
        </ul>
      </div>
      <div>
        <span className="k m">COURSES (COURSERA CATALOGUE)</span>
        {rec.courses.length === 0 && <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>No catalogue course found for this skill.</p>}
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 8 }}>
          {rec.courses.map((c) => (
            <li key={c.id} style={{ fontSize: '0.86rem' }}>
              <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title} ↗</a>
              <div className="rec-meta">
                <span>{c.provider || 'Coursera'}</span>
                {c.level && <><span>·</span><span>{c.level}</span></>}
                <span>·</span>
                <span>{c.rating != null ? `★ ${c.rating.toFixed(1)} (${c.review_count.toLocaleString()})` : 'unrated'}</span>
                {c.duration_hours != null && <><span>·</span><span>~{c.duration_hours}h</span></>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <PracticeBlock practice={rec.practice} />
    </div>
  )
}

export default function RecommendationPlan({ candidateSkills, targetRoleHint = '', onUnavailable }) {
  const [roles, setRoles] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [loadingRoles, setLoadingRoles] = useState(true)
  const [loadingPlan, setLoadingPlan] = useState(false)

  const hasSkills = Array.isArray(candidateSkills) && candidateSkills.length > 0
  const skillsKey = useMemo(() => JSON.stringify((candidateSkills || []).map((s) => [s.skill, s.state])), [candidateSkills])

  useEffect(() => {
    if (!hasSkills) {
      setLoadingRoles(false)
      return undefined
    }
    let live = true
    setLoadingRoles(true)
    fetchRoleMatches(candidateSkills)
      .then((rs) => {
        if (!live) return
        setRoles(rs)
        setError('')
        setSelectedId((cur) => {
          if (cur && rs.some((r) => r.role_id === cur)) return cur
          const hint = targetRoleHint.trim().toLowerCase()
          const byHint = hint && rs.find((r) => r.title.toLowerCase().includes(hint) || hint.includes(r.title.toLowerCase()))
          return (byHint || rs[0])?.role_id || null
        })
      })
      .catch((e) => {
        if (!live) return
        setError(e.name === 'AbortError' ? 'The recommendation service timed out.' : e.message)
        onUnavailable?.(true)
      })
      .finally(() => live && setLoadingRoles(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsKey, targetRoleHint])

  useEffect(() => {
    if (!selectedId) return undefined
    let live = true
    setLoadingPlan(true)
    fetchRecommendationPlan(candidateSkills, selectedId)
      .then((p) => {
        if (live) {
          setPlan(p)
          onUnavailable?.(false)
        }
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoadingPlan(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, skillsKey])

  if (!hasSkills) {
    return (
      <div className="login-notice" data-testid="empty-state">
        <span className="notice-dot" aria-hidden="true" />
        <span>
          No passport yet, so there is nothing to match. <Link to="/verify">Run verification</Link> to see your best-matching roles and a personalised plan.
        </span>
      </div>
    )
  }
  if (loadingRoles) {
    return <div className="login-notice"><span className="notice-dot" aria-hidden="true" /><span>Matching your passport against technical roles...</span></div>
  }
  if (error && roles.length === 0) {
    return (
      <div className="login-notice" role="alert">
        <span className="notice-dot" aria-hidden="true" />
        <span>Live role matching is unavailable ({error}). Showing the curated list below.</span>
      </div>
    )
  }

  const selected = roles.find((r) => r.role_id === selectedId)
  return (
    <>
      <section style={{ marginBottom: 36 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="k m">ROLE ALIGNMENT</span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>Best-Matching Career Roles</h2>
          <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '4px 0 0' }}>
            Score = skill importance × evidence strength (Verified 1.00 · Supported 0.70 · Claimed 0.35 · Contradicted 0). Deterministic - no AI-generated scores. Pick a role to plan against.
          </p>
        </div>
        <div className="cards-grid">
          {roles.slice(0, 6).map((r) => (
            <button
              key={r.role_id}
              type="button"
              onClick={() => setSelectedId(r.role_id)}
              className="rec-card"
              aria-pressed={r.role_id === selectedId}
              style={{ textAlign: 'left', cursor: 'pointer', outline: r.role_id === selectedId ? '2px solid var(--accent)' : 'none' }}
            >
              <div className="rec-card-top">
                <span className="rec-platform-tag">{r.family}</span>
                <span className="rec-gap-badge">{r.score}%</span>
              </div>
              <h3 className="rec-title">{r.title}</h3>
              <div className="rec-meta">
                <span>core {r.core_coverage}</span><span>·</span>
                <span>{r.matched_skills.length} matched</span><span>·</span>
                <span>{r.missing_skills.length} missing</span>
              </div>
            </button>
          ))}
        </div>
        {roles.length > 6 && (
          <label style={{ display: 'block', margin: '12px 0', fontSize: '0.82rem', color: 'var(--muted)' }}>
            More roles:{' '}
            <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value)}>
              {roles.map((r) => <option key={r.role_id} value={r.role_id}>{r.title} - {r.score}%</option>)}
            </select>
          </label>
        )}
        {selected && <RoleDetail role={selected} />}
      </section>

      <section style={{ marginBottom: 44 }}>
        <div style={{ marginBottom: 16 }}>
          <span className="k m">PERSONALISED PLAN</span>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
            Close your gaps{selected ? ` for ${selected.title}` : ''}
          </h2>
          <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '4px 0 0' }}>
            Ranked by the evidence gap in your passport plus the missing/weak skills of the selected role (and, at half weight, your other top matches).
          </p>
        </div>
        {loadingPlan && <p style={{ color: 'var(--muted)' }}>Fetching courses and GitHub practice issues...</p>}
        {error && !loadingPlan && <p role="alert" style={{ color: 'var(--accent)' }}>{error}</p>}
        {plan && plan.meta.course_catalogue_size === 0 && (
          <p role="alert" style={{ color: 'var(--accent)' }}>Course catalogue is empty on the server. Run the import script to enable course recommendations.</p>
        )}
        {plan && plan.recommendations.length === 0 && !loadingPlan && <p style={{ color: 'var(--muted)' }}>Nothing to recommend - every relevant skill is Verified.</p>}
        <div className="cards-grid">
          {plan && plan.recommendations.map((rec) => <RecCard key={rec.skill} rec={rec} />)}
        </div>
      </section>
    </>
  )
}
