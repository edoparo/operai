import { useEffect, useState, type RefObject } from 'react'

/** The attribute the wizard's action bar carries, so a region that fits the viewport knows how much room the bar takes. */
export const ACTION_BAR_ATTRIBUTE = 'data-wizard-action-bar'

/** Room kept clear below the region, above the action bar (px). */
const BOTTOM_GAP = 16
/** The shortest a fitted region ever gets (px): a viewport too short for more scrolls the page instead. */
const MIN_HEIGHT = 160

/** The nearest ancestor that scrolls vertically (the shell's `<main>`); null when the window itself scrolls. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node
  }
  return null
}

/** The nearest ancestor of `element` that sticks (the wide layout's `sticky top-4` pane), or null. */
function stickyAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'sticky') return node
  }
  return null
}

/**
 * Where the region's top will be once the page has settled, in viewport px: its place in the flow while the page is
 * still scrolled above it, the pinned place (the scroller's top + the sticky offset) after. Never the CLAMPED place a
 * sticky box takes at the very end of its container — that moves with the box's own height and would feed back into it.
 */
function settledTop(region: HTMLElement, root: HTMLElement | null): number {
  const now = region.getBoundingClientRect().top
  const box = stickyAncestor(region)
  if (!box?.parentElement) return now
  const inBox = now - box.getBoundingClientRect().top
  const flow = box.parentElement.getBoundingClientRect().top + inBox
  const pinned = (root ? root.getBoundingClientRect().top : 0) + (parseFloat(getComputedStyle(box).top) || 0) + inBox
  return Math.max(flow, pinned)
}

/**
 * The height (px) that makes `ref`'s region end exactly above the action bar: from where the region's top is NOW —
 * wherever the page has scrolled to — to the scrolling area's bottom edge, less the sticky action bar and a gap
 * (specs/20261115-crm-offer-wizard, owner D19). A viewport-relative max-height cannot do this: the shell's `<main>` is
 * the scroller, with the shell's header and footer, the tool's header and tabs, and the wizard's own header around it.
 *
 * Re-measured on scroll (the region sticks, so its top changes until it is pinned), on resize, and when anything
 * between the region and the scroller changes size (a banner appearing above it). `null` while disabled, so a region
 * that is not in the wide layout keeps its own CSS bound.
 */
export function useFitToScrollport(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const region = ref.current
    if (!enabled || !region) {
      setHeight(null)
      return
    }
    const root = scrollParent(region)
    const scroller: HTMLElement | Window = root ?? window
    let frame = 0

    const measure = () => {
      frame = 0
      const limit = root ? root.getBoundingClientRect().bottom : window.innerHeight
      const bar = (root ?? document).querySelector<HTMLElement>(`[${ACTION_BAR_ATTRIBUTE}]`)
      const reserved = bar ? bar.getBoundingClientRect().height : 0
      const next = Math.max(MIN_HEIGHT, Math.floor(limit - reserved - BOTTOM_GAP - settledTop(region, root)))
      setHeight((current) => (current === next ? current : next))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }

    measure()
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(schedule)
      for (let node: HTMLElement | null = region.parentElement; node; node = node.parentElement) {
        observer.observe(node)
        if (node === root) break
      }
      if (root) observer.observe(root)
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [ref, enabled])

  return height
}
