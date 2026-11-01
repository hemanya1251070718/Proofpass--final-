/**
 * ProofPass - Reusable Sheet Primitive (JrSheet.jsx)
 * WP5: Native <dialog> implementation with top-layer stacking, focus trap,
 * ESC handling, backdrop blur, and touch drag-to-dismiss on mobile.
 */

import { useEffect, useRef, useId } from 'react'

export default function JrSheet({
  open,
  onClose,
  titleId: propTitleId,
  title,
  badge,
  placement = 'center',
  headerAction,
  children
}) {
  const dialogRef = useRef(null)
  const openerRef = useRef(null)
  const handleRef = useRef(null)
  const autoId = useId()
  const titleId = propTitleId || `jr-sheet-title-${autoId}`

  // Track the element that triggered the modal to restore focus on close
  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement
    }
  }, [open])

  // Sync open state with native dialog .showModal() / .close()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      if (!dialog.open) {
        try {
          dialog.showModal()
        } catch {
          // If already open, ignore
        }
      }
      document.body.style.overflow = 'hidden'
    } else {
      if (dialog.open) {
        dialog.close()
      }
      document.body.style.overflow = ''
      if (openerRef.current && typeof openerRef.current.focus === 'function') {
        openerRef.current.focus()
      }
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Native dialog cancel / close event mapping
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleCancel = (e) => {
      e.preventDefault()
      onClose?.()
    }

    const handleClose = () => {
      onClose?.()
    }

    dialog.addEventListener('cancel', handleCancel)
    dialog.addEventListener('close', handleClose)

    return () => {
      dialog.removeEventListener('cancel', handleCancel)
      dialog.removeEventListener('close', handleClose)
    }
  }, [onClose])

  // Backdrop click dismissal (when clicking outside dialog card)
  const handleDialogClick = (e) => {
    if (e.target === dialogRef.current) {
      onClose?.()
    }
  }

  // Mobile Drag-to-Dismiss Pointer Event Handlers
  useEffect(() => {
    const handle = handleRef.current
    const dialog = dialogRef.current
    if (!handle || !dialog) return

    let startY = 0
    let startTime = 0
    let currentDy = 0
    let isDragging = false

    const onPointerDown = (e) => {
      if (window.innerWidth > 734) return
      startY = e.clientY
      startTime = performance.now()
      currentDy = 0
      isDragging = true
      handle.setPointerCapture(e.pointerId)
      dialog.style.transition = 'none'
    }

    const onPointerMove = (e) => {
      if (!isDragging) return
      const dy = e.clientY - startY
      if (dy > 0) {
        currentDy = dy
        dialog.style.transform = `translateY(${dy}px)`
      }
    }

    const onPointerUp = (e) => {
      if (!isDragging) return
      isDragging = false
      try {
        handle.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      const elapsed = Math.max(1, performance.now() - startTime)
      const velocity = currentDy / elapsed

      dialog.style.transition = 'transform 0.28s var(--jr-ease)'

      if (currentDy > 120 || velocity > 0.5) {
        dialog.style.transform = 'translateY(100%)'
        setTimeout(() => {
          dialog.style.transform = ''
          dialog.style.transition = ''
          onClose?.()
        }, 250)
      } else {
        dialog.style.transform = 'translateY(0)'
        setTimeout(() => {
          dialog.style.transform = ''
          dialog.style.transition = ''
        }, 280)
      }
    }

    handle.addEventListener('pointerdown', onPointerDown)
    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('pointercancel', onPointerUp)

    return () => {
      handle.removeEventListener('pointerdown', onPointerDown)
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', onPointerUp)
      handle.removeEventListener('pointercancel', onPointerUp)
    }
  }, [onClose])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className={`jr-sheet ${placement === 'right' ? 'jr-sheet--right' : 'jr-sheet--center'}`}
      onClick={handleDialogClick}
      aria-labelledby={titleId}
    >
      <div className="jr-sheet__inner">
        {/* Mobile Swipe-to-Dismiss Grab Handle */}
        <div ref={handleRef} className="jr-sheet__handle-zone" title="Swipe down to close">
          <div className="jr-sheet__handle" />
        </div>

        {/* Sheet Header */}
        <div className="jr-sheet__header">
          <div>
            {badge && <span className="jr-sheet__badge">{badge}</span>}
            <h2 id={titleId} className="jr-sheet__title">
              {title}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {headerAction}
            <button
              type="button"
              className="jr-sheet__close-btn"
              onClick={onClose}
              aria-label="Close sheet"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Sheet Content Body */}
        <div className="jr-sheet__body">{children}</div>
      </div>
    </dialog>
  )
}
