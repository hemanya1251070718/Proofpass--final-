import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import Home from './components/Home.jsx'
import Legal from './components/Legal.jsx'
import Login from './components/Login.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { PRIVACY, TERMS } from './legal.js'
import { RM, scroller, scrollToTarget } from './lib.js'
import { AuthProvider, useAuth, RequireRole } from './auth/AuthContext.jsx'

gsap.registerPlugin(ScrollTrigger)

const Verify = lazy(() => import('./components/Verify.jsx'))
const ApplicantDashboard = lazy(() => import('./components/ApplicantDashboard.jsx'))
const Recommendations = lazy(() => import('./components/Recommendations.jsx'))
const JobRadarMap = lazy(() => import('./components/JobRadarMap.jsx'))
const Learnings = lazy(() => import('./components/Learnings.jsx'))
const PassportView = lazy(() => import('./components/PassportView.jsx'))
const RecruiterDashboard = lazy(() => import('./components/RecruiterDashboard.jsx'))
const RecruiterRoleDetail = lazy(() => import('./components/RecruiterRoleDetail.jsx'))
const CandidateCompare = lazy(() => import('./components/CandidateCompare.jsx'))

const prefetchVerify = () => {
  import('./components/Verify.jsx')
}

const SECTIONS = [
  ['states', 'States'],
  ['scoring', 'Scoring'],
  ['pipeline', 'Pipeline'],
  ['views', 'Views'],
]

function Mark() {
  return (
    <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" />
      <rect x="7" y="8" width="18" height="4" />
      <rect x="7" y="15" width="12" height="4" />
    </svg>
  )
}

// Module-level flag: intro animation plays only on full page load, skipped on in-app route changes
let hasPlayedNavIntro = false

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}

