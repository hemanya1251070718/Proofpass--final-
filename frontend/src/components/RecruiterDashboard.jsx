/**
 * Recruiter Dashboard Component
 * Clean table overview of active hiring roles: Role, Company, Applicants,
 * With passport, Average match, and Updated date.
 * Includes search filtering, "+ Add new role" creation, and zero inline styles.
 */

import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listRoles, createRole } from '../api/roles.js'
import { listApplicantsForRole } from '../api/applicants.js'
import { listPassports } from '../api/passports.js'
import { rankApplicants } from '../lib/rank.js'
import { matchSkillsFromText } from '../data/taxonomy.js'
import JobDescriptionImport from './JobDescriptionImport.jsx'

export default function RecruiterDashboard() {
  const navigate = useNavigate()
  const [roles, setRoles] = useState([])
  const [roleStats, setRoleStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddRoleModal, setShowAddRoleModal] = useState(false)
  const [notice, setNotice] = useState(null)

  // New Role Form State
  const [newTitle, setNewTitle] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCv, setNewCv] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newWorkMode, setNewWorkMode] = useState('')
  const [newMinYears, setNewMinYears] = useState(null)
  const [newSkills, setNewSkills] = useState([
    { skill: 'React', importance: 'Must', weight: 3 },
    { skill: 'TypeScript', importance: 'Must', weight: 3 },
  ])
  const [addSkillInput, setAddSkillInput] = useState('')
  const [addSkillImportance, setAddSkillImportance] = useState('Must')
  const [formErrors, setFormErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleApplyJdInAddRole = (applied) => {
    if (applied.title) setNewTitle(applied.title)
    if (applied.description) setNewDesc(applied.description)
    if (applied.requiredSkills) setNewSkills(applied.requiredSkills)
    if (applied.location) setNewLocation(applied.location)
    if (applied.workMode) setNewWorkMode(applied.workMode)
    if (applied.minExperienceYears != null) setNewMinYears(applied.minExperienceYears)
    setFormErrors((prev) => ({ ...prev, title: null, desc: null }))
  }

  // Load roles and compute applicant stats
  const fetchRolesData = async (silent = false) => {
    try {
      const allRoles = await listRoles()
      setRoles(allRoles)
      const browserPassports = await listPassports()

      const stats = {}
      for (const r of allRoles) {
        const { withPassport, noPassport } = await listApplicantsForRole(r.id)

        let combinedWithPassport = [...withPassport]
        const existingIds = new Set(
          combinedWithPassport.map((a) => a.passport?.id || a.passport?.passport_id || a.id)
        )
        const roleSkillNames = (r.requiredSkills || []).map((req) =>
          (req.skill || req.name || '').toLowerCase().trim()
        )
        const roleTitleClean = (r.title || '').toLowerCase().trim()

        for (const p of browserPassports) {
          if (p.revoked || p.legacy) continue  // legacy client-sealed records are not ranked
          const pId = p.id || p.passport_id
          if (!pId || existingIds.has(pId) || existingIds.has(`live_${pId}`)) continue

          const pRoleClean = (p.targetRole || p.target_role || '').toLowerCase().trim()
          const pSkills = p.skills || []
          const hasRoleOverlap =
            pRoleClean &&
            (roleTitleClean.includes(pRoleClean.slice(0, 10)) ||
              pRoleClean.includes(roleTitleClean.slice(0, 10)))
          const hasSkillOverlap = pSkills.some((s) =>
            roleSkillNames.includes((s.skill || s.name || '').toLowerCase().trim())
          )

          if (
            hasRoleOverlap ||
            hasSkillOverlap ||
            !pRoleClean ||
            pRoleClean === 'software engineer' ||
            pRoleClean === 'full-stack engineer'
          ) {
            combinedWithPassport.push({
              id: `live_${pId}`,
              name: p.candidate || p.candidate_name || 'Applicant',
              hasPassport: true,
              passport: p,
              skills: pSkills,
            })
            existingIds.add(pId)
          }
        }

        const ranked = rankApplicants(r, combinedWithPassport)
        const avgMatch =
          ranked.length > 0
            ? Math.round(
                ranked.reduce((sum, c) => sum + (c.score || 0), 0) / ranked.length
              )
            : null

        const dateRaw = r.updatedAt || r.createdAt
        stats[r.id] = {
          withPassport: combinedWithPassport.length,
          noPassport: noPassport.length,
          total: combinedWithPassport.length + noPassport.length,
          avgMatch: avgMatch !== null ? `${avgMatch}%` : '—',
          updatedDate: dateRaw
            ? new Date(dateRaw).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : '—',
        }
      }
      setRoleStats(stats)
      if (!silent) setLoading(false)
    } catch (err) {
      if (!silent) {
        setNotice(`Failed to load roles: ${err.message}`)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    fetchRolesData()
    const interval = setInterval(() => {
      fetchRolesData(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Skill suggestion from description
  const handleSuggest = () => {
    if (!newDesc || newDesc.trim().length < 15) {
      setFormErrors((prev) => ({ ...prev, desc: 'Enter at least 15 characters of description first.' }))
      return
    }
    const matched = matchSkillsFromText(newDesc)
    const existing = new Set(newSkills.map((s) => s.skill.toLowerCase()))
    const toAdd = matched
      .filter((m) => !existing.has(m.name.toLowerCase()))
      .map((m) => ({ skill: m.name, importance: 'Must', weight: 3 }))

    if (toAdd.length > 0) {
      setNewSkills((prev) => [...prev, ...toAdd])
      setNotice(`Added ${toAdd.length} suggested skills from description.`)
    } else {
      setNotice('No new taxonomy skills detected in description.')
    }
  }

  const handleAddSkill = () => {
    if (!addSkillInput.trim()) return
    const name = addSkillInput.trim()
    if (newSkills.some((s) => s.skill.toLowerCase() === name.toLowerCase())) {
      setAddSkillInput('')
      return
    }
    const weight = addSkillImportance === 'Must' ? 3 : addSkillImportance === 'Should' ? 2 : 1
    setNewSkills((prev) => [...prev, { skill: name, importance: addSkillImportance, weight }])
    setAddSkillInput('')
  }

  const handleRemoveSkill = (skill) => {
    setNewSkills((prev) => prev.filter((s) => s.skill !== skill))
  }

  const handleCreateRole = async (e) => {
    e.preventDefault()
    setNotice(null)

    const errs = {}
    if (!newTitle.trim()) errs.title = 'Job title is required.'
    if (!newDesc.trim() || newDesc.trim().length < 40) {
      errs.desc = 'Description must be at least 40 characters.'
    }

    if (Object.keys(errs).length > 0) {
      setFormErrors(errs)
      return
    }

    setFormErrors({})
    setIsSubmitting(true)

    try {
      const created = await createRole({
        title: newTitle.trim(),
        company: newCompany.trim() || 'My Company',
        description: newDesc.trim(),
        requiredSkills: newSkills,
        demoCv: newCv.trim(),
        location: newLocation ? newLocation.trim() : null,
        workMode: newWorkMode || null,
        minExperienceYears: newMinYears != null ? Number(newMinYears) : null,
      })

      setShowAddRoleModal(false)
      setNewTitle('')
      setNewCompany('')
      setNewDesc('')
      setNewCv('')
      setNewLocation('')
      setNewWorkMode('')
      setNewMinYears(null)
      setNewSkills([
        { skill: 'React', importance: 'Must', weight: 3 },
        { skill: 'TypeScript', importance: 'Must', weight: 3 },
      ])
      setNotice(`Role "${created.title}" successfully created.`)
      await fetchRolesData()
    } catch (err) {
      setNotice(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Filtered roles by search query
  const filteredRoles = useMemo(() => {
    if (!searchQuery.trim()) return roles
    const q = searchQuery.toLowerCase().trim()
    return roles.filter(
      (r) =>
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.company && r.company.toLowerCase().includes(q))
    )
  }, [roles, searchQuery])

  if (loading) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div className="skeleton-list" aria-busy="true" aria-label="Loading recruiter workspace">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-row">
                <div className="skeleton-bar skeleton-w-180" />
                <div className="skeleton-bar skeleton-w-90" />
                <div className="skeleton-bar skeleton-w-60" />
                <div className="skeleton-bar skeleton-w-60" />
                <div className="skeleton-bar skeleton-w-60" />
                <div className="skeleton-bar skeleton-w-90" />
              </div>
            ))}
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
          <span className="k m">RECRUITER WORKSPACE</span>
          <div className="dash-header-row">
            <div>
              <h1 className="dash-title">Hiring Role Openings</h1>
              <p className="dash-subtitle">
                Inspect applicant pass rates, evidence-backed leaderboard rankings, and verify unverified resumes.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="b sm"
                onClick={() => setShowAddRoleModal(true)}
              >
                + Add new role
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <div className="login-notice mb-20" role="status">
            <span className="notice-dot" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {/* Roles Search Toolbar */}
        <div className="roles-search-toolbar">
          <input
            type="search"
            className="form-input sm roles-search-input"
            placeholder="Search roles by title or company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search roles by title or company"
          />

          <span className="lb-filter-count">
            {filteredRoles.length} role{filteredRoles.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Roles Table (Item 1: Clean table, not cards) */}
        {roles.length === 0 ? (
          <div className="table-card glass roles-empty-state">
            <p>No hiring roles created yet.</p>
            <button
              type="button"
              className="b sm"
              onClick={() => setShowAddRoleModal(true)}
            >
              + Add new role
            </button>
          </div>
        ) : filteredRoles.length === 0 ? (
          <div className="table-card glass roles-empty-state">
            <p>No roles found matching "{searchQuery}".</p>
            <button
              type="button"
              className="b sm g"
              onClick={() => setSearchQuery('')}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="table-card glass">
            <div className="responsive-table-wrapper" data-lenis-prevent>
              <table className="dash-table" role="table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Company</th>
                    <th scope="col">Applicants</th>
                    <th scope="col">With passport</th>
                    <th scope="col">Average match</th>
                    <th scope="col">Updated</th>
                    <th scope="col" className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoles.map((role) => {
                    const stats = roleStats[role.id] || {
                      total: 0,
                      withPassport: 0,
                      avgMatch: '—',
                      updatedDate: '—',
                    }

                    return (
                      <tr
                        key={role.id}
                        className="clickable-row"
                        onClick={() => navigate(`/recruiter/role/${role.id}`)}
                      >
                        <td data-label="Role" className="role-title-cell">
                          <Link
                            to={`/recruiter/role/${role.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {role.title}
                          </Link>
                          {(role.location || role.workMode) && (
                            <div className="role-meta-line mt-4">
                              {role.location && <span>📍 {role.location}</span>}
                              {role.location && role.workMode && (
                                <span className="role-meta-dot" aria-hidden="true">·</span>
                              )}
                              {role.workMode && <span>💼 {role.workMode}</span>}
                            </div>
                          )}
                        </td>

                        <td data-label="Company">
                          <span className="text-muted-sm">{role.company}</span>
                        </td>

                        <td data-label="Applicants">
                          <strong>{stats.total}</strong>
                        </td>

                        <td data-label="With passport">
                          <span className="stat-tag-v">
                            <strong>{stats.withPassport}</strong>
                          </span>
                        </td>

                        <td data-label="Average match">
                          <span className="lb-match-val-accent">
                            <strong>{stats.avgMatch}</strong>
                          </span>
                        </td>

                        <td data-label="Updated">
                          <span className="text-muted-sm">{stats.updatedDate}</span>
                        </td>

                        <td data-label="Action" className="text-right">
                          <Link
                            to={`/recruiter/role/${role.id}`}
                            className="b sm g"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View role →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Add Role Modal with zero inline styles */}
        {showAddRoleModal && (
          <div
            className="modal-backdrop"
            onClick={() => setShowAddRoleModal(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Create job role"
          >
            <div
              className="modal-dialog"
              onClick={(e) => e.stopPropagation()}
              data-lenis-prevent
            >
              <div className="modal-header-row">
                <h2 className="section-title-sm">
                  Create Job Role
                </h2>
                <button
                  type="button"
                  className="b sm g"
                  onClick={() => setShowAddRoleModal(false)}
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>

              <JobDescriptionImport
                currentValues={{
                  title: newTitle,
                  description: newDesc,
                  requiredSkills: newSkills,
                  location: newLocation,
                  workMode: newWorkMode,
                  minExperienceYears: newMinYears,
                }}
                onApply={handleApplyJdInAddRole}
              />

              <form onSubmit={handleCreateRole}>
                <div className="form-group">
                  <label className="form-label">Role Title</label>
                  <input
                    type="text"
                    className={`form-input ${formErrors.title ? 'input-error' : ''}`}
                    placeholder="e.g. Senior Backend Python Engineer"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                  />
                  {formErrors.title && <span className="field-error-msg">{formErrors.title}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label">Company Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Acme Health Tech"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                  />
                </div>

                <div className="gap-form-row">
                  <div className="form-group">
                    <label className="form-label">Location (optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. London, UK"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Workplace Model (optional)</label>
                    <select
                      className="form-input"
                      value={newWorkMode}
                      onChange={(e) => setNewWorkMode(e.target.value)}
                    >
                      <option value="">None specified</option>
                      <option value="Remote">Remote</option>
                      <option value="Hybrid">Hybrid</option>
                      <option value="On-site">On-site</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Min Experience (Years, optional)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    className="form-input"
                    placeholder="e.g. 4"
                    value={newMinYears ?? ''}
                    onChange={(e) => setNewMinYears(e.target.value ? Number(e.target.value) : null)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Job Requirement Description</label>
                  <textarea
                    rows="3"
                    className={`form-input ${formErrors.desc ? 'input-error' : ''}`}
                    placeholder="Describe role responsibilities, tech stack, and evaluation context..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    required
                  />
                  {formErrors.desc && <span className="field-error-msg">{formErrors.desc}</span>}
                </div>

                {/* Skills Taxonomy Section */}
                <div className="form-group">
                  <div className="table-head-row-between mb-8">
                    <label className="form-label">Required Skills & Weighting</label>
                    <button
                      type="button"
                      className="b sm g"
                      onClick={handleSuggest}
                      title="Auto-detect skills mentioned in description"
                    >
                      ✨ Auto-suggest from description
                    </button>
                  </div>

                  <div className="add-skill-row mb-12">
                    <input
                      type="text"
                      className="form-input sm"
                      placeholder="Skill name (e.g. Docker, SQL)"
                      value={addSkillInput}
                      onChange={(e) => setAddSkillInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddSkill()
                        }
                      }}
                    />
                    <select
                      className="form-input sm w-select-importance"
                      value={addSkillImportance}
                      onChange={(e) => setAddSkillImportance(e.target.value)}
                    >
                      <option value="Must">Must (3x)</option>
                      <option value="Should">Should (2x)</option>
                      <option value="Nice">Nice (1x)</option>
                    </select>
                    <button type="button" className="b sm g" onClick={handleAddSkill}>
                      Add
                    </button>
                  </div>

                  <div className="tag-cloud">
                    {newSkills.map((req) => (
                      <span key={req.skill} className="removable-tag">
                        <strong>{req.skill}</strong> ({req.importance})
                        <button
                          type="button"
                          onClick={() => handleRemoveSkill(req.skill)}
                          aria-label={`Remove ${req.skill}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Demo CV Viewer Input */}
                <div className="form-group">
                  <label className="form-label">Demo Candidate CV Reference</label>
                  <textarea
                    rows="3"
                    className="form-input sm"
                    placeholder="Paste reference resume text to map competencies against..."
                    value={newCv}
                    onChange={(e) => setNewCv(e.target.value)}
                  />
                </div>

                <div className="flex-end-mt20">
                  <button type="submit" className="b sm" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating role...' : 'Create Role'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
