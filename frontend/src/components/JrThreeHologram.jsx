/**
 * ProofPass - 3D Holographic Radar Beacon (JrThreeHologram.jsx)
 * Lightweight Three.js WebGL canvas rendering a rotating 3D holographic wireframe node.
 * Automatically handles window resize, devicePixelRatio, and cleans up on unmount.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function JrThreeHologram({ size = 36, color = 0xe8803f }) {
  const mountRef = useRef(null)

  useEffect(() => {
    const container = mountRef.current
    if (!container) return

    // Scene & Camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
    camera.position.z = 2.8

    // WebGL Renderer with transparency
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      renderer.setSize(size, size)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      container.appendChild(renderer.domElement)
    } catch (e) {
      console.warn('Three.js WebGL initialization skipped:', e)
      return
    }

    // Geometry: Geodesic Wireframe + Core Glow Sphere
    const group = new THREE.Group()

    const wireframeGeo = new THREE.IcosahedronGeometry(0.85, 1)
    const wireframeMat = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.75
    })
    const wireframeMesh = new THREE.Mesh(wireframeGeo, wireframeMat)
    group.add(wireframeMesh)

    // Inner Core
    const coreGeo = new THREE.SphereGeometry(0.35, 12, 12)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    group.add(coreMesh)

    // Orbiting Ring
    const ringGeo = new THREE.RingGeometry(1.05, 1.15, 24)
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    })
    const ringMesh = new THREE.Mesh(ringGeo, ringMat)
    ringMesh.rotation.x = Math.PI / 3
    group.add(ringMesh)

    scene.add(group)

    // Animation Loop
    let animId
    let isMounted = true

    const animate = () => {
      if (!isMounted) return
      group.rotation.y += 0.02
      group.rotation.x += 0.008
      ringMesh.rotation.z += 0.015
      renderer.render(scene, camera)
      animId = requestAnimationFrame(animate)
    }

    animate()

    // Cleanup
    return () => {
      isMounted = false
      if (animId) cancelAnimationFrame(animId)
      if (renderer) {
        renderer.dispose()
        if (renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement)
        }
      }
      wireframeGeo.dispose()
      wireframeMat.dispose()
      coreGeo.dispose()
      coreMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
    }
  }, [size, color])

  return (
    <div
      ref={mountRef}
      className="jr-three-holo"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
      aria-hidden="true"
    />
  )
}
