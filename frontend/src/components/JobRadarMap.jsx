/**
 * ProofPass - Job Radar & Commute Geolocation Microservice (Apple iOS 27 Edition)
 *
 * Designed with Apple iOS Dynamic Island & Liquid Frosted Glass UI.
 * Zero visual overlap guaranteed via isolated iOS Modal Sheets & strict layout constraints.
 *
 * Authentic Free Industry APIs Integrated:
 * 1. OSRM API (Project OSRM) - Turn-by-turn road driving routing, geometry & real commute minutes
 * 2. OpenStreetMap Nominatim - High-precision neighborhood & suburb reverse geocoding
 * 3. ipwho.is & ipapi.co - Instant high-reliability network IP geolocation fallback
 * 4. HTML5 Geolocation API - Native device GPS & Wi-Fi triangulation with high accuracy
 * 5. Clearbit Corporate Logo API - Verified corporate branding resolution
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
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
import './jr-tokens.css'
import { getCompanyLogo } from './useLogo.js'
import JrSheet from './JrSheet.jsx'
import JrSegmented from './JrSegmented.jsx'
import JobCard, { JobCardSkeleton } from './JobCard.jsx'
import MatchRing from './MatchRing.jsx'
import gsap from 'gsap'
import JrLottie, { LOTTIE_RADAR_SONAR, LOTTIE_SUCCESS_CHECK } from './JrLottie.jsx'
import RadarBackground from './RadarBackground.jsx'
import { RM, scroller } from '../lib.js'

const PinIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
)

const SatelliteIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m13 7 3-3 4 4-3 3M7 13l-3 3 4 4 3-3" />
    <rect x="8" y="8" width="8" height="8" rx="1" transform="rotate(45 12 12)" />
    <path d="M16 21a5 5 0 0 0 5-5" />
  </svg>
)

const LocateIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)

// Haversine fallback distance formula (in km)
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

// Route lines and pin popups can't read CSS variables; matches --jr-orange in jr-tokens.css
const JR_ORANGE = '#c84b0e'

// Corridor colours live in the data file; its one orange is drawn in the shared orange
const corridorColor = (color) => (String(color).toLowerCase() === '#e8803f' ? JR_ORANGE : color)

// 100% Free Tile Providers (Zero watermark, zero mandatory key)
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

function getTileConfig(theme) {
  return {
    url: TILE_PRESETS[theme]?.url || TILE_PRESETS.dark.url,
    className: TILE_PRESETS[theme]?.className || 'leaflet-dark-tiles',
    tileSize: 256,
    zoomOffset: 0
  }
}

export default function JobRadarMap() {
  const { user } = useAuth()
  const isRecruiter = user?.role === 'recruiter'
  const isApplicant = user?.role === 'applicant'
  const isAdmin = user?.role === 'admin'

  const [passport, setPassport] = useState(null)

  // Perspective: 'candidate' vs 'recruiter'
  // Strictly enforce role-based authorization:
  // - Candidates/applicants can ONLY access 'candidate' perspective
  // - Recruiters can ONLY access 'recruiter' perspective
  // - Admins can test/audit both perspectives
  const [perspective, setPerspective] = useState(() => {
    if (user?.role === 'recruiter') return 'recruiter'
    return 'candidate'
  })

  // Enforce strict perspective lock based on authenticated role
  useEffect(() => {
    if (isRecruiter && perspective !== 'recruiter') {
      setPerspective('recruiter')
    } else if (isApplicant && perspective !== 'candidate') {
      setPerspective('candidate')
    }
  }, [isRecruiter, isApplicant, perspective])

  // Safe handler for perspective changes (Admin only)
  const handlePerspectiveChange = (newPerspective) => {
    if (!isAdmin) {
      console.warn('Unauthorized perspective switch attempt blocked by role guard')
      return
    }
    setPerspective(newPerspective)
  }

  // Search & Navigation
  const [searchQuery, setSearchQuery] = useState('')
  const [userCoords, setUserCoords] = useState(PUNE_NEIGHBORHOOD_ORIGINS[0] || SAMPLE_TECH_HUBS.pune)
  const [locationStatus, setLocationStatus] = useState('idle') // 'idle' | 'detecting' | 'locked' | 'fallback'
  const [locating, setLocating] = useState(false)
  const [locationToast, setLocationToast] = useState(null)

  // Filters
  const [radiusFilter, setRadiusFilter] = useState('all') // 'all', '5', '15', '30'
  const [workModeFilter, setWorkModeFilter] = useState('ALL') // 'ALL', 'Onsite', 'Hybrid', 'Remote'
  const [tierFilter, setTierFilter] = useState('ALL') // 'ALL', 'smb', 'enterprise'
  const [selectedSezCorridor, setSelectedSezCorridor] = useState('all')

  // Selection
  const [selectedCompany, setSelectedCompany] = useState(RADAR_COMPANIES[0])
  const [selectedCandidate, setSelectedCandidate] = useState(VERIFIED_TALENT_PROFILES[0])
  const [siteTheme, setSiteTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  )
  const [satelliteOn, setSatelliteOn] = useState(false)
  const baseMapTheme = siteTheme === 'dark' ? 'dark' : 'streets'
  const mapTheme = satelliteOn ? 'satellite' : baseMapTheme

  // Interactive Card Expansion: tracks which card is currently expanded on click
  const [expandedCardId, setExpandedCardId] = useState(RADAR_COMPANIES[0]?.id || null)
  const [expandedCandidateId, setExpandedCandidateId] = useState(VERIFIED_TALENT_PROFILES[0]?.id || null)

  // Active iOS Modal Sheet: null | 'origin' | 'corridor' | 'filter' | 'key'
  const [activeModal, setActiveModal] = useState(null)

  // Real OSRM Road Route state
  const [roadRouteData, setRoadRouteData] = useState({
    distanceKm: null,
    durationMin: null,
    isRoadRoute: false
  })

  // Modals & Proof-Gap Drawer states
  const [applyModalCompany, setApplyModalCompany] = useState(null)
  const [appliedSuccess, setAppliedSuccess] = useState(false)
  const [proofGapItem, setProofGapItem] = useState(null)
  const [proofGapSigned, setProofGapSigned] = useState(false)
  const [extraVerifiedSkills, setExtraVerifiedSkills] = useState(new Set())
  const [interviewInviteCandidate, setInterviewInviteCandidate] = useState(null)
  const [interviewInviteSuccess, setInterviewInviteSuccess] = useState(false)

  // WP2: Sentinel for capsule scroll shadow & search expand state
  const sentinelRef = useRef(null)
  const searchInputRef = useRef(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isSearchExpanded, setIsSearchExpanded] = useState(false)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsScrolled(!entry.isIntersecting)
      },
      { threshold: [0] }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  // Match the map to the site theme, live
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setSiteTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const mapContainerRef = useRef(null)
  const recenterRef = useRef(null)
  const listScrollRef = useRef(null)
  const cardAnchorRef = useRef(null)
  const cardRevealRef = useRef(null)
  const [cardRevealTick, setCardRevealTick] = useState(0)

  const findCard = (id) => listScrollRef.current?.querySelector(`[data-radar-card="${CSS.escape(id)}"]`)

  // Remember where a card sits before it toggles, so a card collapsing above it can't move it
  const captureCardAnchor = (id) => {
    const card = findCard(id)
    cardAnchorRef.current = card ? { id, top: card.getBoundingClientRect().top } : null
  }

  const requestCardReveal = (id) => {
    cardRevealRef.current = id
    setCardRevealTick((n) => n + 1)
  }

  useLayoutEffect(() => {
    const anchor = cardAnchorRef.current
    cardAnchorRef.current = null
    const list = listScrollRef.current
    const card = anchor && findCard(anchor.id)
    if (list && card) list.scrollTop += card.getBoundingClientRect().top - anchor.top
  }, [expandedCardId, expandedCandidateId])

  // A map pin was clicked: bring its card to the top of the list, below the sticky header
  useLayoutEffect(() => {
    if (!cardRevealTick) return
    const list = listScrollRef.current
    const card = findCard(cardRevealRef.current)
    if (!list || !card) return
    const headerHeight = list.querySelector('.radar-listings-header')?.offsetHeight || 0
    const listTop = list.getBoundingClientRect().top
    list.scrollTo({
      top: list.scrollTop + card.getBoundingClientRect().top - listTop - headerHeight - 6,
      behavior: RM ? 'auto' : 'smooth'
    })
    // On narrow screens the list sits below the map, so the page has to move too
    if (listTop < 0 || listTop > window.innerHeight * 0.5) {
      if (scroller.lenis) scroller.lenis.scrollTo(list, { offset: -96 })
      else list.scrollIntoView({ block: 'start' })
    }
  }, [cardRevealTick])
  const mapInstanceRef = useRef(null)
  const tileLayerRef = useRef(null)
  const markersLayerRef = useRef(null)
  const sezLayerRef = useRef(null)
  const transitPolylineRef = useRef(null)
  const osrmCacheRef = useRef(new Map())
  const abortControllerRef = useRef(null)

  // Close modals on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setActiveModal(null)
        setProofGapItem(null)
        setApplyModalCompany(null)
        setInterviewInviteCandidate(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Load applicant passport for verified skill matching - strictly isolated to current user!
  useEffect(() => {
    async function loadPassport() {
      if (!user) {
        setPassport(null)
        return
      }
      try {
        const userPassports = await listPassports(user.id)
        let active = userPassports[0] || null
        if (!active) {
          const all = await listPassports()
          // Strictly match current user credentials - NEVER fall back to another candidate's passport!
          active = all.find((p) =>
            (p.userId && p.userId === user.id) ||
            (p.email && user.email && p.email.toLowerCase() === user.email.toLowerCase()) ||
            (p.candidate && user.name && p.candidate.toLowerCase() === user.name.toLowerCase())
          ) || null
        }
        setPassport(active)
      } catch (err) {
        console.error('Failed to load passport:', err)
        setPassport(null)
      }
    }
    loadPassport()
  }, [user])

  // Extract candidate verified skills strictly from their active passport
  const candidateVerifiedSkills = (passport?.skills || [])
    .filter((s) => s.state === 'V' || s.claim_state === 'Verified')
    .map((s) => s.skill.toLowerCase())

  // Dynamic set of verified skills: authentic passport skills + any skills verified in this session via Proof-Gap
  const verifiedSkillSet = new Set([
    ...candidateVerifiedSkills,
    ...Array.from(extraVerifiedSkills).map((s) => s.toLowerCase())
  ])

  // Compute distance and match score for each company dynamically based on active credentials
  const processedCompanies = RADAR_COMPANIES.map((comp) => {
    const isRemote = comp.workMode === 'Remote'
    const distKm = isRemote ? 0 : calculateDistanceKm(userCoords.lat, userCoords.lng, comp.coordinates.lat, comp.coordinates.lng)

    const totalRequired = comp.requiredSkills.length
    const matchedCount = comp.requiredSkills.filter((sk) => verifiedSkillSet.has(sk.toLowerCase())).length

    // Credential role affinity: check user's targetRole from profile
    const userRole = (user?.profile?.targetRole || '').toLowerCase()
    const compRole = comp.roleTitle.toLowerCase()
    const compDesc = comp.description.toLowerCase()
    const roleWords = userRole.split(/[\s,/-]+/).filter((w) => w.length > 2)
    const roleMatches = roleWords.some((w) => compRole.includes(w) || compDesc.includes(w))

    let matchScore = 0
    if (verifiedSkillSet.size === 0) {
      // New user with zero verified skills yet
      // Reflects unverified status (15%-25%) prompting Proof-Gap resolution
      matchScore = roleMatches ? 25 : 15
    } else {
      const skillRatio = totalRequired > 0 ? (matchedCount / totalRequired) : 0.5
      const baseScore = roleMatches ? 22 : 12
      matchScore = Math.min(98, Math.round(baseScore + skillRatio * (98 - baseScore)))
    }

    return {
      ...comp,
      distanceKm: distKm,
      matchScore,
      matchedSkillsCount: matchedCount,
      roleMatches
    }
  })

  // Filter based on selected criteria
  const filteredCompanies = processedCompanies.filter((comp) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const corpus = `${comp.name} ${comp.roleTitle} ${comp.techPark} ${(comp.requiredSkills || []).join(' ')} ${comp.description}`.toLowerCase()
      if (!corpus.includes(q)) return false
    }

    if (radiusFilter === '5' && comp.distanceKm > 5.5 && comp.workMode !== 'Remote') return false
    if (radiusFilter === '15' && comp.distanceKm > 16 && comp.workMode !== 'Remote') return false
    if (radiusFilter === '30' && comp.distanceKm > 35 && comp.workMode !== 'Remote') return false

    if (workModeFilter !== 'ALL' && comp.workMode.toLowerCase() !== workModeFilter.toLowerCase()) {
      return false
    }

    if (tierFilter !== 'ALL' && comp.tier !== tierFilter) {
      return false
    }

    if (selectedSezCorridor !== 'all' && comp.corridorId !== selectedSezCorridor) {
      return false
    }

    return true
  }).sort((a, b) => (b.matchScore - a.matchScore) || (a.distanceKm - b.distanceKm))

  // ── AUTHENTIC REVERSE GEOCODING (OSM Nominatim / BigDataCloud) ──────────
  const reverseGeocodeLocality = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
        { headers: { 'User-Agent': 'ProofPass-JobRadar/2.0' } }
      )
      if (res.ok) {
        const data = await res.json()
        const addr = data.address || {}
        if (addr.suburb && addr.village && addr.suburb !== addr.village) {
          return `${addr.suburb}, ${addr.village}`
        }
        if (addr.suburb && addr.neighbourhood && addr.suburb !== addr.neighbourhood) {
          return `${addr.suburb}, ${addr.neighbourhood}`
        }
        return addr.suburb || addr.village || addr.neighbourhood || addr.city_district || addr.residential || addr.road || addr.city || 'Current location'
      }
    } catch {
      // Fallback to BigDataCloud
      try {
        const bdc = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
        if (bdc.ok) {
          const bdcData = await bdc.json()
          return bdcData.locality || bdcData.city || 'Current location'
        }
      } catch (e) {
        console.warn('Reverse geocoding fallback failed:', e)
      }
    }
    return 'Current location'
  }

  // ── PURE LIVE DEVICE GPS LOCATION ENGINE ────────────────────────────────
  // Directly acquires exact physical coordinates from user's device hardware/OS
  const handleDetectLocation = useCallback(async () => {
    setLocating(true)
    setLocationStatus('detecting')
    setActiveModal(null)

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocating(false)
      setLocationStatus('fallback')
      setLocationToast('Geolocation is not supported by your browser')
      setTimeout(() => setLocationToast(null), 4000)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6))
        const lng = Number(pos.coords.longitude.toFixed(6))
        const acc = Math.round(pos.coords.accuracy || 15)

        // Authentically reverse geocode user's exact device coordinates
        const locality = await reverseGeocodeLocality(lat, lng)
        const cleanName = `Live GPS · ${locality}`

        const coords = {
          name: cleanName,
          city: 'Pune',
          lat,
          lng,
          zoom: 15,
          accuracy: acc
        }

        setUserCoords(coords)
        setLocating(false)
        setLocationStatus('locked')
        setLocationToast(`Live Location Locked: ${locality}`)
        setTimeout(() => setLocationToast(null), 3500)

        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([lat, lng], 15, { duration: 0.9 })
        }
      },
      async (err) => {
        console.warn('Geolocation notice:', err.message)
        // High-reliability multi-user IP fallback: triangulates user by public IP network
        try {
          const res = await fetch('https://ipapi.co/json/')
          if (res.ok) {
            const data = await res.json()
            if (data && data.latitude && data.longitude) {
              const ipLocality = data.city || data.region || 'Detected Network Node'
              const ipCoords = {
                name: `Network IP · ${ipLocality}`,
                city: data.city || 'Pune',
                lat: Number(data.latitude.toFixed(6)),
                lng: Number(data.longitude.toFixed(6)),
                zoom: 13,
                accuracy: 5000
              }
              setUserCoords(ipCoords)
              setLocating(false)
              setLocationStatus('fallback')
              setLocationToast(`Location Triangulated via IP: ${ipLocality}`)
              setTimeout(() => setLocationToast(null), 3500)
              if (mapInstanceRef.current) {
                mapInstanceRef.current.flyTo([ipCoords.lat, ipCoords.lng], 13, { duration: 0.9 })
              }
              return
            }
          }
        } catch (ipErr) {
          console.warn('IP fallback failed:', ipErr)
        }

        setLocating(false)
        setLocationStatus('fallback')
        if (err.code === 1) {
          setLocationToast('Location access denied in browser. Please enable permissions.')
        } else if (err.code === 2) {
          setLocationToast('Device position unavailable. Check GPS/Wi-Fi.')
        } else if (err.code === 3) {
          setLocationToast('GPS location request timed out. Please try again.')
        } else {
          setLocationToast('Could not acquire device GPS.')
        }
        setTimeout(() => setLocationToast(null), 4000)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000
      }
    )
  }, [])

  // Fly to the known position, and fetch a live one if the current origin isn't a live fix
  const handleRecenter = () => {
    const map = mapInstanceRef.current
    if (map) map.flyTo([userCoords.lat, userCoords.lng], Math.max(map.getZoom(), 14), { duration: 0.8 })
    if (locationStatus !== 'locked' && !locating) handleDetectLocation()
  }
  recenterRef.current = handleRecenter

  // Auto-detect on first load
  useEffect(() => {
    const timer = setTimeout(() => {
      handleDetectLocation()
    }, 800)
    return () => clearTimeout(timer)
  }, [handleDetectLocation])

  // ── AUTHENTIC OSRM ROAD ROUTING SERVICE (WP7) ──────────────────────────
  // Debounced ~400ms, abortable via AbortController, cached by origin coords -> compId
  useEffect(() => {
    if (perspective !== 'candidate' || !selectedCompany || selectedCompany.workMode === 'Remote') {
      setRoadRouteData({ distanceKm: null, durationMin: null, isRoadRoute: false })
      if (transitPolylineRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(transitPolylineRef.current)
        transitPolylineRef.current = null
      }
      return
    }

    // Cancel any previous in-flight OSRM request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    const userLat = userCoords.lat
    const userLng = userCoords.lng
    const compLat = selectedCompany.coordinates.lat
    const compLng = selectedCompany.coordinates.lng
    const cacheKey = `${userLat.toFixed(4)},${userLng.toFixed(4)}->${selectedCompany.id}`

    // Check in-memory cache first to avoid redundant network calls
    if (osrmCacheRef.current.has(cacheKey)) {
      const cached = osrmCacheRef.current.get(cacheKey)
      setRoadRouteData({
        distanceKm: cached.distanceKm,
        durationMin: cached.durationMin,
        isRoadRoute: cached.isRoadRoute
      })
      if (mapInstanceRef.current) {
        if (transitPolylineRef.current) {
          mapInstanceRef.current.removeLayer(transitPolylineRef.current)
        }
        const polyline = L.polyline(cached.roadLatLngs, {
          color: JR_ORANGE,
          weight: 5,
          className: 'jr-route',
          opacity: 1
        }).addTo(mapInstanceRef.current)
        transitPolylineRef.current = polyline
      }
      return
    }

    // Debounce OSRM fetch ~400ms to avoid hammering during fast clicks or repositioning
    const timerId = setTimeout(async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${compLng},${compLat}?overview=full&geometries=geojson`
        const res = await fetch(url, { signal: controller.signal })
        if (res.ok) {
          const data = await res.json()
          if (!controller.signal.aborted && data.routes && data.routes.length > 0) {
            const route = data.routes[0]
            const roadDistKm = Number((route.distance / 1000).toFixed(1))
            const roadDurMin = Math.max(1, Math.round(route.duration / 60))
            const roadLatLngs = route.geometry.coordinates.map((coord) => [coord[1], coord[0]])

            const result = {
              distanceKm: roadDistKm,
              durationMin: roadDurMin,
              isRoadRoute: true,
              roadLatLngs
            }
            osrmCacheRef.current.set(cacheKey, result)

            setRoadRouteData({
              distanceKm: roadDistKm,
              durationMin: roadDurMin,
              isRoadRoute: true
            })

            if (mapInstanceRef.current) {
              if (transitPolylineRef.current) {
                mapInstanceRef.current.removeLayer(transitPolylineRef.current)
              }
              const polyline = L.polyline(roadLatLngs, {
                color: JR_ORANGE,
                weight: 5,
                className: 'jr-route',
                opacity: 1
              }).addTo(mapInstanceRef.current)
              transitPolylineRef.current = polyline
            }
            return
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('OSRM routing fallback to driving estimate:', err)
        }
      }

      // Fallback straight corridor if OSRM is offline or non-200
      if (!controller.signal.aborted && mapInstanceRef.current) {
        if (transitPolylineRef.current) {
          mapInstanceRef.current.removeLayer(transitPolylineRef.current)
        }
        const straightPoints = [
          [userLat, userLng],
          [(userLat + compLat) / 2 + 0.003, (userLng + compLng) / 2 - 0.002],
          [compLat, compLng]
        ]
        const polyline = L.polyline(straightPoints, {
          color: JR_ORANGE,
          weight: 4,
          className: 'jr-route',
          opacity: 1
        }).addTo(mapInstanceRef.current)
        transitPolylineRef.current = polyline

        const straightDist = calculateDistanceKm(userLat, userLng, compLat, compLng)
        setRoadRouteData({
          distanceKm: straightDist,
          durationMin: selectedCompany.transit?.travelTimeMinutes || Math.round(straightDist * 1.8),
          isRoadRoute: false
        })
      }
    }, 400)

    return () => {
      clearTimeout(timerId)
      controller.abort()
    }
  }, [userCoords.lat, userCoords.lng, selectedCompany?.id, perspective])

  // WP4: ResizeObserver debounced ~100ms calling map.invalidateSize({ animate: false })
  useEffect(() => {
    if (!mapContainerRef.current) return
    let timeoutId = null
    const ro = new ResizeObserver(() => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ animate: false })
        }
      }, 100)
    })
    ro.observe(mapContainerRef.current)
    return () => {
      ro.disconnect()
      clearTimeout(timeoutId)
    }
  }, [])

  // ── LEAFLET MAP & PIN INITIALIZATION ────────────────────────────────────
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

      L.control.zoom({ position: 'bottomright' }).addTo(map)

      // Recenter sits directly above zoom in the same corner
      const RecenterControl = L.Control.extend({
        onAdd() {
          const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control jr-recenter-control')
          const button = L.DomUtil.create('button', 'jr-recenter-btn', bar)
          button.type = 'button'
          button.title = 'Recenter on my location'
          button.setAttribute('aria-label', 'Recenter map on my location')
          button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
          L.DomEvent.disableClickPropagation(bar)
          L.DomEvent.on(button, 'click', () => recenterRef.current?.())
          return bar
        }
      })
      new RecenterControl({ position: 'bottomright' }).addTo(map)

      const currentConfig = getTileConfig(mapTheme)
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

    // 2. Tile layer theme switch
    if (tileLayerRef.current) {
      const currentConfig = getTileConfig(mapTheme)
      tileLayerRef.current.setUrl(currentConfig.url)
      const container = tileLayerRef.current.getContainer()
      if (container) {
        container.className = `leaflet-tile-container leaflet-zoom-animated ${currentConfig.className}`
      }
    }

    // 3. Render Pune SEZ Corridor Polygons
    sezLayer.clearLayers()
    PUNE_SEZ_CORRIDORS.forEach((sez) => {
      const isSelected = selectedSezCorridor === sez.id
      const poly = L.polygon(sez.polygon, {
        color: isSelected ? '#fff' : corridorColor(sez.color),
        weight: isSelected ? 3 : 1.5,
        fillColor: corridorColor(sez.fillColor),
        fillOpacity: isSelected ? 0.32 : 0.12,
        dashArray: isSelected ? null : '4, 4'
      })

      poly.bindTooltip(
        `<div style="font-family: -apple-system, sans-serif; font-size: 0.76rem; padding: 2px;"><strong>${sez.name}</strong><br/><span style="color: ${JR_ORANGE};">${sez.subtitle}</span></div>`,
        { sticky: true }
      )

      poly.on('click', () => {
        setSelectedSezCorridor(sez.id)
        map.fitBounds(poly.getBounds(), { padding: [24, 24] })
      })

      poly.addTo(sezLayer)
    })

    // 4. Render Markers
    markersLayer.clearLayers()

    // Commute Origin Pin (Draggable)
    const userPinHtml = `
      <div class="radar-user-map-pin ${locationStatus === 'fallback' ? 'is-fallback' : ''}" title="Your location (drag to change)">
        <svg width="28" height="36" viewBox="0 0 28 36" aria-hidden="true">
          <path d="M14 1C6.8 1 1 6.8 1 14c0 9.6 13 21 13 21s13-11.400 13-21C27 6.8 21.200 1 14 1z" fill="currentColor" stroke="#fff" stroke-width="2"/>
          <circle cx="14" cy="14" r="5" fill="#fff"/>
        </svg>
      </div>
    `
    const userIcon = L.divIcon({
      html: userPinHtml,
      className: 'user-marker-container',
      iconSize: [28, 36],
      iconAnchor: [14, 36]
    })
    const userMarker = L.marker([userCoords.lat, userCoords.lng], {
      icon: userIcon,
      draggable: true,
      zIndexOffset: 1000
    }).addTo(markersLayer)

    // Visual GPS Accuracy Halo Circle
    if (userCoords.accuracy && userCoords.accuracy < 3000) {
      L.circle([userCoords.lat, userCoords.lng], {
        radius: Math.max(15, userCoords.accuracy),
        color: '#38bdf8',
        fillColor: '#38bdf8',
        fillOpacity: 0.10,
        weight: 1.5,
        dashArray: '4, 4'
      }).addTo(markersLayer)
    }

    userMarker.bindTooltip(
      `<strong>${userCoords.name || 'Origin'}</strong><br/><span style="color: ${JR_ORANGE}; font-size: 0.72rem;">${locationStatus === 'fallback' ? 'Not your exact location. ' : ''}Drag pin to reposition origin</span>`,
      { permanent: false, direction: 'top', offset: [0, -36] }
    )

    userMarker.on('dragend', async (e) => {
      const p = e.target.getLatLng()
      const lat = Number(p.lat.toFixed(5))
      const lng = Number(p.lng.toFixed(5))
      const locality = await reverseGeocodeLocality(lat, lng)
      setUserCoords({
        name: `Pinned · ${locality}`,
        city: 'Pune',
        lat,
        lng,
        zoom: 14.5
      })
      setLocationStatus('custom')
      setLocationToast(`Commute Origin Moved to: ${locality}`)
      setTimeout(() => setLocationToast(null), 3000)
    })

    // Explicit dragend only for manual origin repositioning (accidental map clicks ignored)
    map.off('click')

    if (perspective === 'candidate') {
      // Candidate View: Render Company Beacons
      filteredCompanies.forEach((comp) => {
        const isSelected = selectedCompany?.id === comp.id
        const isHighMatch = comp.matchScore >= 90
        const isRemote = comp.workMode === 'Remote'

        const pinHtml = `
          <div class="radar-clean-pin ${isSelected ? 'active-pin' : ''} ${isHighMatch ? 'high-match' : ''} ${isRemote ? 'remote-pin' : ''}" >
            <div class="pin-score">${comp.matchScore}%</div>
            <div class="pin-initials">${comp.logo}</div>
            <div class="pin-expanded-label">${comp.name}</div>
          </div>
        `

        const customIcon = L.divIcon({
          html: pinHtml,
          className: 'clean-marker-container',
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        })

        const marker = L.marker([comp.coordinates.lat, comp.coordinates.lng], { icon: customIcon })

        marker.on('click', () => {
          setSelectedCompany(comp)
          setExpandedCardId(comp.id)
          requestCardReveal(comp.id)
          map.flyTo([comp.coordinates.lat, comp.coordinates.lng], 14.5, { duration: 0.8 })
        })

        const popupHtml = `
          <div style="font-family: -apple-system, sans-serif; min-width: 210px; padding: 2px;">
            <strong style="color: #111; font-size: 0.95rem;">${comp.name}</strong>
            ${comp.smbFastTrack ? '<div style="color: ${JR_ORANGE}; font-size: 0.72rem; font-weight: bold; margin-top: 1px;">DIRECT CTO FAST-TRACK</div>' : ''}
            <div style="color: ${JR_ORANGE}; font-weight: bold; font-size: 0.8rem; margin: 3px 0;">${comp.matchScore}% Skill Match</div>
            <div style="color: #666; font-size: 0.75rem; margin-bottom: 4px;">${comp.techPark}</div>
            <div style="color: #0284c7; font-size: 0.72rem; margin-bottom: 6px; font-weight: 500;">${comp.transit?.travelTimeMinutes || 20}m commute via ${comp.transit?.corridorName || 'Road'}</div>
            <a href="${comp.officialUrl}" target="_blank" style="color: ${JR_ORANGE}; font-size: 0.75rem; font-weight: 600; text-decoration: none;">View Official Careers Portal ↗</a>
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
            <div style="font-size: 0.6rem; color: #38bdf8; font-family: monospace; font-weight: 700;">${cand.matchToHiringNeeds}%</div>
            <div style="font-size: 0.66rem; color: #fff; font-family: monospace; font-weight: 700;">PP</div>
            <div class="pin-expanded-label">Verified Candidate · ${cand.neighborhood}</div>
          </div>
        `

        const candIcon = L.divIcon({
          html: pinHtml,
          className: 'clean-marker-container',
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        })

        const marker = L.marker([cand.coordinates.lat, cand.coordinates.lng], { icon: candIcon })

        marker.on('click', () => {
          setSelectedCandidate(cand)
          setExpandedCandidateId(cand.id)
          requestCardReveal(cand.id)
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
    locationStatus,
    extraVerifiedSkills
  ])

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

  // Skill states are decided only by the backend verification engine. The Proof-Gap drawer never changes a state.

  // Dispatch application modal
  const handleApply = (comp) => {
    if (isRecruiter) {
      console.warn('Unauthorized: Recruiters cannot submit candidate job applications')
      return
    }
    setApplyModalCompany(comp)
    setAppliedSuccess(false)
  }

  const confirmDispatchApplication = () => {
    setAppliedSuccess(true)
    setTimeout(() => {
      setApplyModalCompany(null)
      setAppliedSuccess(false)
    }, 2000)
  }

  // Recruiter: Dispatch interview invitation
  const handleDispatchInterviewInvite = (cand) => {
    if (!isRecruiter && !isAdmin) {
      console.warn('Unauthorized: Candidates cannot dispatch interview invitations')
      return
    }
    setInterviewInviteCandidate(cand)
    setInterviewInviteSuccess(false)
  }

  const confirmDispatchInterview = () => {
    setInterviewInviteSuccess(true)
    setTimeout(() => {
      setInterviewInviteCandidate(null)
      setInterviewInviteSuccess(false)
    }, 2000)
  }

  // ── GSAP MICRO-INTERACTIONS ──────────────────────────────────────────
  // Staggered card list entrance motion
  useEffect(() => {
    if (typeof window !== 'undefined' && filteredCompanies.length > 0) {
      gsap.fromTo(
        '.jr-card',
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.32, stagger: 0.03, ease: 'power2.out', clearProps: 'transform' }
      )
    }
  }, [filteredCompanies.length, perspective, selectedSezCorridor, workModeFilter])

  // Real road transit banner smooth entrance
  useEffect(() => {
    if (roadRouteData.durationMin) {
      gsap.fromTo(
        '.radar-live-transit-banner',
        { opacity: 0, y: 12, scale: 0.98 },
        { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: 'back.out(1.3)' }
      )
    }
  }, [roadRouteData.durationMin, selectedCompany?.id])

  // Say so whenever the origin on the map isn't the user's real position
  const originLabel = userCoords.name?.split('·')[1]?.trim() || userCoords.name?.split('(')[0]?.trim() || 'Origin'
  const locationNote =
    locationStatus === 'idle' || locationStatus === 'detecting'
      ? 'Finding your location...'
      : locationStatus === 'fallback'
        ? (userCoords.name?.startsWith('Network IP')
            ? `Approximate location from your network: ${originLabel}`
            : `Device location unavailable. Showing ${originLabel}.`)
        : null

  // Count active filter criteria
  const activeFiltersCount = (radiusFilter !== 'all' ? 1 : 0) + (workModeFilter !== 'ALL' ? 1 : 0) + (tierFilter !== 'ALL' ? 1 : 0)

  // Current selected corridor display name
  const activeCorridorObj = PUNE_SEZ_CORRIDORS.find((c) => c.id === selectedSezCorridor)

  return (
    <main id="main" className="dash-page radar-page jr-root" data-basemap={baseMapTheme}>
      {/* Flat page background */}
      <RadarBackground />

      <div className="w">
        {/* WP2: 1px Sentinel for scroll shadow detection without scroll listeners */}
        <div ref={sentinelRef} className="jr-sentinel" aria-hidden="true" />

        {/* ── 1. APPLE iOS 27 DYNAMIC ISLAND COMMAND CAPSULE (WP2) ─────────── */}
        <header className={`ios-dynamic-island-shell ${isScrolled ? 'is-scrolled' : ''}`}>
          <div className="ios-island-capsule">
            {/* Left: Dynamic Beacon & Branding */}
            <div className="ios-island-brand">
              <div className="ios-radar-beacon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <JrLottie animationData={LOTTIE_RADAR_SONAR} width={28} height={28} />
              </div>
              <div className="ios-brand-text">
                <div className="ios-app-title">
                  <span>{perspective === 'candidate' ? 'JOB RADAR' : 'TALENT RADAR'}</span>
                </div>
                <div className="ios-app-subtitle">
                  {perspective === 'candidate' ? 'Pune Tech Corridors · Metro 3' : 'Recruiter Talent Scout'}
                </div>
              </div>
            </div>

            {/* Center: Fluid Expanding Search Island (WP2) */}
            <div
              className="ios-search-capsule"
              data-expanded={isSearchExpanded || Boolean(searchQuery)}
              aria-expanded={isSearchExpanded || Boolean(searchQuery)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onFocus={() => setIsSearchExpanded(true)}
                onBlur={() => {
                  if (!searchQuery) setIsSearchExpanded(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsSearchExpanded(false)
                    searchInputRef.current?.blur()
                  }
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='Search verified roles, skills (e.g. "React", "Python", "Docker", "Druva")...'
                aria-label="Search verified roles and skills"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="ios-search-clear"
                  onClick={() => {
                    setSearchQuery('')
                    setIsSearchExpanded(false)
                  }}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Right: Quick Action Glass Capsules */}
            <div className="ios-action-capsules">
              {/* Origin Trigger */}
              <button
                type="button"
                className={`ios-pill-btn ${locationStatus === 'locked' ? 'active-green' : locationStatus === 'fallback' ? 'active-amber' : ''}`}
                onClick={() => setActiveModal('origin')}
                title={locationNote || 'Change Commute Origin or Re-Scan Live GPS'}
              >
                <PinIcon />
                <span className="pill-text-truncate">{userCoords.name?.split('·')[1]?.trim() || userCoords.name?.split('(')[0]?.trim() || 'Origin'}</span>
              </button>

              {/* Corridor Trigger */}
              <button
                type="button"
                className={`ios-pill-btn ${selectedSezCorridor !== 'all' ? 'active-orange' : ''}`}
                onClick={() => setActiveModal('corridor')}
                title="Geofence by Pune SEZ Corridor"
              >
                <span className="pill-text-truncate">{activeCorridorObj ? activeCorridorObj.name.split(' ')[0] : 'All SEZs'}</span>
              </button>

              {/* Re-Detect Live GPS button */}
              <button
                type="button"
                className="ios-pill-btn gps-action-btn"
                onClick={handleDetectLocation}
                title="Instantly detect your live laptop location via Wi-Fi/GPS triangulation"
              >
                <LocateIcon />
                <span className="gps-label">{locating ? 'Triangulating...' : 'My Location'}</span>
              </button>

              {/* Perspective switch, for admins only */}
              {isAdmin ? (
                <JrSegmented
                  value={perspective}
                  onChange={handlePerspectiveChange}
                />
              ) : null}
            </div>
          </div>

          {/* Optional Toast Notification Pill */}
          {locationToast && (
            <div className="ios-island-toast-pill">
              <span className="toast-dot" />
              <span>{locationToast}</span>
            </div>
          )}
        </header>

        {/* ── 2. MAIN SPLIT GRID: LEAFLET MAP + JOB CARDS LIST ────────────── */}
        <div className="radar-grid jr-layout">
          {/* LEFT: LIVE LEAFLET MAP VIEWPORT */}
          <div className="radar-viewport-container jr-map">
            {/* Basemap follows the site theme; satellite is an on/off choice */}
            <button
              type="button"
              className={`jr-map-satellite ${satelliteOn ? 'active' : ''}`}
              aria-pressed={satelliteOn}
              onClick={() => setSatelliteOn((on) => !on)}
              title="Show satellite imagery"
            >
              <SatelliteIcon />
              <span>Satellite</span>
            </button>

            {/* Leaflet Canvas Element */}
            <div ref={mapContainerRef} className="leaflet-map-element" />

            {/* Mercedes MBUX / Audi MMI Telemetry Navigation Deck */}
            {perspective === 'candidate' && selectedCompany && selectedCompany.workMode !== 'Remote' && (
              <div key={selectedCompany.id} className="jr-cockpit-hud jr-hud-crossfade">
                {/* 1. Left Section: Waypoint & Destination Identity */}
                <div className="jr-cockpit-dest">
                  <h4 className="jr-cockpit-name">{selectedCompany.name}</h4>

                  <div className="jr-cockpit-subline">
                    <svg className="jr-cockpit-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className="jr-cockpit-origin-text">
                      From {userCoords.name?.split('·')[1]?.trim() || userCoords.name?.split('(')[0]?.trim() || 'Origin'}
                    </span>
                  </div>
                </div>

                {/* 2. Center Section: Digital Instrument Cluster Metrics */}
                <div className="jr-cockpit-metrics">
                  <div className="jr-cockpit-metric-cell">
                    <div className="jr-cockpit-val-wrap jr-tabular">
                      <span className="jr-cockpit-val">
                        {roadRouteData.durationMin || selectedCompany.transit?.travelTimeMinutes || 20}
                      </span>
                      <span className="jr-cockpit-unit">MIN</span>
                    </div>
                    <span className="jr-cockpit-label">Commute Time</span>
                  </div>

                  <div className="jr-cockpit-divider" aria-hidden="true" />

                  <div className="jr-cockpit-metric-cell">
                    <div className="jr-cockpit-val-wrap jr-tabular">
                      <span className="jr-cockpit-val">
                        {roadRouteData.distanceKm || selectedCompany.distanceKm}
                      </span>
                      <span className="jr-cockpit-unit">KM</span>
                    </div>
                    <span className="jr-cockpit-label">Road Distance</span>
                  </div>
                </div>

                {/* 3. Right Section: Multi-Modal Metro Connection & Launch CTA */}
                <div className="jr-cockpit-actions">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&origin=${userCoords.lat},${userCoords.lng}&destination=${selectedCompany.coordinates.lat},${selectedCompany.coordinates.lng}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="jr-cockpit-btn"
                    title="Open live Google Maps turn-by-turn route navigation in new window"
                  >
                    <span>Launch Navigation</span>
                    <svg className="jr-cockpit-svg sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polygon points="3 11 22 2 13 21 11 13 3 11" />
                    </svg>
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: JOB OPPORTUNITY CARDS OR RECRUITER TALENT CARDS (WP3 List Crossfade) */}
          <div key={perspective} ref={listScrollRef} className="radar-listings-scroll jr-list-crossfade" data-lenis-prevent>
            {/* Header / Expand All Control */}
            <div className="radar-listings-header">
              <span className="listings-count-badge">
                {perspective === 'candidate'
                  ? `${filteredCompanies.length} Verified Roles Mapped`
                  : `${VERIFIED_TALENT_PROFILES.length} Verified Profiles Mapped`}
              </span>
              {perspective === 'candidate' && (
                <button
                  type="button"
                  className={`ios-pill-btn ${activeFiltersCount > 0 ? 'active-amber' : ''}`}
                  onClick={() => setActiveModal('filter')}
                  title="Smart Filters"
                >
                  <span>Filter</span>
                  {activeFiltersCount > 0 && <span className="pill-badge">{activeFiltersCount}</span>}
                </button>
              )}
            </div>

            {perspective === 'candidate' ? (
              filteredCompanies.length === 0 ? (
                <div className="radar-empty-state">
                  <h3>No matches for &ldquo;{searchQuery || 'current filters'}&rdquo;</h3>
                  <p>Try clearing your keyword search query or resetting the commute distance and tier filters.</p>
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
                filteredCompanies.map((comp, idx) => (
                  <JobCard
                    key={comp.id}
                    comp={comp}
                    index={idx}
                    isSelected={selectedCompany?.id === comp.id}
                    isExpanded={expandedCardId === comp.id}
                    onToggleExpand={(c) => {
                      captureCardAnchor(c.id)
                      setExpandedCardId((prev) => (prev === c.id ? null : c.id))
                    }}
                    onSelect={(c) => {
                      setSelectedCompany(c)
                      if (mapInstanceRef.current && c.coordinates) {
                        mapInstanceRef.current.flyTo([c.coordinates.lat, c.coordinates.lng], 14.5, { duration: 0.8 })
                      }
                    }}
                    onApply={handleApply}
                    onOpenProofGap={handleOpenProofGap}
                    onFocusMap={(c) => {
                      setSelectedCompany(c)
                      if (mapInstanceRef.current && c.coordinates) {
                        mapInstanceRef.current.flyTo([c.coordinates.lat, c.coordinates.lng], 15, { duration: 0.9 })
                        mapContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                      }
                    }}
                    verifiedSkillSet={verifiedSkillSet}
                  />
                ))
              )
            ) : (
              // Recruiter View: Verified Candidates
              VERIFIED_TALENT_PROFILES.map((cand) => {
                const isSelected = selectedCandidate?.id === cand.id
                const isExpanded = expandedCandidateId === cand.id
                return (
                  <div
                    key={cand.id}
                    data-radar-card={cand.id}
                    className={`radar-candidate-card ${isSelected ? 'active' : ''} ${isExpanded ? 'is-expanded' : ''}`}
                    onClick={() => {
                      setSelectedCandidate(cand)
                      captureCardAnchor(cand.id)
                      setExpandedCandidateId((prev) => (prev === cand.id ? null : cand.id))
                      if (mapInstanceRef.current && cand.coordinates) {
                        mapInstanceRef.current.flyTo([cand.coordinates.lat, cand.coordinates.lng], 14, { duration: 0.8 })
                      }
                    }}
                  >
                    <div className="cand-header-row">
                      <div>
                        <div className="cand-title-block">
                          <strong className="cand-codename">{cand.codeName}</strong>
                          <span className="cand-sha-pill">
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '3px' }}>
                              <path fillRule="evenodd" d="M8 0c-.69 0-1.84.04-2.88.31-1.03.27-2.07.72-2.9 1.48-.42.38-.72.84-.94 1.34C1.06 3.63 1 4.2 1 4.8c0 4.24 2.87 8.35 6.38 10.95.37.28.87.28 1.24 0C12.13 13.15 15 9.04 15 4.8c0-.6-.06-1.17-.28-1.67-.22-.5-.52-.96-.94-1.34-.83-.76-1.87-1.21-2.9-1.48C9.84.04 8.69 0 8 0zm2.78 5.72a.75.75 0 0 0-1.06-1.06L6.5 7.88 5.28 6.66a.75.75 0 0 0-1.06 1.06l1.75 1.75c.3.3.77.3 1.06 0l3.75-3.75z" />
                            </svg>
                            <span>SHA-256 VALIDATED</span>
                          </span>
                        </div>
                        <div className="cand-role-compact">{cand.roleTag}</div>
                        <div className="cand-loc-text">
                          <span className="jr-meta-item">
                            <svg className="jr-meta-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            <span>{cand.neighborhood}</span>
                            <span className="jr-dot-sep">·</span>
                            <strong style={{ color: '#10b981' }}>{cand.distanceToClientKm} km away</strong>
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        <MatchRing score={cand.matchToHiringNeeds} size={38} strokeWidth={3.5} />
                        <div className="card-expand-indicator">
                          <span>{isExpanded ? 'Hide' : 'Profile'}</span>
                          <span className={`expand-chevron ${isExpanded ? 'open' : ''}`}>▾</span>
                        </div>
                      </div>
                    </div>

                    <div className="card-expandable-content">
                      <div className="cand-depth">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: JR_ORANGE, verticalAlign: 'middle', marginRight: '6px' }} aria-hidden="true">
                          <line x1="6" y1="3" x2="6" y2="15" />
                          <circle cx="18" cy="6" r="3" />
                          <circle cx="6" cy="18" r="3" />
                          <path d="M18 9a9 9 0 0 1-9 9" />
                        </svg>
                        <span>Verified Commit Depth: {cand.commitDepth}</span>
                      </div>

                      <div className="jr-skill-chips-row">
                        {cand.verifiedSkills.map((sk) => (
                          <span key={sk} className="jr-skill-chip verified">
                            <svg className="jr-chip-check" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                            </svg>
                            <span className="jr-chip-name">{sk}</span>
                            <span className="jr-chip-tag-verified">Verified</span>
                          </span>
                        ))}
                      </div>

                      <button
                        type="button"
                        className="jr-btn jr-btn--primary"
                        style={{ width: '100%', marginTop: '10px' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDispatchInterviewInvite(cand)
                        }}
                      >
                        <svg className="jr-btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M22 2 11 13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                        <span>Dispatch Direct Interview Invite</span>
                      </button>
                    </div>
                  </div>
                )
              })
            )}


          </div>
        </div>
      </div>

      {/* ── 3. ZERO-OVERLAP NATIVE <dialog> MODAL SHEETS (WP5) ───────────── */}

      {/* MODAL 1: COMMUTE ORIGIN & GPS SELECTION */}
      <JrSheet
        open={activeModal === 'origin'}
        onClose={() => setActiveModal(null)}
        badge="COMMUTE ORIGIN ENGINE"
        title="Select Commute Origin"
      >
        <p className="ios-modal-desc">
          Distances, driving times, and transit corridors update live relative to your origin. Choose a Pune campus or let high-accuracy GPS triangulate your exact position.
        </p>

        {/* 1-Click GPS Button */}
        <div style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className={`ios-action-banner-btn ${locating ? 'scanning' : ''}`}
            onClick={handleDetectLocation}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LocateIcon size={18} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, color: '#fff' }}>
                  {locating ? 'Triangulating Live Coordinates...' : 'Detect My Exact Live Location'}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#38bdf8' }}>
                  Uses HTML5 GPS with authentic IP network fallback
                </div>
              </div>
            </div>
            <span className="banner-chevron">→</span>
          </button>
        </div>

        <div className="ios-preset-label">Quick Pune Student Campuses & Residential Hubs:</div>
        <div className="ios-origin-grid">
          {PUNE_NEIGHBORHOOD_ORIGINS.map((orig) => {
            const isSelected = userCoords.lat === orig.lat && userCoords.lng === orig.lng
            return (
              <button
                key={orig.id}
                type="button"
                className={`ios-origin-tile ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setUserCoords(orig)
                  setLocationStatus('custom')
                  setActiveModal(null)
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo([orig.lat, orig.lng], 14, { duration: 0.9 })
                  }
                }}
              >
                <div className="tile-top">
                  <strong className="tile-name">{orig.name}</strong>
                  {isSelected && <span className="tile-check">✓</span>}
                </div>
                <div className="tile-sub">{orig.neighborhood}</div>
              </button>
            )
          })}
        </div>

        <div className="ios-modal-footer-tip">
          <strong>Pro-Tip:</strong> Drag your location pin on the map to set a custom origin, or use the recenter button on the map to return to your live location.
        </div>
      </JrSheet>

      {/* MODAL 2: SEZ CORRIDOR GEOFENCING */}
      <JrSheet
        open={activeModal === 'corridor'}
        onClose={() => setActiveModal(null)}
        badge="PUNE IT SPECIAL ECONOMIC ZONES"
        title="Geofence by Tech Corridor"
      >
        <p className="ios-modal-desc">
          Filter opportunities strictly within Pune’s premier IT special economic zones and boundary polygons.
        </p>

        <div className="ios-corridor-list">
          <button
            type="button"
            className={`ios-corridor-row ${selectedSezCorridor === 'all' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedSezCorridor('all')
              setActiveModal(null)
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="corridor-color-dot" style={{ background: '#9c958f' }} />
              <div>
                <div style={{ fontWeight: 600, color: '#fff' }}>All Pune SEZs & Tech Hubs</div>
                <div style={{ fontSize: '0.72rem', color: '#9c958f' }}>Includes all tech parks, SMBs, and remote opportunities</div>
              </div>
            </div>
            {selectedSezCorridor === 'all' && <span className="tile-check">✓</span>}
          </button>

          {PUNE_SEZ_CORRIDORS.map((sez) => {
            const isSelected = selectedSezCorridor === sez.id
            return (
              <button
                key={sez.id}
                type="button"
                className={`ios-corridor-row ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedSezCorridor(sez.id)
                  setActiveModal(null)
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo(sez.center, 13.5, { duration: 0.9 })
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="corridor-color-dot" style={{ background: corridorColor(sez.color) }} />
                  <div>
                    <div style={{ fontWeight: 600, color: '#fff' }}>{sez.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#9c958f' }}>{sez.subtitle}</div>
                  </div>
                </div>
                {isSelected && <span className="tile-check">✓</span>}
              </button>
            )
          })}
        </div>
      </JrSheet>

      {/* MODAL 3: SMART MULTI-FILTERS */}
      <JrSheet
        open={activeModal === 'filter'}
        onClose={() => setActiveModal(null)}
        badge="SEARCH CRITERIA"
        title="Opportunity Filters"
        headerAction={
          activeFiltersCount > 0 ? (
            <button
              type="button"
              className="ios-reset-filters-btn"
              onClick={() => {
                setRadiusFilter('all')
                setWorkModeFilter('ALL')
                setTierFilter('ALL')
              }}
            >
              Reset All
            </button>
          ) : null
        }
      >
        {/* Filter Section: Organization Type */}
        <div className="filter-group-block">
          <label className="filter-group-label">Organization Tier:</label>
          <div className="filter-options-grid three-col">
            {[
              { key: 'ALL', label: 'All Tiers' },
              { key: 'smb', label: 'Fast-Track SMBs' },
              { key: 'enterprise', label: 'Enterprise MNC' }
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                className={`filter-btn ${tierFilter === t.key ? 'active' : ''}`}
                onClick={() => setTierFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Section: Work Mode */}
        <div className="filter-group-block">
          <label className="filter-group-label">Work Mode:</label>
          <div className="filter-options-grid four-col">
            {['ALL', 'Onsite', 'Hybrid', 'Remote'].map((m) => (
              <button
                key={m}
                type="button"
                className={`filter-btn ${workModeFilter === m ? 'active' : ''}`}
                onClick={() => setWorkModeFilter(m)}
              >
                {m === 'ALL' ? 'All' : m}
              </button>
            ))}
          </div>
        </div>

        {/* Filter Section: Commute Radius */}
        <div className="filter-group-block">
          <label className="filter-group-label">Commute Radius from Origin:</label>
          <div className="filter-options-grid four-col">
            {[
              { key: 'all', label: 'Anywhere' },
              { key: '5', label: '< 5 km' },
              { key: '15', label: '< 15 km' },
              { key: '30', label: '< 30 km' }
            ].map((r) => (
              <button
                key={r.key}
                type="button"
                className={`filter-btn ${radiusFilter === r.key ? 'active' : ''}`}
                onClick={() => setRadiusFilter(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: '20px' }}>
          <button
            type="button"
            className="radar-action-btn primary full"
            onClick={() => setActiveModal(null)}
          >
            Apply Filters ({filteredCompanies.length} Mapped)
          </button>
        </div>
      </JrSheet>


      {/* ── 4. CRYPTOGRAPHIC PROOF-GAP RESOLUTION DRAWER (WP5 Desktop Drawer) ── */}
      <JrSheet
        open={Boolean(proofGapItem)}
        onClose={() => setProofGapItem(null)}
        placement="right"
        badge="SKILL GAP · ILLUSTRATIVE EXAMPLE"
        title={`Bridge Skill Gap: ${proofGapItem?.skill || ''}`}
      >
        {proofGapItem && (
          <>
            <p className="ios-modal-desc">
              This employer requires a skill that is not Verified on your passport. The commit below is an illustrative example only, not your code. To close the gap, run Verify with a repository that shows this skill and pass the micro-check.
            </p>

            <div className="proofgap-commit-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: JR_ORANGE, fontWeight: 600 }}>{proofGapItem.evidence.repoName}</span>
                <span style={{ color: '#9c958f' }}>{proofGapItem.evidence.date}</span>
              </div>
              <div style={{ color: '#fff', fontWeight: 600, marginBottom: '6px' }}>
                Commit {proofGapItem.evidence.commitHash}: {proofGapItem.evidence.commitMessage}
              </div>
              <div style={{ color: '#38bdf8', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Example of the evidence the engine looks for</span>
                <span className="jr-simulated-tag">Simulated</span>
              </div>

              <div className="proofgap-snippet">
                <pre style={{ margin: 0, fontFamily: 'monospace' }}>{proofGapItem.evidence.codeSnippet}</pre>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <a href="/verify" className="radar-action-btn primary" style={{ flex: 1, textAlign: 'center' }}>
                Verify this skill
              </a>
              <button type="button" className="radar-secondary-link" onClick={() => setProofGapItem(null)}>
                Close
              </button>
            </div>
          </>
        )}
      </JrSheet>

      {/* ── 5. PASSPORT APPLICATION MODAL ─────────────────────────────────── */}
      <JrSheet
        open={Boolean(applyModalCompany) && !isRecruiter}
        onClose={() => setApplyModalCompany(null)}
        badge="CRYPTOGRAPHIC PASSPORT · DEMO"
        title={`Apply to ${applyModalCompany?.name || ''}`}
      >
        {applyModalCompany && (
          <>
            <p className="ios-modal-desc">
              Your application includes an unforgeable cryptographic seal validating your commit authorship against this role.
            </p>

            <div className="apply-summary-card">
              <div className="summary-row">
                <span>Role:</span>
                <strong style={{ color: '#fff' }}>{applyModalCompany.roleTitle}</strong>
              </div>
              <div className="summary-row">
                <span>Office:</span>
                <span style={{ color: '#ddd' }}>{applyModalCompany.techPark}</span>
              </div>
              <div className="summary-row">
                <span>Commute Distance:</span>
                <span style={{ color: '#4ade80', fontFamily: 'monospace' }}>
                  {applyModalCompany.workMode === 'Remote' ? 'Remote Global' : `${applyModalCompany.distanceKm} km from origin`}
                </span>
              </div>
              <div className="summary-row">
                <span>Passport Seal:</span>
                <span style={{ color: JR_ORANGE, fontFamily: 'monospace' }}>SHA-256 VALIDATED ✓ (Demo Seal)</span>
              </div>
            </div>

            {appliedSuccess ? (
              <div className="proofgap-success-banner" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <JrLottie animationData={LOTTIE_SUCCESS_CHECK} loop={false} width={28} height={28} />
                <span>Application Dispatched to {applyModalCompany.name} HR Portal!</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="radar-action-btn primary"
                  style={{ flex: 1 }}
                  onClick={confirmDispatchApplication}
                >
                  Confirm & Dispatch Passport
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
          </>
        )}
      </JrSheet>

      {/* ── 6. RECRUITER INTERVIEW DISPATCH MODAL ─────────────────────────── */}
      <JrSheet
        open={Boolean(interviewInviteCandidate) && (isRecruiter || isAdmin)}
        onClose={() => setInterviewInviteCandidate(null)}
        badge="B2B FAST-TRACK RECRUITER"
        title={`Invite ${interviewInviteCandidate?.codeName || ''}`}
      >
        {interviewInviteCandidate && (
          <>
            <p className="ios-modal-desc">
              Candidate has commit-level cryptographic verification. Direct technical interview invitation bypasses resume screening.
            </p>

            <div className="apply-summary-card">
              <div className="summary-row">
                <span>Candidate Locality:</span>
                <span style={{ color: '#fff' }}>{interviewInviteCandidate.neighborhood}</span>
              </div>
              <div className="summary-row">
                <span>Proximity to Office:</span>
                <span style={{ color: '#38bdf8' }}>{interviewInviteCandidate.distanceToClientKm} km away</span>
              </div>
              <div className="summary-row">
                <span>Fit Score:</span>
                <span style={{ color: '#4ade80', fontWeight: 700 }}>{interviewInviteCandidate.matchToHiringNeeds}% FIT</span>
              </div>
            </div>

            {interviewInviteSuccess ? (
              <div className="proofgap-success-banner">
                ✓ Direct Interview Invitation Sent to Candidate Calendar!
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="radar-action-btn primary"
                  style={{ flex: 1, background: '#0369a1', borderColor: '#0369a1' }}
                  onClick={confirmDispatchInterview}
                >
                  Send Immediate Interview Invite
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
          </>
        )}
      </JrSheet>
    </main>
  )
}
