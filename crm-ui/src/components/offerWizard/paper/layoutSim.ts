/**
 * An independent model of how the browser lays the paged flow out, for the tests only (specs/20261115-crm-offer-wizard
 * T73, DD-73: jsdom has no layout). It applies the CSS 2.1 s. 9.5 rule that the plan relies on, to the output of
 * `realize`: a line box that overlaps a full-width float starts below it, a table's border box likewise, a row's
 * `translateY` moves it without touching the layout, a table's `margin-bottom` pushes what follows, and a float pair
 * inside a cell moves the lines of that cell. It shares no code with `realize` or `placeBreaks`.
 */
import type { FlowItem, PagedLayout } from './types'

export interface PlacedAtom {
  item: number
  /** Line, part or row index within the item (a line of an over-tall row: row * 1000 + line). */
  index: number
  top: number
  bottom: number
}

interface Interval {
  top: number
  bottom: number
}

const EPS = 1e-6

function floatsOf(pairs: readonly { run: number; dead: number }[], origin: number): Interval[] {
  const floats: Interval[] = []
  let y = origin
  for (const pair of pairs) {
    y += pair.run
    floats.push({ top: y, bottom: y + pair.dead })
    y += pair.dead
  }
  return floats
}

/** The first y at or after `y` where a box of height `h` overlaps none of `floats`. */
function below(y: number, h: number, floats: readonly Interval[]): number {
  let cursor = y
  for (let again = true; again;) {
    again = false
    for (const f of floats) {
      if (f.top < cursor + h - EPS && f.bottom > cursor + EPS && f.bottom > f.top) {
        cursor = f.bottom
        again = true
      }
    }
  }
  return cursor
}

export function simulate(items: readonly FlowItem[], layout: PagedLayout): PlacedAtom[] {
  const flowFloats = floatsOf(layout.rail, 0)
  const atoms: PlacedAtom[] = []
  let cy = 0
  let prevBottom = 0
  for (const item of items) {
    if (item.kind === 'text') {
      if (!(item.lines >= 1)) continue
      cy += item.top - prevBottom
      for (let i = 0; i < item.lines; i++) {
        cy = below(cy, item.lineHeight, flowFloats)
        atoms.push({ item: item.id, index: i, top: cy, bottom: cy + item.lineHeight })
        cy += item.lineHeight
      }
      prevBottom = item.top + item.lines * item.lineHeight
    } else if (item.kind === 'unit') {
      if (!(item.height > 0)) continue
      cy += item.top - prevBottom
      const parts = item.parts && item.parts.length >= 2 ? item.parts : [{ top: item.top, height: item.height }]
      let partBottom = item.top
      parts.forEach((part, i) => {
        cy += part.top - partBottom
        cy = below(cy, part.height, flowFloats)
        atoms.push({ item: item.id, index: i, top: cy, bottom: cy + part.height })
        cy += part.height
        partBottom = part.top + part.height
      })
      prevBottom = item.top + item.height
    } else {
      const first = item.rows[0]
      if (!first) continue
      cy += first.top - prevBottom
      const lastRow = item.rows[item.rows.length - 1]!
      let layoutHeight = lastRow.top + lastRow.height - first.top
      for (const [key, pairs] of layout.cellRail) {
        const [id] = key.split(':').map(Number)
        if (id === item.id) layoutHeight += pairs.reduce((sum, pair) => sum + pair.dead, 0)
      }
      cy = below(cy, layoutHeight, flowFloats)
      let ry = cy
      item.rows.forEach((row, r) => {
        const key = `${item.id}:${r}`
        const shift = layout.rowShift.get(key) ?? 0
        const rails = layout.cellRail.get(key)
        if (!rails) {
          atoms.push({ item: item.id, index: r * 1000, top: ry + shift, bottom: ry + shift + row.height })
          ry += row.height
          return
        }
        const pad = row.pad ?? 0
        const lines = Math.max(1, Math.round((row.height - 2 * pad) / row.lineHeight))
        const cellFloats = floatsOf(rails, ry + pad)
        let c = ry + pad
        for (let j = 0; j < lines; j++) {
          c = below(c, row.lineHeight, cellFloats)
          atoms.push({ item: item.id, index: r * 1000 + j, top: c + shift, bottom: c + shift + row.lineHeight })
          c += row.lineHeight
        }
        ry = c + pad
      })
      cy = ry + (layout.tableExtra.get(String(item.id)) ?? 0)
      prevBottom = lastRow.top + lastRow.height
    }
  }
  return atoms
}

/**
 * What is wrong with a laid-out flow, as readable strings: an atom that starts above its page's frame top, one that
 * ends below its frame bottom (an atom taller than the body is exempt: it can only overflow), pages used out of
 * order, or a page no atom is on. An empty list is a layout where every line is inside a frame and no page is blank.
 */
export function frameViolations(
  items: readonly FlowItem[],
  layout: PagedLayout,
  page: { height: number; gap: number },
  body: number,
): string[] {
  const period = page.height + page.gap
  const problems: string[] = []
  const used = new Set<number>()
  let last = 0
  const atoms = simulate(items, layout)
  for (const atom of atoms) {
    const p = Math.floor((atom.top + 1e-6) / period)
    if (p < last) problems.push(`atom ${atom.item}/${atom.index} goes back to page ${p}`)
    last = p
    used.add(p)
    if (atom.top - p * period < -1e-6) problems.push(`atom ${atom.item}/${atom.index} starts above its frame`)
    if (atom.bottom - atom.top <= body && atom.bottom - p * period > body + 0.02) {
      problems.push(`atom ${atom.item}/${atom.index} ends ${atom.bottom - p * period - body} px below its frame`)
    }
  }
  for (let p = 0; p < layout.pages && atoms.length > 0; p++) if (!used.has(p)) problems.push(`page ${p} holds no line`)
  for (const p of used) if (p >= layout.pages) problems.push(`atom on page ${p} of ${layout.pages}`)
  return problems
}
