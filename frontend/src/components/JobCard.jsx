/**
 * ProofPass - Expanding Job Card Tile (JobCard.jsx)
 * WP6: Single <button> header, CSS grid-template-rows 0fr->1fr accordion,
 * inert panel when closed, MatchRing gauge, commit skill coverage bar,
 * clear CTA hierarchy, and mount stagger motion.
 */

import { useId } from 'react'
import MatchRing from './MatchRing.jsx'
import { getCompanyLogo } from './useLogo.js'

export default function JobCard({
  comp,
  index = 0,
  isSelected = false,
  isExpanded = false,
  onToggleExpand,
  onSelect,
  onApply,
  onOpenProofGap,
  onFocusMap,
  verifiedSkillSet = new Set()
}) {
  const panelId = useId()
  const isSmb = comp.tier === 'smb'
  const isRemote = comp.workMode === 'Remote'

  // Commit Skill Coverage metrics
  const verifiedCount = comp.requiredSkills.filter((sk) =>
    verifiedSkillSet.has(sk.toLowerCase())
  ).length
  const totalSkillsCount = comp.requiredSkills.length
  const coveragePercent = totalSkillsCount > 0
    ? Math.round((verifiedCount / totalSkillsCount) * 100)
    : 0

  // Mount animation delay capped at 8 items (320ms)
  const staggerDelay = index < 8 ? `${index * 40}ms` : '0ms'

  return (
    <article
      className={`jr-card ${isSelected ? 'is-selected' : ''} ${isExpanded ? 'is-expanded' : ''} ${isSmb ? 'is-smb' : ''}`}
      style={{ animationDelay: staggerDelay }}
      onClick={() => onSelect?.(comp)}
    >
      {/* 1. Compact Header as a Single Accessible Button */}
      <button
        type="button"
        id={`jr-card-header-${comp.id}`}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="jr-card__header-btn"
        onClick={(e) => {
          e.stopPropagation()
          onToggleExpand?.(comp)
          onSelect?.(comp)
        }}
      >
        <div className="jr-card__identity">
          <div className="radar-entity-frame">
            <img
              src={getCompanyLogo(comp.domain)}
              alt={`${comp.name} logo`}
              width="44"
              height="44"
              loading="lazy"
              decoding="async"
              className="radar-entity-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
            <div
              className="radar-avatar-badge"
              style={{
                background: `${comp.badgeColor}25`,
                color: comp.badgeColor
              }}
            >
              {comp.logo}
            </div>
          </div>

          <div className="jr-card__titles">
            <div className="jr-card__name-row">
              <h3 className="jr-card__company-name">{comp.name}</h3>
              <span className="corporate-verified-check" title="Cryptographically Verified Corporate Employer">
                ✓
              </span>
              {comp.smbFastTrack && (
                <span className="smb-fasttrack-tag" title="Fast-Track: Direct technical interview, skip resume screening">
                  ⚡ FAST-TRACK
                </span>
              )}
            </div>
            <div className="jr-card__role-title">{comp.roleTitle}</div>
            <p className="jr-card__meta">
              <span>📍 {comp.techPark}</span>
              <span className="dot-sep">·</span>
              {isRemote ? (
                <span className="remote-pill">🌐 100% Remote</span>
              ) : (
                <span className="jr-tabular">
                  🚗 {comp.distanceKm} km · ⏱️ {comp.transit?.travelTimeMinutes || 20}m
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Match Ring Gauge & Expand Indicator */}
        <div className="jr-card__match-cluster">
          <MatchRing score={comp.matchScore} size={38} strokeWidth={3.5} />
          <div className="jr-card__chevron-wrap">
            <span className="jr-card__chevron-label">{isExpanded ? 'Hide' : 'View'}</span>
            <span className={`expand-chevron ${isExpanded ? 'open' : ''}`} aria-hidden="true">
              ▾
            </span>
          </div>
        </div>
      </button>

      {/* 2. Expanding Panel via CSS Grid Template Rows (0fr -> 1fr) */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={`jr-card-header-${comp.id}`}
        className="jr-card__accordion"
        inert={!isExpanded ? '' : undefined}
      >
        <div className="jr-card__panel">
          <div className="jr-card__panel-inner">
            {/* Compensation & Work Mode Bar */}
            <div className="radar-stipend-row">
              <span className="radar-stipend-val">{comp.stipend}</span>
              <span className="dot-sep">·</span>
              <span className="workmode-text">{comp.workModeDesc}</span>
              <span className="dot-sep">·</span>
              <span className="opportunity-type-pill">{comp.opportunityType}</span>
            </div>

            {/* Transit Corridor & Metro Pill */}
            {!isRemote && comp.transit && (
              <div className="radar-transit-pill-row">
                <span className="radar-transit-badge">
                  ⚡ {comp.transit.travelTimeMinutes} mins commute via {comp.transit.corridorName || 'Expressway'}
                </span>
                <span className="radar-metro-badge">
                  🚇 {comp.transit.metroLine || 'Metro Connected'}
                </span>
              </div>
            )}

            {/* WP6 Skill Coverage Two-Tone Bar */}
            <div className="jr-card__coverage-block">
              <div className="jr-card__coverage-header">
                <span className="jr-card__coverage-title">Commit Proof Coverage</span>
                <span className="jr-card__coverage-stat jr-tabular">
                  {verifiedCount}/{totalSkillsCount} skills verified ({coveragePercent}%)
                </span>
              </div>
              <div className="jr-card__coverage-track" role="progressbar" aria-valuenow={coveragePercent} aria-valuemin="0" aria-valuemax="100">
                <div
                  className="jr-card__coverage-fill"
                  style={{ width: `${coveragePercent}%` }}
                />
              </div>
            </div>

            {/* Cryptographic Skill Verification Tags with +VERIFY Gap CTA */}
            <div className="radar-skill-tags" aria-label="Required skills and verification status">
              {comp.requiredSkills.map((sk) => {
                const isVerified = verifiedSkillSet.has(sk.toLowerCase())
                return isVerified ? (
                  <span
                    key={sk}
                    className="radar-skill-tag verified"
                    title="Skill verified via git commits on your cryptographic passport"
                  >
                    ✓ {sk}
                  </span>
                ) : (
                  <button
                    key={sk}
                    type="button"
                    className="radar-skill-tag clickable-gap"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenProofGap?.(sk, comp)
                    }}
                    title="Click to resolve Proof-Gap: Sign commit evidence to increase match score"
                  >
                    ○ {sk}
                    <span className="radar-gap-hint">+VERIFY</span>
                  </button>
                )
              })}
            </div>

            {/* Full Role & Team Description */}
            <p className="radar-comp-desc">{comp.description}</p>

            {/* 3. Strict CTA Hierarchy */}
            <div className="radar-card-actions">
              {/* Primary Filled Pill */}
              <button
                type="button"
                className="radar-action-btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  onApply?.(comp)
                }}
              >
                🚀 Apply with Passport
              </button>

              {/* External Corporate Portal Link */}
              <a
                href={comp.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="radar-secondary-link"
                onClick={(e) => e.stopPropagation()}
                title="Verify on official corporate career portal"
              >
                Official Portal ↗
              </a>

              {/* Tertiary / Ghost Focus Map Button */}
              <button
                type="button"
                className="radar-secondary-link map-focus-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onFocusMap?.(comp)
                }}
                title="Center and highlight beacon on map"
              >
                Focus Map 🎯
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * Accessible Loading Skeleton Tile with Smooth Shimmer
 */
export function JobCardSkeleton() {
  return (
    <div className="jr-card jr-skeleton" aria-hidden="true">
      <div className="jr-card__header-btn" style={{ cursor: 'default' }}>
        <div className="jr-card__identity">
          <div className="radar-entity-frame jr-skeleton__block jr-skeleton__logo" />
          <div className="jr-card__titles" style={{ width: '60%' }}>
            <div className="jr-skeleton__block jr-skeleton__text-lg" />
            <div className="jr-skeleton__block jr-skeleton__text-sm" />
            <div className="jr-skeleton__block jr-skeleton__text-xs" />
          </div>
        </div>
        <div className="jr-skeleton__block jr-skeleton__circle" />
      </div>
    </div>
  )
}
