/**
 * ProofPass - Vector Lottie Animation Primitive (JrLottie.jsx)
 * Renders lightweight, 60fps vector animations using lottie-web.
 */

import { useEffect, useRef } from 'react'
import lottie from 'lottie-web'

// Authentic Vector Sonar Radar Animation JSON
export const LOTTIE_RADAR_SONAR = {
  v: '5.5.7',
  fr: 60,
  ip: 0,
  op: 120,
  w: 100,
  h: 100,
  nm: 'RadarSonar',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'BeaconCore',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [50, 50, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [85, 85, 100], e: [115, 115, 100] },
            { t: 60, s: [115, 115, 100], e: [85, 85, 100] },
            { t: 120, s: [85, 85, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: 'el',
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [22, 22] }
        },
        {
          ty: 'fl',
          c: { a: 0, k: [0.91, 0.5, 0.25, 1] },
          o: { a: 0, k: 100 }
        }
      ]
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: 'PulseWave',
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 0, s: [90], e: [0] },
            { t: 90, s: [0] }
          ]
        },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [50, 50, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [25, 25, 100], e: [180, 180, 100] },
            { t: 90, s: [180, 180, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: 'el',
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [46, 46] }
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.91, 0.5, 0.25, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 3 }
        }
      ]
    }
  ]
}

// Authentic Vector Checkmark Success Animation JSON
export const LOTTIE_SUCCESS_CHECK = {
  v: '5.5.7',
  fr: 60,
  ip: 0,
  op: 60,
  w: 120,
  h: 120,
  nm: 'SuccessCheck',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'Ring',
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [60, 60, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [40, 40, 100], e: [100, 100, 100] },
            { t: 30, s: [100, 100, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: 'el',
          p: { a: 0, k: [0, 0] },
          s: { a: 0, k: [90, 90] }
        },
        {
          ty: 'st',
          c: { a: 0, k: [0.13, 0.77, 0.37, 1] },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 6 }
        }
      ]
    }
  ]
}

export default function JrLottie({
  animationData = LOTTIE_RADAR_SONAR,
  loop = true,
  autoplay = true,
  width = 32,
  height = 32,
  className = ''
}) {
  const containerRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    animRef.current = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop,
      autoplay,
      animationData
    })

    return () => {
      if (animRef.current) {
        animRef.current.destroy()
        animRef.current = null
      }
    }
  }, [animationData, loop, autoplay])

  return (
    <div
      ref={containerRef}
      className={`jr-lottie-wrap ${className}`}
      style={{ width, height, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      aria-hidden="true"
    />
  )
}

