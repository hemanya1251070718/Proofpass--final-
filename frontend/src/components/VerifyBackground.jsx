import { useEffect, useState } from 'react'

// Matches --bg in styles.css for each theme
const BG_DARK = '#151311'
const BG_LIGHT = '#f6f1e7'

export default function VerifyBackground() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return false
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr) return attr === 'dark'
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Watch data-theme with a MutationObserver so the colour switches the moment the theme toggles
  useEffect(() => {
    const checkTheme = () => {
      const attr = document.documentElement.getAttribute('data-theme')
      if (attr) {
        setIsDark(attr === 'dark')
      } else {
        setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
    }

    checkTheme()

    const observer = new MutationObserver(() => {
      checkTheme()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onMql = (e) => {
      if (!document.documentElement.getAttribute('data-theme')) {
        setIsDark(e.matches)
      }
    }
    mql.addEventListener('change', onMql)

    return () => {
      observer.disconnect()
      mql.removeEventListener('change', onMql)
    }
  }, [])

  return (
    <div
      className="verify-background"
      style={{ backgroundColor: isDark ? BG_DARK : BG_LIGHT }}
      aria-hidden="true"
    />
  )
}