function AppShell() {
  const { pathname } = useLocation()
  const { user, logout } = useAuth()
  const home = pathname === '/'
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')

  const headerRef = useRef(null)
  const logoRef = useRef(null)
  const navRef = useRef(null)
  const actionsRef = useRef(null)
  const scrolledRef = useRef(false)
  const hiddenRef = useRef(false)
  const openRef = useRef(false)
  openRef.current = open

  // Smooth scroll (Lenis) wired into GSAP's ticker with lagSmoothing(0)
  useEffect(() => {
    if (RM) return
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
    scroller.lenis = lenis
    lenis.on('scroll', ScrollTrigger.update)
    const raf = (t) => lenis.raf(t * 1000)
    gsap.ticker.add(raf)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(raf)
      lenis.destroy()
      scroller.lenis = null
    }
  }, [])

  // Prefetch Verify chunk on idle after first paint
  useEffect(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => prefetchVerify(), { timeout: 2500 })
      return () => window.cancelIdleCallback && window.cancelIdleCallback(id)
    } else {
      const timer = setTimeout(prefetchVerify, 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  // New page: go to top, close the menu, reset header visibility and clear any nav offsets
  useEffect(() => {
    if (scroller.lenis) scroller.lenis.scrollTo(0, { immediate: true, force: true })
    else window.scrollTo(0, 0)
    setOpen(false)
    if (headerRef.current) {
      headerRef.current.classList.remove('hide')
      headerRef.current.classList.toggle('scrolled', window.scrollY > 8)
    }
    if (navRef.current) {
      const links = navRef.current.querySelectorAll('a')
      gsap.set(links, { clearProps: 'all' })
    }
    if (actionsRef.current) {
      gsap.set(actionsRef.current.children, { clearProps: 'all' })
    }
    hiddenRef.current = false
    scrolledRef.current = window.scrollY > 8
    setCurrent('')
    ScrollTrigger.refresh()
  }, [pathname])

  // Nav links emerge from the logo and title on full page load
  useLayoutEffect(() => {
    if (hasPlayedNavIntro || RM || window.innerWidth <= 820 || !home) {
      if (navRef.current) {
        gsap.set(navRef.current.querySelectorAll('a'), { clearProps: 'all' })
      }
      return
    }

    let cancelled = false
    document.fonts.ready.then(() => {
      if (cancelled || hasPlayedNavIntro || window.innerWidth <= 820) return
      hasPlayedNavIntro = true

      const logo = logoRef.current
      const nav = navRef.current
      const actions = actionsRef.current
      if (!logo || !nav) return

      const links = Array.from(
        nav.querySelectorAll('a:not(.nav-login-mobile):not(.nav-verify-mobile)')
      )
      if (!links.length) return

      const logoRect = logo.getBoundingClientRect()
      const logoTargetX = logoRect.right
      const mark = logo.querySelector('.logo-mark') || logo

      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(links, { clearProps: 'transform,opacity,willChange' })
          if (actions) {
            gsap.set(actions.children, { clearProps: 'transform,opacity,willChange' })
          }
        },
      })

      // Logo mark tiny pulse
      tl.to(
        mark,
        {
          scale: 1.08,
          duration: 0.18,
          ease: 'power1.out',
          yoyo: true,
          repeat: 1,
        },
        0
      )

      links.forEach((link, idx) => {
        const linkRect = link.getBoundingClientRect()
        const deltaX = logoTargetX - linkRect.left

        gsap.set(link, {
          x: deltaX,
          scale: 0.7,
          opacity: 0,
          willChange: 'transform, opacity',
        })

        tl.to(
          link,
          {
            x: 0,
            scale: 1,
            opacity: 1,
            duration: 0.9,
            ease: 'expo.out',
          },
          idx * 0.07
        )
      })

      // Actions fade in and rise 8px staggered after links
      if (actions) {
        const actionItems = Array.from(actions.children).filter(
          (el) => !el.classList.contains('nav-toggle')
        )
        gsap.set(actionItems, {
          y: 8,
          opacity: 0,
          willChange: 'transform, opacity',
        })

        const actionsStartTime = links.length * 0.07 + 0.12
        tl.to(
          actionItems,
          {
            y: 0,
            opacity: 1,
            duration: 0.65,
            stagger: 0.08,
            ease: 'power3.out',
          },
          actionsStartTime
        )
      }
    })

    return () => {
      cancelled = true
      if (navRef.current) {
        gsap.set(navRef.current.querySelectorAll('a'), { clearProps: 'all' })
      }
      if (actionsRef.current) {
        gsap.set(actionsRef.current.children, { clearProps: 'all' })
      }
    }
  }, [])

  // Header scroll listener - toggles classes directly on ref, zero per-frame setState
  useEffect(() => {
    let last = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      const isScrolled = y > 8
      if (isScrolled !== scrolledRef.current) {
        scrolledRef.current = isScrolled
        if (headerRef.current) {
          headerRef.current.classList.toggle('scrolled', isScrolled)
        }
      }

      let isHidden = hiddenRef.current
      if (y > 480 && y > last + 6 && !openRef.current) {
        isHidden = true
      } else if (y < last - 6 || y < 480) {
        isHidden = false
      }

      if (isHidden !== hiddenRef.current) {
        hiddenRef.current = isHidden
        if (headerRef.current) {
          headerRef.current.classList.toggle('hide', isHidden)
        }
      }
      last = y
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll progress bar
  useEffect(() => {
    if (RM) return
    const st = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (s) => gsap.set('#pb', { scaleX: s.progress }),
    })
    return () => st.kill()
  }, [pathname])

  // Highlight the nav link for the section in view
  useEffect(() => {
    if (!home) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setCurrent(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' }
    )
    SECTIONS.forEach(([id]) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [home])

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  // In-page anchors go through the smooth scroller
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest('a[href^="#"]')
      if (!a || a.getAttribute('href') === '#') return
      const el = document.querySelector(a.getAttribute('href'))
      if (!el) return
      e.preventDefault()
      setOpen(false)
      scrollToTarget(el)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const handleMobileNavClick = () => {
    setOpen(false)
  }

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div id="pb" aria-hidden="true" />
      <header
        ref={headerRef}
        className={`site-header${open ? ' menu-open' : ''}`}
      >
        <div className="w bar">
          <Link ref={logoRef} className="logo" to="/">
            <Mark />
            <span>
              Proof<i>Pass</i>
            </span>
          </Link>
          <nav
            ref={navRef}
            id="primary-nav"
            className={`site-nav${open ? ' open' : ''}`}
            aria-label="Primary"
          >
            {!user ? (
              home ? (
                SECTIONS.map(([id, label]) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    aria-current={current === id ? 'true' : undefined}
                  >
                    {label}
                  </a>
                ))
              ) : (
                <Link to="/" aria-current={pathname === '/' ? 'page' : undefined}>
                  Home
                </Link>
              )
            ) : user.role === 'applicant' ? (
              <>
                <Link
                  to="/dashboard"
                  aria-current={pathname === '/dashboard' ? 'page' : undefined}
                  onClick={handleMobileNavClick}
                >
                  Dashboard
                </Link>
                <Link
                  to="/verify"
                  aria-current={pathname === '/verify' ? 'page' : undefined}
                  onClick={handleMobileNavClick}
                >
                  Verify
                </Link>
                <Link
                  to="/learnings"
                  aria-current={pathname === '/learnings' ? 'page' : undefined}
                  onClick={handleMobileNavClick}
                >
                  Learnings
                </Link>
                <Link
                  to="/recommendations"
                  aria-current={pathname === '/recommendations' ? 'page' : undefined}
                  onClick={handleMobileNavClick}
                >
                  Recommendations
                </Link>
                <Link
                  to="/radar"
                  aria-current={pathname === '/radar' ? 'page' : undefined}
                  onClick={handleMobileNavClick}
                >
                  Job Radar
                </Link>
              </>
            ) : (
              <Link
                to="/recruiter"
                aria-current={pathname.startsWith('/recruiter') ? 'page' : undefined}
                onClick={handleMobileNavClick}
              >
                Dashboard
              </Link>
            )}

            {!user ? (
              <>
                <Link
                  to="/login"
                  className="b g sm nav-login-mobile"
                  style={{ display: open ? undefined : 'none' }}
                  onClick={handleMobileNavClick}
                >
                  Log in
                </Link>
                <Link
                  to="/login?tab=signup"
                  className="b sm nav-verify-mobile"
                  style={{ display: open ? undefined : 'none' }}
                  onClick={handleMobileNavClick}
                >
                  Sign up
                </Link>
              </>
            ) : (
              <div
                className="nav-mobile-user"
                style={{
                  display: open ? 'flex' : 'none',
                  flexDirection: 'column',
                  gap: '8px',
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--line)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                  <span style={{ fontWeight: 600 }}>{user.name}</span>
                  <span className={`chip sm ${user.role === 'recruiter' ? 'C' : 'V'}`}>{user.role}</span>
                </div>
                <button
                  type="button"
                  className="b g sm"
                  onClick={() => {
                    handleMobileNavClick()
                    logout()
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </nav>
          <div ref={actionsRef} className="bar-actions">
            <ThemeToggle />
            {!user ? (
              <>
                <Link
                  to="/login"
                  className="b g sm"
                  aria-current={pathname === '/login' ? 'page' : undefined}
                >
                  Log in
                </Link>
                <Link
                  to="/login?tab=signup"
                  className="b sm"
                >
                  Sign up
                </Link>
              </>
            ) : (
              <>
                <div className="header-user-tag">
                  {user.name && user.name.toLowerCase() !== user.role.toLowerCase() && (
                    <span className="header-user-name" title={user.name}>
                      {user.name}
                    </span>
                  )}
                  <span className={`chip sm ${user.role === 'recruiter' ? 'C' : 'V'}`}>
                    {user.role}
                  </span>
                </div>
                <button
                  type="button"
                  className="b g sm"
                  onClick={logout}
                >
                  Log out
                </button>
              </>
            )}
            <button
              type="button"
              className="icon-btn nav-toggle"
              aria-expanded={open}
              aria-controls="primary-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((o) => !o)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>

      <div key={pathname}>
        <Suspense fallback={<main id="main" style={{ minHeight: '70vh' }} />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/privacy" element={<Legal doc={PRIVACY} />} />
            <Route path="/terms" element={<Legal doc={TERMS} />} />

            {/* Read-only Passport View (Applicant & Recruiter shared) */}
            <Route
              path="/passport/:passportId"
              element={
                <ErrorBoundary>
                  <PassportView />
                </ErrorBoundary>
              }
            />

            {/* Applicant Protected Routes */}
            <Route
              path="/dashboard"
              element={
                <RequireRole roles="applicant">
                  <ErrorBoundary>
                    <ApplicantDashboard />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/verify"
              element={
                <RequireRole roles="applicant">
                  <ErrorBoundary>
                    <Verify />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/learnings"
              element={
                <RequireRole roles="applicant">
                  <ErrorBoundary>
                    <Learnings />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/recommendations"
              element={
                <RequireRole roles="applicant">
                  <ErrorBoundary>
                    <Recommendations />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/radar"
              element={
                <RequireRole roles="applicant">
                  <ErrorBoundary>
                    <JobRadarMap />
                  </ErrorBoundary>
                </RequireRole>
              }
            />

            {/* Recruiter Protected Routes */}
            <Route
              path="/recruiter"
              element={
                <RequireRole roles="recruiter">
                  <ErrorBoundary>
                    <RecruiterDashboard />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/recruiter/role/:roleId/compare"
              element={
                <RequireRole roles="recruiter">
                  <ErrorBoundary>
                    <CandidateCompare />
                  </ErrorBoundary>
                </RequireRole>
              }
            />
            <Route
              path="/recruiter/role/:roleId"
              element={
                <RequireRole roles="recruiter">
                  <ErrorBoundary>
                    <RecruiterRoleDetail />
                  </ErrorBoundary>
                </RequireRole>
              }
            />

            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </div>

      <footer className="site-footer">
        <div className="w">
          <span>
            ProofPass is a prototype. All data shown is sample data and nothing you type leaves this page.
          </span>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms and Conditions</Link>
        </div>
      </footer>
    </>
  )
}
