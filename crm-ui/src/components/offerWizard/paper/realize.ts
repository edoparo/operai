/**
 * `realize`: turns the chosen breaks into what the preview paints (specs/20261115-crm-offer-wizard T73, plan DD-70).
 * Pure; no DOM.
 *
 * A page period is `H + G` (a page and the gap under it). In the final layout the first line of page k sits on that
 * page's frame top, `k * (H + G)` below the flow's top, so a break that ends a page after `pageRun` px of content
 * leaves a dead zone of `H + G - pageRun`: the rest of the frame, the bottom margin, the gap and the next top margin.
 * Three mechanisms keep it free of text:
 *
 *  - RAIL (a break before a text line, a unit part or a whole table): an empty float pair at the start of the flow,
 *    `z` (width 0, height `run`) then `F` (width 100 %, height `dead`), both `clear: left`; CSS 2.1 s. 9.5 moves
 *    the following line boxes, and a table's border box, below `F`.
 *  - SHIFT (a break between two rows of one table): the following rows get `translateY(sum of dead zones)` and the
 *    table `margin-bottom` the same sum, since a table is a block formatting context a float cannot move row by row.
 *  - CELL RAIL (a break inside a row taller than a page): the same pair inside each cell of that row.
 *
 * `run` of a rail pair is the final-layout distance from the end of the previous rail's `F` to the break, so it
 * includes any page that a shift break filled in between.
 */
import type { PageGeometry } from './geometry'
import type { Band, Break, FlowItem, PagedLayout, PaintedBox, TableItem } from './types'

/** The part of the geometry `realize` reads. */
export type PageBoxes = Pick<PageGeometry, 'height' | 'gap' | 'inset' | 'left' | 'width' | 'frame'>

export const rowKey = (item: number, row: number): string => `${item}:${row}`

type Mechanism = 'rail' | 'shift' | 'cell'

function mechanismOf(item: FlowItem | undefined, br: Break): Mechanism {
  if (item?.kind !== 'table' || br.row === undefined) return 'rail'
  if (br.rowLine !== undefined) return 'cell'
  return br.row >= 1 ? 'shift' : 'rail'
}

export function realize(
  items: readonly FlowItem[],
  breaks: readonly Break[],
  geometry: PageBoxes,
  painted: readonly PaintedBox[] = [],
): PagedLayout {
  const period = geometry.height + geometry.gap
  const byId = new Map<number, FlowItem>()
  for (const item of items) byId.set(item.id, item)

  const rail: { run: number; dead: number }[] = []
  const rowShift = new Map<string, number>()
  const tableExtra = new Map<string, number>()
  const rowFirstOnPage = new Set<string>()
  const cellRail = new Map<string, { run: number; dead: number }[]>()
  const shifts = new Map<number, { row: number; dead: number }[]>()

  // Per break: the final-layout y at which it ends its page, and the dead zone it opens.
  const finalBreak: number[] = []
  const dead: number[] = []
  // The page index after each break. One atom that cannot split (a unit without parts, a line taller than the body
  // and the gap) may be taller than one page period: it then spans several, and the next page starts below them.
  const indexAfter: number[] = []
  let pageStart = 0
  let pageIndex = 0 // index of the page the current break ends
  let lastRailPage = 0 // the page whose frame top the last rail F ends on
  breaks.forEach((br) => {
    const item = byId.get(br.item)
    const pageRun = br.at - pageStart
    const span = Math.max(1, Math.ceil((pageRun - 1e-6) / period))
    const gapAfter = Math.max(0, span * period - pageRun)
    const finalY = pageIndex * period + pageRun
    pageIndex += span
    indexAfter.push(pageIndex)
    finalBreak.push(finalY)
    dead.push(gapAfter)
    const mechanism = mechanismOf(item, br)
    if (mechanism === 'rail') {
      rail.push({ run: Math.max(0, finalY - lastRailPage * period), dead: gapAfter })
      lastRailPage = pageIndex
    } else if (mechanism === 'shift' && item?.kind === 'table' && br.row !== undefined) {
      const list = shifts.get(item.id) ?? []
      list.push({ row: br.row, dead: gapAfter })
      shifts.set(item.id, list)
      rowFirstOnPage.add(rowKey(item.id, br.row))
    } else if (item?.kind === 'table' && br.row !== undefined) {
      const key = rowKey(item.id, br.row)
      const list = cellRail.get(key) ?? []
      const row = item.rows[br.row]
      const first = list.length === 0
      const cellTop = row ? row.top + (row.pad ?? 0) : pageStart
      list.push({ run: Math.max(0, first ? br.at - cellTop : pageRun), dead: gapAfter })
      cellRail.set(key, list)
    }
    pageStart = br.at
  })

  for (const [id, list] of shifts) {
    const table = byId.get(id) as TableItem
    let sum = 0
    let next = 0
    const sorted = [...list].sort((a, b) => a.row - b.row)
    for (let r = sorted[0]?.row ?? 0; r < table.rows.length; r++) {
      while (next < sorted.length && (sorted[next]?.row ?? Infinity) <= r) sum += sorted[next++]?.dead ?? 0
      if (sum > 0) rowShift.set(rowKey(id, r), sum)
    }
    tableExtra.set(
      String(id),
      sorted.reduce((total, entry) => total + entry.dead, 0),
    )
  }

  // Where a box that starts at unpaged `top` is drawn: breaks strictly above it have already moved it.
  const finalTop = (top: number): number => {
    let p = 0
    while (p < breaks.length && (breaks[p]?.at ?? Infinity) < top) p++
    const start = p === 0 ? 0 : (breaks[p - 1]?.at ?? 0)
    return (p === 0 ? 0 : (indexAfter[p - 1] ?? 0)) * period + (top - start)
  }
  const bandsFor = (top: number, height: number, only?: (br: Break) => boolean): Band[] => {
    const origin = finalTop(top)
    const bands: Band[] = []
    breaks.forEach((br, k) => {
      if (br.at < top || br.at >= top + height || (only && !only(br))) return
      const gapAfter = dead[k] ?? 0
      if (gapAfter <= 0) return
      const from = (finalBreak[k] ?? 0) - origin
      bands.push({ from, to: from + gapAfter })
    })
    return bands
  }

  const clip = new Map<string, readonly Band[]>()
  for (const box of painted) {
    const bands = bandsFor(box.top, box.height)
    if (bands.length > 0) clip.set(box.key, bands)
  }
  for (const key of cellRail.keys()) {
    const [id, row] = key.split(':').map(Number)
    const item = byId.get(id ?? -1)
    const r = item?.kind === 'table' ? item.rows[row ?? -1] : undefined
    if (!r) continue
    const bands = bandsFor(r.top, r.height, (br) => br.item === id && br.row === row && br.rowLine !== undefined)
    if (bands.length > 0) clip.set(key, bands)
  }

  const pages = pageIndex + 1
  const pageBoxes = Array.from({ length: pages }, (_, i) => ({
    left: geometry.left,
    top: geometry.inset + i * period,
    width: geometry.width,
    height: geometry.height,
  }))
  return {
    pages,
    pageBoxes,
    flowBox: {
      left: geometry.left + geometry.frame.left,
      top: geometry.inset + geometry.frame.top,
      width: geometry.width - geometry.frame.left - geometry.frame.right,
    },
    rail,
    rowShift,
    tableExtra,
    rowFirstOnPage,
    cellRail,
    clip,
    stageHeight: pages * geometry.height + (pages - 1) * geometry.gap + 2 * geometry.inset,
  }
}
