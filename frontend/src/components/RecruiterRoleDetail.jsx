/**
 * Recruiter Role Detail View Component
 * Provides:
 * 1. Leaderboard: Calm, aligned candidate ranking with neutral initials avatars,
 *    4 clean state toggles, quick view drawer, tie notes, search/filter/sort toolbar,
 *    and CSV export.
 * 2. No passport attached: CSV download of selected, batch passport upload pipeline with consent check.
 * 3. Requirements: Editable role criteria, importance weighting, job description import, and demo CV viewer.
 */

import { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getRole, updateRole } from '../api/roles.js'
import { listApplicantsForRole } from '../api/applicants.js'
import { listPassports } from '../api/passports.js'
import { rankApplicants } from '../lib/rank.js'
import { getSkillsByState } from '../lib/skillsByState.js'
import { L } from '../data.js'
import { RM } from '../lib.js'
import RoleHeader from './recruiter/RoleHeader.jsx'
import RoleSummary from './recruiter/RoleSummary.jsx'
import LeaderboardToolbar from './recruiter/LeaderboardToolbar.jsx'
import LeaderboardStatesExplainer from './recruiter/LeaderboardStatesExplainer.jsx'
import CandidateRow from './recruiter/CandidateRow.jsx'
import CandidateDrawer from './recruiter/CandidateDrawer.jsx'
import { NoPassportTab } from './recruiter/NoPassportTab.jsx'
import { RequirementsTab } from './recruiter/RequirementsTab.jsx'

