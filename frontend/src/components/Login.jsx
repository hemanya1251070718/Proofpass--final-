/**
 * Login and Sign-up Page Component
 * Handles unified authentication, role selection (Applicant | Recruiter), onboarding forms,
 * and inline validation using the existing ProofPass card and token system.
 */

import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import Seg from './Seg.jsx'
import JobDescriptionImport from './JobDescriptionImport.jsx'
import { matchSkillsFromText, TAXONOMY } from '../data/taxonomy.js'

export default function Login() {
  const { login, signup } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Tab: 'login' | 'signup'
  const queryParams = new URLSearchParams(location.search)
  const initialTab = queryParams.get('tab') === 'signup' ? 'signup' : 'login'
  const [activeTab, setActiveTab] = useState(initialTab)

  // Role for Signup: 'applicant' | 'recruiter'
  const [signupRole, setSignupRole] = useState('applicant')

  // Common Fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  // Applicant Fields
  const [targetRole, setTargetRole] = useState('')
  const [hasNoWorkExp, setHasNoWorkExp] = useState(false)
  const [experiences, setExperiences] = useState([
    { title: '', organisation: '', duration: '', summary: '' },
  ])
  const [githubUrl, setGithubUrl] = useState('')
  const [leetcodeUrl, setLeetcodeUrl] = useState('')
  const [certificateLinks, setCertificateLinks] = useState('')

  // Recruiter Fields
  const [companyName, setCompanyName] = useState('')
  const [roleHiringFor, setRoleHiringFor] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  const [demoCvText, setDemoCvText] = useState('')
  const [demoCvFileName, setDemoCvFileName] = useState('')
  const [requiredSkills, setRequiredSkills] = useState([
    { skill: 'React', importance: 'Must', weight: 3 },
    { skill: 'TypeScript', importance: 'Must', weight: 3 },
  ])
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillImportance, setNewSkillImportance] = useState('Must')
  const [recruiterLocation, setRecruiterLocation] = useState('')
  const [recruiterWorkMode, setRecruiterWorkMode] = useState('')
  const [recruiterMinYears, setRecruiterMinYears] = useState(null)

  const handleApplyJdInSignup = (applied) => {
    if (applied.title) setRoleHiringFor(applied.title)
    if (applied.description) setRoleDescription(applied.description)
    if (applied.requiredSkills) setRequiredSkills(applied.requiredSkills)
    if (applied.location) setRecruiterLocation(applied.location)
    if (applied.workMode) setRecruiterWorkMode(applied.workMode)
    if (applied.minExperienceYears != null) setRecruiterMinYears(applied.minExperienceYears)
    setErrors((prev) => ({
      ...prev,
      roleHiringFor: null,
      roleDescription: null,
    }))
  }

  // Validation & Status
  const [errors, setErrors] = useState({})
  const [statusMessage, setStatusMessage] = useState(location.state?.notice || null)
  // Be honest about storage: the free demo deployment keeps data on an ephemeral filesystem.
  const [storageNote, setStorageNote] = useState(null)
  useEffect(() => {
    let live = true
    fetch('/api/v1/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h) => {
        if (live && h && h.persistent_storage === false) {
          setStorageNote('Demo deployment: accounts and passports are stored on temporary server storage and are erased whenever the app restarts or is redeployed.')
        }
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Experience Entry handlers for Applicant
  const handleExpChange = (idx, field, value) => {
    setExperiences((prev) => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: value }
      return copy
    })
    if (errors[`exp_${idx}_${field}`] || errors.experience) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[`exp_${idx}_${field}`]
        delete next.experience
        return next
      })
    }
  }

  const addExperienceEntry = () => {
    setExperiences((prev) => [
      ...prev,
      { title: '', organisation: '', duration: '', summary: '' },
    ])
  }

  const removeExperienceEntry = (idx) => {
    if (experiences.length <= 1) return
    setExperiences((prev) => prev.filter((_, i) => i !== idx))
  }

  // Recruiter Skill Suggestions
  const handleSuggestSkills = () => {
    if (!roleDescription || roleDescription.trim().length < 10) {
      setErrors((prev) => ({
        ...prev,
        roleDescription: 'Please enter a detailed description first to suggest matching skills.',
      }))
      return
    }
    const matched = matchSkillsFromText(roleDescription)
    if (matched.length === 0) {
      setStatusMessage('No common taxonomy keywords identified in the description text.')
      return
    }

    const existingNames = new Set(requiredSkills.map((s) => s.skill.toLowerCase()))
    const toAdd = matched
      .filter((m) => !existingNames.has(m.name.toLowerCase()))
      .map((m) => ({ skill: m.name, importance: 'Must', weight: 3 }))

    if (toAdd.length === 0) {
      setStatusMessage('All recognized skills are already added to your requirement list.')
      return
    }

    setRequiredSkills((prev) => [...prev, ...toAdd])
    setStatusMessage(`Suggested and added ${toAdd.length} skills from description text.`)
  }

  const handleAddSkillTag = () => {
    if (!newSkillName.trim()) return
    const clean = newSkillName.trim()
    if (requiredSkills.some((s) => s.skill.toLowerCase() === clean.toLowerCase())) {
      setNewSkillName('')
      return
    }
    const weight = newSkillImportance === 'Must' ? 3 : newSkillImportance === 'Should' ? 2 : 1
    setRequiredSkills((prev) => [
      ...prev,
      { skill: clean, importance: newSkillImportance, weight },
    ])
    setNewSkillName('')
  }

  const handleRemoveSkillTag = (skillToRemove) => {
    setRequiredSkills((prev) => prev.filter((s) => s.skill !== skillToRemove))
  }

  // File picker for demo CV
  const handleCvFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setDemoCvFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setDemoCvText(ev.target.result || `Uploaded file: ${file.name}`)
    }
    reader.readAsText(file)
  }

  // Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatusMessage(null)

    const errs = {}

    // Common validations
    if (!email.trim()) {
      errs.email = 'Email address is required.'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = 'Please enter a valid email address.'
    }

    if (!password) {
      errs.password = 'Password is required.'
    } else if (activeTab !== 'login' && password.length < 8) {
      errs.password = 'Password must be at least 8 characters.'
    }

    if (activeTab === 'signup') {
      if (!name.trim()) {
        errs.name = 'Full name is required.'
      }

      if (signupRole === 'applicant') {
        if (!targetRole.trim()) {
          errs.targetRole = 'Target role is required (e.g. Full Stack Engineer).'
        }

        // Validate experience entries
        let hasValidExp = false
        experiences.forEach((exp, idx) => {
          if (exp.title.trim() && exp.organisation.trim() && exp.summary.trim()) {
            hasValidExp = true
          }
        })

        if (!hasValidExp) {
          errs.experience = hasNoWorkExp
            ? 'Please provide at least one project or academic entry with title, organization, and summary.'
            : 'At least one work experience entry with title, organization, and summary is required.'
        }
      } else {
        // Recruiter validations
        if (!companyName.trim()) {
          errs.companyName = 'Company name is required.'
        }
        if (!roleHiringFor.trim()) {
          errs.roleHiringFor = 'Role title you are hiring for is required.'
        }
        if (!roleDescription.trim() || roleDescription.trim().length < 40) {
          errs.roleDescription = 'Requirement description must be at least 40 characters.'
        }
        if (!demoCvText.trim() && !demoCvFileName) {
          errs.demoCv = 'Please paste demo CV text or choose a CV file.'
        }
      }
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      if (activeTab === 'login') {
        const user = await login(email.trim(), password)
        const target = location.state?.from || (user.role === 'recruiter' ? '/recruiter' : '/dashboard')
        navigate(target, { replace: true })
      } else {
        // Sign-up payload
        const profile =
          signupRole === 'applicant'
            ? {
                targetRole: targetRole.trim(),
                hasNoWorkExp,
                experiences,
                githubUrl: githubUrl.trim(),
                leetcodeUrl: leetcodeUrl.trim(),
                certificateLinks: certificateLinks.trim(),
              }
            : {
                company: companyName.trim(),
                roleHiringFor: roleHiringFor.trim(),
                description: roleDescription.trim(),
                demoCv: demoCvText || demoCvFileName,
                requiredSkills,
                location: recruiterLocation || null,
                workMode: recruiterWorkMode || null,
                minExperienceYears: recruiterMinYears != null ? Number(recruiterMinYears) : null,
              }

        const user = await signup({
          role: signupRole,
          name: name.trim(),
          email: email.trim(),
          password,
          profile,
        })

        const dest = user.role === 'recruiter' ? '/recruiter' : '/dashboard'
        navigate(dest, { replace: true })
      }
    } catch (err) {
      setStatusMessage(err.message || 'Authentication failed. Please verify your details.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main id="main" className="login-page">
      <div className="w">
        <div className="login-card glass">
          <div className="login-header">
            <span className="k m">ACCOUNT ACCESS</span>
            <h1 className="login-title">
              {activeTab === 'login' ? 'Log in' : 'Create an account'}
            </h1>
            <p className="login-desc">
              {activeTab === 'login'
                ? 'Access your saved skill passport, evidence models, and verification history.'
                : 'Join ProofPass to verify candidate capabilities against ground-truth evidence.'}
            </p>
          </div>

          {/* Log in | Sign up Switcher */}
          <div className="login-header-tabs">
            <Seg
              items={[
                { id: 'login', label: 'Log in' },
                { id: 'signup', label: 'Sign up' },
              ]}
              value={activeTab}
              onChange={(tab) => {
                setActiveTab(tab)
                setErrors({})
                setStatusMessage(null)
              }}
              label="Authentication mode"
            />
          </div>

          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {/* Prototype Notice */}
            <div className="login-notice" role="status" aria-live="polite">
              <span className="notice-dot" aria-hidden="true" />
              <span>
                {statusMessage ||
                  storageNote ||
                  'Accounts and passports are stored on the ProofPass server. Resumes you submit are processed by the verification engine.'}
              </span>
            </div>

            {/* Role Picker for Sign up */}
            {activeTab === 'signup' && (
              <div className="signup-role-picker">
                <label className="form-label">I am an</label>
                <Seg
                  items={[
                    { id: 'applicant', label: 'Applicant' },
                    { id: 'recruiter', label: 'Recruiter' },
                  ]}
                  value={signupRole}
                  onChange={(r) => {
                    setSignupRole(r)
                    setErrors({})
                  }}
                  label="Account role"
                />
              </div>
            )}

            {/* Full Name (Sign-up only) */}
            {activeTab === 'signup' && (
              <div className="form-group">
                <label htmlFor="auth-name" className="form-label">
                  Full name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  name="name"
                  className={`form-input ${errors.name ? 'input-error' : ''}`}
                  placeholder="e.g. Alex Rivera"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (errors.name) setErrors((prev) => ({ ...prev, name: null }))
                  }}
                  aria-invalid={errors.name ? 'true' : 'false'}
                  required
                />
                {errors.name && <span className="field-error-msg">{errors.name}</span>}
              </div>
            )}

            {/* Email */}
            <div className="form-group">
              <label htmlFor="auth-email" className="form-label">
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                name="email"
                autoComplete="email"
                className={`form-input ${errors.email ? 'input-error' : ''}`}
                placeholder="name@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (errors.email) setErrors((prev) => ({ ...prev, email: null }))
                }}
                aria-invalid={errors.email ? 'true' : 'false'}
                required
              />
              {errors.email && <span className="field-error-msg">{errors.email}</span>}
            </div>

            {/* Password */}
            <div className="form-group">
              <label htmlFor="auth-password" className="form-label">
                Password {activeTab === 'login' && '(6+ characters)'}
              </label>
              <input
                id="auth-password"
                type="password"
                name="password"
                autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
                className={`form-input ${errors.password ? 'input-error' : ''}`}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errors.password) setErrors((prev) => ({ ...prev, password: null }))
                }}
                aria-invalid={errors.password ? 'true' : 'false'}
                required
              />
              {errors.password && <span className="field-error-msg">{errors.password}</span>}
            </div>

            {/* APPLICANT ONBOARDING FIELDS */}
            {activeTab === 'signup' && signupRole === 'applicant' && (
              <>
                <div className="form-group">
                  <label htmlFor="auth-target-role" className="form-label">
                    Target role
                  </label>
                  <input
                    id="auth-target-role"
                    type="text"
                    className={`form-input ${errors.targetRole ? 'input-error' : ''}`}
                    placeholder="e.g. Senior Full Stack TypeScript Engineer"
                    value={targetRole}
                    onChange={(e) => {
                      setTargetRole(e.target.value)
                      if (errors.targetRole) setErrors((prev) => ({ ...prev, targetRole: null }))
                    }}
                    required
                  />
                  {errors.targetRole && <span className="field-error-msg">{errors.targetRole}</span>}
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="form-label">
                      {hasNoWorkExp ? 'Project & Academic Experience' : 'Past Work Experience'}
                    </label>
                    <label style={{ fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="checkbox"
                        checked={hasNoWorkExp}
                        onChange={(e) => setHasNoWorkExp(e.target.checked)}
                      />
                      I have no work experience yet
                    </label>
                  </div>

                  {experiences.map((exp, idx) => (
                    <div key={idx} className="exp-entry-card">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '8px' }}>
                        <input
                          type="text"
                          className="form-input sm"
                          placeholder={hasNoWorkExp ? 'Project title' : 'Job title'}
                          value={exp.title}
                          onChange={(e) => handleExpChange(idx, 'title', e.target.value)}
                        />
                        <input
                          type="text"
                          className="form-input sm"
                          placeholder={hasNoWorkExp ? 'Institution or personal repo' : 'Organisation'}
                          value={exp.organisation}
                          onChange={(e) => handleExpChange(idx, 'organisation', e.target.value)}
                        />
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <input
                          type="text"
                          className="form-input sm"
                          placeholder="Duration (e.g. 2022 - Present)"
                          value={exp.duration}
                          onChange={(e) => handleExpChange(idx, 'duration', e.target.value)}
                        />
                      </div>
                      <textarea
                        className="form-input sm"
                        rows="2"
                        placeholder="Short summary of technologies used and achievements"
                        value={exp.summary}
                        onChange={(e) => handleExpChange(idx, 'summary', e.target.value)}
                      />
                      {experiences.length > 1 && (
                        <button
                          type="button"
                          className="b sm g"
                          style={{ marginTop: '6px', fontSize: '0.75rem', padding: '2px 8px' }}
                          onClick={() => removeExperienceEntry(idx)}
                        >
                          Remove entry
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="b sm g"
                    style={{ marginTop: '4px' }}
                    onClick={addExperienceEntry}
                  >
                    + Add another experience entry
                  </button>
                  {errors.experience && (
                    <span className="field-error-msg" style={{ display: 'block', marginTop: '6px' }}>
                      {errors.experience}
                    </span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="auth-github" className="form-label">
                    GitHub URL or handle <span style={{ color: 'var(--faint)' }}>(optional)</span>
                  </label>
                  <input
                    id="auth-github"
                    type="text"
                    className="form-input"
                    placeholder="https://github.com/username"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-leetcode" className="form-label">
                    LeetCode URL <span style={{ color: 'var(--faint)' }}>(optional)</span>
                  </label>
                  <input
                    id="auth-leetcode"
                    type="text"
                    className="form-input"
                    placeholder="https://leetcode.com/username"
                    value={leetcodeUrl}
                    onChange={(e) => setLeetcodeUrl(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-certs" className="form-label">
                    Certificate links or credentials <span style={{ color: 'var(--faint)' }}>(optional)</span>
                  </label>
                  <input
                    id="auth-certs"
                    type="text"
                    className="form-input"
                    placeholder="e.g. AWS Certified Cloud Practitioner (2023)"
                    value={certificateLinks}
                    onChange={(e) => setCertificateLinks(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* RECRUITER ONBOARDING FIELDS */}
            {activeTab === 'signup' && signupRole === 'recruiter' && (
              <>
                <div className="form-group">
                  <label htmlFor="auth-company" className="form-label">
                    Company name
                  </label>
                  <input
                    id="auth-company"
                    type="text"
                    className={`form-input ${errors.companyName ? 'input-error' : ''}`}
                    placeholder="e.g. Veloce Systems"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value)
                      if (errors.companyName) setErrors((prev) => ({ ...prev, companyName: null }))
                    }}
                    required
                  />
                  {errors.companyName && <span className="field-error-msg">{errors.companyName}</span>}
                </div>

                <div className="form-group">
                  <label htmlFor="auth-hiring-role" className="form-label">
                    Role hiring for
                  </label>
                  <input
                    id="auth-hiring-role"
                    type="text"
                    className={`form-input ${errors.roleHiringFor ? 'input-error' : ''}`}
                    placeholder="e.g. Senior Full Stack TypeScript Engineer"
                    value={roleHiringFor}
                    onChange={(e) => {
                      setRoleHiringFor(e.target.value)
                      if (errors.roleHiringFor) setErrors((prev) => ({ ...prev, roleHiringFor: null }))
                    }}
                    required
                  />
                  {errors.roleHiringFor && <span className="field-error-msg">{errors.roleHiringFor}</span>}
                </div>

                {/* Job Description Importer */}
                <JobDescriptionImport
                  currentValues={{
                    title: roleHiringFor,
                    description: roleDescription,
                    requiredSkills,
                    location: recruiterLocation,
                    workMode: recruiterWorkMode,
                    minExperienceYears: recruiterMinYears,
                  }}
                  onApply={handleApplyJdInSignup}
                />

                {(recruiterLocation || recruiterWorkMode || recruiterMinYears != null) && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {recruiterLocation && (
                      <span className="chip sm" style={{ fontSize: '0.72rem' }}>
                        📍 {recruiterLocation}
                      </span>
                    )}
                    {recruiterWorkMode && (
                      <span className="chip sm S" style={{ fontSize: '0.72rem' }}>
                        💼 {recruiterWorkMode}
                      </span>
                    )}
                    {recruiterMinYears != null && (
                      <span className="chip sm" style={{ fontSize: '0.72rem' }}>
                        ⏳ {recruiterMinYears}+ yrs exp
                      </span>
                    )}
                  </div>
                )}

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label htmlFor="auth-role-desc" className="form-label">
                      Requirement description (min 40 chars)
                    </label>
                    <button
                      type="button"
                      className="b sm g"
                      style={{ fontSize: '0.74rem', padding: '3px 8px' }}
                      onClick={handleSuggestSkills}
                    >
                      Suggest skills from description
                    </button>
                  </div>
                  <textarea
                    id="auth-role-desc"
                    rows="3"
                    className={`form-input ${errors.roleDescription ? 'input-error' : ''}`}
                    placeholder="Describe core technical requirements, expected architectural stack, and candidate seniority."
                    value={roleDescription}
                    onChange={(e) => {
                      setRoleDescription(e.target.value)
                      if (errors.roleDescription) setErrors((prev) => ({ ...prev, roleDescription: null }))
                    }}
                    required
                  />
                  {errors.roleDescription && <span className="field-error-msg">{errors.roleDescription}</span>}
                </div>

                {/* Weighted Required Skills Tags */}
                <div className="form-group">
                  <label className="form-label">
                    Required skills with importance <span style={{ color: 'var(--faint)' }}>(optional)</span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input sm"
                      placeholder="Add skill (e.g. Docker, Python)"
                      value={newSkillName}
                      onChange={(e) => setNewSkillName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handleAddSkillTag()
                        }
                      }}
                    />
                    <select
                      className="form-input sm"
                      style={{ width: '110px' }}
                      value={newSkillImportance}
                      onChange={(e) => setNewSkillImportance(e.target.value)}
                    >
                      <option value="Must">Must (3x)</option>
                      <option value="Should">Should (2x)</option>
                      <option value="Nice">Nice (1x)</option>
                    </select>
                    <button type="button" className="b sm g" onClick={handleAddSkillTag}>
                      Add
                    </button>
                  </div>

                  <div className="tag-cloud">
                    {requiredSkills.map((req) => (
                      <span key={req.skill} className="removable-tag">
                        <strong>{req.skill}</strong>
                        <span style={{ color: 'var(--faint)', fontSize: '0.7rem' }}>
                          ({req.importance})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSkillTag(req.skill)}
                          aria-label={`Remove ${req.skill}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Demo CV Upload or Paste */}
                <div className="form-group">
                  <label className="form-label">
                    Demo candidate CV <span style={{ color: 'var(--faint)' }}>(upload or paste)</span>
                  </label>
                  <div style={{ marginBottom: '8px' }}>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      onChange={handleCvFile}
                    />
                    {demoCvFileName && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--accent)', marginLeft: '8px' }}>
                        Selected: {demoCvFileName}
                      </span>
                    )}
                  </div>
                  <textarea
                    rows="3"
                    className={`form-input ${errors.demoCv ? 'input-error' : ''}`}
                    placeholder="Or paste demo resume text here (nothing leaves your browser)..."
                    value={demoCvText}
                    onChange={(e) => {
                      setDemoCvText(e.target.value)
                      if (errors.demoCv) setErrors((prev) => ({ ...prev, demoCv: null }))
                    }}
                  />
                  {errors.demoCv && <span className="field-error-msg">{errors.demoCv}</span>}
                </div>
              </>
            )}

            <div className="login-actions">
              <button type="submit" className="b login-submit-btn" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Connecting...'
                  : activeTab === 'login'
                  ? 'Log in'
                  : 'Complete sign up'}
              </button>
            </div>
          </form>

          <div className="login-footer">
            <Link to="/" className="back-home-link">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
