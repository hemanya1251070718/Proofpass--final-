/**
 * ProofPass - Luxury Engineering Job Card Tile (JobCard.jsx)
 * Designed to Audi, Tesla & Google Material You telemetry standards:
 * - Carbon glass backdrops & hairline architectural borders (zero AI-generated clutter)
 * - 4-cell partitioned Specification Matrix (Compensation, Work Model, Role Track, Commute)
 * - Clean vector SVG iconography (strictly zero cartoon emojis)
 * - Precision dark-slate skill verification chips with Proof-Gap CTA
 * - High-contrast CTA hierarchy with cryptographically stamped actions
 */

import { useId, useState } from 'react'
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
  const [imgFailed, setImgFailed] = useState(false)
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

  // Mount stagger animation delay capped at 8 items
  const staggerDelay = index < 8 ? `${index * 40}ms` : '0ms'

  // Parse stipend for spec matrix
  const stipendPrimary = comp.stipend?.split('·')[0]?.trim() || comp.stipend
  const stipendSub = comp.stipend?.split('·')[1]?.trim() || 'Annual Base'

  // Parse opportunity type
  const oppTypePrimary = comp.opportunityType?.split('/')[0]?.trim() || comp.opportunityType
  const oppTypeSub = comp.opportunityType?.split('/')[1]?.trim() || 'Direct Review'

  return (
    <article
      className={`jr-card ${isSelected ? 'is-selected' : ''} ${isExpanded ? 'is-expanded' : ''} ${isSmb ? 'is-smb' : ''}`}
      style={{ animationDelay: staggerDelay }}
      onClick={() => onSelect?.(comp)}
    >
      {/* 1. Header Button */}
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
            {!imgFailed ? (
              <img
                src={getCompanyLogo(comp.domain)}
                alt={`${comp.name} logo`}
                width="42"
                height="42"
                loading="lazy"
                decoding="async"
                className="radar-entity-logo"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <div
                className="radar-avatar-badge"
                style={{
                  background: `${comp.badgeColor}25`,
                  color: comp.badgeColor
                }}
              >
                {comp.logo}
              </div>
            )}
          </div>

          <div className="jr-card__titles">
            <div className="jr-card__name-row">
              <h3 className="jr-card__company-name">{comp.name}</h3>
              <span className="jr-verified-shield" title="Cryptographically Verified Corporate Entity">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M8 0c-.69 0-1.84.04-2.88.31-1.03.27-2.07.72-2.9 1.48-.42.38-.72.84-.94 1.34C1.06 3.63 1 4.2 1 4.8c0 4.24 2.87 8.35 6.38 10.95.37.28.87.28 1.24 0C12.13 13.15 15 9.04 15 4.8c0-.6-.06-1.17-.28-1.67-.22-.5-.52-.96-.94-1.34-.83-.76-1.87-1.21-2.9-1.48C9.84.04 8.69 0 8 0zm2.78 5.72a.75.75 0 0 0-1.06-1.06L6.5 7.88 5.28 6.66a.75.75 0 0 0-1.06 1.06l1.75 1.75c.3.3.77.3 1.06 0l3.75-3.75z" />
                </svg>
              </span>
              {comp.smbFastTrack && (
                <span className="jr-fasttrack-tag" title="Fast-Track: Direct technical review, skips resume filters">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span>DIRECT REVIEW</span>
                </span>
              )}
            </div>
            <div className="jr-card__role-title">{comp.roleTitle}</div>
            <div className="jr-card__meta">
              <span className="jr-meta-item">
                <svg className="jr-meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{comp.techPark}</span>
              </span>
              <span className="jr-dot-sep">·</span>
              {isRemote ? (
                <span className="jr-meta-item">
                  <svg className="jr-meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  <span>100% Remote</span>
                </span>
              ) : (
                <span className="jr-meta-item jr-tabular">
                  <svg className="jr-meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9C2.1 11.1 2 11.5 2 12v4c0 .6.4 1 1 1h2" />
                    <circle cx="7" cy="17" r="2" />
                    <path d="M9 17h6" />
                    <circle cx="17" cy="17" r="2" />
                  </svg>
                  <span>{comp.distanceKm} km</span>
                  <span className="jr-dot-sep">·</span>
                  <svg className="jr-meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>{comp.transit?.travelTimeMinutes || 20}m</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Match Ring Cluster */}
        <div className="jr-card__match-cluster">
          <MatchRing score={comp.matchScore} size={38} strokeWidth={3.5} />
          <div className="jr-card__chevron-wrap">
            <span className="jr-card__chevron-label">{isExpanded ? 'Hide' : 'Specs'}</span>
            <span className={`expand-chevron ${isExpanded ? 'open' : ''}`} aria-hidden="true">
              ▾
            </span>
          </div>
        </div>
      </button>

      {/* 2. Expanding Specification Matrix & Details */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={`jr-card-header-${comp.id}`}
        className="jr-card__accordion"
        inert={!isExpanded ? '' : undefined}
      >
        <div className="jr-card__panel">
          <div className="jr-card__panel-inner">
            {/* Tesla / Audi Specification Matrix */}
            <div className="jr-spec-matrix">
              <div className="jr-spec-cell">
                <span className="jr-spec-label">Compensation</span>
                <span className="jr-spec-value">{stipendPrimary}</span>
                <span className="jr-spec-sub">{stipendSub}</span>
              </div>
              <div className="jr-spec-cell">
                <span className="jr-spec-label">Work Arrangement</span>
                <span className="jr-spec-value">{comp.workMode}</span>
                <span className="jr-spec-sub">{comp.workModeDesc}</span>
              </div>
              <div className="jr-spec-cell">
                <span className="jr-spec-label">Employment Track</span>
                <span className="jr-spec-value">{oppTypePrimary}</span>
                <span className="jr-spec-sub">{oppTypeSub}</span>
              </div>
              <div className="jr-spec-cell">
                <span className="jr-spec-label">Transit Corridor</span>
                <span className="jr-spec-value">
                  {isRemote ? '0 mins' : `${comp.transit?.travelTimeMinutes || 20}m driving`}
                </span>
                <span className="jr-spec-sub">
                  {isRemote ? 'Digital Asynchronous' : (comp.transit?.corridorName || 'Direct Highway Route')}
                </span>
              </div>
            </div>

            {/* Public Transit / Corridor Strip */}
            {!isRemote && comp.transit && (
              <div className="jr-transit-strip">
                <div className="jr-transit-strip__left">
                  <svg className="jr-transit-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="4" y="3" width="16" height="16" rx="2" />
                    <path d="M4 11h16M12 3v8M8 19l-2 3M16 19l2 3" />
                    <circle cx="8" cy="15" r="1" fill="currentColor" />
                    <circle cx="16" cy="15" r="1" fill="currentColor" />
                  </svg>
                  <span className="jr-transit-strip__text">{comp.transit.metroLine}</span>
                </div>
                {comp.transit.peakTrafficPenalty && (
                  <span className="jr-transit-strip__badge">
                    Peak {comp.transit.peakTrafficPenalty}
                  </span>
                )}
              </div>
            )}

            {/* Cryptographic Proof Coverage Bar */}
            <div className="jr-coverage-block">
              <div className="jr-coverage-header">
                <div className="jr-coverage-label-wrap">
                  <svg className="jr-coverage-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span className="jr-coverage-title">Cryptographic Proof Coverage</span>
                </div>
                <span className="jr-coverage-stat jr-tabular">
                  {verifiedCount} of {totalSkillsCount} Verified <span className="jr-coverage-pct">({coveragePercent}%)</span>
                </span>
              </div>
              <div className="jr-coverage-track" role="progressbar" aria-valuenow={coveragePercent} aria-valuemin="0" aria-valuemax="100">
                <div
                  className="jr-coverage-fill"
                  style={{ width: `${coveragePercent}%` }}
                />
              </div>
            </div>

            {/* Precision Dark-Slate Skill Chips with Proof-Gap CTA */}
            <div className="jr-skill-chips-row" aria-label="Required skills and verification status">
              {comp.requiredSkills.map((sk) => {
                const isVerified = verifiedSkillSet.has(sk.toLowerCase())
                return isVerified ? (
                  <span
                    key={sk}
                    className="jr-skill-chip verified"
                    title="Skill verified via git commits on your cryptographic passport"
                  >
                    <svg className="jr-chip-check" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                    </svg>
                    <span className="jr-chip-name">{sk}</span>
                    <span className="jr-chip-tag-verified">Verified</span>
                  </span>
                ) : (
                  <button
                    key={sk}
                    type="button"
                    className="jr-skill-chip unverified"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenProofGap?.(sk, comp)
                    }}
                    title={`Resolve Proof-Gap: Sign commit evidence for ${sk}`}
                  >
                    <span className="jr-chip-plus">+</span>
                    <span className="jr-chip-name">{sk}</span>
                    <span className="jr-chip-tag-gap">Verify Proof</span>
                  </button>
                )
              })}
            </div>

            {/* Technical Role Context & Briefing */}
            <p className="jr-card-brief">{comp.description}</p>

            {/* High-Contrast Action Buttons */}
            <div className="jr-card-actions">
              <button
                type="button"
                className="jr-btn jr-btn--primary"
                onClick={(e) => {
                  e.stopPropagation()
                  onApply?.(comp)
                }}
              >
                <svg className="jr-btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <span>Apply with Passport</span>
              </button>

              <a
                href={comp.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="jr-btn jr-btn--secondary"
                onClick={(e) => e.stopPropagation()}
                title="Verify on official corporate career portal"
              >
                <span>Official Portal</span>
                <svg className="jr-btn-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>

              <button
                type="button"
                className="jr-btn jr-btn--ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  onFocusMap?.(comp)
                }}
                title="Highlight beacon and route on map"
              >
                <svg className="jr-btn-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="3" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
                <span>Locate</span>
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