export default function RecruiterRoleDetail() {
  const { roleId } = useParams()

  const [role, setRole] = useState(null)
  const [activeTab, setActiveTab] = useState('leaderboard')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)
  const [openPanels, setOpenPanels] = useState({}) // { [candidateId]: 'V' | 'S' | 'C' | 'X' | null }
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const [showStatesExplainer, setShowStatesExplainer] = useState(true)
  const [newlyAddedIds, setNewlyAddedIds] = useState(new Set())

  // Leaderboard Toolbar Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'contradicted' | '80plus'
  const [activeSort, setActiveSort] = useState('rank') // 'rank' | 'match' | 'verified' | 'fewest_contradicted'

  // Quick View Drawer candidate
  const [drawerCandidate, setDrawerCandidate] = useState(null) // null | { candidate, displayedName }

  // Candidate Data
  const [applicantsWithPassport, setApplicantsWithPassport] = useState([])
  const [applicantsNoPassport, setApplicantsNoPassport] = useState([])

  // Shared anonymous screening state in sessionStorage
  const [hideNames, setHideNames] = useState(() => {
    try {
      return sessionStorage.getItem('pp_recruiter_hide_names') === 'true'
    } catch {
      return false
    }
  })

  const handleToggleHideNames = (val) => {
    setHideNames(val)
    if (val) {
      setSearchQuery('')
    }
    try {
      sessionStorage.setItem('pp_recruiter_hide_names', String(val))
    } catch {
      // storage restricted
    }
  }

  // Candidate Comparison Selection State per role (key: pp-compare-<roleId>)
  const [compareIds, setCompareIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem(`pp-compare-${roleId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          return new Set(parsed.slice(0, 3))
        }
      }
    } catch {
      // storage restricted
    }
    return new Set()
  })

  // Prune stored IDs that no longer exist once candidates load
  useEffect(() => {
    if (applicantsWithPassport.length > 0) {
      const validIds = new Set(applicantsWithPassport.map((a) => a.id))
      setCompareIds((prev) => {
        let changed = false
        const next = new Set()
        prev.forEach((id) => {
          if (validIds.has(id)) {
            next.add(id)
          } else {
            changed = true
          }
        })
        if (changed) {
          try {
            sessionStorage.setItem(`pp-compare-${roleId}`, JSON.stringify(Array.from(next)))
          } catch {
            // storage restricted
          }
          return next
        }
        return prev
      })
    }
  }, [applicantsWithPassport, roleId])

  const handleToggleCompare = (id) => {
    setCompareIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= 3) return prev // Max 3 candidates
        next.add(id)
      }
      try {
        sessionStorage.setItem(`pp-compare-${roleId}`, JSON.stringify(Array.from(next)))
      } catch {
        // storage restricted
      }
      return next
    })
  }

  const handleClearCompare = () => {
    setCompareIds(new Set())
    try {
      sessionStorage.removeItem(`pp-compare-${roleId}`)
    } catch {
      // storage restricted
    }
  }

  const [isSavingRole, setIsSavingRole] = useState(false)

  const handleDirectGeneratePassports = async (generatedIds) => {
    setNewlyAddedIds((prev) => new Set([...prev, ...generatedIds]))
    await loadRoleData()
    setActiveTab('leaderboard')
    setNotice(
      `Directly generated passports for ${generatedIds.length} candidate(s). Promoted to Leaderboard and highlighted below.`
    )
    setLiveAnnouncement(
      `Promoted ${generatedIds.length} candidate(s) to Leaderboard.`
    )
  }

  const handleUpdateRole = async (payload) => {
    setIsSavingRole(true)
    try {
      const updated = await updateRole(roleId, payload)
      setRole(updated)
      setNotice('Role requirements updated.')
    } catch (err) {
      setNotice(err.message)
    } finally {
      setIsSavingRole(false)
    }
  }

  // Load role and applicants
  const loadRoleData = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const r = await getRole(roleId)
      setRole(r)

      const { withPassport, noPassport } = await listApplicantsForRole(roleId)

      // Fetch all stored passports from backend database and browser
      const browserPassports = await listPassports()

      let combinedWithPassport = [...withPassport]
      const existingPassportIds = new Set(
        combinedWithPassport.map((a) => a.passport?.id || a.passport?.passport_id || a.id)
      )

      // Extract role skills (lowercase) for smart matching
      const roleSkillNames = (r.requiredSkills || []).map((req) =>
        (req.skill || req.name || '').toLowerCase().trim()
      )
      const roleTitleClean = (r.title || '').toLowerCase().trim()

      for (const p of browserPassports) {
        if (p.revoked || p.legacy) continue  // legacy client-sealed records are not ranked

        const pId = p.id || p.passport_id
        if (!pId || existingPassportIds.has(pId) || existingPassportIds.has(`live_${pId}`)) {
          continue
        }

        const pRoleClean = (p.targetRole || p.target_role || '').toLowerCase().trim()
        const pSkills = p.skills || []

        // Match if:
        // 1) Target role overlaps with current role title
        // 2) Any passport skill overlaps with role required skills
        // 3) Or target role is generic / unassigned / freshly generated
        const hasRoleOverlap =
          pRoleClean &&
          (roleTitleClean.includes(pRoleClean.slice(0, 10)) ||
            pRoleClean.includes(roleTitleClean.slice(0, 10)))

        const hasSkillOverlap = pSkills.some((s) => {
          const sName = (s.skill || s.name || '').toLowerCase().trim()
          return roleSkillNames.includes(sName)
        })

        // Always show live candidates if role or skill matches, or default candidate pool
        if (
          hasRoleOverlap ||
          hasSkillOverlap ||
          !pRoleClean ||
          pRoleClean === 'software engineer' ||
          pRoleClean === 'full-stack engineer'
        ) {
          combinedWithPassport.unshift({
            id: `live_${pId}`,
            name: p.candidate || p.candidate_name || (p.github_login ? `@${p.github_login}` : 'Applicant'),
            email:
              p.email ||
              `${(p.candidate || p.github_login || 'applicant').toLowerCase().replace(/\s+/g, '.')}@proofpass.live`,
            hasPassport: true,
            passport: p,
            isLiveDemo: true,
            isDemo: Boolean(p.isDemo),
            skills: pSkills,
          })
          existingPassportIds.add(pId)
          existingPassportIds.add(`live_${pId}`)
        }
      }

      setApplicantsWithPassport(combinedWithPassport)
      setApplicantsNoPassport(noPassport)
      if (!silent) setLoading(false)
    } catch (err) {
      if (!silent) {
        setNotice(err.message)
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadRoleData()
    // Dynamic polling every 2.5s to sync newly generated passports across browsers
    const interval = setInterval(() => {
      loadRoleData(true)
    }, 2500)
    return () => clearInterval(interval)
  }, [roleId])

  // Ranked Leaderboard computation using rankApplicants pure function
  const rankedCandidates = useMemo(() => {
    if (!role) return []
    return rankApplicants(role, applicantsWithPassport)
  }, [role, applicantsWithPassport])

  // Filtered and Sorted Candidate View
  const displayedCandidates = useMemo(() => {
    let list = [...rankedCandidates]

    // 1. Search Query (Disabled in anonymous mode)
    if (!hideNames && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((c) => (c.name || '').toLowerCase().includes(q))
    }

    // 2. Dropdown Filter
    if (activeFilter === 'contradicted') {
      list = list.filter((c) => (c.contradictedCount || 0) > 0)
    } else if (activeFilter === '80plus') {
      list = list.filter((c) => (c.score || 0) >= 80)
    }

    // 3. Dropdown Sort (Official c.rank is strictly preserved)
    if (activeSort === 'match') {
      list.sort((a, b) => (b.score || 0) - (a.score || 0) || a.rank - b.rank)
    } else if (activeSort === 'verified') {
      list.sort(
        (a, b) => (b.verifiedReqCount || 0) - (a.verifiedReqCount || 0) || a.rank - b.rank
      )
    } else if (activeSort === 'fewest_contradicted') {
      list.sort(
        (a, b) => (a.contradictedCount || 0) - (b.contradictedCount || 0) || a.rank - b.rank
      )
    } else {
      // Default: Official Rank
      list.sort((a, b) => a.rank - b.rank)
    }

    return list
  }, [rankedCandidates, hideNames, searchQuery, activeFilter, activeSort])

  // In-card skills panel handlers
  const handleToggleTile = (candidateId, stateKey, count, dispName) => {
    if (count === 0) return
    setOpenPanels((prev) => {
      const isCurrent = prev[candidateId] === stateKey
      const nextState = isCurrent ? null : stateKey
      if (nextState) {
        const stateName = L[stateKey] || stateKey
        setLiveAnnouncement(`Showing ${count} ${stateName} skills for ${dispName}`)
      }
      return { ...prev, [candidateId]: nextState }
    })
  }

  const handleClosePanel = (candidateId, stateKey) => {
    setOpenPanels((prev) => ({ ...prev, [candidateId]: null }))
    setTimeout(() => {
      const tileBtn = document.getElementById(`tile-btn-${candidateId}-${stateKey}`)
      if (tileBtn) {
        tileBtn.focus()
      }
    }, 0)
  }

  // Quick View Drawer handlers
  const handleOpenDrawer = (candidate, displayedName) => {
    setDrawerCandidate({ candidate, displayedName })
  }

  const handleCloseDrawer = () => {
    setDrawerCandidate(null)
  }

  // Frontend CSV Export of visible leaderboard
  const handleExportLeaderboardCsv = () => {
    if (displayedCandidates.length === 0) {
      setNotice('No candidates available to export.')
      return
    }

    const headers = [
      'Rank',
      'Name',
      'Match %',
      'Verified',
      'Supported',
      'Claimed',
      'Contradicted',
    ]

    const rows = displayedCandidates.map((c) => {
      const sbs = getSkillsByState(c.passport, role)
      const name = hideNames
        ? `Candidate #${c.rank.toString().padStart(2, '0')}`
        : c.name

      return [
        c.rank,
        `"${name.replace(/"/g, '""')}"`,
        `${c.score}%`,
        sbs.V.length,
        sbs.S.length,
        sbs.C.length,
        sbs.X.length,
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const safeTitle = (role?.title || 'Role').replace(/[^a-zA-Z0-9_-]+/g, '_')
    link.download = `${safeTitle}_Leaderboard.csv`
    link.click()
    URL.revokeObjectURL(url)
    setNotice(
      `Exported ${displayedCandidates.length} candidate record${displayedCandidates.length > 1 ? 's' : ''} to CSV.`
    )
  }



  // Underline Tabs Configuration with ARIA arrow navigation
  const tabs = [
    { id: 'leaderboard', label: 'Leaderboard', count: rankedCandidates.length },
    {
      id: 'nopassport',
      label: 'No passport attached',
      count: applicantsNoPassport.length,
    },
    { id: 'requirements', label: 'Requirements & CV' },
  ]

  const tabListRef = useRef(null)

  const handleTabKeyDown = (e, currentIdx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const diff = e.key === 'ArrowRight' ? 1 : -1
    const nextIdx = (currentIdx + diff + tabs.length) % tabs.length
    const nextTab = tabs[nextIdx]
    setActiveTab(nextTab.id)
    if (nextTab.id === 'leaderboard') {
      loadRoleData()
    }
    const buttons = tabListRef.current?.querySelectorAll('button[role="tab"]')
    buttons?.[nextIdx]?.focus()
  }

  // Loading skeleton state
  if (loading || !role) {
    return (
      <main id="main" className="dash-page">
        <div className="w">
          <div
            className="skeleton-list"
            aria-busy="true"
            aria-label="Loading role evaluation workspace"
          >
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`skeleton-row ${RM ? 'rm' : ''}`}>
                <div className="skeleton-bar skeleton-w-24" />
                <div className="skeleton-bar skeleton-w-180" />
                <div className="skeleton-bar skeleton-w-60" />
                <div className="skeleton-bar skeleton-w-240" />
                <div className="skeleton-bar skeleton-w-90" />
              </div>
            ))}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main
      id="main"
      className={`dash-page ${compareIds.size >= 2 ? 'pad-b-compare' : ''}`}
    >
      <div className="w">
        {/* Step 2: Role Header */}
        <RoleHeader
          role={role}
          onEditRequirements={() => setActiveTab('requirements')}
          onExportCsv={handleExportLeaderboardCsv}
        />

        {/* Step 3: Summary Strip */}
        <RoleSummary
          applicantsWithPassport={applicantsWithPassport}
          applicantsNoPassport={applicantsNoPassport}
          rankedCandidates={rankedCandidates}
        />

        {notice && (
          <div className="login-notice mb-20" role="status">
            <span className="notice-dot" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}

        {rankedCandidates.some((c) => c.isDemo) && (
          <div className="login-notice" role="note">
            <span className="notice-dot" aria-hidden="true" />
            <span>
              Rows tagged <strong>DEMO DATA</strong> are browser-seeded sample candidates for demonstration. They are not real applicants and their passports were not issued by the verification engine.
            </span>
          </div>
        )}

        {/* Step 4: Underline Tabs with ARIA navigation */}
        <div className="role-tablist-wrap">
          <ul
            ref={tabListRef}
            className="role-tablist"
            role="tablist"
            aria-label="Role evaluation views"
          >
            {tabs.map((tab, idx) => {
              const isSelected = activeTab === tab.id
              return (
                <li key={tab.id} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`role-tab-${tab.id}`}
                    aria-selected={isSelected}
                    aria-controls={`role-tabpanel-${tab.id}`}
                    tabIndex={isSelected ? 0 : -1}
                    className="role-tab-btn"
                    onClick={() => {
                      if (tab.id === 'leaderboard') {
                        loadRoleData()
                      }
                      setActiveTab(tab.id)
                    }}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined && (
                      <span className="role-tab-count">({tab.count})</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        {/* TAB 1: LEADERBOARD */}
        {activeTab === 'leaderboard' && (
          <div
            id="role-tabpanel-leaderboard"
            role="tabpanel"
            aria-labelledby="role-tab-leaderboard"
            className="table-card glass card-pad-24"
          >
            {/* Screen Reader Live Announcement */}
            <div aria-live="polite" className="sr-only">
              {liveAnnouncement}
            </div>

            {/* States Explainer Card: Clear, prominent, and readable */}
            <LeaderboardStatesExplainer
              isOpen={showStatesExplainer}
              onToggle={() => setShowStatesExplainer((prev) => !prev)}
            />

            {/* Newly Added Candidates Banner */}
            {newlyAddedIds.size > 0 && (
              <div className="newly-added-banner" role="status">
                <div className="newly-added-banner-content">
                  <span className="newly-added-icon">⚡</span>
                  <span>
                    <strong>{newlyAddedIds.size} candidate(s)</strong> have been directly generated and promoted to the leaderboard! Highlighted below.
                  </span>
                </div>
                <button
                  type="button"
                  className="b sm g"
                  onClick={() => setNewlyAddedIds(new Set())}
                >
                  Dismiss highlights
                </button>
              </div>
            )}

            {/* Step 5: Leaderboard Toolbar */}
            <LeaderboardToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              filterValue={activeFilter}
              onFilterChange={setActiveFilter}
              sortValue={activeSort}
              onSortChange={setActiveSort}
              hideNames={hideNames}
              onToggleHideNames={handleToggleHideNames}
              totalCount={rankedCandidates.length}
              visibleCount={displayedCandidates.length}
              showStatesExplainer={showStatesExplainer}
              onToggleStatesExplainer={() => setShowStatesExplainer((prev) => !prev)}
              onResetFilters={() => {
                setSearchQuery('')
                setActiveFilter('all')
                setActiveSort('rank')
              }}
            />

            {/* Candidate List / Grid */}
            <div className="leaderboard-wrapper">
              {displayedCandidates.length === 0 ? (
                <div className="lb-empty-filter">
                  <p>
                    {rankedCandidates.length === 0
                      ? 'No candidates with verified passports attached to this role yet.'
                      : 'No candidates match the current filter or search criteria.'}
                  </p>
                  {(activeFilter !== 'all' || searchQuery.trim() !== '' || activeSort !== 'rank') && (
                    <button
                      type="button"
                      className="b sm g"
                      onClick={() => {
                        setSearchQuery('')
                        setActiveFilter('all')
                        setActiveSort('rank')
                      }}
                    >
                      Show all candidates
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="leaderboard-header" role="row" aria-hidden="true">
                    <div className="lb-col-h">Rank</div>
                    <div className="lb-col-h">Candidate</div>
                    <div className="lb-col-h">Match</div>
                    <div className="lb-col-h">Skills</div>
                    <div className="lb-col-h lb-col-h-actions" />
                  </div>

                  <ul className="leaderboard-list" role="list">
                    {displayedCandidates.map((c, idx) => {
                      const openState = openPanels[c.id] || null

                      // Tie note calculation relative to full ranked leaderboard
                      let tieNote = null
                      const nextCandidate = rankedCandidates[c.rank] // next ranked candidate
                      if (nextCandidate && nextCandidate.score === c.score) {
                        const nextName = hideNames
                          ? `Candidate #${nextCandidate.rank.toString().padStart(2, '0')}`
                          : nextCandidate.name
                        let reason = 'fresher verification timestamp'
                        if (c.verifiedReqCount > nextCandidate.verifiedReqCount) {
                          reason = `more verified required skills (${c.verifiedReqCount} vs ${nextCandidate.verifiedReqCount})`
                        } else if (c.contradictedCount < nextCandidate.contradictedCount) {
                          reason =
                            c.contradictedCount === 0
                              ? `no contradicted skills (0 vs ${nextCandidate.contradictedCount})`
                              : `fewer contradicted skills (${c.contradictedCount} vs ${nextCandidate.contradictedCount})`
                        }
                        tieNote = `Ranked above ${nextName}: ${reason}`
                      }

                      return (
                        <CandidateRow
                          key={c.id}
                          candidate={c}
                          role={role}
                          hideNames={hideNames}
                          openState={openState}
                          onToggleState={handleToggleTile}
                          onCloseState={handleClosePanel}
                          onOpenDrawer={handleOpenDrawer}
                          isCompared={compareIds.has(c.id)}
                          canCompare={compareIds.size < 3}
                          onToggleCompare={handleToggleCompare}
                          tieNote={tieNote}
                          isNewlyAdded={newlyAddedIds.has(c.id)}
                        />
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: NO PASSPORT ATTACHED */}
        {activeTab === 'nopassport' && (
          <NoPassportTab
            applicantsNoPassport={applicantsNoPassport}
            role={role}
            roleId={roleId}
            onReloadRole={loadRoleData}
            onNavigateTab={setActiveTab}
            onDirectGeneratePassports={handleDirectGeneratePassports}
            setNotice={setNotice}
          />
        )}

        {/* TAB 3: REQUIREMENTS & DEMO CV */}
        {activeTab === 'requirements' && (
          <RequirementsTab
            role={role}
            onSaveRole={handleUpdateRole}
            isSaving={isSavingRole}
            setNotice={setNotice}
          />
        )}
      </div>

      {/* Quick View Drawer */}
      {drawerCandidate && (
        <CandidateDrawer
          candidate={drawerCandidate.candidate}
          role={role}
          isOpen={Boolean(drawerCandidate)}
          onClose={handleCloseDrawer}
          displayedName={drawerCandidate.displayedName}
        />
      )}

      {/* Sticky Bottom Compare Bar (when 2 or 3 candidates are selected) */}
      {compareIds.size >= 2 && (
        <div className="sticky-compare-bar" role="region" aria-label="Candidate comparison toolbar">
          <div className="w sticky-compare-inner">
            <div className="sticky-compare-summary">
              <span className="compare-bar-badge" aria-hidden="true">
                {compareIds.size}
              </span>
              <div>
                <strong className="compare-bar-title">Compare {compareIds.size} candidates</strong>
                <span className="compare-bar-note">Side-by-side competency & evidence audit</span>
              </div>
            </div>

            <div className="sticky-compare-actions">
              <button
                type="button"
                className="b sm g"
                onClick={handleClearCompare}
              >
                Clear
              </button>
              <Link
                to={`/recruiter/role/${roleId}/compare?ids=${Array.from(compareIds).join(',')}`}
                className="b sm"
              >
                Compare →
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
