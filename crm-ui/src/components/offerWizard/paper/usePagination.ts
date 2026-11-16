/**
 * `usePagination`: when and how the preview's pages are laid out (specs/20261115-crm-offer-wizard T74, plan DD-69).
 *
 * Inputs: the content (the settled resolution), the region's width, the root font size and the web font arriving —
 * never the letterhead, the D19 height or the scroll. When one changes the flow renders UNPAGED (no rail, no row shift),
 * a layout effect reads it (`collectFlowItems`), places the breaks, realises them and sets the paged layout; React
 * flushes that update before the browser paints, so the unpaged frame is never seen. The stage keeps its previous
 * height meanwhile, so the scroll offset is never clamped.
 *
 * `PaginationEnv` is the seam for tests and for a browser with no layout: jsdom has none, so a test gives the width and
 * the collector. Without a width (nothing measured, an element not displayed) nothing is paginated: one page.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { collectFlowItems, type CollectedFlow } from './collectFlowItems'
import { pageGeometry, type PageGeometry } from './geometry'
import { keyLayout, type KeyedLayout } from './keyed'
import { placeBreaks } from './placement'
import { realize } from './realize'

export interface PaginationEnvValue {
  /** Reads the unpaged flow; default `collectFlowItems`. */
  collect?: (flow: HTMLElement) => CollectedFlow
  /** The region's width, px: given, it replaces the measured one and nothing is observed. */
  width?: number
  rootFontPx?: number
  /** Tests: the page ceiling and the time budget (ms) of one measure, replacing `MAX_PAGES` and `MEASURE_BUDGET_MS`. */
  maxPages?: number
  budgetMs?: number
  /** Tests: the clock the budget is read from; default `performance.now`. */
  now?: () => number
}
export const PaginationEnv = createContext<PaginationEnvValue>({})

/**
 * Security L-9: the preview lays out at most this many pages. Measured offers run to about 30 pages inline and 91 in the
 * narrow Drawer; 200 leaves more than twice the worst of those. Past it the cost is the browser's (one box and one image
 * per page, one float pair per break), not the pure core's, so the flow is shown on one continuous sheet instead.
 */
export const MAX_PAGES = 200
/** Security L-9: a measure (collect, place, realise) that takes longer than this is not repeated as pages: continuous sheet. */
export const MEASURE_BUDGET_MS = 500

/** At most this many width-driven layouts in a row, each right after our own layout, before the width is held (no ping-pong). */
const MAX_ECHOES = 2
const ECHO_WINDOW_MS = 150

/** The width the geometry assumes while nothing is measured (nothing is paginated then). */
const FALLBACK_WIDTH = 488

/** One continuous sheet for a flow that is not paged: no rail, shift or clip (the flow as it is unpaged), one box tall enough for all of it. */
function continuous(geometry: PageGeometry, flowHeight: number): KeyedLayout {
  const one = realize([], [], geometry)
  const height = Math.max(geometry.height, Math.ceil(flowHeight + geometry.frame.top + geometry.frame.bottom))
  const box = one.pageBoxes[0]!
  return {
    ...one,
    pageBoxes: [{ ...box, height }],
    stageHeight: height + 2 * geometry.inset,
  }
}

const NO_TABLES: ReadonlySet<string> = new Set()

const rootFont = (): number => {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(px) && px > 0 ? px : 16
}

export interface Pagination {
  geometry: PageGeometry
  /** The paged layout, or null while the flow must render unpaged (to be measured, or nothing to measure). */
  layout: KeyedLayout | null
  /** What the page layer and the stage draw: the paged layout's, else the last one's, else one page. */
  stage: Pick<KeyedLayout, 'pageBoxes' | 'stageHeight'>
  /** Tables whose words may break anywhere because they would not fit the frame otherwise (a second pass of the measure). */
  wrapAnywhere: ReadonlySet<string>
  /** True when the flow is shown on one continuous sheet because it is too long to lay out as pages (L-9). */
  unpaged: boolean
  /** How many layouts have been made: a test's and the e2e's witness that a layout happened (or did not). */
  version: number
}

