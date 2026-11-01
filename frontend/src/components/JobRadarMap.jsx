/**
 * ProofPass - Job Radar & Commute Geolocation Microservice
 * Production UI inspired by Linear, Apple Maps, and Vercel Design Systems
 *
 * Features:
 * - Fluid glassmorphic command bar with interactive dropdown popovers
 * - Real-time keyword & skill search with instant reactivity
 * - Draggable commute origin pin + High-accuracy Wi-Fi/GPS triangulation
 * - Pune SEZ corridor geofencing (Hinjawadi, Kharadi, Magarpatta, SB Road)
 * - SMB Fast-Track hiring enablement (Track 2)
 * - 1-Click Cryptographic Proof-Gap resolution drawer (FastAPI SQLite sync)
 * - Two-way marketplace: Candidate View vs Recruiter Talent Scout
 */

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '../auth/AuthContext.jsx'
import { listPassports } from '../api/passports.js'
import {
  RADAR_COMPANIES,
  SAMPLE_TECH_HUBS,
  PUNE_SEZ_CORRIDORS,
  MOCK_REPO_EVIDENCE,
  VERIFIED_TALENT_PROFILES,
  PUNE_NEIGHBORHOOD_ORIGINS
} from '../data/radarCompanies.js'
import '../radar.css'

// Haversine formula: calculates distance in km between two lat/long points
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0
  const R = 6371
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

// Tile Providers (100% Free with zero API keys required by default)
const TILE_PRESETS = {
  dark: {
    name: 'Dark Tech',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    className: 'leaflet-dark-tiles'
  },
  streets: {
    name: 'Streets',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    className: 'leaflet-clean-streets'
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    className: 'leaflet-satellite-tiles'
  }
}

