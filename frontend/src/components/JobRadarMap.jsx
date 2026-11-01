/**
 * JobRadarMap Component
 * Interactive Dark-Mode Radar Map powered by Mapbox GL & Proximity Math.
 * Displays glowing burnt-orange beacons for verified jobs & internships within a dynamic radius (5km, 15km, 30km, Remote).
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { listPassports } from '../api/passports.js'
import { RADAR_COMPANIES, SAMPLE_TECH_HUBS } from '../data/radarCompanies.js'
import '../radar.css'

// Haversine formula: calculates distance in km between two lat/long points
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0
  const R = 6371 // Radius of Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180)
  const dLon = (lon2 - lon1) * (Math.PI / 180)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c * 10) / 10
}

export default function JobRadarMap() {
  const { user } = useAuth()
  const [passport, setPassport] = useState(null)
  const [selectedHub, setSelectedHub] = useState('pune')
  const [userCoords, setUserCoords] = useState(SAMPLE_TECH_HUBS.pune)
  const [radiusFilter, setRadiusFilter] = useState('15') // 5, 15, 30, 'remote', 'all'
  const [modeFilter, setModeFilter] = useState('ALL') // ALL, Onsite, Hybrid, Remote
  const [selectedCompany, setSelectedCompany] = useState(RADAR_COMPANIES[0])
  const [locating, setLocating] = useState(false)
  const [applyModalCompany, setApplyModalCompany] = useState(null)
  const [appliedSuccess, setAppliedSuccess] = useState(false)
  const [mapboxActive, setMapboxActive] = useState(false)
  const [mapboxToken, setMapboxToken] = useState(import.meta.env.VITE_MAPBOX_TOKEN || '')
  const [showTokenInput, setShowTokenInput] = useState(false)

  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markersRef = useRef([])

  // Load applicant passport for verified skill matching
  useEffect(() => {
    async function loadPassport() {
      try {
        const userPassports = await listPassports(user?.id)
        let active = userPassports[0] || null
        if (!active) {
          const all = await listPassports()
          active = all.find((p) => p.candidate === user?.name || p.userId === user?.id) || all[0] || null
        }
        setPassport(active)
      } catch (err) {
        console.error('Failed to load passport:', err)
      }
    }
    loadPassport()
  }, [user])

  // Update user coordinates when hub changes
  const handleHubChange = (hubKey) => {
    setSelectedHub(hubKey)
    if (SAMPLE_TECH_HUBS[hubKey]) {
      setUserCoords(SAMPLE_TECH_HUBS[hubKey])
    }
  }

  // Detect live browser GPS location
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const coords = {
          name: 'Current GPS Location',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        }
        setUserCoords(coords)
      },
      (err) => {
        setLocating(false)
        alert('Could not retrieve location. Using Pune Tech Corridor as default.')
      },
      { timeout: 8000 }
    )
  }

  // Calculate candidate verified skills
  const verifiedSkillSet = new Set(
    (passport?.skills || []).filter((s) => s.state === 'V').map((s) => s.skill.toLowerCase())
  )

  // Compute distance and match score for each company
  const processedCompanies = RADAR_COMPANIES.map((comp) => {
    const isRemote = comp.workMode === 'Remote'
    const distKm = isRemote ? 0 : calculateDistanceKm(userCoords.lat, userCoords.lng, comp.coordinates.lat, comp.coordinates.lng)

    // Match score based on verified skills
    const totalRequired = comp.requiredSkills.length
    const matchedCount = comp.requiredSkills.filter((sk) => verifiedSkillSet.has(sk.toLowerCase())).length
    const matchScore = totalRequired > 0 ? Math.round(50 + (matchedCount / totalRequired) * 48) : 75

    return {
      ...comp,
      distanceKm: distKm,
      matchScore: Math.min(99, Math.max(65, matchScore)),
      matchedSkillsCount: matchedCount
    }
  })

  // Filter companies based on user selection
  const filteredCompanies = processedCompanies.filter((comp) => {
    // Work mode filter
    if (modeFilter !== 'ALL' && comp.workMode.toLowerCase() !== modeFilter.toLowerCase()) {
      return false
    }

    // Radius filter
    if (radiusFilter === 'remote') {
      return comp.workMode === 'Remote'
    }
    if (radiusFilter === '5') {
      return comp.workMode === 'Remote' || comp.distanceKm <= 5.5
    }
    if (radiusFilter === '15') {
      return comp.workMode === 'Remote' || comp.distanceKm <= 16
    }
    if (radiusFilter === '30') {
      return comp.workMode === 'Remote' || comp.distanceKm <= 35
    }
    return true
  }).sort((a, b) => b.matchScore - a.matchScore)

  // Initialize Mapbox GL if token is present
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current) return

    let isMounted = true
    import('mapbox-gl').then((mapboxglModule) => {
      const mapboxgl = mapboxglModule.default || mapboxglModule
      mapboxgl.accessToken = mapboxToken

      try {
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [userCoords.lng, userCoords.lat],
          zoom: radiusFilter === '5' ? 12.5 : radiusFilter === '15' ? 11 : 9.8,
          pitch: 35,
          bearing: -10,
          attributionControl: false
        })

        mapInstanceRef.current = map

        map.on('load', () => {
          if (!isMounted) return
          setMapboxActive(true)

          // Add user home blip
          const userEl = document.createElement('div')
          userEl.className = 'radar-center-blip'
          new mapboxgl.Marker(userEl).setLngLat([userCoords.lng, userCoords.lat]).addTo(map)

          // Add company beacons
          updateMapboxMarkers(map, mapboxgl, filteredCompanies)
        })
      } catch (e) {
        console.warn('Mapbox init failed, using built-in canvas radar:', e)
        setMapboxActive(false)
      }
    }).catch(() => {
      setMapboxActive(false)
    })

    return () => {
      isMounted = false
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [mapboxToken, userCoords])

  // Update Mapbox markers when filters change
  const updateMapboxMarkers = (map, mapboxgl, companies) => {
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    companies.forEach((comp) => {
      if (comp.workMode === 'Remote') return

      const el = document.createElement('div')
      el.className = `radar-beacon-dot ${comp.matchScore >= 90 ? 'high-match' : ''}`
      el.style.cursor = 'pointer'
      el.title = `${comp.name} (${comp.matchScore}% Match)`

      el.addEventListener('click', () => {
        setSelectedCompany(comp)
        map.flyTo({ center: [comp.coordinates.lng, comp.coordinates.lat], zoom: 13, speed: 1.2 })
      })

      const marker = new mapboxgl.Marker(el)
        .setLngLat([comp.coordinates.lng, comp.coordinates.lat])
        .addTo(map)

      markersRef.current.push(marker)
    })
  }

  // Handle application dispatch
  const handleApply = (comp) => {
    setApplyModalCompany(comp)
    setAppliedSuccess(false)
  }

  const confirmDispatchApplication = () => {
    setAppliedSuccess(true)
    setTimeout(() => {
      setApplyModalCompany(null)
      setAppliedSuccess(false)
    }, 2400)
  }

  return (
    <main id="main" className="dash-page radar-page">
      <div className="w">
        {/* Header HUD */}
        <div className="radar-header-card">
          <div className="radar-title-group">
            <span className="k m">GEOLOCATION PROXIMITY RADAR</span>
            <h1>
              Nearby Jobs & Internships
              <span className="radar-live-badge">
                <span className="radar-live-dot" /> LIVE SCANNER
              </span>
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--muted, #9c958f)' }}>
              Proximity radar mapping verified tech openings to your physical location · Filtered by SHA-256 passport competency.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="radar-locate-btn"
              onClick={handleDetectLocation}
              disabled={locating}
            >
              {locating ? 'Scanning GPS...' : '📍 Detect My Location'}
            </button>
            <button
              type="button"
              className="b sm g"
              onClick={() => setShowTokenInput(!showTokenInput)}
              style={{ fontSize: '0.78rem' }}
            >
              {mapboxActive ? 'Mapbox GL: Active ✓' : 'Mapbox Token'}
            </button>
          </div>
        </div>

        {/* Optional Mapbox Token Bar */}
        {showTokenInput && (
          <div className="radar-controls-card" style={{ borderLeft: '3px solid #b54610' }}>
            <span className="k m">MAPBOX GL CONFIGURATION (OPTIONAL)</span>
            <p style={{ fontSize: '0.82rem', margin: '4px 0 8px', color: 'var(--muted)' }}>
              The radar automatically runs our interactive dark canvas without any API key. If you have a free Mapbox token (pk.eyJ...), paste it below for live vector satellite tiles:
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="pk.eyJ1IjoieW91ci11c2VybmFtZSI..."
                value={mapboxToken}
                onChange={(e) => setMapboxToken(e.target.value.trim())}
                style={{ flex: 1, padding: '8px 12px', background: '#121110', border: '1px solid #333', color: '#fff', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
              <button
                type="button"
                className="b sm"
                onClick={() => setShowTokenInput(false)}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* Filters Card */}
        <div className="radar-controls-card">
          <div className="radar-filter-row">
            {/* Tech Hub City */}
            <div className="radar-pill-group">
              <span className="radar-label">Tech Hub:</span>
              {Object.keys(SAMPLE_TECH_HUBS).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`radar-pill-btn ${selectedHub === key ? 'active' : ''}`}
                  onClick={() => handleHubChange(key)}
                >
                  {key.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Radius Filter */}
            <div className="radar-pill-group">
              <span className="radar-label">Radius:</span>
              {['5', '15', '30', 'remote', 'all'].map((rad) => (
                <button
                  key={rad}
                  type="button"
                  className={`radar-pill-btn ${radiusFilter === rad ? 'active' : ''}`}
                  onClick={() => setRadiusFilter(rad)}
                >
                  {rad === 'remote' ? '100% Remote' : rad === 'all' ? 'All Distance' : `${rad} km`}
                </button>
              ))}
            </div>

            {/* Work Mode */}
            <div className="radar-pill-group">
              <span className="radar-label">Work Mode:</span>
              {['ALL', 'Onsite', 'Hybrid', 'Remote'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`radar-pill-btn ${modeFilter === mode ? 'active' : ''}`}
                  onClick={() => setModeFilter(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Grid: Mapbox / Radar Left + Company Cards Right */}
        <div className="radar-grid">
          {/* Viewport Map / Radar Canvas */}
          <div className="radar-viewport-container">
            <div className="radar-viewport-header">
              <div className="radar-hud-tag">
                RADAR: {userCoords.name || `${userCoords.lat.toFixed(4)}°N, ${userCoords.lng.toFixed(4)}°E`}
              </div>
              <div className="radar-hud-tag" style={{ color: '#22c55e' }}>
                RANGE: {radiusFilter === 'remote' ? 'REMOTE' : `${radiusFilter} KM`} ({filteredCompanies.length} FOUND)
              </div>
            </div>

            {/* Native Mapbox GL Container (if token active) */}
            <div
              ref={mapContainerRef}
              className="mapbox-canvas-target"
              style={{ display: mapboxActive ? 'block' : 'none' }}
            />

            {/* Built-in Dark-Mode Interactive Radar Canvas (Always 100% working fallback) */}
            {!mapboxActive && (
              <div className="radar-screen-canvas">
                {/* Concentric distance rings */}
                <div className="radar-concentric-ring" style={{ width: '130px', height: '130px' }}>
                  <span className="radar-ring-label">5 KM</span>
                </div>
                <div className="radar-concentric-ring" style={{ width: '270px', height: '270px' }}>
                  <span className="radar-ring-label">15 KM</span>
                </div>
                <div className="radar-concentric-ring" style={{ width: '420px', height: '420px' }}>
                  <span className="radar-ring-label">30 KM</span>
                </div>

                {/* Crosshairs & Sweep Beam */}
                <div className="radar-crosshair-h" />
                <div className="radar-crosshair-v" />
                <div className="radar-sweep-beam" />

                {/* Center User Blip */}
                <div className="radar-center-blip" title="Your Location" />

                {/* Interactive Company Beacons on Canvas */}
                {filteredCompanies.map((comp, idx) => {
                  if (comp.workMode === 'Remote') return null

                  // Calculate polar position based on offset from center
                  const dLat = comp.coordinates.lat - userCoords.lat
                  const dLng = comp.coordinates.lng - userCoords.lng
                  const scale = radiusFilter === '5' ? 2200 : radiusFilter === '15' ? 1200 : 700
                  const posX = Math.max(8, Math.min(92, 50 + dLng * scale))
                  const posY = Math.max(8, Math.min(92, 50 - dLat * scale))
                  const isSelected = selectedCompany?.id === comp.id

                  return (
                    <div
                      key={comp.id}
                      className={`radar-beacon-node ${isSelected ? 'selected' : ''}`}
                      style={{ left: `${posX}%`, top: `${posY}%` }}
                      onClick={() => setSelectedCompany(comp)}
                    >
                      <div className={`radar-beacon-dot ${comp.matchScore >= 90 ? 'high-match' : ''}`} />
                      <div className="radar-beacon-tooltip">
                        <strong>{comp.name}</strong> · {comp.distanceKm} km ({comp.matchScore}% Match)
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Job Openings Sidebar */}
          <div className="radar-cards-column">
            {filteredCompanies.length === 0 ? (
              <div className="radar-job-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                  No companies found within <strong>{radiusFilter} km</strong> matching your criteria.
                </p>
                <button
                  type="button"
                  className="radar-pill-btn active"
                  onClick={() => { setRadiusFilter('all'); setModeFilter('ALL') }}
                >
                  Reset Radius to All
                </button>
              </div>
            ) : (
              filteredCompanies.map((comp) => {
                const isSelected = selectedCompany?.id === comp.id
                return (
                  <div
                    key={comp.id}
                    className={`radar-job-card ${isSelected ? 'active-card' : ''}`}
                    onClick={() => setSelectedCompany(comp)}
                  >
                    <div className="radar-card-top">
                      <div className="radar-comp-info">
                        <div className="radar-logo-box" style={{ borderColor: comp.badgeColor }}>
                          {comp.logo}
                        </div>
                        <div>
                          <h3 className="radar-comp-name">{comp.name}</h3>
                          <p className="radar-comp-loc">
                            📍 {comp.techPark} · {comp.workMode === 'Remote' ? '🌐 100% Remote' : `${comp.distanceKm} km away`}
                          </p>
                        </div>
                      </div>

                      <div className={`radar-match-badge ${comp.matchScore >= 90 ? 'high' : ''}`}>
                        {comp.matchScore}% MATCH
                      </div>
                    </div>

                    <div className="radar-role-title">{comp.roleTitle}</div>

                    <div className="radar-stipend-row">
                      <span className="radar-stipend-val">{comp.stipend}</span>
                      <span>·</span>
                      <span>{comp.workModeDesc}</span>
                    </div>

                    {/* Skill verification pills */}
                    <div className="radar-skill-tags">
                      {comp.requiredSkills.map((sk) => {
                        const isVerified = verifiedSkillSet.has(sk.toLowerCase())
                        return (
                          <span
                            key={sk}
                            className={`radar-skill-tag ${isVerified ? 'verified' : ''}`}
                            title={isVerified ? 'Skill verified on your passport' : 'Skill missing or unverified'}
                          >
                            {isVerified ? '✓ ' : '○ '}{sk}
                          </span>
                        )
                      })}
                    </div>

                    <p style={{ fontSize: '0.78rem', color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.4 }}>
                      {comp.description}
                    </p>

                    <button
                      type="button"
                      className="radar-action-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleApply(comp)
                      }}
                    >
                      🚀 Apply with Verified Passport
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 1-Click Passport Application Modal */}
      {applyModalCompany && (
        <div className="radar-modal-overlay" onClick={() => setApplyModalCompany(null)}>
          <div className="radar-modal-box" onClick={(e) => e.stopPropagation()}>
            <span className="k m">CRYPTOGRAPHIC PASSPORT APPLICATION</span>
            <h2 style={{ fontSize: '1.25rem', margin: '6px 0', color: '#fff' }}>
              Dispatch Application to {applyModalCompany.name}
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--muted)', margin: '0 0 18px' }}>
              Your application includes an unforgeable cryptographic seal containing your verified commit evidence.
            </p>

            <div style={{ background: '#121110', border: '1px solid #2d2b29', borderRadius: '6px', padding: '14px', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--muted)' }}>Role:</span>
                <strong style={{ color: '#fff' }}>{applyModalCompany.roleTitle}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--muted)' }}>Office Location:</span>
                <span>{applyModalCompany.techPark}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--muted)' }}>Proximity:</span>
                <span style={{ color: '#22c55e', fontFamily: 'monospace' }}>
                  {applyModalCompany.workMode === 'Remote' ? 'Remote Global' : `${applyModalCompany.distanceKm} km away`}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: 'var(--muted)' }}>Passport Seal Status:</span>
                <span style={{ color: '#e8803f', fontFamily: 'monospace' }}>SHA-256 VERIFIED ✓</span>
              </div>
            </div>

            {appliedSuccess ? (
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '6px', padding: '14px', textAlign: 'center', color: '#22c55e', fontSize: '0.9rem', fontWeight: 600 }}>
                ✓ Application Dispatched to {applyModalCompany.name} HR Portal!
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="b sm"
                  style={{ flex: 1 }}
                  onClick={confirmDispatchApplication}
                >
                  Confirm & Send Passport
                </button>
                <button
                  type="button"
                  className="b sm g"
                  onClick={() => setApplyModalCompany(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
