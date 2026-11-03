/**
 * Authentication API module.
 * Accounts and sessions live on the backend (/api/v1/account/*): Argon2id passwords, server-side sessions in an
 * HttpOnly cookie. Nothing credential-like is stored in localStorage; the browser only holds the opaque cookie.
 */

const ACCOUNT_API = '/api/v1/account'

async function accountRequest(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${ACCOUNT_API}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Could not reach the ProofPass server. Check that the backend is running.')
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const d = data?.detail
    const msg = Array.isArray(d) ? d.map((x) => x.msg).join(' ') : d
    const err = new Error(msg || `Request failed (${res.status}).`)
    err.status = res.status
    throw err
  }
  return data
}

/** Register an applicant or recruiter account (the server validates and fixes the role). */
export async function signupRequest({ role, name, email, password, profile = {} }) {
  const data = await accountRequest('/register', { method: 'POST', body: { role, name, email, password, profile } })
  return data.user
}

/** Authenticate with email and password; the server sets the session cookie. */
export async function loginRequest(email, password) {
  const data = await accountRequest('/login', { method: 'POST', body: { email, password } })
  return data.user
}

/** Invalidate the server-side session. */
export async function logoutRequest() {
  try {
    await accountRequest('/logout', { method: 'POST' })
  } catch {
    // Session may already be gone; the local user state is cleared by the caller regardless.
  }
  return true
}

/** Restore the session from the cookie. Returns the user or null. */
export async function getSession() {
  try {
    return (await accountRequest('/session')).user
  } catch {
    return null
  }
}

/** Merge non-sensitive profile fields. The role can never be changed through this call. */
export async function updateProfileRequest(profile) {
  return (await accountRequest('/profile', { method: 'PATCH', body: { profile } })).user
}

/**
 * Retrieve verified GitHub OAuth profile from active backend session.
 *
 * @returns {Promise<{ github_login: string, github_id: number, avatar_url?: string } | null>}
 */
export async function getGitHubSession() {
  try {
    const res = await fetch('/api/v1/auth/github/session', {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.connected ? data : null
  } catch {
    return null
  }
}

/**
 * Terminate active GitHub OAuth session.
 *
 * @returns {Promise<boolean>}
 */
export async function logoutGitHubSession() {
  try {
    const res = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Retrieve server authentication configuration.
 *
 * @returns {Promise<{ github_oauth_configured: boolean }>}
 */
export async function getAuthConfig() {
  try {
    const res = await fetch('/api/v1/auth/config', {
      method: 'GET',
      credentials: 'include',
    })
    if (!res.ok) {
      return { github_oauth_configured: false }
    }
    return await res.json()
  } catch {
    return { github_oauth_configured: false }
  }
}