export function usePagination({
  regionRef,
  flowRef,
  probeRef,
  contentKey,
}: {
  regionRef: RefObject<HTMLElement | null>
  flowRef: RefObject<HTMLElement | null>
  probeRef: RefObject<HTMLElement | null>
  contentKey: unknown
}): Pagination {
  const env = useContext(PaginationEnv)
  const [measured, setMeasured] = useState<number | null>(null)
  const [measuredRoot, setMeasuredRoot] = useState<number>(() => (typeof document === 'undefined' ? 16 : rootFont()))
  const [fontEpoch, setFontEpoch] = useState(0)
  const width = env.width ?? measured
  const rootPx = env.rootFontPx ?? measuredRoot
  const enabled = width !== null && width > 0

  const widthRef = useRef(0)
  const lastLayoutAt = useRef(0)
  const echoes = useRef(0)

  // the region's width and the root font size, read before the first paint, then observed
  useLayoutEffect(() => {
    const region = regionRef.current
    if (!region || env.width !== undefined) return
    widthRef.current = region.clientWidth
    // read before the first paint, so the first frame already has the right width
    setMeasured(region.clientWidth)
    if (typeof ResizeObserver !== 'function') return
    let frame = 0
    const read = () => {
      frame = 0
      const next = region.clientWidth
      if (Math.abs(next - widthRef.current) < 0.5) return
      if (performance.now() - lastLayoutAt.current < ECHO_WINDOW_MS) {
        if (echoes.current >= MAX_ECHOES) return
        echoes.current += 1
      } else {
        echoes.current = 0
      }
      widthRef.current = next
      setMeasured(next)
    }
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(read)
    })
    observer.observe(region)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [regionRef, env.width, env.rootFontPx])

  // the root font size changes the probe's width (1rem), which nothing else reports
  useEffect(() => {
    const probe = probeRef.current
    if (env.rootFontPx !== undefined || !probe || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      const next = entry?.contentRect.width ?? 0
      if (next > 0) setMeasuredRoot((current) => (Math.abs(current - next) < 0.01 ? current : next))
    })
    observer.observe(probe)
    return () => observer.disconnect()
  }, [probeRef, env.rootFontPx])

  // the web font arriving changes every line's width
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts || typeof fonts.addEventListener !== 'function') return
    const bump = () => setFontEpoch((epoch) => epoch + 1)
    fonts.addEventListener('loadingdone', bump)
    return () => fonts.removeEventListener('loadingdone', bump)
  }, [])

  const geometry = useMemo(
    () => pageGeometry(width !== null && width > 0 ? width : FALLBACK_WIDTH, rootPx),
    [width, rootPx],
  )
  const baseKey = useMemo(() => ({}), [contentKey, width, rootPx, fontEpoch]) // eslint-disable-line react-hooks/exhaustive-deps
  // a table too wide for the frame with its words whole is measured again with its words breaking anywhere
  const [wide, setWide] = useState<{ base: object; keys: ReadonlySet<string> } | null>(null)
  const wrapAnywhere = wide?.base === baseKey ? wide.keys : NO_TABLES
  const key = useMemo(() => ({}), [baseKey, wrapAnywhere]) // eslint-disable-line react-hooks/exhaustive-deps
  const [paged, setPaged] = useState<{ key: object; layout: KeyedLayout; version: number; unpaged: boolean } | null>(
    null,
  )
  const live = enabled && paged?.key === key ? paged.layout : null

  useLayoutEffect(() => {
    if (!enabled || live) return
    const flow = flowRef.current
    if (!flow) return
    const clock = env.now ?? (() => performance.now())
    const startedAt = clock()
    const collected = (env.collect ?? collectFlowItems)(flow)
    const missing = (collected.overflowing ?? []).filter((table) => !wrapAnywhere.has(table))
    if (missing.length > 0) {
      setWide({ base: baseKey, keys: new Set([...wrapAnywhere, ...missing]) })
      return
    }
    const maxPages = env.maxPages ?? MAX_PAGES
    const budget = env.budgetMs ?? MEASURE_BUDGET_MS
    const version = (paged?.version ?? 0) + 1
    // L-9: past the ceiling or the budget nothing is paged; the whole flow stays on one continuous sheet, no text hidden
    const fallBack = () => {
      lastLayoutAt.current = performance.now()
      setPaged({ key, layout: continuous(geometry, flow.getBoundingClientRect().height), version, unpaged: true })
    }
    const breaks = placeBreaks(collected.items, geometry.body)
    if (breaks.length + 1 > maxPages || clock() - startedAt > budget) return fallBack()
    const realized = realize(collected.items, breaks, geometry, collected.painted)
    if (realized.pages > maxPages || clock() - startedAt > budget) return fallBack()
    lastLayoutAt.current = performance.now()
    setPaged({ key, layout: keyLayout(realized, collected.keys), version, unpaged: false })
  }, [
    enabled,
    live,
    key,
    baseKey,
    wrapAnywhere,
    geometry,
    flowRef,
    env.collect,
    env.maxPages,
    env.budgetMs,
    env.now,
    paged?.version,
  ])

  const onePage = useMemo(() => realize([], [], geometry), [geometry])
  // while the flow is unpaged for a measure the previous layout still draws the pages: the stage never shrinks first
  const stage = enabled ? (paged?.layout ?? onePage) : onePage
  const unpaged = enabled && paged?.key === key && paged.unpaged
  return { geometry, layout: live, stage, wrapAnywhere, unpaged, version: paged?.version ?? 0 }
}
