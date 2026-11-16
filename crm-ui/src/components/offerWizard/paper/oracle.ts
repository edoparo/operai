/**
 * An independent oracle for `placeBreaks` (test support): it re-derives atoms and the rank-0 ("free") break points from
 * the items and reports every way a break list breaks a rule of plan DD-68, or ends a page early without a rule to
 * justify it (O12). It shares no code with placement.ts.
 */
import type { Break, FlowItem } from './types'

const EPS = 0.01

interface OAtom {
  top: number
  bottom: number
  /** A break before this atom breaks no rule. */
  free: boolean
}

function oracleAtoms(item: FlowItem, body: number): OAtom[] {
  if (item.kind === 'text') {
    return Array.from({ length: item.lines }, (_, i) => ({
      top: item.top + i * item.lineHeight,
      bottom: item.top + (i + 1) * item.lineHeight,
      free: i >= 2 && item.lines - i >= 2,
    }))
  }
  if (item.kind === 'unit') {
    const parts = item.parts && item.parts.length >= 2 ? item.parts : [{ top: item.top, height: item.height }]
    return parts.map((p) => ({ top: p.top, bottom: p.top + p.height, free: false }))
  }
  const atoms: OAtom[] = []
  item.rows.forEach((row, r) => {
    const free = r >= 1 && !item.rows[r - 1]!.head
    if (row.height <= body + EPS) return void atoms.push({ top: row.top, bottom: row.top + row.height, free })
    const pad = row.pad ?? 0
    const lines = Math.max(1, Math.round((row.height - 2 * pad) / row.lineHeight))
    for (let j = 0; j < lines; j++) {
      atoms.push({
        top: j === 0 ? row.top : row.top + pad + j * row.lineHeight,
        bottom: j === lines - 1 ? row.top + row.height : row.top + pad + (j + 1) * row.lineHeight,
        free: j === 0 ? free : false,
      })
    }
  })
  return atoms
}

const isEmpty = (item: FlowItem): boolean =>
  item.kind === 'text' ? item.lines < 1 : item.kind === 'unit' ? !(item.height > 0) : item.rows.length === 0
const keeps = (item: FlowItem): boolean => item.kind !== 'table' && item.keepNext

