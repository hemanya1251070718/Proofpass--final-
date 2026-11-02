/**
 * Google Gemini client for AI-suggested skill milestones (Learnings page).
 * Read-only display data: results are never persisted or merged into tracked roadmaps.
 */

const GEMINI_MODEL = 'gemini-3.8-flash'
const TIMEOUT_MS = 8000

function fallbackMilestones(skill) {
  return {
    items: [
      { step: 1, title: `Review ${skill} fundamentals` },
      { step: 2, title: `Build a small ${skill} exercise` },
      { step: 3, title: 'Get feedback or compare against a reference solution' },
      { step: 4, title: 'Take the verification assessment' },
    ],
    source: 'fallback',
  }
}

function isValidMilestones(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (item) =>
        item &&
        Number.isFinite(item.step) &&
        typeof item.title === 'string' &&
        item.title.trim() !== ''
    )
  )
}

/**
 * Generate a 4-step checklist for moving a skill toward Verified.
 * Never throws: a missing key or any request or response problem returns the fallback.
 *
 * @param {string} skill - Skill name
 * @param {string} currentState - Current skill state code (e.g. 'C', 'S')
 * @returns {Promise<{items: Array<{step: number, title: string}>, source: 'ai' | 'fallback'}>}
 */
export async function generateSkillMilestones(skill, currentState) {
  const key = (import.meta.env.VITE_GEMINI_MILESTONES_KEY || '').trim()
  if (!key) return fallbackMilestones(skill)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const prompt =
      `Give exactly 4 short, concrete steps (each under 12 words) to take the skill "${skill}" ` +
      `from its current state "${currentState}" to Verified. ` +
      'Return strictly a JSON array of objects shaped { "step": number, "title": string }.'

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: 'application/json' },
        }),
        signal: controller.signal,
      }
    )
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)

    const data = await response.json()
    const milestones = JSON.parse(data.candidates[0].content.parts[0].text)
    if (!isValidMilestones(milestones)) throw new Error('unexpected response shape')

    return { items: milestones, source: 'ai' }
  } catch (err) {
    // Message only: the request URL contains the API key
    console.warn(`Gemini milestones unavailable, using fallback: ${err?.message}`)
    return fallbackMilestones(skill)
  } finally {
    clearTimeout(timer)
  }
}
