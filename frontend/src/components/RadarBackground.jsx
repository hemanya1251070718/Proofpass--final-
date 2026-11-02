/**
 * ProofPass - Ambient Live Background for Job Radar (RadarBackground.jsx)
 * Shared aesthetic with Verify tab: drifting radial warm glow blobs,
 * illuminated dot grid, and subtle GSAP-driven ember particle constellation.
 * Calibrated with light density (~30 particles) so it stays calm and elegant without clutter.
 */

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { RM } from '../lib.js'

export default function RadarBackground() {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr) return attr === 'dark'
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Synchronize with document theme toggles
  useEffect(() => {
    const checkTheme = () => {
      const attr = document.documentElement.getAttribute('data-theme')
      if (attr) {
        setIsDark(attr === 'dark')
      } else {
        setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
      }
    }

    checkTheme()

    const observer = new MutationObserver(checkTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onMql = (e) => {
      if (!document.documentElement.getAttribute('data-theme')) {
        setIsDark(e.matches)
      }
    }
    mql.addEventListener('change', onMql)

    return () => {
      observer.disconnect()
      mql.removeEventListener('change', onMql)
    }
  }, [])

  // Particle canvas simulation on gsap.ticker
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let paused = false

    // Mouse coordinates
    const mouse = { x: -2000, y: -2000, active: false }

    const onPointerMove = (e) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
      mouse.active = true
      if (containerRef.current) {
        containerRef.current.style.setProperty('--px', `${e.clientX}px`)
        containerRef.current.style.setProperty('--py', `${e.clientY}px`)
      }
    }

    const onPointerLeave = () => {
      mouse.active = false
      mouse.x = -2000
      mouse.y = -2000
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })

    // DPR capped at 1.5 for crisp rendering and high performance
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    let width = window.innerWidth
    let height = window.innerHeight

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Pre-render a glow sprite on an offscreen canvas
    const glowSprite = document.createElement('canvas')
    const glowSize = 32
    glowSprite.width = Math.round(glowSize * dpr)
    glowSprite.height = Math.round(glowSize * dpr)
    const gCtx = glowSprite.getContext('2d')
    gCtx.scale(dpr, dpr)
    const gGrad = gCtx.createRadialGradient(glowSize / 2, glowSize / 2, 1, glowSize / 2, glowSize / 2, glowSize / 2)
    if (isDark) {
      gGrad.addColorStop(0, 'rgba(232, 128, 63, 0.75)')
      gGrad.addColorStop(0.35, 'rgba(232, 128, 63, 0.35)')
      gGrad.addColorStop(1, 'rgba(232, 128, 63, 0)')
    } else {
      gGrad.addColorStop(0, 'rgba(181, 70, 16, 0.65)')
      gGrad.addColorStop(0.35, 'rgba(232, 128, 63, 0.25)')
      gGrad.addColorStop(1, 'rgba(232, 128, 63, 0)')
    }
    gCtx.fillStyle = gGrad
    gCtx.beginPath()
    gCtx.arc(glowSize / 2, glowSize / 2, glowSize / 2, 0, Math.PI * 2)
    gCtx.fill()

    // Setup particles (calibrated to 32 for calm, uncluttered live atmosphere)
    const PARTICLE_COUNT = 32
    const particles = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: isDark ? -(0.25 + Math.random() * 0.45) : (Math.random() - 0.5) * 0.3,
        r: 1.3 + Math.random() * 1.8,
        alpha: 0.2 + Math.random() * 0.45,
        phase: Math.random() * Math.PI * 2,
      })
    }

    // Static frame if prefers-reduced-motion is active
    if (RM) {
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = isDark
          ? `rgba(232, 128, 63, ${p.alpha * 0.5})`
          : `rgba(181, 70, 16, ${p.alpha * 0.4})`
        ctx.fill()
      }
      return () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerleave', onPointerLeave)
        window.removeEventListener('resize', resize)
      }
    }

    const onVisibilityChange = () => {
      paused = document.hidden
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const maxConnectDist = 120
    let lastTime = performance.now()

    const tick = () => {
      if (paused) return
      const now = performance.now()
      const dt = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now
      const dtFactor = dt * 60

      ctx.clearRect(0, 0, width, height)

      // 1. Move and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.phase += 0.015 * dtFactor

        p.x += (Math.sin(p.phase) * 0.2 + p.vx) * dtFactor
        p.y += p.vy * dtFactor

        if (p.y < -12) {
          p.y = height + 10
          p.x = Math.random() * width
        }
        if (p.y > height + 12) p.y = -10
        if (p.x < -12) p.x = width + 10
        if (p.x > width + 12) p.x = -10

        // Gentle cursor push
        if (mouse.active) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.hypot(dx, dy)
          const repelRadius = 100

          if (dist > 0.001 && dist < repelRadius) {
            const force = (1 - dist / repelRadius) * 1.5 * dtFactor
            p.x += (dx / dist) * force
            p.y += (dy / dist) * force
          }
        }

        // Fast glow draw
        const drawR = p.r * 2.6
        ctx.globalAlpha = p.alpha
        ctx.drawImage(glowSprite, p.x - drawR, p.y - drawR, drawR * 2, drawR * 2)
      }
      ctx.globalAlpha = 1

      // 2. Subtle constellation interconnecting lines
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.hypot(dx, dy)

          if (dist < maxConnectDist) {
            const lineAlpha = (1 - dist / maxConnectDist) * (isDark ? 0.18 : 0.1)
            ctx.strokeStyle = isDark
              ? `rgba(232, 128, 63, ${lineAlpha})`
              : `rgba(181, 70, 16, ${lineAlpha})`
            ctx.lineWidth = 0.75
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }
      }
    }

    gsap.ticker.add(tick)

    return () => {
      gsap.ticker.remove(tick)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isDark])

  return (
    <div
      ref={containerRef}
      className="radar-background"
      aria-hidden="true"
    >
      {/* Soft drifting ambient glow blobs */}
      <div className="rb-blobs">
        <div className="rb-blob rb-blob-1" />
        <div className="rb-blob rb-blob-2" />
        <div className="rb-blob rb-blob-3" />
      </div>

      {/* Subtle illuminated dot grid */}
      <div className="rb-dot-grid" />

      {/* Calm glowing particle constellation */}
      <canvas ref={canvasRef} className="rb-particle-canvas" />
    </div>
  )
}
