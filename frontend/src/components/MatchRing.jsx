/**
 * ProofPass - Match Ring Gauge (MatchRing.jsx)
 * WP6: Animated SVG circular gauge showing match percentage (green >= 85%, amber otherwise).
 */

export default function MatchRing({ score = 0, size = 38, strokeWidth = 3.5 }) {
  const radius = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * radius
  const clampedScore = Math.min(100, Math.max(0, Number(score) || 0))
  const offset = circumference - (clampedScore / 100) * circumference
  const isHigh = clampedScore >= 85
  const strokeColor = isHigh ? 'var(--jr-good, #22c55e)' : 'var(--jr-warn, #f59e0b)'

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
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="jr-match-ring__progress"
        />
      </svg>
      <span className="jr-match-ring__label">{clampedScore}%</span>
    </div>
  )
}