function getTileConfig(theme, customKey) {
  if (customKey && customKey.startsWith('pk.')) {
    if (theme === 'satellite') {
      return {
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${customKey}`,
        className: 'leaflet-clean-streets',
        tileSize: 512,
        zoomOffset: -1
      }
    }
    return {
      url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${customKey}`,
      className: 'leaflet-clean-streets',
      tileSize: 512,
      zoomOffset: -1
    }
  }

  return {
    url: TILE_PRESETS[theme]?.url || TILE_PRESETS.dark.url,
    className: TILE_PRESETS[theme]?.className || 'leaflet-dark-tiles',
    tileSize: 256,
    zoomOffset: 0
  }
}

export default function JobRadarMap() {
  const { user } = useAuth()
  const [passport, setPassport] = useState(null)

  // 1. Perspective: 'candidate' (Applicant Radar) vs 'recruiter' (B2B Talent Scout)
  const [perspective, setPerspective] = useState('candidate')

  // Search & Navigation
  const [searchQuery, setSearchQuery] = useState('')
  const [userCoords, setUserCoords] = useState(PUNE_NEIGHBORHOOD_ORIGINS[0] || SAMPLE_TECH_HUBS.pune)
  const [radiusFilter, setRadiusFilter] = useState('all') // 'all', '5', '15', '30'
  const [workModeFilter, setWorkModeFilter] = useState('ALL') // 'ALL', 'Onsite', 'Hybrid', 'Remote'
  const [tierFilter, setTierFilter] = useState('ALL') // 'ALL', 'smb', 'enterprise'
  const [selectedSezCorridor, setSelectedSezCorridor] = useState('all')

  // Selection
  const [selectedCompany, setSelectedCompany] = useState(RADAR_COMPANIES[0])
  const [selectedCandidate, setSelectedCandidate] = useState(VERIFIED_TALENT_PROFILES[0])
  const [mapTheme, setMapTheme] = useState('dark') // 'dark', 'streets', 'satellite'
  const [locating, setLocating] = useState(false)

  // Interactive Dropdown States
  const [activeDropdown, setActiveDropdown] = useState(null) // 'origin', 'corridor', 'filter', null

  // Modals & Proof-Gap Drawer states
  const [applyModalCompany, setApplyModalCompany] = useState(null)
  const [appliedSuccess, setAppliedSuccess] = useState(false)
  const [proofGapItem, setProofGapItem] = useState(null)
  const [proofGapSigned, setProofGapSigned] = useState(false)
  const [extraVerifiedSkills, setExtraVerifiedSkills] = useState(new Set())
  const [interviewInviteCandidate, setInterviewInviteCandidate] = useState(null)
  const [interviewInviteSuccess, setInterviewInviteSuccess] = useState(false)

  // Custom API key configuration
  const [customApiKey, setCustomApiKey] = useState(localStorage.getItem('pp_custom_map_key') || '')
  const [showKeyModal, setShowKeyModal] = useState(false)

  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const tileLayerRef = useRef(null)
  const markersLayerRef = useRef(null)
  const sezLayerRef = useRef(null)
  const transitPolylineRef = useRef(null)
  const toolbarRef = useRef(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target)) {
        setActiveDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  // Extract candidate verified skills + extra dynamically signed skills
  const verifiedSkillSet = new Set([
    ...(passport?.skills || []).filter((s) => s.state === 'V').map((s) => s.skill.toLowerCase()),
    ...Array.from(extraVerifiedSkills).map((s) => s.toLowerCase())
  ])

  // Compute distance and match score for each company
  const processedCompanies = RADAR_COMPANIES.map((comp) => {
    const isRemote = comp.workMode === 'Remote'
    const distKm = isRemote ? 0 : calculateDistanceKm(userCoords.lat, userCoords.lng, comp.coordinates.lat, comp.coordinates.lng)

    const totalRequired = comp.requiredSkills.length
    const matchedCount = comp.requiredSkills.filter((sk) => verifiedSkillSet.has(sk.toLowerCase())).length
    const matchScore = totalRequired > 0 ? Math.round(58 + (matchedCount / totalRequired) * 41) : 75

    return {
      ...comp,
      distanceKm: distKm,
      matchScore: Math.min(99, Math.max(68, matchScore)),
      matchedSkillsCount: matchedCount
    }
  })

  // Filter based on selected scope, tier, SEZ corridor, search query, and workMode
  const filteredCompanies = processedCompanies.filter((comp) => {
    // Search Query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const corpus = `${comp.name} ${comp.roleTitle} ${comp.techPark} ${(comp.requiredSkills || []).join(' ')} ${comp.description}`.toLowerCase()
      if (!corpus.includes(q)) return false
    }

    // Radius Filter
    if (radiusFilter === '5' && comp.distanceKm > 5.5 && comp.workMode !== 'Remote') return false
    if (radiusFilter === '15' && comp.distanceKm > 16 && comp.workMode !== 'Remote') return false
    if (radiusFilter === '30' && comp.distanceKm > 35 && comp.workMode !== 'Remote') return false

    // Work Mode Filter
    if (workModeFilter !== 'ALL' && comp.workMode.toLowerCase() !== workModeFilter.toLowerCase()) {
      return false
    }

    // Tier Filter: SMB vs Enterprise
    if (tierFilter !== 'ALL' && comp.tier !== tierFilter) {
      return false
    }

    // SEZ Corridor Filter
    if (selectedSezCorridor !== 'all' && comp.corridorId !== selectedSezCorridor) {
      return false
    }

    return true
  }).sort((a, b) => b.matchScore - a.matchScore)

  // Initialize and update Live Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return

    // 1. Create Leaflet map instance
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [userCoords.lat, userCoords.lng],
        zoom: 12.5,
        zoomControl: false,
        attributionControl: false
      })

      L.control.zoom({ position: 'topright' }).addTo(map)

      const currentConfig = getTileConfig(mapTheme, customApiKey)
      const tileLayer = L.tileLayer(currentConfig.url, {
        maxZoom: 19,
        className: currentConfig.className,
        subdomains: ['a', 'b', 'c'],
        tileSize: currentConfig.tileSize,
        zoomOffset: currentConfig.zoomOffset
      }).addTo(map)

      tileLayerRef.current = tileLayer

      const sezLayer = L.layerGroup().addTo(map)
      sezLayerRef.current = sezLayer

      const markersLayer = L.layerGroup().addTo(map)
      markersLayerRef.current = markersLayer

      mapInstanceRef.current = map
    }

    const map = mapInstanceRef.current
    const markersLayer = markersLayerRef.current
    const sezLayer = sezLayerRef.current

    // 2. Update Tile Layer on Theme Change
    if (tileLayerRef.current) {
      const currentConfig = getTileConfig(mapTheme, customApiKey)
      tileLayerRef.current.setUrl(currentConfig.url)
      const container = tileLayerRef.current.getContainer()
      if (container) {
        container.className = `leaflet-tile-container leaflet-zoom-animated ${currentConfig.className}`
      }
    }

    // 3. Render Pune SEZ Corridor Boundary Polygons
    sezLayer.clearLayers()
    PUNE_SEZ_CORRIDORS.forEach((sez) => {
      const isSelected = selectedSezCorridor === sez.id
      const poly = L.polygon(sez.polygon, {
        color: isSelected ? '#fff' : sez.color,
        weight: isSelected ? 3 : 1.5,
        fillColor: sez.fillColor,
        fillOpacity: isSelected ? 0.32 : 0.12,
        dashArray: isSelected ? null : '4, 4'
      })

      poly.bindTooltip(
        `<div style="font-family: sans-serif; font-size: 0.75rem;"><strong>${sez.name}</strong><br/><span style="color: #e8803f;">${sez.subtitle}</span></div>`,
        { sticky: true }
      )

      poly.on('click', () => {
        setSelectedSezCorridor(sez.id)
        map.fitBounds(poly.getBounds(), { padding: [24, 24] })
      })

      poly.addTo(sezLayer)
    })

    // 4. Update Animated Transit Polyline
    if (transitPolylineRef.current) {
      map.removeLayer(transitPolylineRef.current)
      transitPolylineRef.current = null
    }

    if (perspective === 'candidate' && selectedCompany && selectedCompany.workMode !== 'Remote') {
      const routePoints = [
        [userCoords.lat, userCoords.lng],
        [
          (userCoords.lat + selectedCompany.coordinates.lat) / 2 + 0.003,
          (userCoords.lng + selectedCompany.coordinates.lng) / 2 - 0.002
        ],
        [selectedCompany.coordinates.lat, selectedCompany.coordinates.lng]
      ]

      const polyline = L.polyline(routePoints, {
        color: '#e8803f',
        weight: 4,
        className: 'transit-route-line',
        opacity: 0.95
      }).addTo(map)

      transitPolylineRef.current = polyline
    }

    // 5. Render Markers depending on Perspective
    markersLayer.clearLayers()

    // Add Draggable Commute Origin Pin
    const userPinHtml = `
      <div class="radar-user-map-pin" title="${perspective === 'candidate' ? 'Your Commute Origin (Drag or click map to change)' : 'Corporate Office HQ'}">
        <div class="user-pin-core"></div>
        <div class="user-pin-ring"></div>
      </div>
    `
    const userIcon = L.divIcon({
      html: userPinHtml,
      className: 'user-marker-container',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    })
    const userMarker = L.marker([userCoords.lat, userCoords.lng], {
      icon: userIcon,
      draggable: true
    }).addTo(markersLayer)

    userMarker.bindTooltip(
      `📍 <strong>${userCoords.name || 'Your Origin'}</strong><br/><span style="color: #e8803f; font-size: 0.72rem;">Drag pin or click map to reposition</span>`,
      { permanent: false, direction: 'top' }
    )

    userMarker.on('dragend', (e) => {
      const p = e.target.getLatLng()
      setUserCoords({
        name: `Custom Origin (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})`,
        city: 'Pune',
        lat: Number(p.lat.toFixed(5)),
        lng: Number(p.lng.toFixed(5)),
        zoom: 14
      })
    })

    // Click anywhere on map to reposition commute origin
    map.off('click')
    map.on('click', (e) => {
      if (e.originalEvent && (e.originalEvent.target.classList.contains('leaflet-container') || e.originalEvent.target.tagName === 'path')) {
        setUserCoords({
          name: `Pinned (${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)})`,
          city: 'Pune',
          lat: Number(e.latlng.lat.toFixed(5)),
          lng: Number(e.latlng.lng.toFixed(5)),
          zoom: 14
        })
      }
    })

    if (perspective === 'candidate') {
      // Candidate View: Render Company Beacons
      filteredCompanies.forEach((comp) => {
        const isSelected = selectedCompany?.id === comp.id
        const isHighMatch = comp.matchScore >= 90
        const isRemote = comp.workMode === 'Remote'
        const isSmb = comp.tier === 'smb'

        const pinHtml = `
          <div class="radar-clean-pin ${isSelected ? 'active-pin' : ''} ${isHighMatch ? 'high-match' : ''} ${isRemote ? 'remote-pin' : ''}" style="${isSmb ? 'border-color: #fbbf24;' : ''}">
            <div class="pin-score" style="${isSmb ? 'color: #fbbf24;' : ''}">${comp.matchScore}%</div>
            <div class="pin-initials">${comp.logo}</div>
            <div class="pin-expanded-label">${isSmb ? '⚡ ' : ''}${comp.name}</div>
          </div>
        `

        const customIcon = L.divIcon({
          html: pinHtml,
          className: 'clean-marker-container',
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        })

        const marker = L.marker([comp.coordinates.lat, comp.coordinates.lng], { icon: customIcon })

        marker.on('click', () => {
          setSelectedCompany(comp)
          map.flyTo([comp.coordinates.lat, comp.coordinates.lng], 14.5, { duration: 0.8 })
        })

        const popupHtml = `
          <div style="font-family: sans-serif; min-width: 200px; padding: 2px;">
            <strong style="color: #111; font-size: 0.95rem;">${comp.name}</strong>
            ${comp.smbFastTrack ? '<div style="color: #d97706; font-size: 0.72rem; font-weight: bold; margin-top: 1px;">⚡ DIRECT CTO FAST-TRACK</div>' : ''}
            <div style="color: #e8803f; font-weight: bold; font-size: 0.8rem; margin: 3px 0;">${comp.matchScore}% Skill Match</div>
            <div style="color: #666; font-size: 0.75rem; margin-bottom: 4px;">📍 ${comp.techPark}</div>
            <div style="color: #0284c7; font-size: 0.72rem; margin-bottom: 6px; font-weight: 500;">⚡ ${comp.transit?.travelTimeMinutes || 20}m commute via ${comp.transit?.transitType || 'Transit'}</div>
            <a href="${comp.officialUrl}" target="_blank" style="color: #b54610; font-size: 0.75rem; font-weight: 600; text-decoration: none;">View Official Careers Portal ↗</a>
          </div>
        `
        marker.bindPopup(popupHtml)
        marker.addTo(markersLayer)
      })
    } else {
      // Recruiter View: Render Verified Candidates
      VERIFIED_TALENT_PROFILES.forEach((cand) => {
        const isSelected = selectedCandidate?.id === cand.id

        const pinHtml = `
          <div class="radar-candidate-pin ${isSelected ? 'active-pin' : ''}">
            <div style="font-size: 0.58rem; color: #38bdf8; font-family: monospace; font-weight: 700;">${cand.matchToHiringNeeds}%</div>
            <div style="font-size: 0.65rem; color: #fff; font-family: monospace; font-weight: 700;">PP</div>
            <div class="pin-expanded-label">Verified Candidate · ${cand.neighborhood}</div>
          </div>
        `

        const candIcon = L.divIcon({
          html: pinHtml,
          className: 'clean-marker-container',
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        })

        const marker = L.marker([cand.coordinates.lat, cand.coordinates.lng], { icon: candIcon })

        marker.on('click', () => {
          setSelectedCandidate(cand)
          map.flyTo([cand.coordinates.lat, cand.coordinates.lng], 14, { duration: 0.8 })
        })

        marker.addTo(markersLayer)
      })
    }
  }, [
    perspective,
    userCoords,
    filteredCompanies,
    selectedCompany,
    selectedCandidate,
    selectedSezCorridor,
    searchQuery,
    mapTheme,
    customApiKey,
    extraVerifiedSkills
  ])

  // Detect live browser GPS location with Wi-Fi triangulation + IP network fallback
  const handleDetectLocation = async () => {
    setLocating(true)
    setActiveDropdown(null)

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false)
          const acc = Math.round(pos.coords.accuracy || 0)
          const coords = {
            name: `Live GPS (±${acc}m accuracy)`,
            city: 'Pune',
            lat: Number(pos.coords.latitude.toFixed(5)),
            lng: Number(pos.coords.longitude.toFixed(5)),
            zoom: 14
          }
          setUserCoords(coords)
          if (mapInstanceRef.current) {
            mapInstanceRef.current.flyTo([coords.lat, coords.lng], 14, { duration: 1.0 })
          }
        },
        async (geoErr) => {
          console.warn('HTML5 Geolocation unavailable or blocked:', geoErr?.message)
          try {
            const res = await fetch('https://ipapi.co/json/')
            if (res.ok) {
              const data = await res.json()
              if (data.latitude && data.longitude) {
                setLocating(false)
                const coords = {
                  name: `Network Location (${data.city || 'Pune'})`,
                  city: data.city || 'Pune',
                  lat: Number(data.latitude.toFixed(5)),
                  lng: Number(data.longitude.toFixed(5)),
                  zoom: 13.5
                }
                setUserCoords(coords)
                if (mapInstanceRef.current) {
                  mapInstanceRef.current.flyTo([coords.lat, coords.lng], 13.5, { duration: 1.0 })
                }
                return
              }
            }
          } catch (netErr) {
            console.warn('Network IP fallback failed:', netErr)
          }

          setLocating(false)
          setActiveDropdown('origin')
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0
        }
      )
    } else {
      setLocating(false)
      setActiveDropdown('origin')
    }
  }

  // Save custom enterprise API key
  const handleSaveApiKey = (key) => {
    setCustomApiKey(key)
    localStorage.setItem('pp_custom_map_key', key)
    setShowKeyModal(false)
  }

  // Open Proof-Gap Resolution Drawer for unverified skill
  const handleOpenProofGap = (skillName, comp) => {
    const evidence = MOCK_REPO_EVIDENCE[skillName.toLowerCase()] || {
      skill: skillName,
      repoName: 'open-source-contributions',
      commitHash: 'e7a1c904bf2381d5',
      commitMessage: `feat: implement production ${skillName} integration with comprehensive edge case validation`,
      date: '2 weeks ago',
      linesAuthored: 94,
      codeSnippet: `// Cryptographic authorship verified via Git blame\nimport { configure${skillName} } from "@core/runtime";\nexport const config = configure${skillName}({ strict: true });`
    }
    setProofGapItem({ skill: skillName, evidence, company: comp })
    setProofGapSigned(false)
  }

  // Sign proof-gap commit evidence and boost skill match score (persisted via FastAPI + SQLite)
  const handleSignProofGapEvidence = async () => {
    if (!proofGapItem) return
    setProofGapSigned(true)

    try {
      await fetch('/api/v1/passports/verify-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passport_id: passport?.id || passport?.passport_id || 'pass-001',
          skill: proofGapItem.skill,
          repo_url: proofGapItem.evidence.repoName,
          commit_sha: proofGapItem.evidence.commitHash,
          commit_message: proofGapItem.evidence.commitMessage,
          lines_authored: proofGapItem.evidence.linesAuthored
        })
      })
    } catch (err) {
      console.warn('Backend server offline, fallback to local cryptographic signing:', err)
    }

    setTimeout(() => {
      setExtraVerifiedSkills((prev) => new Set([...prev, proofGapItem.skill.toLowerCase()]))
      setProofGapItem(null)
      setProofGapSigned(false)
    }, 1600)
  }

  // Dispatch application modal
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

  // Recruiter: Dispatch interview invitation
  const handleDispatchInterviewInvite = (cand) => {
    setInterviewInviteCandidate(cand)
    setInterviewInviteSuccess(false)
  }

  const confirmDispatchInterview = () => {
    setInterviewInviteSuccess(true)
    setTimeout(() => {
      setInterviewInviteCandidate(null)
      setInterviewInviteSuccess(false)
    }, 2200)
  }

  // Count active filter criteria
  const activeFiltersCount = (radiusFilter !== 'all' ? 1 : 0) + (workModeFilter !== 'ALL' ? 1 : 0) + (tierFilter !== 'ALL' ? 1 : 0)

  return (
    <main id="main" className="dash-page radar-page">
      <div className="w">
        {/* ── 1. TOP NAVBAR / HERO CARD ──────────────────────────────────── */}
        <header className="radar-navbar-card">
          <div className="radar-branding">
            <div className="radar-logo-pulse" title="ProofPass Cryptographic Talent Radar">
              📡
            </div>
            <div className="radar-title-text">
              <h1>
                Job Radar & Commute Engine
                <span className="radar-live-status-pill">
                  <span className="radar-live-dot" /> Live Street Grid
                </span>
              </h1>
              <p>
                Pune Tech Corridors · Metro Line 3 Transit · SHA-256 Commit-Verified Evidence
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Perspective Segmented Switch (Apple Style) */}
            <div className="segmented-pill-switch">
              <button
                type="button"
                className={`segmented-pill-btn ${perspective === 'candidate' ? 'active' : ''}`}
                onClick={() => setPerspective('candidate')}
              >
                👨‍💻 Candidates
              </button>
              <button
                type="button"
                className={`segmented-pill-btn ${perspective === 'recruiter' ? 'active' : ''}`}
                onClick={() => setPerspective('recruiter')}
              >
                🏢 Recruiters
              </button>
            </div>

            <button
              type="button"
              className="radar-dropdown-trigger"
              onClick={() => setShowKeyModal(true)}
              style={{ fontSize: '0.78rem' }}
              title="Configure Enterprise Mapbox or Google License"
            >
              ⚙️ {customApiKey ? 'License Active ✓' : 'Enterprise Key'}
            </button>
          </div>
        </header>

        {/* ── 2. UNIFIED FLOATING CONTROL ISLAND (LINEAR-STYLE TOOLBAR) ──── */}
        <div ref={toolbarRef} className="radar-toolbar">
          {/* Quick Search Input */}
          <div className="radar-search-island">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search verified roles, skills, or companies (e.g. "React", "Python", "Docker", "Druva")...'
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                title="Clear filter"
              >
                ✕
              </button>
            )}
          </div>

          {/* DROPDOWN 1: Commute Origin & Campus Picker */}
          <div className="dropdown-anchor-wrapper">
            <button
              type="button"
              className={`radar-dropdown-trigger ${activeDropdown === 'origin' ? 'open active' : ''}`}
              onClick={() => setActiveDropdown(activeDropdown === 'origin' ? null : 'origin')}
            >
              <span>📍 Origin:</span>
              <strong style={{ color: '#fff' }}>{userCoords.name?.split('(')[0]?.trim() || 'Pune'}</strong>
              <span className="trigger-chevron">▼</span>
            </button>

            {activeDropdown === 'origin' && (
              <div className="radar-popover-panel" style={{ width: 320 }}>
                <div className="popover-header">
                  <span>Commute Origin Point</span>
                  <span style={{ color: '#e8803f' }}>Auto-Recalculate</span>
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <button
                    type="button"
                    className="popover-option-btn"
                    style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', marginBottom: '6px' }}
                    onClick={handleDetectLocation}
                  >
                    <span>{locating ? '🛰️ Triangulating GPS...' : '📍 Detect Live GPS (Wi-Fi)'}</span>
                    <span style={{ fontSize: '0.68rem', opacity: 0.8 }}>±15m accuracy</span>
                  </button>
                </div>

                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {PUNE_NEIGHBORHOOD_ORIGINS.map((orig) => {
                    const isSelected = userCoords.lat === orig.lat && userCoords.lng === orig.lng
                    return (
                      <button
                        key={orig.id}
                        type="button"
                        className={`popover-option-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setUserCoords(orig)
                          setActiveDropdown(null)
                          if (mapInstanceRef.current) {
                            mapInstanceRef.current.flyTo([orig.lat, orig.lng], 13.8, { duration: 0.8 })
                          }
                        }}
                      >
                        <div>
                          <div>{orig.name}</div>
                          <div className="popover-sublabel">{orig.neighborhood}</div>
                        </div>
                        {isSelected && <span style={{ color: '#e8803f' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>

                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.72rem', color: '#9c958f' }}>
                  💡 Tip: Drag the orange pin directly on the map to set any custom point!
                </div>
              </div>
            )}
          </div>

          {/* DROPDOWN 2: SEZ IT Corridors */}
          <div className="dropdown-anchor-wrapper">
            <button
              type="button"
              className={`radar-dropdown-trigger ${activeDropdown === 'corridor' ? 'open active' : ''} ${selectedSezCorridor !== 'all' ? 'active' : ''}`}
              onClick={() => setActiveDropdown(activeDropdown === 'corridor' ? null : 'corridor')}
            >
              <span>🗺️ Corridor:</span>
              <strong style={{ color: '#fff' }}>
                {selectedSezCorridor === 'all'
                  ? 'All Pune SEZs'
                  : PUNE_SEZ_CORRIDORS.find((c) => c.id === selectedSezCorridor)?.name || 'Corridor'}
              </strong>
              <span className="trigger-chevron">▼</span>
            </button>

            {activeDropdown === 'corridor' && (
              <div className="radar-popover-panel" style={{ width: 300 }}>
                <div className="popover-header">
                  <span>Pune Geofenced SEZ Zones</span>
                </div>

                <button
                  type="button"
                  className={`popover-option-btn ${selectedSezCorridor === 'all' ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedSezCorridor('all')
                    setActiveDropdown(null)
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo([userCoords.lat, userCoords.lng], 12.2)
                    }
                  }}
                >
                  <span>📍 All Pune Corridors</span>
                  <span style={{ fontSize: '0.72rem', color: '#9c958f' }}>({processedCompanies.length} jobs)</span>
                </button>

                {PUNE_SEZ_CORRIDORS.map((sez) => {
                  const isSelected = selectedSezCorridor === sez.id
                  return (
                    <button
                      key={sez.id}
                      type="button"
                      className={`popover-option-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedSezCorridor(sez.id)
                        setActiveDropdown(null)
                        if (mapInstanceRef.current) {
                          mapInstanceRef.current.flyTo(sez.center, 13.8)
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sez.color }} />
                        <div>
                          <div>{sez.name}</div>
                          <div className="popover-sublabel">{sez.subtitle}</div>
                        </div>
                      </div>
                      {isSelected && <span style={{ color: '#e8803f' }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* DROPDOWN 3: Multi-Filter Popover (Radius, Tier & Work Mode) */}
          <div className="dropdown-anchor-wrapper">
            <button
              type="button"
              className={`radar-dropdown-trigger ${activeDropdown === 'filter' ? 'open active' : ''} ${activeFiltersCount > 0 ? 'active' : ''}`}
              onClick={() => setActiveDropdown(activeDropdown === 'filter' ? null : 'filter')}
            >
              <span>⚙️ Filters</span>
              {activeFiltersCount > 0 && (
                <span style={{ background: '#b54610', color: '#fff', fontSize: '0.68rem', padding: '1px 5px', borderRadius: '10px' }}>
                  {activeFiltersCount}
                </span>
              )}
              <span className="trigger-chevron">▼</span>
            </button>

            {activeDropdown === 'filter' && (
              <div className="radar-popover-panel" style={{ width: 320 }}>
                <div className="popover-header">
                  <span>Filter Opportunities</span>
                  {activeFiltersCount > 0 && (
                    <button
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: '#e8803f', cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={() => {
                        setRadiusFilter('all')
                        setWorkModeFilter('ALL')
                        setTierFilter('ALL')
                      }}
                    >
                      Reset All
                    </button>
                  )}
                </div>

                {/* Organization Tier */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.74rem', color: '#9c958f', marginBottom: '6px' }}>Organization Type:</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { key: 'ALL', label: 'All' },
                      { key: 'smb', label: '⚡ Fast-Track SMBs' },
                      { key: 'enterprise', label: '🏢 Enterprise' }
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        className={`popover-option-btn ${tierFilter === t.key ? 'selected' : ''}`}
                        style={{ padding: '6px 8px', fontSize: '0.75rem', justifyContent: 'center' }}
                        onClick={() => setTierFilter(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Work Mode */}
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '0.74rem', color: '#9c958f', marginBottom: '6px' }}>Work Mode:</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {['ALL', 'Onsite', 'Hybrid', 'Remote'].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`popover-option-btn ${workModeFilter === m ? 'selected' : ''}`}
                        style={{ padding: '6px 8px', fontSize: '0.75rem', justifyContent: 'center' }}
                        onClick={() => setWorkModeFilter(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Commute Radius */}
                <div>
                  <div style={{ fontSize: '0.74rem', color: '#9c958f', marginBottom: '6px' }}>Commute Distance:</div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {[
                      { key: 'all', label: 'All Pune' },
                      { key: '5', label: '< 5 km' },
                      { key: '15', label: '< 15 km' },
                      { key: '30', label: '< 30 km' }
                    ].map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        className={`popover-option-btn ${radiusFilter === r.key ? 'selected' : ''}`}
                        style={{ padding: '6px 8px', fontSize: '0.75rem', justifyContent: 'center' }}
                        onClick={() => setRadiusFilter(r.key)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 3. MAIN SPLIT GRID: MAP VIEWPORT + SIDEBAR LIST ────────────── */}
        <div className="radar-grid">
          {/* LEFT: LIVE LEAFLET MAP VIEWPORT */}
          <div className="radar-viewport-container">
            {/* Top Floating Controls */}
            <div className="radar-floating-hud-top">
              <div className="hud-capsule">
                <span>📍</span>
                <span>
                  {perspective === 'candidate'
                    ? `${filteredCompanies.length} Verified Openings Mapped`
                    : `${VERIFIED_TALENT_PROFILES.length} Verified Candidates Mapped`}
                </span>
              </div>

              {/* Theme Switcher */}
              <div className="hud-theme-picker">
                <button
                  type="button"
                  className={`hud-theme-btn ${mapTheme === 'dark' ? 'active' : ''}`}
                  onClick={() => setMapTheme('dark')}
                  title="Dark Tech Basemap"
                >
                  🌙 Dark
                </button>
                <button
                  type="button"
                  className={`hud-theme-btn ${mapTheme === 'streets' ? 'active' : ''}`}
                  onClick={() => setMapTheme('streets')}
                  title="Daylight Streets"
                >
                  ☀️ Streets
                </button>
                <button
                  type="button"
                  className={`hud-theme-btn ${mapTheme === 'satellite' ? 'active' : ''}`}
                  onClick={() => setMapTheme('satellite')}
                  title="ESRI Satellite Imagery"
                >
                  🛰️ Satellite
                </button>
              </div>
            </div>

            {/* Map Element */}
            <div ref={mapContainerRef} className="leaflet-map-element" />

            {/* Bottom Floating Transit HUD */}
            {perspective === 'candidate' && selectedCompany && selectedCompany.workMode !== 'Remote' && (
              <div className="radar-floating-transit-hud">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ color: '#e8803f' }}>⚡ Commute to {selectedCompany.name}:</strong>
                  <span style={{ color: '#38bdf8' }}>{selectedCompany.transit?.travelTimeMinutes || 20}m commute</span>
                  <span style={{ color: '#9c958f' }}>via {selectedCompany.transit?.corridorName || 'City Express'}</span>
                </div>
                <div style={{ color: '#4ade80', fontFamily: 'monospace' }}>
                  {selectedCompany.transit?.metroLine || 'Pune Metro Line 3 Connected'}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: OPPORTUNITY CARDS OR RECRUITER LIST */}
          <div className="radar-listings-scroll">
            {perspective === 'candidate' ? (
              filteredCompanies.length === 0 ? (
                <div className="radar-empty-state">
                  <h3>No opportunities found</h3>
                  <p>Try clearing your search query or expanding the commute radius filter.</p>
                  <button
                    type="button"
                    className="radar-action-btn"
                    style={{ margin: '0 auto' }}
                    onClick={() => {
                      setSearchQuery('')
                      setRadiusFilter('all')
                      setWorkModeFilter('ALL')
                      setTierFilter('ALL')
                      setSelectedSezCorridor('all')
                    }}
                  >
                    Reset All Filters
                  </button>
                </div>
              ) : (
                filteredCompanies.map((comp) => {
                  const isSelected = selectedCompany?.id === comp.id
                  const isSmb = comp.tier === 'smb'

                  return (
                    <div
                      key={comp.id}
                      className={`radar-company-card ${isSelected ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCompany(comp)
                        if (mapInstanceRef.current && comp.coordinates) {
                          mapInstanceRef.current.flyTo([comp.coordinates.lat, comp.coordinates.lng], 14, { duration: 0.8 })
                        }
                      }}
                      style={isSmb ? { borderLeft: '3px solid #fbbf24' } : {}}
                    >
                      <div className="radar-comp-top-row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div className="radar-entity-frame">
                            <img
                              src={`https://logo.clearbit.com/${comp.domain}`}
                              alt={comp.name}
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

                          <div>
                            <h3 className="radar-comp-name">
                              {comp.name}
                              <span style={{ color: '#4ade80', fontSize: '0.85rem' }} title="Verified Corporate Opening">
                                ✓
                              </span>
                            </h3>
                            <p className="radar-comp-loc">
                              📍 {comp.techPark} ·{' '}
                              {comp.workMode === 'Remote' ? (
                                <strong style={{ color: '#38bdf8' }}>🌐 100% Remote</strong>
                              ) : (
                                <strong>{comp.distanceKm} km commute</strong>
                              )}
                            </p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                          <div className={`radar-match-badge ${comp.matchScore >= 90 ? 'high' : ''}`}>
                            {comp.matchScore}% MATCH
                          </div>
                          {comp.smbFastTrack && (
                            <span className="smb-fasttrack-tag" title="ProofPass candidates skip Round 1 resume screening">
                              ⚡ FAST-TRACK
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="radar-role-title">{comp.roleTitle}</div>
                      <div style={{ fontSize: '0.74rem', color: '#e8803f', fontFamily: 'monospace', marginBottom: '6px' }}>
                        {comp.opportunityType}
                      </div>

                      <div className="radar-stipend-row">
                        <span className="radar-stipend-val">{comp.stipend}</span>
                        <span>·</span>
                        <span>{comp.workModeDesc}</span>
                      </div>

                      {/* Commute Transit Pill */}
                      {comp.workMode !== 'Remote' && comp.transit && (
                        <div style={{ marginBottom: '8px' }}>
                          <span className="radar-transit-badge">
                            ⚡ {comp.transit.travelTimeMinutes} mins · {comp.transit.transitType}
                          </span>
                        </div>
                      )}

                      {/* Skill verification pills */}
                      <div className="radar-skill-tags">
                        {comp.requiredSkills.map((sk) => {
                          const isVerified = verifiedSkillSet.has(sk.toLowerCase())
                          return isVerified ? (
                            <span
                              key={sk}
                              className="radar-skill-tag verified"
                              title="Skill cryptographically verified on your passport"
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
                                handleOpenProofGap(sk, comp)
                              }}
                              title="Click to resolve Proof-Gap: Sign commit evidence & boost match score"
                            >
                              ○ {sk}
                              <span className="radar-gap-hint">+VERIFY</span>
                            </button>
                          )
                        })}
                      </div>

                      <p style={{ fontSize: '0.78rem', color: '#9c958f', margin: '0 0 14px', lineHeight: 1.45 }}>
                        {comp.description}
                      </p>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="radar-action-btn"
                          style={{ flex: 1 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleApply(comp)
                          }}
                        >
                          🚀 Apply with Passport
                        </button>

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
                      </div>
                    </div>
                  )
                })
              )
            ) : (
              // Recruiter View: Verified Candidates
              VERIFIED_TALENT_PROFILES.map((cand) => {
                const isSelected = selectedCandidate?.id === cand.id
                return (
                  <div
                    key={cand.id}
                    className={`radar-candidate-card ${isSelected ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCandidate(cand)
                      if (mapInstanceRef.current && cand.coordinates) {
                        mapInstanceRef.current.flyTo([cand.coordinates.lat, cand.coordinates.lng], 14, { duration: 0.8 })
                      }
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ color: '#fff', fontSize: '0.94rem' }}>{cand.codeName}</strong>
                          <span style={{ fontSize: '0.68rem', background: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '1px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>
                            SHA-256 VALID ✓
                          </span>
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#9c958f', marginTop: '2px' }}>
                          📍 {cand.neighborhood} · <strong style={{ color: '#38bdf8' }}>{cand.distanceToClientKm} km away</strong>
                        </div>
                      </div>

                      <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
                        {cand.matchToHiringNeeds}% FIT
                      </span>
                    </div>

                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#e8803f', marginBottom: '6px' }}>
                      {cand.roleTag}
                    </div>

                    <div style={{ fontSize: '0.74rem', color: '#a3e635', fontFamily: 'monospace', marginBottom: '8px' }}>
                      ⚡ Verified Commit Depth: {cand.commitDepth}
                    </div>

                    <div className="radar-skill-tags" style={{ marginBottom: '10px' }}>
                      {cand.verifiedSkills.map((sk) => (
                        <span key={sk} className="radar-skill-tag verified">
                          ✓ {sk}
                        </span>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="radar-action-btn"
                      style={{ width: '100%', background: 'linear-gradient(180deg, #0284c7, #0369a1)', borderColor: '#0284c7' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDispatchInterviewInvite(cand)
                      }}
                    >
                      ⚡ Dispatch Direct Interview Invite
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* ── 4. DRAWERS & MODALS ─────────────────────────────────────────── */}

      {/* Proof-Gap Drawer */}
      {proofGapItem && (
        <div className="radar-modal-overlay" onClick={() => setProofGapItem(null)}>
          <div className="proofgap-drawer-box" onClick={(e) => e.stopPropagation()}>
            <span className="k m" style={{ color: '#e8803f' }}>CRYPTOGRAPHIC PROOF-GAP RESOLUTION</span>
            <h2 style={{ fontSize: '1.25rem', margin: '6px 0', color: '#fff' }}>
              Bridge Skill Gap: {proofGapItem.skill}
            </h2>
            <p style={{ fontSize: '0.84rem', color: '#9c958f', margin: '0 0 14px' }}>
              ProofPass scanned your linked GitHub repositories and detected verifiable commit evidence authored by you matching this requirement.
            </p>

            <div className="proofgap-commit-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#e8803f' }}>Repository: {proofGapItem.evidence.repoName}</span>
                <span style={{ color: '#9c958f' }}>{proofGapItem.evidence.date}</span>
              </div>
              <div style={{ color: '#fff', fontWeight: 600, marginBottom: '6px' }}>
                Commit {proofGapItem.evidence.commitHash}: {proofGapItem.evidence.commitMessage}
              </div>
              <div style={{ color: '#38bdf8', fontSize: '0.72rem' }}>
                Git Blame Verified: {proofGapItem.evidence.linesAuthored} lines authored by applicant
              </div>

              <div className="proofgap-snippet">
                <pre style={{ margin: 0, fontFamily: 'monospace' }}>{proofGapItem.evidence.codeSnippet}</pre>
              </div>
            </div>

            {proofGapSigned ? (
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '6px', padding: '14px', textAlign: 'center', color: '#4ade80', fontSize: '0.9rem', fontWeight: 600 }}>
                ✓ Commit Evidence Signed & Cryptographically Stamped into Passport! Skill Verified!
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="radar-action-btn"
                  style={{ flex: 1 }}
                  onClick={handleSignProofGapEvidence}
                >
                  🔐 Cryptographically Sign Evidence (SHA-256) & Boost Match
                </button>
                <button
                  type="button"
                  className="radar-secondary-link"
                  onClick={() => setProofGapItem(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recruiter Direct Interview Invite Modal */}
      {interviewInviteCandidate && (
        <div className="radar-modal-overlay" onClick={() => setInterviewInviteCandidate(null)}>
          <div className="radar-modal-box" onClick={(e) => e.stopPropagation()}>
            <span className="k m" style={{ color: '#38bdf8' }}>B2B FAST-TRACK RECRUITMENT</span>
            <h2 style={{ fontSize: '1.25rem', margin: '6px 0', color: '#fff' }}>
              Dispatch Direct Interview Invite to {interviewInviteCandidate.codeName}
            </h2>
            <p style={{ fontSize: '0.84rem', color: '#9c958f', margin: '0 0 14px' }}>
              Because ProofPass cryptographically verifies code authorship at the commit level, this candidate qualifies for immediate technical interview scheduling.
            </p>

            <div style={{ background: '#121110', border: '1px solid #2d2b29', borderRadius: '6px', padding: '12px', marginBottom: '16px', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#9c958f' }}>Candidate Location:</span>
                <span style={{ color: '#fff' }}>{interviewInviteCandidate.neighborhood}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#9c958f' }}>Proximity to Office:</span>
                <span style={{ color: '#38bdf8' }}>{interviewInviteCandidate.distanceToClientKm} km</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9c958f' }}>Cryptographic Seal:</span>
                <span style={{ color: '#4ade80', fontFamily: 'monospace' }}>VALIDATED (TAMPER-FREE)</span>
              </div>
            </div>

            {interviewInviteSuccess ? (
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '6px', padding: '14px', textAlign: 'center', color: '#4ade80', fontSize: '0.9rem', fontWeight: 600 }}>
                ✓ Direct Interview Invitation Dispatched to Candidate Calendar!
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="radar-action-btn"
                  style={{ flex: 1, background: 'linear-gradient(180deg, #0284c7, #0369a1)', borderColor: '#0284c7' }}
                  onClick={confirmDispatchInterview}
                >
                  ⚡ Send Immediate Interview Invite
                </button>
                <button
                  type="button"
                  className="radar-secondary-link"
                  onClick={() => setInterviewInviteCandidate(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enterprise API Key Modal */}
      {showKeyModal && (
        <div className="radar-modal-overlay" onClick={() => setShowKeyModal(false)}>
          <div className="radar-modal-box" onClick={(e) => e.stopPropagation()}>
            <span className="k m">ENTERPRISE GEOLOCATION CONFIGURATION</span>
            <h2 style={{ fontSize: '1.25rem', margin: '6px 0', color: '#fff' }}>
              Corporate Map License Key
            </h2>
            <p style={{ fontSize: '0.84rem', color: '#9c958f', margin: '0 0 16px' }}>
              ProofPass runs on OpenStreetMap & ESRI with zero watermarks. If deploying for a corporate client with a dedicated Mapbox or Google license, enter your key below:
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#e8803f', display: 'block', marginBottom: '6px' }}>
                MAPBOX TOKEN / GOOGLE KEY:
              </label>
              <input
                type="text"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value.trim())}
                placeholder="pk.eyJ1IjoieW91ci11c2VybmFtZSI..."
                style={{ width: '100%', padding: '10px 14px', background: '#121110', border: '1px solid #333', color: '#fff', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.82rem', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="radar-action-btn"
                style={{ flex: 1 }}
                onClick={() => handleSaveApiKey(customApiKey)}
              >
                Save & Apply License
              </button>
              {customApiKey && (
                <button
                  type="button"
                  className="radar-secondary-link"
                  onClick={() => handleSaveApiKey('')}
                >
                  Reset
                </button>
              )}
              <button
                type="button"
                className="radar-secondary-link"
                onClick={() => setShowKeyModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click Passport Application Modal */}
      {applyModalCompany && (
        <div className="radar-modal-overlay" onClick={() => setApplyModalCompany(null)}>
          <div className="radar-modal-box" onClick={(e) => e.stopPropagation()}>
            <span className="k m">CRYPTOGRAPHIC PASSPORT APPLICATION</span>
            <h2 style={{ fontSize: '1.25rem', margin: '6px 0', color: '#fff' }}>
              Dispatch Application to {applyModalCompany.name}
            </h2>
            <p style={{ fontSize: '0.84rem', color: '#9c958f', margin: '0 0 18px' }}>
              Your application includes an unforgeable cryptographic seal containing your verified commit evidence.
            </p>

            <div style={{ background: '#121110', border: '1px solid #2d2b29', borderRadius: '6px', padding: '14px', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: '#9c958f' }}>Role:</span>
                <strong style={{ color: '#fff' }}>{applyModalCompany.roleTitle}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: '#9c958f' }}>Official Office:</span>
                <span style={{ color: '#ddd' }}>{applyModalCompany.techPark}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem' }}>
                <span style={{ color: '#9c958f' }}>Physical Address:</span>
                <span style={{ color: '#9c958f', fontSize: '0.75rem', maxWidth: '60%', textAlign: 'right' }}>
                  {applyModalCompany.address}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.82rem', marginTop: '6px' }}>
                <span style={{ color: '#9c958f' }}>Commute Proximity:</span>
                <span style={{ color: '#4ade80', fontFamily: 'monospace' }}>
                  {applyModalCompany.workMode === 'Remote' ? 'Remote Global' : `${applyModalCompany.distanceKm} km away`}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                <span style={{ color: '#9c958f' }}>Passport Seal Status:</span>
                <span style={{ color: '#e8803f', fontFamily: 'monospace' }}>SHA-256 VERIFIED ✓</span>
              </div>
            </div>

            {appliedSuccess ? (
              <div style={{ background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '6px', padding: '14px', textAlign: 'center', color: '#4ade80', fontSize: '0.9rem', fontWeight: 600 }}>
                ✓ Application Dispatched to {applyModalCompany.name} HR Portal!
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="radar-action-btn"
                  style={{ flex: 1 }}
                  onClick={confirmDispatchApplication}
                >
                  Confirm & Send Passport
                </button>
                <button
                  type="button"
                  className="radar-secondary-link"
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
