/**
 * `collectFlowItems`: the pagination's one DOM reader (specs/20261115-crm-offer-wizard T74, plan DD-69).
 *
 * It reads the elements the preview marks, in document order, from the REAL tree while it is laid out unpaged (no
 * rail, no row shift), and returns the pure core's items with `top` in px from the flow's top. Marks:
 *   `data-flow="text|table|unit"` an item; `data-flow="row"` a table's row (`data-flow-head` its header);
 *   `data-flow-keep="next"` R3; `data-flow-break="before"` R6; `data-flow-key` the stable name of a table or of a
 *   painted element (the render looks its layout up by it); `data-flow-paint` an element that paints a border or a
 *   background across the flow (the hand-edited section). A unit's parts are its element children.
 */
import type { FlowItem, PaintedBox, TableRow } from './types'

export interface CollectedFlow {
  items: FlowItem[]
  /** Item id to its `data-flow-key` (tables). */
  keys: Map<number, string>
  painted: PaintedBox[]
  /** Tables (by `data-flow-key`) wider than the flow: their words may not be kept whole (the render breaks them anywhere). */
  overflowing?: string[]
}

const px = (value: string): number => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/** The lines of a text whose height is not a whole number of line heights: distinct tops of its client rects. */
function linesByRects(el: Element): number {
  const range = document.createRange()
  range.selectNodeContents(el)
  const tops = new Set<number>()
  for (const rect of Array.from(range.getClientRects())) if (rect.height > 1) tops.add(Math.round(rect.top))
  return tops.size
}

export function collectFlowItems(flow: HTMLElement): CollectedFlow {
  const origin = flow.getBoundingClientRect().top
  const items: FlowItem[] = []
  const keys = new Map<number, string>()
  const painted: PaintedBox[] = []
  const overflowing: string[] = []
  const flowWidth = flow.getBoundingClientRect().width
  let id = 0

  for (const el of Array.from(flow.querySelectorAll<HTMLElement>('[data-flow], [data-flow-paint]'))) {
    if (el.hasAttribute('data-flow-paint')) {
      const rect = el.getBoundingClientRect()
      painted.push({ key: el.getAttribute('data-flow-key') ?? '', top: rect.top - origin, height: rect.height })
    }
    const kind = el.getAttribute('data-flow')
    if (kind === null || kind === 'row') continue
    const rect = el.getBoundingClientRect()
    const keepNext = el.getAttribute('data-flow-keep') === 'next'
    const breakBefore = el.getAttribute('data-flow-break') === 'before'
    id += 1
    if (kind === 'text') {
      const lineHeight = px(getComputedStyle(el).lineHeight) || rect.height
      let lines = lineHeight > 0 ? Math.round(rect.height / lineHeight) : 0
      if (lines > 0 && Math.abs(rect.height - lines * lineHeight) > 0.5) lines = Math.max(1, linesByRects(el))
      items.push({ kind: 'text', id, top: rect.top - origin, lineHeight, lines, keepNext, breakBefore })
    } else if (kind === 'unit') {
      const parts = Array.from(el.children).map((child) => {
        const box = child.getBoundingClientRect()
        return { top: box.top - origin, height: box.height }
      })
      items.push({ kind: 'unit', id, top: rect.top - origin, height: rect.height, parts, keepNext, breakBefore })
    } else if (kind === 'table') {
      const rows: TableRow[] = Array.from(el.querySelectorAll<HTMLElement>('[data-flow="row"]')).map((row) => {
        const box = row.getBoundingClientRect()
        const cell = getComputedStyle(row.querySelector('th, td') ?? row)
        return {
          top: box.top - origin,
          height: box.height,
          head: row.hasAttribute('data-flow-head'),
          lineHeight: px(cell.lineHeight),
          pad: px(cell.paddingTop),
        }
      })
      items.push({ kind: 'table', id, breakBefore, keepNext: false, rows })
      const key = el.getAttribute('data-flow-key')
      if (key) {
        keys.set(id, key)
        if (rect.width > flowWidth + 0.5) overflowing.push(key)
      }
    }
  }
  return { items, keys, painted, overflowing }
}
