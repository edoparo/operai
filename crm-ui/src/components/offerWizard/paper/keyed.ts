/**
 * The paged layout as the render reads it (specs/20261115-crm-offer-wizard T74, plan DD-70): `realize` keys a table's
 * row shifts and rails by the item id the collector gave it; the elements know their tables by `data-flow-key`, so the
 * ids are swapped for the keys here. Pure.
 */
import type { Band, PagedLayout } from './types'

export type KeyedLayout = PagedLayout

const ROW = /^(\d+):(\d+)$/
const TABLE = /^\d+$/

export function keyLayout(layout: PagedLayout, keys: ReadonlyMap<number, string>): KeyedLayout {
  const rekey = (key: string): string => {
    const row = ROW.exec(key)
    if (row) return `${keys.get(Number(row[1])) ?? row[1]}:${row[2]}`
    if (TABLE.test(key)) return keys.get(Number(key)) ?? key
    return key
  }
  const map = <V>(source: ReadonlyMap<string, V>): Map<string, V> =>
    new Map(Array.from(source, ([key, value]) => [rekey(key), value]))
  return {
    ...layout,
    rowShift: map(layout.rowShift),
    tableExtra: map(layout.tableExtra),
    rowFirstOnPage: new Set(Array.from(layout.rowFirstOnPage, rekey)),
    cellRail: map(layout.cellRail),
    clip: map(layout.clip),
  }
}

/**
 * `clip-path` that keeps an element's box except the dead bands (rest of a page, gap, next margin) it paints across,
 * so a border or a background is never drawn in a margin or a gap (AC-11.10). The rectangles are far wider and taller
 * than any box: only the bands matter, and a clip-path never grows what it clips.
 */
export function clipPath(bands: readonly Band[] | undefined): string | undefined {
  if (!bands || bands.length === 0) return undefined
  const sorted = [...bands].sort((a, b) => a.from - b.from)
  const rects: string[] = []
  let top = -10000
  for (const band of sorted) {
    rects.push(`M-10000 ${top}H100000V${band.from}H-10000Z`)
    top = band.to
  }
  rects.push(`M-10000 ${top}H100000V100000H-10000Z`)
  return `path("${rects.join(' ')}")`
}
