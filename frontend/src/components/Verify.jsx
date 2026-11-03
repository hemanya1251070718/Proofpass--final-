import { useEffect, useLayoutEffect, useRef, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import gsap from 'gsap'
import Passport3D from './Passport3D.jsx'
import HalfStepper from './HalfStepper.jsx'
import VerifyBackground from './VerifyBackground.jsx'
import LockedStage from './LockedStage.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import VerificationChatbot from './VerificationChatbot.jsx'
import { RM, scroller } from '../lib.js'
import { L } from '../data.js'
import { matchSkillsFromText } from '../data/taxonomy.js'
import { validateIntake, SAMPLE_RESUME_TEXT, SAMPLE_TARGET_ROLE } from '../engine/index.js'
import {
  GITHUB_URL_RE,
  buildMicroChecks,
  buildRoleMatch,
  buildStepData,
  checkIntegrity,
  fetchQuiz,
  issuePassport,
  skillStatesFromPassport,
  submitQuizAnswer,
  verifyStoredPassport,
} from '../engine/backendVerification.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { normalizePassport } from '../api/passports.js'
import { buildRoadmapsForGaps } from '../lib/roadmap.js'
import { saveRoadmapsFromVerification, updateRoadmapStep } from '../api/roadmaps.js'
import { getGitHubSession, logoutGitHubSession, getAuthConfig } from '../api/auth.js'
import { attachEvidenceDetailsToPassport, buildSkillEvidenceDetails } from '../lib/evidenceDetails.js'
import { EvidenceCard } from './EvidenceCard.jsx'

const STEP_DEFINITIONS = [
  { id: 0, title: 'Intake', subtitle: 'Form and consent' },
  { id: 1, title: 'Read', subtitle: 'Parse resume and repo' },
  { id: 2, title: 'Propose', subtitle: 'Model skill pointers' },
  { id: 3, title: 'Check evidence', subtitle: 'Hash and file check' },
  { id: 4, title: 'Authorship', subtitle: 'Blame and usage depth' },
  { id: 5, title: 'Assign states', subtitle: 'Trust ceilings' },
  { id: 6, title: 'Micro-checks', subtitle: 'Code trade-off questions' },
  { id: 7, title: 'Role match', subtitle: 'Evidence-weighted match' },
  { id: 8, title: 'Issue passport', subtitle: 'SHA-256 seal' },
]

export default function Verify() {
  const [currentStep, setCurrentStep] = useState(0)
  const [highestUnlockedStep, setHighestUnlockedStep] = useState(0)
  const [stepStatus, setStepStatus] = useState({
    0: 'running',
    1: 'waiting',
    2: 'waiting',
    3: 'waiting',
    4: 'waiting',
    5: 'waiting',
    6: 'waiting',
    7: 'waiting',
    8: 'waiting',
  })

  // Live log lines and chatbot visibility
  const [logs, setLogs] = useState([
    `[${new Date().toLocaleTimeString()}] System ready. Step 0 (Intake) active. Please provide a resume and evidence source.`,
  ])
  const [showLogChat, setShowLogChat] = useState(false)
  const [hasStartedVerification, setHasStartedVerification] = useState(false)
  const [previewStep, setPreviewStep] = useState(null)
  const [rattleCount, setRattleCount] = useState(0)

  const isFirstMount = useRef(true)
  const stepHeadingRef = useRef(null)

  // Clear preview automatically whenever the real step changes
  useEffect(() => {
    setPreviewStep(null)
  }, [currentStep])

  // Close verification log when real currentStep changes (skipping initial mount)
  const isFirstStepChange = useRef(true)
  useEffect(() => {
    if (isFirstStepChange.current) {
      isFirstStepChange.current = false
      return
    }
    setShowLogChat(false)
  }, [currentStep])

  // Reset page and inner container scrolls to top immediately when currentStep changes
  useLayoutEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }

    if (scroller.lenis) {
      scroller.lenis.scrollTo(0, { immediate: true, force: true })
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }

    if (contentCardRef.current) {
      const scrollContainers = contentCardRef.current.querySelectorAll(
        '.table-card, .table-wrapper, .data-table-wrapper, [style*="overflow"], table'
      )
      scrollContainers.forEach((el) => {
        el.scrollTop = 0
        el.scrollLeft = 0
      })
    }

    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus({ preventScroll: true })
    }
  }, [currentStep])

  // Cursor spotlight on glass and background dot grid
  useEffect(() => {
    let rafId = null
    let latestEvt = null

    const handlePointerMove = (e) => {
      latestEvt = e
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (!latestEvt) return
          const ev = latestEvt
          latestEvt = null
          rafId = null

          // Set global cursor coordinates for background dot grid mask
          document.documentElement.style.setProperty('--px', `${ev.clientX}px`)
          document.documentElement.style.setProperty('--py', `${ev.clientY}px`)

          // Set per-card spotlight coordinates for .glass elements
          const glassCards = document.querySelectorAll('.glass')
          glassCards.forEach((card) => {
            const rect = card.getBoundingClientRect()
            const mx = ev.clientX - rect.left
            const my = ev.clientY - rect.top
            card.style.setProperty('--mx', `${mx}px`)
            card.style.setProperty('--my', `${my}px`)
          })
        })
      }
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [])

  const { user } = useAuth()

  // Form State (Step 0)
  const [resumeMode, setResumeMode] = useState('paste')
  const [resumeText, setResumeText] = useState('')
  const [resumeFile, setResumeFile] = useState(null)
  const [isExtractingResume, setIsExtractingResume] = useState(false)
  const [extractedResumeInfo, setExtractedResumeInfo] = useState(null)
  const [evidenceMode, setEvidenceMode] = useState('github')
  const [githubUser, setGithubUser] = useState(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [authError, setAuthError] = useState(null)
  const [authAnnouncement, setAuthAnnouncement] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const backendRef = useRef(null) // the backend's response for this run: the only source of states, hashes and scores
  const [targetRole, setTargetRole] = useState('')
  const [consentAi, setConsentAi] = useState(false)
  const [consentRepo, setConsentRepo] = useState(false)
  const [formErrors, setFormErrors] = useState({})


  // Check active GitHub session and handle OAuth callback query parameters
  useEffect(() => {
    let mounted = true

    const params = new URLSearchParams(window.location.search)
    const errParam = params.get('auth_error')
    const successParam = params.get('auth_success')

    if (errParam) {
      const errMessages = {
        cancelled: 'GitHub connection was cancelled. You can try connecting again.',
        state_mismatch: 'Security validation failed (state mismatch). Please try again.',
        github_down: 'GitHub service was unreachable. Please try again in a few moments.',
        token_exchange_failed: 'Failed to exchange authorization code with GitHub. Please try again.',
        state_missing: 'Missing authentication state parameter. Please try again.',
        invalid_user: 'Could not retrieve verified user profile from GitHub.',
      }
      const msg = errMessages[errParam] || 'Authentication failed. Please try connecting again.'
      setAuthError(msg)
      setAuthAnnouncement(msg)
      window.history.replaceState({}, '', window.location.pathname)
    } else if (successParam) {
      setAuthAnnouncement('GitHub account connected successfully.')
      window.history.replaceState({}, '', window.location.pathname)
    }

    async function checkSession() {
      setIsCheckingAuth(true)
      try {
        const gh = await getGitHubSession()
        if (mounted && gh) {
          setGithubUser(gh)
          setAuthError(null)
          addLog(`Authenticated GitHub session detected for @${gh.github_login}.`)
        }
      } catch {
        // Not authenticated
      } finally {
        if (mounted) setIsCheckingAuth(false)
      }
    }

    checkSession()
    return () => {
      mounted = false
    }
  }, [])

  const handleConnectGitHub = async () => {
    setAuthError(null)
    try {
      const config = await getAuthConfig()
      if (!config?.github_oauth_configured) {
        setAuthError('GitHub sign-in is not configured on this server. Use a public GitHub URL instead (Ownership Unverified).')
        return
      }
    } catch {
      setAuthError('GitHub sign-in is not configured on this server. Use a public GitHub URL instead (Ownership Unverified).')
      return
    }

    setAuthAnnouncement('Redirecting to GitHub authorization...')
    window.location.href = '/api/v1/auth/github/start'
  }

  const handleDisconnectGitHub = async () => {
    await logoutGitHubSession()
    setGithubUser(null)
    setAuthError(null)
    setAuthAnnouncement('GitHub account disconnected.')
    addLog('GitHub account disconnected.')
  }

  // Prefill from user profile if available
  useEffect(() => {
    if (user?.profile?.targetRole && !targetRole) {
      setTargetRole(user.profile.targetRole)
    }
    if (user?.profile?.experience && !resumeText && !resumeFile) {
      const exp = user.profile.experience
      const expText = Array.isArray(exp)
        ? exp.map((e) => `${e.title || 'Role'} at ${e.org || 'Organization'} (${e.duration || 'Period'})\n${e.summary || ''}`).join('\n\n')
        : String(exp)
      if (expText.trim()) {
        setResumeText(`${user.name || 'Candidate'}\nTarget: ${user.profile?.targetRole || ''}\n\nExperience:\n${expText}`)
      }
    }
  }, [user])

  // Pipeline Data Storage
  const [intakeData, setIntakeData] = useState(null)
  const [readData, setReadData] = useState(null)
  const [proposeData, setProposeData] = useState(null)
  const [evidenceData, setEvidenceData] = useState(null)
  const [authorshipData, setAuthorshipData] = useState(null)
  const [statesData, setStatesData] = useState(null)
  const [microChecks, setMicroChecks] = useState([])
  const [roleMatchData, setRoleMatchData] = useState(null)
  const [passportData, setPassportData] = useState(null)

  // Step Execution & Error states
  const [stepError, setStepError] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Step 8 Verification / Tamper state
  const [hashCheckResult, setHashCheckResult] = useState(null)
  const [activeResultTab, setActiveResultTab] = useState('Candidate')
  const [expandedResultSkills, setExpandedResultSkills] = useState({})

  const toggleResultSkillExpand = (skillName) => {
    setExpandedResultSkills((prev) => ({
      ...prev,
      [skillName]: !prev[skillName],
    }))
  }

  // Step 5 Evidence verification expansion state
  const [expandedStep5Skills, setExpandedStep5Skills] = useState({})
  const toggleStep5SkillExpand = (skillName) => {
    setExpandedStep5Skills((prev) => ({
      ...prev,
      [skillName]: !prev[skillName],
    }))
  }

  // Step 7 Close your gaps roadmaps state
  const [openGapSkill, setOpenGapSkill] = useState(null)
  const [roadmapsStepDone, setRoadmapsStepDone] = useState({})

  // Idempotently sync roadmaps when Step 7 completes
  useEffect(() => {
    if (currentStep === 7 && roleMatchData?.rankedGaps && intakeData?.targetRole) {
      saveRoadmapsFromVerification(user?.id, intakeData.targetRole, roleMatchData.rankedGaps).catch((err) =>
        console.warn('Failed to sync roadmaps in Step 7:', err)
      )
    }
  }, [currentStep, roleMatchData, intakeData?.targetRole, user?.id])

  // Refs for animations and auto-scroll
  const contentCardRef = useRef(null)
  const logTerminalRef = useRef(null)
  const progressDummy = useRef(0)

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${time}] ${message}`])
  }

  // Auto-scroll log console
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight
    }
  }, [logs])

  // GSAP Step Transition animation
  useEffect(() => {
    if (RM || !contentCardRef.current) return
    gsap.fromTo(
      contentCardRef.current,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }
    )
  }, [currentStep])

  // Helper to load sample data for rapid testing
  const handleLoadSample = () => {
    setResumeMode('paste')
    setResumeText(SAMPLE_RESUME_TEXT)
    setTargetRole(SAMPLE_TARGET_ROLE)
    setConsentAi(true)
    setConsentRepo(true)
    setFormErrors({})
    setExtractedResumeInfo(null)
    addLog('Sample resume text and target role loaded. Evidence still comes from your own GitHub account.')
  }

  // Pre-extract resume file via PyMuPDF backend upon upload
  const handleResumeFileChange = async (file) => {
    setResumeFile(file)
    setExtractedResumeInfo(null)
    if (!file) return

    setIsExtractingResume(true)
    addLog(`Uploading ${file.name} to ProofPass backend for PyMuPDF text & skill extraction...`)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/v1/extract-resume', {
        method: 'POST',
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        if (data.text) {
          setResumeText(data.text)
          // Supplement with local taxonomy matches if any are present in text
          const localTaxonomySkills = matchSkillsFromText(data.text).map((t) => t.name)
          const allSkills = Array.from(new Set([...(data.claimed_skills || []), ...localTaxonomySkills]))
          data.claimed_skills = allSkills
        }
        setExtractedResumeInfo(data)
        addLog(`PyMuPDF extraction success: Identified ${data.claimed_skills.length} skills in ${file.name}: ${data.claimed_skills.join(', ')}`)
      } else {
        const err = await res.text()
        addLog(`Backend notice (${res.status}): ${err}`)
      }
    } catch (err) {
      addLog(`Backend service notice (${err.message}). Step 1 will execute fallback.`)
    } finally {
      setIsExtractingResume(false)
    }
  }

  // STEP 0: validate the intake, then let the backend do the work.
  const handleStartVerification = async () => {
    const mode = evidenceMode === 'github' && githubUser ? 'oauth' : 'url'
    const urlOk = GITHUB_URL_RE.test(publicUrl.trim())
    const formPayload = {
      resumeText: resumeText || extractedResumeInfo?.text || '',
      resumeFile,
      extractedSections: extractedResumeInfo?.sections || null,
      mode,
      githubUrl: mode === 'oauth' ? `https://github.com/${githubUser.github_login}` : publicUrl.trim(),
      githubUser: mode === 'oauth' ? githubUser : null,
      targetRole,
      consentAi,
      consentRepo,
    }

    const { valid, errors } = validateIntake({
      ...formPayload,
      githubUrl: mode === 'oauth' || urlOk ? formPayload.githubUrl : '',
    })
    if (!valid) {
      setFormErrors(errors)
      addLog('Validation error: Required intake fields are incomplete or consent is missing.')
      return
    }

    setFormErrors({})
    setIntakeData(formPayload)
    setHasStartedVerification(true)
    setStepStatus((s) => ({ ...s, 0: 'done', 1: 'running' }))
    setHighestUnlockedStep((h) => Math.max(h, 1))
    setCurrentStep(1)
    addLog(
      mode === 'oauth'
        ? `Intake validated. GitHub ownership is authenticated (@${githubUser.github_login}).`
        : 'Intake validated. Public GitHub URL supplied: ownership is NOT verified, so no skill can become Verified.'
    )
    runStep1(formPayload)
  }

  // STEP 1: the backend reads the resume and GitHub, verifies every claim and seals the passport.
  const runStep1 = async (inputForm) => {
    setIsProcessing(true)
    setStepError(null)
    setStepStatus((s) => ({ ...s, 1: 'running' }))
    const form = inputForm || intakeData

    try {
      addLog('Sending resume and GitHub source to the ProofPass verification engine...')
      const resp = await issuePassport({
        mode: form.mode,
        resumeText: form.resumeText,
        githubUrl: form.githubUrl,
        targetRole: form.targetRole,
        consent: form.consentAi && form.consentRepo,
      })
      const steps = buildStepData(resp, form)
      backendRef.current = { resp, steps }
      setReadData(steps.readData)
      setStepStatus((s) => ({ ...s, 1: 'done' }))
      setHighestUnlockedStep((h) => Math.max(h, 2))
      addLog(`Backend read ${steps.readData.skillsCount} resume claims and ${steps.readData.repoCount} repositories. Passport ${resp.passport_id} issued.`)
    } catch (err) {
      backendRef.current = null
      setStepError(`Step 1 Read Error: ${err.message}`)
      setStepStatus((s) => ({ ...s, 1: 'flagged' }))
      addLog(`Error in Step 1: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // STEPS 2-4 reveal what the backend already computed; nothing is recalculated in the browser.
  const revealStep = (n, setter, key, flaggedWhen) => async () => {
    const steps = backendRef.current?.steps
    if (!steps) {
      setStepError('No verification result is available. Restart the verification.')
      return
    }
    setStepError(null)
    setter(steps[key])
    setStepStatus((s) => ({ ...s, [n]: flaggedWhen?.(steps[key]) ? 'flagged' : 'done' }))
    setHighestUnlockedStep((h) => Math.max(h, n + 1))
    addLog(`Step ${n} loaded from the backend verification result.`)
  }
  const runStep2 = revealStep(2, setProposeData, 'proposeData')
  const runStep3 = revealStep(3, setEvidenceData, 'evidenceData', (d) => d.flaggedCount > 0)
  const runStep4 = revealStep(4, setAuthorshipData, 'authorshipData')

  const runStep5 = async () => {
    const steps = backendRef.current?.steps
    if (!steps) return
    setIsProcessing(true)
    setStepError(null)
    try {
      setStatesData(steps.statesData)
      let questions = []
      try {
        questions = await fetchQuiz(backendRef.current.resp.passport_id)
      } catch (err) {
        addLog(`Micro-check questions unavailable: ${err.message}`)
      }
      setMicroChecks(buildMicroChecks(questions, steps.statesData.skillStates))
      setStepStatus((s) => ({ ...s, 5: 'done' }))
      setHighestUnlockedStep((h) => Math.max(h, 6))
      const c = steps.statesData.counts
      addLog(`Step 5: backend states -> ${c.V} Verified, ${c.S} Supported, ${c.C} Claimed, ${c.X} Contradicted.`)
    } finally {
      setIsProcessing(false)
    }
  }

  // STEP 6: the backend grades the answer; a skill only changes state if the backend says so.
  const handleAnswerMicroCheck = async (skillName, answer) => {
    const target = microChecks.find((m) => m.skill === skillName)
    if (!target || !backendRef.current) return
    const pid = backendRef.current.resp.passport_id
    setIsProcessing(true)
    try {
      const out = await submitQuizAnswer(pid, target.questionId, answer)
      const passed = Boolean(out.results?.[0]?.passed)
      const feedback = out.results?.[0]?.feedback || ''
      setMicroChecks((prev) =>
        prev.map((m) => (m.skill === skillName ? { ...m, answered: true, passed, userAnswer: answer, feedback } : m))
      )

      const { resp } = backendRef.current
      const updated = { ...resp, passport: out.passport, sha256_hash: out.updated_hash, role_match_score: out.updated_role_match_score }
      const skillStates = skillStatesFromPassport(out.passport, resp.evidence, resp.claims)
      const counts = { V: 0, S: 0, C: 0, X: 0 }
      skillStates.forEach((s) => {
        counts[s.state] += 1
      })
      const nextStates = { skillStates, counts, totalSkills: skillStates.length }
      backendRef.current = {
        resp: updated,
        steps: { ...backendRef.current.steps, statesData: nextStates, roleMatchData: buildRoleMatch(out.passport, skillStates) },
      }
      setStatesData(nextStates)
      addLog(`Micro-check for ${skillName}: ${passed ? 'accepted' : 'not accepted'} by the backend.`)
    } catch (err) {
      setMicroChecks((prev) =>
        prev.map((m) =>
          m.skill === skillName
            ? { ...m, answered: true, passed: false, userAnswer: answer, feedback: `The backend could not grade this answer: ${err.message}` }
            : m
        )
      )
    } finally {
      setIsProcessing(false)
    }
  }

  const completeStep6 = () => {
    setStepStatus((s) => ({ ...s, 6: 'done' }))
    setHighestUnlockedStep((h) => Math.max(h, 7))
    setCurrentStep(7)
    runStep7()
  }

  // STEP 7: backend role match.
  const runStep7 = async () => {
    if (!backendRef.current) return
    setRoleMatchData(backendRef.current.steps.roleMatchData)
    setStepStatus((s) => ({ ...s, 7: 'done' }))
    setHighestUnlockedStep((h) => Math.max(h, 8))
  }

  // STEP 8: show the passport exactly as the backend sealed and stored it.
  const runStep8 = async () => {
    if (!backendRef.current) return
    setIsProcessing(true)
    setStepError(null)
    try {
      const { resp } = backendRef.current
      const stored = await fetch(`/api/v1/passports/${encodeURIComponent(resp.passport_id)}`, { credentials: 'same-origin' })
      if (!stored.ok) throw new Error('The sealed passport could not be read back from the server.')
      const detail = await stored.json()
      const passport = normalizePassport({ ...detail.passport, ...detail })
      passport.candidateName = user?.name
      setPassportData({ passport, hash: detail.sha256_hash, tampered: false, sealedPayload: detail.passport })
      setStepStatus((s) => ({ ...s, 8: 'done' }))
      addLog('Passport issued and sealed by the backend. Read back from the database.')
    } catch (err) {
      setStepError(`Step 8 Issue Passport Error: ${err.message}`)
      setStepStatus((s) => ({ ...s, 8: 'flagged' }))
      addLog(`Error in Step 8: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // Server-side integrity check of the stored passport.
  const handleVerifyHash = async () => {
    if (!passportData) return
    setHashCheckResult({ valid: null, message: 'Checking integrity on the server...' })
    try {
      const res = await verifyStoredPassport(passportData.passport.id)
      setHashCheckResult({ valid: res.valid, message: res.message })
      addLog(`Hash Check: ${res.message}`)
    } catch (err) {
      setHashCheckResult({ valid: false, message: `Check failed: ${err.message}` })
    }
  }

  // Tamper demonstration: edit a COPY of the sealed payload and ask the backend whether the seal still matches.
  const handleSimulateTamper = async () => {
    if (!passportData?.sealedPayload) return
    setHashCheckResult({ valid: null, message: 'Recomputing the hash of an edited copy on the server...' })
    try {
      const copy = JSON.parse(JSON.stringify(passportData.sealedPayload))
      if (copy.skills?.length) {
        copy.skills[0].claim_state = copy.skills[0].claim_state === 'Verified' ? 'Supported' : 'Verified'
      }
      const res = await checkIntegrity(copy, passportData.hash)
      setHashCheckResult({
        valid: res.valid,
        message: res.valid
          ? 'Unexpected: the edited copy still matches.'
          : 'Hash mismatch. The edited copy no longer matches the sealed hash. Tamper detected.',
      })
      addLog(`Tamper Simulation: edited a copy of the first skill; recomputed ${res.computed_hash.slice(0, 16)}... != sealed ${passportData.hash.slice(0, 16)}...`)
    } catch (err) {
      setHashCheckResult({ valid: false, message: `Check failed: ${err.message}` })
    }
  }

  // Stepper navigation
  const handleStepSelect = (stepId) => {
    // Clicking a completed stage goes back to it
    if (stepId <= highestUnlockedStep) {
      setCurrentStep(stepId)
      setPreviewStep(null)
    }
  }

  const handleStepPreview = (stepId) => {
    if (stepId > currentStep) {
      setPreviewStep(stepId)
      setRattleCount((c) => c + 1)
    }
  }

  const intakeValid = validateIntake({
    resumeText,
    resumeFile,
    githubUser: evidenceMode === 'github' ? githubUser : null,
    githubUrl: evidenceMode === 'url' && GITHUB_URL_RE.test(publicUrl.trim()) ? publicUrl.trim() : '',
    targetRole,
    consentAi,
    consentRepo,
  }).valid
  const allChecksAnswered = microChecks.every((m) => m.answered)

  const GateHint = ({ show, text }) =>
    show ? <span className="gate-hint m">{text}</span> : null

  return (
    <div className="verify-page">
      {/* Living Interactive Background */}
      <VerifyBackground currentStep={currentStep} />

      {/* Half-circle pipeline dial (portals to document.body) */}
      <HalfStepper
        steps={STEP_DEFINITIONS}
        current={currentStep}
        status={stepStatus}
        previewStep={previewStep}
        onSelect={handleStepSelect}
        onPreview={handleStepPreview}
        onClearPreview={() => setPreviewStep(null)}
      />

      <div className="w verify-layout">
        <main className="verify-main-content">
          <div className="step-card glass" ref={contentCardRef} hidden={previewStep !== null}>
            {/* Step Header with aria-live and Show/Hide log chatbot toggle */}
            <div className="step-card-header">
              <div>
                <span className="k m">STEP 0{currentStep} / 08</span>
                <h2 ref={stepHeadingRef} tabIndex={-1} style={{ outline: 'none' }}>{STEP_DEFINITIONS[currentStep].title}</h2>
              </div>
              <div className="step-card-header-right">
                <button
                  type="button"
                  className={`log-toggle-header-btn ${showLogChat ? 'active' : ''}`}
                  onClick={() => setShowLogChat((prev) => !prev)}
                  aria-expanded={showLogChat}
                  title={showLogChat ? 'Hide live verification log chatbot' : 'Show live verification log chatbot in right corner'}
                >
                  <span className={`log-indicator-dot ${isProcessing ? 'pulsing' : ''}`} />
                  <span>{showLogChat ? 'Hide Verification Log' : 'Show Verification Log'}</span>
                  <span className="log-count-pill m">{logs.length}</span>
                </button>
                <div className="step-status-indicator m" aria-live="polite">
                  STATUS: {stepStatus[currentStep].toUpperCase()}
                </div>
              </div>
            </div>

            {/* Error Message with Retry Button */}
            {stepError && (
              <div className="step-error-banner" role="alert">
                <strong>Step Alert:</strong> {stepError}
                <button
                  type="button"
                  className="b sm"
                  onClick={() => {
                    if (currentStep === 1) runStep1()
                    else if (currentStep === 2) runStep2()
                    else if (currentStep === 3) runStep3()
                    else if (currentStep === 4) runStep4()
                    else if (currentStep === 5) runStep5()
                    else if (currentStep === 7) runStep7()
                    else if (currentStep === 8) runStep8()
                  }}
                >
                  Retry step
                </button>
              </div>
            )}

            {/* STEP 0: INTAKE FORM */}
            {currentStep === 0 && (
              <div className="intake-form-pane">
                <p className="step-desc">
                  Provide candidate resume, code evidence source, and target role to initialize the deterministic verification pipeline.
                </p>

                <div className="preset-bar">
                  <span className="m">Testing shortcut:</span>
                  <button type="button" className="b g sm" onClick={handleLoadSample}>
                    Load sample candidate input
                  </button>
                </div>

                {/* 1. Resume Input */}
                <div className="form-group">
                  <label className="form-label">
                    1. Candidate Resume <span className="req">*</span>
                  </label>
                  <div className="mode-toggle">
                    <button
                      type="button"
                      className={`mode-btn ${resumeMode === 'paste' ? 'on' : ''}`}
                      onClick={() => setResumeMode('paste')}
                    >
                      Paste resume text
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${resumeMode === 'upload' ? 'on' : ''}`}
                      onClick={() => setResumeMode('upload')}
                    >
                      Upload PDF or DOCX
                    </button>
                  </div>

                  {resumeMode === 'paste' ? (
                    <textarea
                      rows={6}
                      className="form-textarea"
                      placeholder="Paste resume text including summary, technical skills, and work history..."
                      value={resumeText}
                      onChange={(e) => setResumeText(e.target.value)}
                    />
                  ) : (
                    <div className="file-input-wrapper">
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt"
                        onChange={(e) => handleResumeFileChange(e.target.files?.[0])}
                      />
                      {isExtractingResume && (
                        <div className="m file-hint" style={{ color: '#38bdf8', marginTop: '6px' }}>
                          ⚡ Extracting text & technical skills via PyMuPDF backend...
                        </div>
                      )}
                      {resumeFile && !isExtractingResume && (
                        <span className="m file-hint" style={{ display: 'block', marginTop: '6px' }}>
                          Selected: <strong>{resumeFile.name}</strong> ({(resumeFile.size / 1024).toFixed(1)} KB)
                        </span>
                      )}
                      {extractedResumeInfo && !isExtractingResume && (
                        <div
                          style={{
                            marginTop: '10px',
                            padding: '10px 12px',
                            background: 'rgba(16, 185, 129, 0.08)',
                            borderRadius: '8px',
                            border: '1px solid rgba(16, 185, 129, 0.25)',
                          }}
                        >
                          <div style={{ fontSize: '0.82rem', color: '#10b981', fontWeight: 600, marginBottom: '6px' }}>
                            ✓ PyMuPDF Extracted: {extractedResumeInfo.char_count.toLocaleString()} chars · {extractedResumeInfo.claimed_skills.length} skills detected
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {extractedResumeInfo.claimed_skills.map((s) => (
                              <span
                                key={s}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.3)',
                                  fontWeight: 500,
                                }}
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {formErrors.resume && <p className="field-error">{formErrors.resume}</p>}
                </div>

                {/* 2. Evidence Source */}
                <div className="form-group">
                  <label className="form-label">
                    2. Code Evidence Source <span className="req">*</span>
                  </label>
                  <div className="mode-toggle">
                    <button
                      type="button"
                      className={`mode-btn ${evidenceMode === 'github' ? 'on' : ''}`}
                      onClick={() => setEvidenceMode('github')}
                    >
                      Connect GitHub (verified ownership)
                    </button>
                    <button
                      type="button"
                      className={`mode-btn ${evidenceMode === 'url' ? 'on' : ''}`}
                      onClick={() => setEvidenceMode('url')}
                    >
                      Public GitHub URL (Ownership Unverified)
                    </button>
                  </div>

                  {evidenceMode === 'github' ? (
                    <div style={{ marginTop: '8px' }}>
                      {githubUser ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            background: 'var(--surface-2)',
                            border: '1px solid var(--line)',
                            borderRadius: '8px',
                            minHeight: '44px',
                            gap: '12px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            {githubUser.avatar_url && (
                              <img
                                src={githubUser.avatar_url}
                                alt={`Avatar for ${githubUser.github_login}`}
                                style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }}
                              />
                            )}
                            <span style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 500 }}>
                              Connected as @{githubUser.github_login}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleDisconnectGitHub}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              fontSize: '0.85rem',
                              padding: '8px 12px',
                              minHeight: '44px',
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                            aria-label="Disconnect GitHub account"
                          >
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <div>
                          <button
                            type="button"
                            className="b g"
                            onClick={handleConnectGitHub}
                            disabled={isCheckingAuth}
                            style={{
                              minHeight: '44px',
                              width: '100%',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: isCheckingAuth ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isCheckingAuth ? 'Checking session...' : 'Connect GitHub'}
                          </button>
                          {authError && (
                            <div
                              style={{
                                marginTop: '8px',
                                padding: '8px 12px',
                                background: 'rgba(239, 68, 68, 0.08)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                color: 'var(--red, #ef4444)',
                                fontSize: '0.82rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px',
                                flexWrap: 'wrap',
                              }}
                              role="alert"
                            >
                              <span>{authError}</span>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                  type="button"
                                  onClick={handleConnectGitHub}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'inherit',
                                    textDecoration: 'underline',
                                    cursor: 'pointer',
                                    fontSize: '0.82rem',
                                    padding: '4px 8px',
                                    minHeight: '44px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                  }}
                                >
                                  Retry
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: '8px' }}>
                      <input
                        type="url"
                        className="form-input"
                        placeholder="https://github.com/your-username"
                        value={publicUrl}
                        onChange={(e) => setPublicUrl(e.target.value)}
                        aria-describedby="url-ownership-note"
                      />
                      <span id="url-ownership-note" className="form-hint m" style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: 4, display: 'block' }}>
                        Ownership of this URL is not proven. The passport will be labelled "Ownership Unverified" and no skill can reach Verified.
                      </span>
                    </div>
                  )}
                  {formErrors.evidence && <p className="field-error">{formErrors.evidence}</p>}
                </div>

                <p className="form-hint m" style={{ fontSize: '0.8rem', opacity: 0.8, margin: '0 0 12px' }}>
                  Coding-platform profiles, certificates and ZIP uploads are not verified by the backend, so they are not accepted as evidence.
                </p>

                {/* 5. Target Role */}
                <div className="form-group">
                  <label className="form-label">
                    3. Target Role or Job Description <span className="req">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Senior Full Stack TypeScript Engineer"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                  />
                  {formErrors.targetRole && <p className="field-error">{formErrors.targetRole}</p>}
                </div>

                {/* 5. Consents */}
                <div className="form-group consent-group">
                  <label className="consent-label">
                    <input
                      type="checkbox"
                      checked={consentAi}
                      onChange={(e) => setConsentAi(e.target.checked)}
                    />
                    <span>
                      I consent to language model analysis of resume text and extracted code snippets for evidence proposal.
                    </span>
                  </label>
                  {formErrors.consentAi && <p className="field-error">{formErrors.consentAi}</p>}

                  <label className="consent-label">
                    <input
                      type="checkbox"
                      checked={consentRepo}
                      onChange={(e) => setConsentRepo(e.target.checked)}
                    />
                    <span>
                      I grant read-only access to inspect repository file trees, commit metadata, and blame history.
                    </span>
                  </label>
                  {formErrors.consentRepo && <p className="field-error">{formErrors.consentRepo}</p>}
                </div>

                <div className="step-actions">
                  <button type="button" className="b mg verify-submit-btn" onClick={handleStartVerification} disabled={!intakeValid}>
                    Verify & Start Pipeline <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={!intakeValid} text="Fill every required field and both consents to continue." />
                </div>
              </div>
            )}

            {/* STEP 1: READ */}
            {currentStep === 1 && readData && (
              <div className="step-pane">
                <p className="step-desc">
                  Parsing resume sections, identifying claimed skills, and cataloguing repository source files.
                </p>

                <div className="io-grid">
                  <div className="io-box">
                    <span className="io-tag m">INPUTS</span>
                    <p><strong>Resume:</strong> {intakeData?.resumeFile?.name || 'Pasted text input'}</p>
                    <p><strong>Evidence:</strong> {intakeData?.githubUrl} {intakeData?.mode === 'oauth' ? '(GitHub ownership verified)' : '(Ownership Unverified)'}</p>
                    <p><strong>Target Role:</strong> {intakeData?.targetRole}</p>
                  </div>
                  <div className="io-box">
                    <span className="io-tag m">OUTPUTS (COUNTS)</span>
                    <p><strong>Resume Sections Parsed:</strong> {readData.sectionCount}</p>
                    <p><strong>Claimed Skills Identified:</strong> {readData.skillsCount}</p>
                    <p><strong>Repositories Indexed:</strong> {readData.repoCount}</p>
                    <p><strong>Code Files Inspected:</strong> {readData.fileCount}</p>
                  </div>
                </div>

                <div className="data-table-wrapper">
                  <span className="table-title m">EXTRACTED SKILL CLAIMS</span>
                  <div className="chips-row">
                    {readData.claimedSkills.map((sk) => (
                      <span key={sk} className="chip C">{sk}</span>
                    ))}
                  </div>
                </div>

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(2)
                      if (!proposeData) runStep2()
                    }}
                  
                    disabled={isProcessing || !readData}
                  >
                    Proceed to Step 2 (Propose) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !readData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 2: PROPOSE */}
            {currentStep === 2 && (
              <div className="step-pane">
                <p className="step-desc">
                  Language model proposes skill claims and suggests pointers to specific file paths, line ranges, and commit hashes.
                </p>

                <div className="warning-banner m">
                  SUGGESTIONS ONLY: Language model proposals are strictly advisory and never constitute final decisions. Every pointer is checked by deterministic code in Step 3.
                </div>

                {proposeData?.isSampleModelOutput && (
                  <div className="sample-badge m">
                    [Sample model output: no LLM API key configured in environment]
                  </div>
                )}

                <div className="io-grid">
                  <div className="io-box">
                    <span className="io-tag m">INPUTS</span>
                    <p><strong>Skills:</strong> {readData?.claimedSkills?.join(', ')}</p>
                    <p><strong>File Index:</strong> {readData?.fileCount} files available</p>
                  </div>
                  <div className="io-box">
                    <span className="io-tag m">OUTPUTS</span>
                    <p><strong>Proposals Generated:</strong> {proposeData?.pointersFound || 0} pointers</p>
                    <p><strong>Model Status:</strong> Advisory proposals ready for check</p>
                  </div>
                </div>

                <div className="table-card">
                  <table className="verify-table">
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th>Proposed File Pointer</th>
                        <th>Line Range</th>
                        <th>Commit</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposeData?.proposals.map((p) => (
                        <tr key={p.skill}>
                          <td><strong>{p.skill}</strong></td>
                          <td className="m">{p.filePath || 'No matching file'}</td>
                          <td className="m">{p.lineRange}</td>
                          <td className="m">{p.commitHash}</td>
                          <td><span className="m tag-advisory">{p.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(3)
                      if (!evidenceData) runStep3()
                    }}
                  
                    disabled={isProcessing || !proposeData}
                  >
                    Proceed to Step 3 (Check Evidence) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !proposeData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 3: CHECK EVIDENCE */}
            {currentStep === 3 && (
              <div className="step-pane">
                <p className="step-desc">
                  Deterministic code confirms each proposed pointer exists and computes cryptographic file hashes to verify integrity.
                </p>

                <div className="io-grid">
                  <div className="io-box">
                    <span className="io-tag m">INPUTS</span>
                    <p><strong>Pointers Evaluated:</strong> {evidenceData?.totalChecked || 0}</p>
                  </div>
                  <div className="io-box">
                    <span className="io-tag m">OUTPUTS</span>
                    <p><strong>Confirmed Pointers:</strong> {evidenceData?.confirmedCount || 0}</p>
                    <p><strong>Dropped / Flagged:</strong> {evidenceData?.flaggedCount || 0}</p>
                  </div>
                </div>

                <div className="table-card">
                  <span className="table-title m">CONFIRMED EVIDENCE POINTERS</span>
                  <table className="verify-table">
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th>Verified File Path</th>
                        <th>SHA-256 Digest</th>
                        <th>Integrity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidenceData?.confirmedPointers.map((p) => (
                        <tr key={p.skill}>
                          <td><strong>{p.skill}</strong></td>
                          <td className="m">{p.filePath}</td>
                          <td className="m">sha256:{p.fileHash}</td>
                          <td><span className="m tag-confirmed">Confirmed</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {evidenceData?.flaggedPointers.length > 0 && (
                  <div className="table-card" style={{ marginTop: 18 }}>
                    <span className="table-title m">DROPPED OR FLAGGED POINTERS</span>
                    <table className="verify-table">
                      <thead>
                        <tr>
                          <th>Skill</th>
                          <th>Proposed Path</th>
                          <th>Reason For Drop</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evidenceData.flaggedPointers.map((p) => (
                          <tr key={p.skill}>
                            <td><strong>{p.skill}</strong></td>
                            <td className="m">{p.filePath || 'None'}</td>
                            <td>{p.flagReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(4)
                      if (!authorshipData) runStep4()
                    }}
                  
                    disabled={isProcessing || !evidenceData}
                  >
                    Proceed to Step 4 (Authorship and Depth) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !evidenceData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 4: AUTHORSHIP AND DEPTH */}
            {currentStep === 4 && (
              <div className="step-pane">
                <p className="step-desc">
                  Analyzing commit history, git blame author lines, and usage depth to confirm original authorship versus tutorial forks.
                </p>

                <div className="io-grid">
                  <div className="io-box">
                    <span className="io-tag m">INPUTS</span>
                    <p><strong>Confirmed Files:</strong> {evidenceData?.confirmedCount} files</p>
                  </div>
                  <div className="io-box">
                    <span className="io-tag m">OUTPUTS</span>
                    <p><strong>Candidate Average Line Share:</strong> {authorshipData?.avgLineShare}%</p>
                    <p><strong>Forked Tutorial Conflicts:</strong> {authorshipData?.authorshipData.filter((a) => a.forkedTutorial).length}</p>
                  </div>
                </div>

                <div className="table-card">
                  <table className="verify-table">
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th>Author Line Share</th>
                        <th>Original Commits</th>
                        <th>Usage Depth Assessment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {authorshipData?.authorshipData.map((a) => (
                        <tr key={a.skill}>
                          <td><strong>{a.skill}</strong></td>
                          <td>{a.lineShare > 0 ? `${a.lineShare}%` : '0%'}</td>
                          <td>{a.commitCount}</td>
                          <td>{a.usageDepth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(5)
                      if (!statesData) runStep5()
                    }}
                  
                    disabled={isProcessing || !authorshipData}
                  >
                    Proceed to Step 5 (Assign States) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !authorshipData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 5: ASSIGN STATES */}
            {currentStep === 5 && (
              <div className="step-pane">
                <p className="step-desc">
                  Evidence sets the highest state a skill can reach. Verified, Supported, Claimed (not penalised), or Contradicted.
                </p>

                <div className="io-grid">
                  <div className="io-box">
                    <span className="io-tag m">STATE RULES</span>
                    <p><strong>Verified:</strong> Code exists and authorship confirmed.</p>
                    <p><strong>Supported:</strong> Code exists, partial depth. One micro-check away.</p>
                    <p><strong>Claimed:</strong> Resume claim with no code found. Not penalised.</p>
                    <p><strong>Contradicted:</strong> Forked tutorial with 0 commits.</p>
                  </div>
                  <div className="io-box">
                    <span className="io-tag m">CURRENT STATE DISTRIBUTION</span>
                    <p><strong>Verified:</strong> {statesData?.counts.V}</p>
                    <p><strong>Supported:</strong> {statesData?.counts.S}</p>
                    <p><strong>Claimed:</strong> {statesData?.counts.C}</p>
                    <p><strong>Contradicted:</strong> {statesData?.counts.X}</p>
                  </div>
                </div>

                <div className="table-card">
                  <table className="verify-table">
                    <thead>
                      <tr>
                        <th>Skill</th>
                        <th>Assigned State</th>
                        <th>Evidence and Rationale</th>
                        <th>Audit Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statesData?.skillStates.map((s) => {
                        const isExpanded = !!expandedStep5Skills[s.skill]
                        const details = buildSkillEvidenceDetails(s, {
                          evidence: backendRef.current?.resp?.evidence,
                        })

                        return (
                          <Fragment key={s.skill}>
                            <tr>
                              <td><strong>{s.skill}</strong></td>
                              <td>
                                <span className={`chip ${s.state}`}>
                                  {s.state === 'V'
                                    ? 'VERIFIED'
                                    : s.state === 'S'
                                      ? 'SUPPORTED'
                                      : s.state === 'C'
                                        ? 'CLAIMED'
                                        : 'CONTRADICTED'}
                                </span>
                              </td>
                              <td>
                                <div style={{ fontSize: '0.86rem' }}>
                                  <div>{s.rationale}</div>
                                  {s.evidence && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '4px' }}>
                                      {s.evidence}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="evidence-expand-btn"
                                  onClick={() => toggleStep5SkillExpand(s.skill)}
                                  aria-expanded={isExpanded}
                                  title={isExpanded ? 'Hide evidence' : 'Show evidence'}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                    <line x1="16" y1="13" x2="8" y2="13" />
                                    <line x1="16" y1="17" x2="8" y2="17" />
                                  </svg>
                                  <span>{isExpanded ? 'Hide evidence' : 'Show evidence'}</span>
                                  <span className="expand-chevron" aria-hidden="true">
                                    {isExpanded ? '▴' : '▾'}
                                  </span>
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="evidence-audit-tr">
                                <td colSpan="4" style={{ padding: '12px 14px', background: 'var(--bg-subtle, rgba(0,0,0,0.02))' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {details.map((detail, idx) => (
                                      <EvidenceCard key={idx} detail={detail} evidence={detail} />
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(6)
                    }}
                  
                    disabled={isProcessing || !statesData}
                  >
                    Proceed to Step 6 (Micro-checks) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !statesData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 6: MICRO-CHECKS */}
            {currentStep === 6 && (
              <div className="step-pane">
                <p className="step-desc">
                  Micro-checks evaluate architectural trade-offs using the candidate's own code. Passing upgrades Supported skills to Verified. Failed checks never lower a skill below Supported.
                </p>

                {microChecks.length === 0 ? (
                  <div className="info-box">
                    <p>No Supported skills remain. All claims are either Verified, Claimed, or Contradicted.</p>
                  </div>
                ) : (
                  <div className="micro-checks-list">
                    {microChecks.map((m) => (
                      <div key={m.skill} className="micro-check-card">
                        <div className="mc-header">
                          <span className="chip S">SUPPORTED SKILL: {m.skill}</span>
                          <span className="m file-ref">{m.filePath}</span>
                        </div>
                        <p className="mc-q"><strong>Question:</strong> {m.question}</p>

                        {!m.answered ? (
                          <div className="mc-form">
                            <textarea
                              rows={3}
                              className="form-textarea"
                              placeholder="Answer in a few sentences explaining your code rationale..."
                              defaultValue=""
                              id={`mc-${m.skill}`}
                            />
                            <button
                              type="button"
                              className="b sm"
                              onClick={() => {
                                const input = document.getElementById(`mc-${m.skill}`)
                                handleAnswerMicroCheck(m.skill, input ? input.value : '')
                              }}
                            >
                              Submit micro-check
                            </button>
                          </div>
                        ) : (
                          <div className="mc-result">
                            <p><strong>Your Answer:</strong> {m.userAnswer}</p>
                            <div className={m.passed ? 'mc-pass m' : 'mc-fail m'}>{m.feedback}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="step-actions">
                  <button type="button" className="b mg" onClick={completeStep6} disabled={!allChecksAnswered}>
                    Complete micro-checks and calculate role match <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={!allChecksAnswered} text="Answer every micro-check to continue." />
                </div>
              </div>
            )}

            {/* STEP 7: ROLE MATCH AND GAPS */}
            {currentStep === 7 && roleMatchData && (
              <div className="step-pane">
                <p className="step-desc">
                  Evidence-weighted role match to "{intakeData?.targetRole}". Weights: Verified 100%, Supported 60%, Claimed 20%, Contradicted 0%.
                </p>

                <div className="match-score-card">
                  <span className="k m">EVIDENCE-WEIGHTED MATCH</span>
                  <div className="match-big m">{roleMatchData.matchPercentage}%</div>
                  <div className="match-bar">
                    <div className="bar-v" style={{ width: `${roleMatchData.matchPercentage}%` }} />
                  </div>
                  <div className="match-stats-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, fontSize: '0.85rem', color: 'var(--muted)' }}>
                    <span>Candidate Claim Verification: <strong style={{ color: 'var(--text)' }}>{roleMatchData.claimVerificationRate ?? Math.round((statesData.counts.V / statesData.totalSkills) * 100)}%</strong> ({statesData.counts.V} of {statesData.totalSkills} verified)</span>
                    <span>•</span>
                    <span>Role Criteria Evaluated: <strong style={{ color: 'var(--text)' }}>{roleMatchData.roleReqs?.length || 0} skills</strong></span>
                  </div>
                  <p className="m match-note" style={{ marginTop: 8 }}>{roleMatchData.disclaimer}</p>
                </div>

                <div className="table-card" style={{ marginTop: 20 }}>
                  <span className="table-title m">RANKED EVIDENCE GAPS (SORTED BY MATCH IMPACT)</span>
                  <table className="verify-table">
                    <thead>
                      <tr>
                        <th>Skill Gap</th>
                        <th>Current State</th>
                        <th>Role Importance</th>
                        <th>Recommended Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roleMatchData.rankedGaps.map((g) => (
                        <tr key={g.skill}>
                          <td><strong>{g.skill}</strong></td>
                          <td><span className={`chip ${g.currentState}`}>{L[g.currentState] || g.currentState}</span></td>
                          <td>Weight {g.importance}</td>
                          <td>{g.recommendation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* CLOSE YOUR GAPS SECTION */}
                {(() => {
                  const gapRoadmaps = buildRoadmapsForGaps(intakeData?.targetRole, roleMatchData?.rankedGaps || [])
                  return (
                    <div className="table-card" style={{ marginTop: 24 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--ink)' }}>
                          Close your gaps for {intakeData?.targetRole || 'Target Role'}
                        </h3>
                        <span className="chip sm" style={{ fontFamily: 'var(--mono)' }}>
                          {gapRoadmaps.length} {gapRoadmaps.length === 1 ? 'skill' : 'skills'}
                        </span>
                      </div>
                      <p style={{ fontSize: '0.86rem', color: 'var(--muted)', margin: '0 0 16px 0', lineHeight: 1.45 }}>
                        Skills your target role needs that are not Verified yet. Open a skill to see its roadmap.
                      </p>

                      {gapRoadmaps.length === 0 ? (
                        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--st-v)', fontSize: '0.92rem' }}>
                          Every skill your target role needs is Verified. No roadmap needed.
                        </div>
                      ) : (
                        <div className="gap-roadmaps-accordion" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {gapRoadmaps.map((roadmap) => {
                            const isOpen = openGapSkill === roadmap.skillId
                            const steps = roadmap.steps || []
                            return (
                              <div
                                key={roadmap.skillId}
                                style={{
                                  borderRadius: 8,
                                  border: '1px solid var(--line)',
                                  background: 'var(--surface)',
                                  overflow: 'hidden',
                                  transition: 'border-color 0.2s ease',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setOpenGapSkill(isOpen ? null : roadmap.skillId)}
                                  style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '14px 16px',
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    gap: 12,
                                  }}
                                  aria-expanded={isOpen}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{roadmap.skillName}</strong>
                                    <span className={`chip sm ${roadmap.state}`}>{L[roadmap.state] || roadmap.state}</span>
                                    <span className="m" style={{ fontSize: '0.75rem', color: 'var(--faint)' }}>
                                      Weight {roadmap.importance}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span className="m" style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                                      {steps.length} {steps.length === 1 ? 'step' : 'steps'}
                                    </span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
                                      ▼
                                    </span>
                                  </div>
                                </button>

                                {isOpen && (
                                  <div style={{ padding: '0 16px 16px 16px', borderTop: '1px solid var(--line-soft)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                                      {steps.map((st, sIdx) => {
                                        const isDone = Boolean(roadmapsStepDone[`${roadmap.skillId}:${st.id}`] ?? st.done)
                                        return (
                                          <div
                                            key={st.id}
                                            style={{
                                              padding: '12px 14px',
                                              borderRadius: 6,
                                              background: isDone ? 'rgba(16, 185, 129, 0.05)' : 'var(--bg)',
                                              border: `1px solid ${isDone ? 'rgba(16, 185, 129, 0.2)' : 'var(--line)'}`,
                                              display: 'flex',
                                              alignItems: 'flex-start',
                                              justifyContent: 'space-between',
                                              gap: 12,
                                              flexWrap: 'wrap',
                                            }}
                                          >
                                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', flex: 1 }}>
                                              <input
                                                type="checkbox"
                                                checked={isDone}
                                                onChange={async () => {
                                                  const nextDone = !isDone
                                                  setRoadmapsStepDone((prev) => ({ ...prev, [`${roadmap.skillId}:${st.id}`]: nextDone }))
                                                  try {
                                                    await updateRoadmapStep(user?.id, roadmap.roleKey, roadmap.skillId, st.id, { done: nextDone })
                                                  } catch (err) {
                                                    console.warn('Could not update step:', err)
                                                  }
                                                }}
                                                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                                              />
                                              <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                  <span style={{ fontWeight: 600, fontSize: '0.88rem', textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--muted)' : 'var(--ink)' }}>
                                                    {sIdx + 1}. {st.title}
                                                  </span>
                                                  <span className="chip sm" style={{ fontSize: '0.7rem', padding: '1px 6px' }}>{st.type}</span>
                                                  <span className="m" style={{ fontSize: '0.75rem', color: 'var(--faint)' }}>{st.platform}</span>
                                                </div>
                                                <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                                                  {st.description}
                                                </p>
                                              </div>
                                            </label>
                                            {st.url && (
                                              <a
                                                href={st.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="b g sm"
                                                style={{ fontSize: '0.75rem', padding: '4px 10px', textDecoration: 'none' }}
                                              >
                                                Open ↗
                                              </a>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div className="step-actions">
                  <button
                    type="button"
                    className="b mg"
                    onClick={() => {
                      setCurrentStep(8)
                      if (!passportData) runStep8()
                    }}
                  
                    disabled={isProcessing || !roleMatchData}
                  >
                    Proceed to Step 8 (Issue Passport) <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </button>
                  <GateHint show={isProcessing || !roleMatchData} text="Wait for this step to finish to continue." />
                </div>
              </div>
            )}

            {/* STEP 8: ISSUE PASSPORT & RESULT VIEW */}
            {currentStep === 8 && passportData && (
              <div className="step-pane result-view">
                <div className="result-hero-3d">
                  <div className="result-3d-stage">
                    <ErrorBoundary fallback={null}>
                      <Passport3D progress={progressDummy} active={true} reduced={RM} />
                    </ErrorBoundary>
                  </div>
                  <div className="result-hero-text">
                    <span className="k m">CRYPTOGRAPHIC SKILL PASSPORT</span>
                    <h2>Passport Issued and Sealed</h2>
                    <p className="m">ID: {passportData.passport.id} • Issued: {new Date(passportData.passport.issuedAt).toLocaleDateString()}</p>
                    <p>Target Role: {passportData.passport.targetRole}</p>
                    <div className="passport-hash-box">
                      <span className="m hash-label">SHA-256 PASSPORT DIGEST:</span>
                      <code className="m">{passportData.hash}</code>
                      <p style={{ margin: '8px 0 0', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: '1.4' }}>
                        The seal covers the entire sealed passport payload (skills, states, evidence chain, role match, ownership). Excerpts shown here are display details.
                      </p>
                    </div>

                    <div className="hash-actions">
                      <button type="button" className="b sm" onClick={handleVerifyHash}>
                        Verify hash
                      </button>
                      <button type="button" className="b g sm" onClick={handleSimulateTamper}>
                        Simulate an edit
                      </button>
                    </div>

                    {hashCheckResult && (
                      <div className={`hash-feedback m ${hashCheckResult.valid === true ? 'ok' : hashCheckResult.valid === false ? 'err' : ''}`} role="status">
                        {hashCheckResult.message}
                      </div>
                    )}
                  </div>
                </div>

                {/* RESUME DETAILS & EXTRACTED SCOPE */}
                <div className="resume-details-card glass" style={{ padding: '20px', margin: '24px 0', borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Resume details &amp; extracted scope</h3>
                    <span className={`chip sm ${passportData.passport.ownershipVerified ? 'V' : 'S'}`}>
                      {passportData.passport.ownershipVerified ? 'GitHub ownership verified' : 'Ownership Unverified'}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', fontSize: '0.88rem' }}>
                    <div>
                      <span className="k m" style={{ display: 'block', fontSize: '0.72rem', opacity: 0.7 }}>PARSED NAME</span>
                      <strong>{passportData.passport.candidateName || user?.name}</strong>
                    </div>
                    <div>
                      <span className="k m" style={{ display: 'block', fontSize: '0.72rem', opacity: 0.7 }}>TARGET ROLE</span>
                      <strong>{passportData.passport.targetRole}</strong>
                    </div>
                    <div>
                      <span className="k m" style={{ display: 'block', fontSize: '0.72rem', opacity: 0.7 }}>PAST EXPERIENCE</span>
                      <p style={{ margin: '2px 0 0', fontSize: '0.84rem' }}>
                        {user?.profile?.experience && Array.isArray(user.profile.experience) && user.profile.experience[0]
                          ? `${user.profile.experience[0].title} at ${user.profile.experience[0].org} (${user.profile.experience[0].duration})`
                          : (readData?.resumeDetails?.experience || 'Software Engineer · Verified Engineering History')}
                      </p>
                    </div>
                    <div>
                      <span className="k m" style={{ display: 'block', fontSize: '0.72rem', opacity: 0.7 }}>SKILLS DETECTED</span>
                      <strong>{passportData.passport.skills.length} skills extracted</strong>
                    </div>
                  </div>
                </div>

                {/* RESULT PERSPECTIVE TABS */}
                <div className="result-tabs-nav">
                  {['Candidate', 'Recruiter', 'Placement'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`res-tab-btn ${activeResultTab === t ? 'active' : ''}`}
                      onClick={() => setActiveResultTab(t)}
                    >
                      {t} View
                    </button>
                  ))}
                </div>

                <div className="result-tab-content">
                  {activeResultTab === 'Candidate' && (
                    <div className="tab-pane">
                      <h3>Candidate Verification Summary</h3>
                      <p>Inspect the file and commit evidence behind each of your claimed skills.</p>
                      <table className="verify-table" style={{ marginTop: 14 }}>
                        <thead>
                          <tr>
                            <th>Skill</th>
                            <th>Status</th>
                            <th>File Proof & Commit Line Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {passportData.passport.skills.map((s) => {
                            const isExpanded = !!expandedResultSkills[s.skill]
                            const details =
                              Array.isArray(s.evidenceDetails) && s.evidenceDetails.length > 0
                                ? s.evidenceDetails
                                : buildSkillEvidenceDetails(s, {
                                    passport: passportData.passport,
                                    evidence: backendRef.current?.resp?.evidence,
                                  })

                            return (
                              <Fragment key={s.skill}>
                                <tr>
                                  <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <strong>{s.skill}</strong>
                                      <button
                                        type="button"
                                        className="evidence-expand-btn"
                                        onClick={() => toggleResultSkillExpand(s.skill)}
                                        aria-expanded={isExpanded}
                                        title={isExpanded ? 'Hide evidence' : 'Show evidence'}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                          <polyline points="14 2 14 8 20 8" />
                                          <line x1="16" y1="13" x2="8" y2="13" />
                                          <line x1="16" y1="17" x2="8" y2="17" />
                                        </svg>
                                        <span>{isExpanded ? 'Hide evidence' : 'Show evidence'}</span>
                                        <span className="expand-chevron" aria-hidden="true">
                                          {isExpanded ? '▴' : '▾'}
                                        </span>
                                      </button>
                                    </div>
                                  </td>
                                  <td><span className={`chip ${s.state}`}>{s.state === 'V' ? 'VERIFIED' : s.state === 'S' ? 'SUPPORTED' : s.state === 'C' ? 'CLAIMED' : 'CONTRADICTED'}</span></td>
                                  <td>{s.evidence}</td>
                                </tr>
                                {isExpanded && (
                                  <tr className="evidence-audit-tr">
                                    <td colSpan="3" style={{ padding: '12px 14px', background: 'var(--bg-subtle, rgba(0,0,0,0.02))' }}>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {details.map((detail, idx) => (
                                          <EvidenceCard key={idx} detail={detail} evidence={detail} skillName={s.skill} />
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {activeResultTab === 'Recruiter' && (
                    <div className="tab-pane">
                      <h3>Recruiter Evidence Report</h3>
                      <p>Evidence-grounded audit trail. No single hire score. Every claim links to code.</p>
                      <ul className="recruiter-list">
                        <li><strong>Verified Skills:</strong> Confirmed original commits with author line share &gt; 75%.</li>
                        <li><strong>Red Flags:</strong> Any forked tutorial repositories with zero original commits are labeled Contradicted.</li>
                        <li><strong>Interview Questions:</strong> Use code-grounded questions from micro-checks for live technical interviews.</li>
                      </ul>
                    </div>
                  )}

                  {activeResultTab === 'Placement' && (
                    <div className="tab-pane">
                      <h3>Placement Cell Overview</h3>
                      <p>Batch skill readiness metrics. Identify where candidate claims outrun code evidence.</p>
                      <div className="placement-metrics-grid">
                        <div className="metric-box">
                          <span className="m">VERIFIED RATIO</span>
                          <div className="m-val">{statesData?.counts.V} / {statesData?.totalSkills}</div>
                        </div>
                        <div className="metric-box">
                          <span className="m">GAPS IDENTIFIED</span>
                          <div className="m-val">{roleMatchData?.rankedGaps.length}</div>
                        </div>
                        <div className="metric-box">
                          <span className="m">TAMPER PROTECTION</span>
                          <div className="m-val">SHA-256</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="result-actions-footer" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '24px' }}>
                  <Link to="/dashboard" className="b sm">
                    Go to dashboard <span className="btn-arrow" aria-hidden="true">-&gt;</span>
                  </Link>
                  <button type="button" className="b g sm" onClick={() => window.print()}>
                    Print passport record
                  </button>
                  <Link to="/" className="b g sm">
                    Return to home
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Locked Stage Chained Card (shown during preview while real card stays mounted with hidden attribute) */}
          {previewStep !== null && (
            <LockedStage
              stepId={previewStep}
              currentStep={currentStep}
              onBack={() => setPreviewStep(null)}
              onLookAt={(s) => {
                setPreviewStep(s)
                setRattleCount((c) => c + 1)
              }}
              rattleTrigger={rattleCount}
            />
          )}

        </main>

        {/* RIGHT CORNER FLOATING CHATBOT-STYLE LIVE VERIFICATION LOG WIDGET */}
        <VerificationChatbot
          isOpen={showLogChat}
          onToggle={() => setShowLogChat((prev) => !prev)}
          onClose={() => setShowLogChat(false)}
          logs={logs}
          currentStep={currentStep}
          currentStepTitle={STEP_DEFINITIONS[currentStep]?.title || ''}
          stepStatus={stepStatus[currentStep] || 'waiting'}
          isProcessing={isProcessing}
          hasStarted={hasStartedVerification || currentStep > 0}
        />
      </div>
    </div>
  )
}
