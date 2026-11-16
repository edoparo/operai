/**
 * `placeBreaks`: where the pages break (specs/20261115-crm-offer-wizard T73, plan DD-68, DD-79, AC-11.11).
 * Pure: measured boxes in, break positions out; no DOM, no React.
 *
 * The rules mirror `crm-api/src/offers/contractPdf.ts` (its line numbers are in the plan):
 *   R1 a page holds what fits; R2 widow/orphan: no 2- or 3-line block splits; R3 keep-with-next (a chain travels
 *   together with the leading part of what follows); R4 a table breaks only before a body row other than its first,
 *   never inside a row, the header not repeated; R5 a unit (the acceptance block) stays whole; R6 an annex starts a
 *   page, never a blank one; R7 on an empty page where nothing fits, the rules give way in a fixed order
 *   (R3, then R2, then R5, then R4's no-split-row) so every page holds at least one line; R8 every line once, in order.
 *
 * How it works. Each item is a list of ATOMS (a text's lines, a table's rows, a unit's parts; the lines of a row that
 * is taller than a page). `rank[i]` says what a break BEFORE atom i costs: 0 nothing, 1 R2, 2 R5, 3 and 4 R4 (3 at a
 * line of an over-tall row that leaves two lines on each side, or before a table's first body row; 4 at any other
 * line of it). A page break is placed at the largest rank-0 atom that still leaves the page full-or-fitting; only
 * when none exists AND the item already starts the page does the lowest rank present give way. Items chained by
 * `keepNext` are placed as one head part; a head that does not fit an empty page peels its first item off (R3 gives
 * way) and tries again.
 */
import type { Break, FlowItem, Relaxed, TableItem, TextItem, UnitItem } from './types'

export type { Break, FlowItem } from './types'

/** Measurement noise tolerated when a box is said to fit (px). */
export const FIT_EPS = 0.01

interface Atom {
  top: number
  bottom: number
  /** What a break before this atom costs (see the module doc); the first atom's rank is never read. */
  rank: number
  /** The fields a Break carries when it is placed before this atom. */
  at: Pick<Break, 'line' | 'row' | 'rowLine'>
}

interface Placed {
  item: FlowItem
  atoms: readonly Atom[]
  /** Atoms that must stay with a keepNext predecessor: up to the first rank-0 break, or all of them. */
  lead: number
}

const RANK_LABEL: Record<number, Relaxed | undefined> = { 0: undefined, 1: 'widow', 2: 'unit', 3: 'row', 4: 'row' }

function textAtoms(item: TextItem): Atom[] {
  const n = item.lines
  return Array.from({ length: n }, (_, i) => ({
    top: item.top + i * item.lineHeight,
    bottom: item.top + (i + 1) * item.lineHeight,
    // R2 (contractPdf.ts lines()): the first and the last two lines of a block stay together.
    rank: i >= 2 && n - i >= 2 ? 0 : 1,
    at: { line: i },
  }))
}

function unitAtoms(item: UnitItem): Atom[] {
  const parts = item.parts
  if (!parts || parts.length < 2) return [{ top: item.top, bottom: item.top + item.height, rank: 0, at: {} }]
  return parts.map((part, i) => ({
    top: i === 0 ? item.top : part.top,
    bottom: i === parts.length - 1 ? item.top + item.height : part.top + part.height,
    rank: 2,
    at: { line: i },
  }))
}

function tableAtoms(item: TableItem, body: number): Atom[] {
  const atoms: Atom[] = []
  item.rows.forEach((row, r) => {
    // R4: never before the first body row (it stays with the header); relaxed only when nothing else fits.
    const rowRank = r === 0 ? 0 : item.rows[r - 1]?.head ? 3 : 0
    if (row.height <= body + FIT_EPS) {
      atoms.push({ top: row.top, bottom: row.top + row.height, rank: rowRank, at: { row: r } })
      return
    }
    // R7: a row taller than a page continues at a line boundary. Its lines sit between the cell padding.
    const pad = row.pad ?? 0
    const lines = Math.max(1, Math.round((row.height - 2 * pad) / row.lineHeight))
    for (let j = 0; j < lines; j++) {
      atoms.push({
        top: j === 0 ? row.top : row.top + pad + j * row.lineHeight,
        bottom: j === lines - 1 ? row.top + row.height : row.top + pad + (j + 1) * row.lineHeight,
        rank: j === 0 ? rowRank : j >= 2 && lines - j >= 2 ? 3 : 4,
        at: j === 0 ? { row: r } : { row: r, rowLine: j },
      })
    }
  })
  return atoms
}

