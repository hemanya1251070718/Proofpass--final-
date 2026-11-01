/**
 * Recommendations Page Component
 * Displays curated learning and practice resources prioritized by candidate skill gaps.
 * Contains two distinct sections: Courses and Practice & Tests.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { listPassports } from '../api/passports.js'
import { getRecommendedResources } from '../api/recommendations.js'

export default function Recommendations() {
  const { user } = useAuth()
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSkillFilter, setSelectedSkillFilter] = useState('ALL')
  const [passport, setPassport] = useState(null)

  useEffect(() => {
    let mounted = true
    async function loadData() {
      try {
        const userPassports = await listPassports(user?.id)
        let active = userPassports[0] || null
        if (!active) {
          const all = await listPassports()
          active = all.find((p) => p.candidate === user?.name || p.userId === user?.id) || null
        }

        if (mounted) {
          setPassport(active)
          const candidateSkills = active?.skills || []
          const recs = await getRecommendedResources(
            candidateSkills,
            user?.profile?.targetRole || active?.targetRole || ''
          )
          setResources(recs)
          setLoading(false)
        }
      } catch {
        if (mounted) setLoading(false)
      }
    }
    loadData()
    return () => {
      mounted = false
    }
  }, [user])

  const candidateSkills = passport?.skills || []
  const unverifiedSkillSet = new Set(
    candidateSkills.filter((s) => s.state !== 'V').map((s) => s.skill.toLowerCase())
  )

  // Unique skills for filtering
  const uniqueSkills = Array.from(new Set(resources.map((r) => r.skill)))

  // Filtered resources
  const filtered = selectedSkillFilter === 'ALL'
    ? resources
    : resources.filter((r) => r.skill.toLowerCase() === selectedSkillFilter.toLowerCase())

  const courses = filtered.filter((r) => r.type === 'course')
  const practiceItems = filtered.filter((r) => r.type === 'practice')

  if (loading) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="login-notice">
            <span className="notice-dot" aria-hidden="true" />
            <span>Curating learning and practice recommendations...</span>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main id="main" className="dash-page">
      <div className="w">
        {/* Header */}
        <div className="dash-header">
          <span className="k m">SKILL ACCELERATION</span>
          <div className="dash-header-row">
            <div>
              <h1 className="dash-title">Recommended Learning & Practice</h1>
              <p className="dash-subtitle">
                Target Role: <strong>{user?.profile?.targetRole || passport?.targetRole || 'Software Engineer'}</strong> · Curated tracks to close evidence gaps and upgrade to Verified.
              </p>
            </div>
            <div>
              <Link to="/radar" className="b sm" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                📡 Proximity Job Radar →
              </Link>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="rec-filters-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontFamily: 'var(--mono)', color: 'var(--faint)' }}>
              FILTER BY SKILL:
            </span>
            <button
              type="button"
              className={`filter-btn ${selectedSkillFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedSkillFilter('ALL')}
            >
              All Skills ({resources.length})
            </button>
            {uniqueSkills.map((sk) => {
              const isGap = unverifiedSkillSet.has(sk.toLowerCase())
              return (
                <button
                  key={sk}
                  type="button"
                  className={`filter-btn ${selectedSkillFilter === sk ? 'active' : ''}`}
                  onClick={() => setSelectedSkillFilter(sk)}
                >
                  {sk} {isGap && '●'}
                </button>
              )
            })}
          </div>

          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            ● Items for unverified skills shown first
          </div>
        </div>

        {/* SECTION 1: COURSES */}
        <section style={{ marginBottom: '44px' }}>
          <div style={{ marginBottom: '16px' }}>
            <span className="k m">FOUNDATIONAL CURRICULUM</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
              Courses and Structured Certifications
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '4px 0 0' }}>
              Official provider curricula to build conceptual and architectural depth.
            </p>
          </div>

          <div className="cards-grid">
            {courses.map((item) => {
              const isGap = unverifiedSkillSet.has(item.skill.toLowerCase())
              return (
                <div key={item.id} className="rec-card">
                  <div>
                    <div className="rec-card-top">
                      <span className="rec-platform-tag">{item.platform}</span>
                      {isGap && <span className="rec-gap-badge">Target Gap</span>}
                    </div>
                    <h3 className="rec-title">{item.title}</h3>
                  </div>

                  <div>
                    <div className="rec-meta" style={{ marginBottom: '14px' }}>
                      <span>Skill: <strong>{item.skill}</strong></span>
                      <span>·</span>
                      <span>Level: {item.level}</span>
                      <span>·</span>
                      <span>{item.cost}</span>
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="b sm"
                      style={{ width: '100%', textAlign: 'center', display: 'block' }}
                    >
                      Open on {item.platform} ↗
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* SECTION 2: PRACTICE AND TESTS */}
        <section style={{ marginBottom: '44px' }}>
          <div style={{ marginBottom: '16px' }}>
            <span className="k m">HANDS-ON ASSESSMENT</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)', margin: '4px 0 0' }}>
              Practice and Topic Tests
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '4px 0 0' }}>
              Solve challenges, write unit test assertions, and submit links to elevate your claims.
            </p>
          </div>

          <div className="cards-grid">
            {practiceItems.map((item) => {
              const isGap = unverifiedSkillSet.has(item.skill.toLowerCase())
              return (
                <div key={item.id} className="rec-card">
                  <div>
                    <div className="rec-card-top">
                      <span className="rec-platform-tag">{item.platform}</span>
                      {isGap && <span className="rec-gap-badge">Target Gap</span>}
                    </div>
                    <h3 className="rec-title">{item.title}</h3>
                  </div>

                  <div>
                    <div className="rec-meta" style={{ marginBottom: '14px' }}>
                      <span>Skill: <strong>{item.skill}</strong></span>
                      <span>·</span>
                      <span>Level: {item.level}</span>
                      <span>·</span>
                      <span>{item.cost}</span>
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="b sm g"
                      style={{ width: '100%', textAlign: 'center', display: 'block' }}
                    >
                      Practice on {item.platform} ↗
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
