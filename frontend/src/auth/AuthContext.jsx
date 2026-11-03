/**
 * Authentication Context & Route Guard
 * Provides session state, signup/login/logout actions, and role-based route protection.
 */

import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getSession, loginRequest, logoutRequest, signupRequest, updateProfileRequest } from '../api/auth.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    getSession().then((session) => {
      if (mounted) {
        setUser(session)
        setLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const login = async (email, password) => {
    const loggedUser = await loginRequest(email, password)
    setUser(loggedUser)
    return loggedUser
  }

  const signup = async (payload) => {
    const newUser = await signupRequest(payload)
    setUser(newUser)
    return newUser
  }

  const logout = async () => {
    await logoutRequest()
    setUser(null)
  }

  const updateProfile = async (profileUpdates) => {
    // Optimistic local merge, persisted on the server. The role is never part of this request.
    setUser((prev) => (prev ? { ...prev, profile: { ...(prev.profile || {}), ...profileUpdates } } : null))
    try {
      const saved = await updateProfileRequest(profileUpdates)
      setUser(saved)
    } catch {
      // Keep the optimistic copy; the next session restore shows what the server has.
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

/**
 * Route guard requiring active user session and matching role.
 *
 * @param {Object} props
 * @param {'applicant'|'recruiter'|Array<string>} props.roles - Allowed role(s)
 * @param {React.ReactNode} props.children
 */
export function RequireRole({ roles, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <main id="main" className="loading-container" style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="login-notice">
          <span className="notice-dot" aria-hidden="true" />
          <span>Verifying session...</span>
        </div>
      </main>
    )
  }

  if (!user) {
    // Redirect to login with notice and original destination
    return (
      <Navigate
        to="/login"
        state={{
          from: location.pathname,
          notice: 'Log in to use ProofPass.',
        }}
        replace
      />
    )
  }

  const allowed = Array.isArray(roles) ? roles : [roles]
  if (!allowed.includes(user.role)) {
    // User role is not permitted on this route, redirect to their home dashboard
    const dest = user.role === 'recruiter' ? '/recruiter' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  return children
}
