/**
 * ProofPass - Accessible Segmented Control (JrSegmented.jsx)
 * WP3: Sliding thumb using CSS ::before transition, radiogroup semantics,
 * ArrowLeft/Right keyboard navigation, and reduced-motion support.
 */

import { useRef } from 'react'

export default function JrSegmented({
  value,
  onChange,
  options = [
    { value: 'candidate', label: '👨‍💻 Candidate' },
    { value: 'recruiter', label: '🏢 Recruiter' }
  ]
}) {
  const containerRef = useRef(null)

  const handleKeyDown = (e) => {
    const currentIndex = options.findIndex((opt) => opt.value === value)
    if (currentIndex === -1) return

    let nextIndex = currentIndex
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % options.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + options.length) % options.length
    }

    if (nextIndex !== currentIndex) {
      onChange(options[nextIndex].value)
      const buttons = containerRef.current?.querySelectorAll('[role="radio"]')
      if (buttons && buttons[nextIndex]) {
        buttons[nextIndex].focus()
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className="jr-seg"
      data-value={value}
      role="radiogroup"
      aria-label="Perspective View Switch"
      onKeyDown={handleKeyDown}
    >
      {options.map((opt) => {
        const isChecked = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isChecked}
            tabIndex={isChecked ? 0 : -1}
            className={`jr-seg__btn ${isChecked ? 'is-selected' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