/** The oracle: returns a list of problems with `breaks` for these items. */
export function checkBreaks(items: readonly FlowItem[], breaks: readonly Break[], body: number): string[] {
  const problems: string[] = []
  const live: FlowItem[] = []
  const eff: boolean[] = []
  let carry = false
  for (const item of items) {
    if (isEmpty(item)) carry ||= item.breakBefore
    else {
      live.push(item)
      eff.push(item.breakBefore || carry)
      carry = false
    }
  }
  // a keep chain is forced to start a page when any member asks for one
  const chainForced = (i: number): boolean => {
    let t = i
    while (t < live.length - 1 && keeps(live[t]!)) t++
    return eff.slice(i, t + 1).some(Boolean)
  }
  const atoms = live.map((item) => oracleAtoms(item, body))
  const owner = new Map<number, { i: number; a: number }>()
  live.forEach((_, i) => atoms[i]!.forEach((atom, a) => owner.set(atom.top, { i, a })))

  let pageStart = 0
  let previous: { i: number; a: number } | null = null
  breaks.forEach((br, j) => {
    const found = owner.get(br.at)
    if (!found || live[found.i]!.id !== br.item)
      return void problems.push(`break ${j} at ${br.at} is not an atom top of item ${br.item}`)
    if (br.at <= pageStart && j > 0) problems.push(`break ${j} at ${br.at} not increasing`)
    const { i, a } = found
    const mine = atoms[i]!
    const free = mine[a]!.free
    const predecessorKeeps = i > 0 && keeps(live[i - 1]!)
    const forcedStart = a === 0 && !predecessorKeeps && chainForced(i)

    // atoms of the page that this break ends: those between pageStart and br.at
    const page: OAtom[] = []
    live.forEach((_, k) =>
      atoms[k]!.forEach((atom) => atom.top >= pageStart - EPS && atom.top < br.at - EPS && page.push(atom)),
    )
    if (page.length === 0) problems.push(`break ${j} ends an empty page`)
    if (page.length >= 2 && page[page.length - 1]!.bottom - pageStart > body + EPS)
      problems.push(`page ${j} overflows with ${page.length} atoms`)

    if (br.relaxed === 'keep') {
      if (a !== 0 || !predecessorKeeps) problems.push(`break ${j} is 'keep' but not between kept items`)
    } else if (!br.relaxed) {
      if (a === 0 && predecessorKeeps)
        problems.push(`break ${j} separates a keepNext item from its next without 'keep'`)
      if (a > 0 && !free) problems.push(`break ${j} unrelaxed but not allowed (item ${br.item} atom ${a})`)
      if (a === 0 && live[i]!.kind === 'table' && !forcedStart) {
        // a table start is a structural break: fine
      }
      if (!forcedStart && !predecessorKeeps) {
        if (a > 0) {
          // mid-item: the largest free atom that still fits, counted from the item's start on this page
          const from = previous && previous.i === i ? previous.a : 0
          let nf = from
          while (nf < mine.length && mine[nf]!.bottom - pageStart <= body + EPS) nf++
          if (a > nf && !(nf === from && a === from + 1))
            problems.push(`break ${j} after the page was full (atom ${a} > first non-fit ${nf})`)
          for (let b = a + 1; b <= nf; b++)
            if (mine[b]?.free) problems.push(`break ${j} could have been later (atom ${b} is free and fits)`)
        } else {
          // an item start: its keep-chain's leading part did not fit the page that ended
          let t = i
          while (t < live.length - 1 && keeps(live[t]!)) t++
          const term = atoms[t]!
          let lead = term.length
          for (let b = 1; b < term.length; b++) if (term[b]!.free) lead = Math.min(lead, b)
          if (term[lead - 1]!.bottom - pageStart <= body + EPS)
            problems.push(`break ${j} before item ${br.item} that would have fit`)
        }
      }
    } else if (br.relaxed === 'widow' && live[i]!.kind !== 'text')
      problems.push(`break ${j} 'widow' on a ${live[i]!.kind}`)
    else if (br.relaxed === 'unit' && live[i]!.kind !== 'unit') problems.push(`break ${j} 'unit' on a ${live[i]!.kind}`)
    else if (br.relaxed === 'row' && live[i]!.kind !== 'table') problems.push(`break ${j} 'row' on a ${live[i]!.kind}`)

    pageStart = br.at
    previous = found
  })

  // the last page: not empty, and fits unless it is a single atom
  const last: OAtom[] = []
  atoms.forEach((list) => list.forEach((atom) => atom.top >= pageStart - EPS && last.push(atom)))
  if (last.length === 0 && atoms.flat().length > 0) problems.push('the last page is empty')
  if (last.length >= 2 && last[last.length - 1]!.bottom - pageStart > body + EPS)
    problems.push('the last page overflows')

  // forced page starts: every chain start with breakBefore (except the very first item) begins a page
  live.forEach((item, i) => {
    if (i === 0 || keeps(live[i - 1]!) || !chainForced(i)) return
    const top = atoms[i]![0]!.top
    if (!breaks.some((br) => Math.abs(br.at - top) < EPS))
      problems.push(`item ${item.id} (breakBefore) does not start a page`)
  })

  // R8: every atom is on exactly one page, in order (pages partition the atoms by their tops)
  const all = atoms.flat()
  const counted = new Set<OAtom>()
  const starts = [0, ...breaks.map((b) => b.at)]
  all.forEach((atom) => {
    let p = 0
    while (p + 1 < starts.length && atom.top >= starts[p + 1]! - EPS) p++
    counted.add(atom)
  })
  if (counted.size !== all.length) problems.push('an atom was lost or counted twice')
  return problems
}
