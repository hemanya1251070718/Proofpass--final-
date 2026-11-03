/**
 * CandidateRow Component
 * Renders an aligned, high-whitespace candidate row on the shared grid.
 * Includes initials avatar, semibold name (opens quick drawer), tie-breaking note,
 * clean match number, 4 state toggles (opens in-row StatePanel), top skills line,
 * and 44px accessible action targets.
 */

import { Link } from 'react-router-dom'
import { RM } from '../../lib.js'
import { getSkillsByState } from '../../lib/skillsByState.js'
import StatePanel from './StatePanel.jsx'

export default function CandidateRow({
  candidate,
  role,
  hideNames,
  openState,
  onToggleState,
  onCloseState,
  onOpenDrawer,
  isCompared,
  canCompare,
  onToggleCompare,
  tieNote,
  isNewlyAdded = false,
}) {
  const skillsByState = getSkillsByState(candidate.passport, role)
  const countV = skillsByState.V.length
  const countS = skillsByState.S.length
  const countC = skillsByState.C.length
  const countX = skillsByState.X.length

  const displayedName = hideNames
    ? `Candidate #${candidate.rank.toString().padStart(2, '0')}`
    : candidate.name

  // Initials for avatar
  const initials = hideNames
    ? `#${candidate.rank}`
    : candidate.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()

  // Top skills text
  const topSkillsText = (candidate.matched || [])
    .slice(0, 3)
    .map((m) => m.skill)
    .join(', ')

  const stateButtons = [
    { key: 'V', count: countV, word: 'Verified', swatchClass: 'swatch-v' },
    { key: 'S', count: countS, word: 'Supported', swatchClass: 'swatch-s' },
    { key: 'C', count: countC, word: 'Claimed', swatchClass: 'swatch-c' },
    { key: 'X', count: countX, word: 'Contradicted', swatchClass: 'swatch-x' },
  ]

  return (
    <li
      className={`leaderboard-item ${openState ? 'has-open-panel' : ''} ${
        isNewlyAdded ? 'lb-row-newly-added' : ''
      }`}
    >
      {/* Col 1: Rank */}
      <div className="lb-cell lb-cell-rank">
        <span className="lb-rank-num">{candidate.rank}</span>
      </div>

      {/* Col 2: Candidate with neutral avatar */}
      <div className="lb-cell lb-cell-candidate">
        <div className="lb-cell-candidate-wrap">
          <div className="lb-avatar" aria-hidden="true">
            {initials}
          </div>

          <div className="lb-candidate-info-col">
            <div className="lb-primary-name">
              <button
                type="button"
                className="lb-candidate-name-btn"
                onClick={() => onOpenDrawer(candidate, displayedName)}
                title={`Open quick profile for ${displayedName}`}
              >
                {displayedName}
              </button>

              {candidate.isDemo && (
                <span className="lb-tag ml-6" title="Browser-seeded sample candidate. Not a real applicant and not backed by a verified passport.">
                  DEMO DATA
                </span>
              )}

              {isNewlyAdded && (
                <span className="lb-tag lb-tag-new">Newly added</span>
              )}
              {candidate.isLiveDemo && (
                <span className="lb-tag">Live demo</span>
              )}
              {candidate.isRecruiterGenerated && !isNewlyAdded && (
                <span className="lb-tag">Recruiter generated</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Col 3: Clean Match Number */}
      <div className="lb-cell lb-cell-match">
        <div className="lb-primary-match">
          <span className="lb-match-val lb-match-val-accent">{candidate.score}%</span>
          <span className="lb-match-lbl">match</span>
        </div>
      </div>

      {/* Col 4: Skills & 4 State Toggles */}
      <div className="lb-cell lb-cell-skills">
        <div className="lb-primary-states" role="group" aria-label="Candidate skill states">
          {stateButtons.map(({ key, count, word, swatchClass }) => {
            const isZero = count === 0
            const isSelected = openState === key
            const isContradictedWithCount = key === 'X' && count > 0

            return (
              <button
                key={key}
                type="button"
                id={`tile-btn-${candidate.id}-${key}`}
                className={`lb-state-btn ${swatchClass} ${isSelected ? 'selected' : ''} ${isContradictedWithCount ? 'contradicted-active' : ''}`}
                onClick={() => onToggleState(candidate.id, key, count, displayedName)}
                disabled={isZero}
                aria-disabled={isZero}
                aria-expanded={isSelected}
                aria-pressed={isSelected}
                aria-controls={`skills-panel-${candidate.id}`}
                title={isZero ? 'No skills in this state' : `${count} ${word} skills`}
              >
                <span className={`lb-state-swatch ${swatchClass}`} aria-hidden="true" />
                <span className="lb-state-count">{count}</span>
                <span className="lb-state-word">{word}</span>
              </button>
            )
          })}
        </div>

        {candidate.totalReqCount > 0 && (
          <div className="lb-skills-req-note">
            {candidate.verifiedReqCount} of {candidate.totalReqCount} required skills Verified
          </div>
        )}

        {topSkillsText && (
          <div className="lb-top-skills">
            <span className="lb-top-skills-lbl">Top skills:</span>
            <span>{topSkillsText}</span>
          </div>
        )}
      </div>

      {/* Col 5: Actions */}
      <div className="lb-cell lb-cell-actions">
        <label
          className="lb-compare-label"
          title={`Select ${displayedName} for comparison`}
        >
          <input
            type="checkbox"
            checked={isCompared}
            onChange={() => onToggleCompare(candidate.id)}
            disabled={!isCompared && !canCompare}
            aria-label={`Select ${displayedName} for comparison`}
          />
          <span>Compare</span>
        </label>

        {candidate.passport && (
          <Link
            to={`/passport/${candidate.passport.id}`}
            className="b sm g lb-view-passport-btn"
          >
            View passport
          </Link>
        )}
      </div>

      {/* In-Card Expandable State Skills Drawer Panel */}
      <div
        className={`lb-drawer-row ${openState ? 'open' : ''} ${RM ? 'rm' : ''}`}
      >
        <div className="lb-drawer-inner">
          {openState && (
            <StatePanel
              candidate={candidate}
              role={role}
              openState={openState}
              skillsByState={skillsByState}
              onClose={onCloseState}
              displayedName={displayedName}
            />
          )}
        </div>
      </div>
    </li>
  )
}