function isEmpty(item: FlowItem): boolean {
  if (item.kind === 'text') return !(item.lines >= 1) || !(item.lineHeight > 0)
  if (item.kind === 'unit') return !(item.height > 0)
  return item.rows.length === 0
}

function keepNextOf(item: FlowItem): boolean {
  return item.kind !== 'table' && item.keepNext
}

/** Empty items are dropped; their `breakBefore` is handed to the next item so a forced page still starts. */
function prepare(items: readonly FlowItem[], body: number): { placed: Placed[]; forced: boolean[] } {
  const placed: Placed[] = []
  const forced: boolean[] = []
  let carry = false
  for (const item of items) {
    if (isEmpty(item)) {
      carry ||= item.breakBefore
      continue
    }
    const atoms =
      item.kind === 'text' ? textAtoms(item) : item.kind === 'unit' ? unitAtoms(item) : tableAtoms(item, body)
    let lead = atoms.length
    for (let i = 1; i < atoms.length; i++) {
      if (atoms[i]?.rank === 0) {
        lead = i
        break
      }
    }
    placed.push({ item, atoms, lead })
    forced.push(item.breakBefore || carry)
    carry = false
  }
  return { placed, forced }
}

export function placeBreaks(items: readonly FlowItem[], body: number): readonly Break[] {
  const limit = Number.isFinite(body) ? Math.max(0, body) : 0
  const { placed, forced } = prepare(items, limit)
  const breaks: Break[] = []
  let pageStart = 0
  let hasContent = false
  let keepPending = false

  const breakAt = (entry: Placed, index: number, relaxed: Relaxed | undefined): void => {
    const atom = entry.atoms[index]
    if (!atom) return
    breaks.push({ at: atom.top, item: entry.item.id, ...atom.at, ...(relaxed ? { relaxed } : {}) })
    pageStart = atom.top
    hasContent = false
  }

  const placeItem = (entry: Placed): void => {
    const { atoms } = entry
    const n = atoms.length
    let from = 0
    for (;;) {
      let nf = from
      while (nf < n && (atoms[nf]?.bottom ?? 0) - pageStart <= limit + FIT_EPS) nf++
      if (nf === n) {
        hasContent = true
        return
      }
      // The next page starts at some atom b in (from, nf]: the page then holds [from, b), all of which fit.
      let best = -1
      let bestRank = Infinity
      for (let b = from + 1; b <= nf; b++) {
        const rank = atoms[b]?.rank ?? Infinity
        if (rank <= bestRank) {
          bestRank = rank
          best = b
        }
      }
      if (best >= 0 && bestRank === 0) {
        breakAt(entry, best, undefined)
        from = best
        continue
      }
      if (from === 0 && hasContent) {
        // Nothing of this item may end the page: it starts the next one, whole.
        breakAt(entry, 0, keepPending ? 'keep' : undefined)
        keepPending = false
        continue
      }
      // The item is at a page's first line and the rules cannot be kept: they give way, in the fixed order.
      const target = best >= 0 ? best : from + 1
      if (target >= n) {
        hasContent = true
        return
      }
      breakAt(entry, target, RANK_LABEL[atoms[target]?.rank ?? 1])
      from = target
    }
  }

  let i = 0
  while (i < placed.length) {
    let j = i
    while (j < placed.length - 1 && keepNextOf(placed[j]!.item)) j++
    let chain = placed.slice(i, j + 1)
    const chainForced = forced.slice(i, j + 1).some(Boolean)
    keepPending = false
    if (chainForced && hasContent) breakAt(chain[0]!, 0, undefined)
    while (chain.length > 1) {
      const last = chain[chain.length - 1]!
      const headBottom = (last.atoms[last.lead - 1]?.bottom ?? 0) - pageStart
      if (headBottom <= limit + FIT_EPS) break
      if (hasContent) {
        breakAt(chain[0]!, 0, keepPending ? 'keep' : undefined)
        keepPending = false
        continue
      }
      // An empty page and the chain still does not fit: R3 gives way, the first item stands alone.
      placeItem(chain[0]!)
      chain = chain.slice(1)
      keepPending = true
    }
    for (const entry of chain) placeItem(entry)
    keepPending = false
    i = j + 1
  }
  return breaks
}
