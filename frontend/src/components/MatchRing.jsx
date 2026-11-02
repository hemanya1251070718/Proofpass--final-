/**
 * ProofPass - Match Ring Gauge (MatchRing.jsx)
 * Enhanced with Anime.js spring stroke transition and fluid numeric counter roll.
 */

import { useEffect, useRef } from 'react'
import { animate } from 'animejs'

export default function MatchRing({ score = 0, size = 38, strokeWidth = 3.5 }) {
  const circleRef = useRef(null)
  const labelRef = useRef(null)
  const prevScoreRef = useRef(0)

  const radius = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const clampedScore = Math.min(100, Math.max(0, Number(score) || 0))
  const targetOffset = circumference - (clampedScore / 100) * circumference
  const isHigh = clampedScore >= 85
  const strokeColor = isHigh ? 'var(--jr-good, #22c55e)' : 'var(--jr-warn, #f59e0b)'

  useEffect(() => {
    // 1. Anime.js stroke-dashoffset transition
    if (circleRef.current) {
      animate(circleRef.current, {
        strokeDashoffset: targetOffset,
        duration: 750,
        ease: 'outCubic'
      })
    }

    // 2. Anime.js numeric score counter roll
    const obj = { val: prevScoreRef.current }
    animate(obj, {
      val: clampedScore,
      duration: 650,
      ease: 'outQuad',
      onUpdate: () => {
        if (labelRef.current) {
          labelRef.current.textContent = `${Math.round(obj.val)}%`
        }
      }
    })
    prevScoreRef.current = clampedScore
  }, [clampedScore, targetOffset])

  return (
    <div
      className="jr-match-ring"
      style={{ width: size, height: size }}
      title={`${clampedScore}% verified match`}
      aria-label={`${clampedScore}% match score`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="jr-match-ring__svg"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth={strokeWidth}
        />
        <circle
          ref={circleRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          strokeLinecap="round"
          className="jr-match-ring__progress"
        />
      </svg>
      <span ref={labelRef} className="jr-match-ring__label">{clampedScore}%</span>
    </div>
  )
}
