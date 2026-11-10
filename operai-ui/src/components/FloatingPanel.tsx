import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { cx } from '../lib/cx'
import { Icon } from './Icon'
import { VisuallyHidden } from './VisuallyHidden'

/** The side of the frame a floating panel rests on. */
export type PerimeterEdge = 'top' | 'right' | 'bottom' | 'left'

/** Where a floating panel rests: an edge, and how far along it (`0` = start, `1` = end). */
export type PerimeterPosition = { edge: PerimeterEdge; offset: number }

export type Rect = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

/** The space a panel may occupy: the viewport minus the insets, minus a margin on every side. */
export const PERIMETER_MARGIN = 12

/** How far one arrow key moves the panel before it snaps back to the perimeter. */
export const KEYBOARD_STEP = 48

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** The top-left corner of a panel of `size` resting at `position` inside `frame`. Pure. */
export function placeOnPerimeter(position: PerimeterPosition, size: Size, frame: Rect): { left: number; top: number } {
  const freeX = Math.max(0, frame.width - size.width)
  const freeY = Math.max(0, frame.height - size.height)
  const offset = clamp01(position.offset)
  switch (position.edge) {
    case 'top':
      return { left: frame.left + offset * freeX, top: frame.top }
    case 'bottom':
      return { left: frame.left + offset * freeX, top: frame.top + freeY }
    case 'left':
      return { left: frame.left, top: frame.top + offset * freeY }
    case 'right':
      return { left: frame.left + freeX, top: frame.top + offset * freeY }
  }
}

/**
 * The perimeter position nearest to a panel whose top-left corner is at `corner`: the edge closest to the panel's
 * centre, and the panel's place along it. Pure; a tie prefers bottom, then right, top, left.
 */
export function snapToPerimeter(corner: { left: number; top: number }, size: Size, frame: Rect): PerimeterPosition {
  const freeX = Math.max(0, frame.width - size.width)
  const freeY = Math.max(0, frame.height - size.height)
  const x = Math.min(Math.max(corner.left - frame.left, 0), freeX)
  const y = Math.min(Math.max(corner.top - frame.top, 0), freeY)
  const distances: [PerimeterEdge, number][] = [
    ['bottom', freeY - y],
    ['right', freeX - x],
    ['top', y],
    ['left', x],
  ]
  const [edge] = distances.reduce((best, next) => (next[1] < best[1] ? next : best))
  const offset = edge === 'top' || edge === 'bottom' ? (freeX === 0 ? 0 : x / freeX) : freeY === 0 ? 0 : y / freeY
  return { edge, offset: clamp01(offset) }
}

/** The frame for a viewport of `width` × `height` with `inset` kept clear (a header, a footer). Pure. */
export function frameOf(width: number, height: number, inset: FloatingInset = {}): Rect {
  const left = (inset.left ?? 0) + PERIMETER_MARGIN
  const top = (inset.top ?? 0) + PERIMETER_MARGIN
  return {
    left,
    top,
    width: Math.max(0, width - left - (inset.right ?? 0) - PERIMETER_MARGIN),
    height: Math.max(0, height - top - (inset.bottom ?? 0) - PERIMETER_MARGIN),
  }
}

export type FloatingInset = { top?: number; right?: number; bottom?: number; left?: number }

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

export type FloatingPanelProps = {
  /** The region's accessible name ("Recording in progress"). */
  label: string
  /** The handle's accessible name ("Move the recorder"). */
  moveLabel: string
  /** How to move it with the keyboard ("Arrow keys move it around the edge of the window"); read with the handle. */
  moveHint: string
  /** Where it rests; the caller owns it (in memory is enough). */
  position: PerimeterPosition
  onPositionChange: (position: PerimeterPosition) => void
  /** Chrome to keep clear, in pixels: the panel never covers it. */
  inset?: FloatingInset
  children: ReactNode
  className?: string
  testId?: string
}

/**
 * FloatingPanel — a small, always-visible panel that rests on the perimeter of the window, above the page and
 * below dialogs (a recorder, a running job). The person moves it by dragging its handle; it then snaps to the
 * nearest edge. With the keyboard, the handle is a button: each arrow key moves the panel one step that way and
 * it snaps again, so it can be walked around the whole edge. It never leaves the frame (the viewport minus `inset`
 * minus a margin) and follows a resize. It is not a dialog: it takes no focus and traps nothing.
 */
export function FloatingPanel({
  label,
  moveLabel,
  moveHint,
  position,
  onPositionChange,
  inset,
  children,
  className,
  testId,
}: FloatingPanelProps) {
  const ref = useRef<HTMLElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [drag, setDrag] = useState<{ left: number; top: number; dx: number; dy: number } | null>(null)
  const hintId = useId()

  // Measure the panel (its content may change size) and follow the window.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const box = node.getBoundingClientRect()
      setSize((current) => (current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height }))
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [])
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const frame = frameOf(viewport.width, viewport.height, inset)
  const placed = placeOnPerimeter(position, size, frame)
  const at = drag ? { left: drag.left, top: drag.top } : placed

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ left: placed.left, top: placed.top, dx: event.clientX - placed.left, dy: event.clientY - placed.top })
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    setDrag({ ...drag, left: event.clientX - drag.dx, top: event.clientY - drag.dy })
  }
  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setDrag(null)
    onPositionChange(snapToPerimeter({ left: drag.left, top: drag.top }, size, frame))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = ARROWS[event.key]
    if (!step) return
    event.preventDefault()
    onPositionChange(snapToPerimeter({ left: placed.left + step[0] * KEYBOARD_STEP, top: placed.top + step[1] * KEYBOARD_STEP }, size, frame))
  }

  return (
    <section
      ref={ref}
      aria-label={label}
      className={cx('floating-panel', drag && 'floating-panel-dragging', className)}
      style={{ left: at.left, top: at.top }}
      data-edge={position.edge}
      data-testid={testId}
    >
      <button
        type="button"
        className="floating-panel-handle"
        aria-label={moveLabel}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <Icon name="grip" />
      </button>
      <VisuallyHidden id={hintId}>{moveHint}</VisuallyHidden>
      <div className="floating-panel-body">{children}</div>
    </section>
  )
}
