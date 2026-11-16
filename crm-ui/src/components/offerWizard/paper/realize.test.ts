/**
 * `realize`: breaks to rail floats, row shifts, cell rails and clips (specs/20261115-crm-offer-wizard T73, DD-70,
 * AC-11.10). The numbers are checked by hand-worked vectors AND by an independent layout model (layoutSim.ts) that
 * lays the floats out the way CSS 2.1 s. 9.5 does and requires every atom inside its page's frame.
 */
import { describe, expect, it } from 'vitest'
import { FlowBuilder } from './flowBuilder'
import { frameViolations, simulate } from './layoutSim'
import { placeBreaks } from './placement'
import { pageGeometry } from './geometry'
import { realize, type PageBoxes } from './realize'
import type { FlowItem, PagedLayout } from './types'

/** A 150 px page, 100 px of body (frame 30 above, 20 below), 20 px gap: a period of 170 px. */
const PAGE: PageBoxes = {
  height: 150,
  gap: 20,
  inset: 8,
  left: 8,
  width: 200,
  frame: { top: 30, bottom: 20, left: 10, right: 10 },
}
const BODY = 100

function layoutOf(
  f: FlowBuilder,
  painted: Parameters<typeof realize>[3] = [],
): { layout: PagedLayout; items: readonly FlowItem[] } {
  const breaks = placeBreaks(f.items, BODY)
  return { layout: realize(f.items, breaks, PAGE, painted), items: f.items }
}

function expectInFrames(items: readonly FlowItem[], layout: PagedLayout, page: PageBoxes = PAGE, body = BODY): void {
  expect(frameViolations(items, layout, page, body)).toEqual([])
}

describe('realize: the rail', () => {
  it('a text over three pages: z/F pairs sized so the next line lands on the next frame top', () => {
    const f = new FlowBuilder(10)
    f.text(25)
    const { layout, items } = layoutOf(f)
    expect(layout.pages).toBe(3)
    expect(layout.rail).toEqual([
      { run: 100, dead: 70 },
      { run: 100, dead: 70 },
    ])
    expect(layout.rowShift.size).toBe(0)
    expect(layout.tableExtra.size).toBe(0)
    expectInFrames(items, layout)
  })

  it('margins before the break stay on the previous page: the run includes them', () => {
    const f = new FlowBuilder(10)
    f.text(9)
    f.gap(5)
    f.text(3)
    const { layout, items } = layoutOf(f)
    expect(layout.rail).toEqual([{ run: 95, dead: 75 }])
    expectInFrames(items, layout)
  })

  it('page boxes, flow box and stage height come from the geometry', () => {
    const f = new FlowBuilder(10)
    f.text(25)
    const { layout } = layoutOf(f)
    expect(layout.pageBoxes).toEqual([
      { left: 8, top: 8, width: 200, height: 150 },
      { left: 8, top: 178, width: 200, height: 150 },
      { left: 8, top: 348, width: 200, height: 150 },
    ])
    expect(layout.flowBox).toEqual({ left: 18, top: 38, width: 180 })
    expect(layout.stageHeight).toBe(3 * 150 + 2 * 20 + 2 * 8)
  })

  it('an offer with one page has no rail and a one-page stage', () => {
    const f = new FlowBuilder(10)
    f.text(3)
    const { layout } = layoutOf(f)
    expect(layout.pages).toBe(1)
    expect(layout.rail).toEqual([])
    expect(layout.stageHeight).toBe(150 + 16)
  })

  it('a break before a whole table is a rail too', () => {
    const f = new FlowBuilder(10)
    f.text(9)
    f.table([{ lines: 1, head: true }, { lines: 1 }, { lines: 1 }])
    const { layout, items } = layoutOf(f)
    expect(layout.rail).toEqual([{ run: 90, dead: 80 }])
    expect(layout.rowShift.size).toBe(0)
    expectInFrames(items, layout)
  })
})

describe('realize: rows of one table (shift)', () => {
  it('a break between two rows shifts the rows after it and pads the table, with no rail inside it', () => {
    const f = new FlowBuilder(10)
    const table = f.table([{ lines: 1, head: true }, ...Array.from({ length: 12 }, () => ({ lines: 1 }))])
    f.text(2)
    const { layout, items } = layoutOf(f)
    expect(layout.rail).toEqual([])
    expect(layout.tableExtra.get(String(table))).toBe(70)
    for (let r = 0; r < 10; r++) expect(layout.rowShift.has(`${table}:${r}`)).toBe(false)
    for (let r = 10; r < 13; r++) expect(layout.rowShift.get(`${table}:${r}`)).toBe(70)
    expect([...layout.rowFirstOnPage]).toEqual([`${table}:10`])
    expectInFrames(items, layout)
  })

  it('two row breaks in one table accumulate; a rail after them counts the page they filled', () => {
    const f = new FlowBuilder(10)
    const table = f.table(Array.from({ length: 25 }, () => ({ lines: 1 })))
    f.text(12)
    const { layout, items } = layoutOf(f)
    expect(layout.rowShift.get(`${table}:10`)).toBe(70)
    expect(layout.rowShift.get(`${table}:20`)).toBe(140)
    expect(layout.tableExtra.get(String(table))).toBe(140)
    expectInFrames(items, layout)
    expect(layout.pages).toBeGreaterThanOrEqual(4)
  })
})

describe('realize: a row taller than a page (cell rail, O13)', () => {
  const build = (): FlowBuilder => {
    const f = new FlowBuilder(10)
    f.table([{ lines: 1, head: true }, { lines: 25 }, { lines: 1 }], { pad: 5 })
    return f
  }

  it('puts a z/F pair inside the row, the first measured from the cell content, the second from the frame top', () => {
    const f = build()
    const { layout, items } = layoutOf(f)
    const table = f.items[0]!.id
    expect(layout.cellRail.get(`${table}:1`)).toEqual([
      { run: 70, dead: 75 },
      { run: 100, dead: 70 },
    ])
    // the row after it is a row-boundary break: a shift of its own dead zone
    expect(layout.rowShift.get(`${table}:2`)).toBe(85)
    expect(layout.tableExtra.get(String(table))).toBe(85)
    expect(layout.rail).toEqual([])
    expectInFrames(items, layout)
  })

  it('clips the row to the bands the dead zones cross, in its own box', () => {
    const f = build()
    const { layout } = layoutOf(f)
    const table = f.items[0]!.id
    expect(layout.clip.get(`${table}:1`)).toEqual([
      { from: 75, to: 150 },
      { from: 250, to: 320 },
    ])
  })
})

describe('realize: unit parts, painted elements', () => {
  it('a unit split between parts uses the rail', () => {
    const f = new FlowBuilder(10)
    f.unit(250, { parts: [50, 50, 50, 50, 50] })
    const { layout, items } = layoutOf(f)
    expect(layout.rail).toEqual([
      { run: 100, dead: 70 },
      { run: 100, dead: 70 },
    ])
    expectInFrames(items, layout)
  })

  it('a painted element that a break crosses gets the dead bands in its own box; one that none crosses gets none', () => {
    const f = new FlowBuilder(10)
    f.text(25)
    f.text(1)
    const { layout } = layoutOf(f, [
      { key: 'hand', top: 0, height: 250 },
      { key: 'clear', top: 205, height: 40 },
      { key: 'second', top: 120, height: 130 },
    ])
    expect(layout.clip.get('hand')).toEqual([
      { from: 100, to: 170 },
      { from: 270, to: 340 },
    ])
    expect(layout.clip.has('clear')).toBe(false)
    // top 120 sits on page 2 (final 170 + 20): the break at unpaged 200 is 80 px into it; the one at 100 is above it
    expect(layout.clip.get('second')).toEqual([{ from: 80, to: 150 }])
  })

  it('a painted element that starts exactly at a break has the band inside its box, at its top', () => {
    const f = new FlowBuilder(10)
    f.text(25)
    const { layout } = layoutOf(f, [{ key: 'start', top: 100, height: 60 }])
    expect(layout.clip.get('start')).toEqual([{ from: 0, to: 70 }])
  })
})

describe('realize: an atom that cannot split and is taller than a page period', () => {
  it('spans the pages it crosses; the next block starts on the frame top below them', () => {
    const f = new FlowBuilder(10)
    f.unit(250)
    f.text(2)
    const { layout, items } = layoutOf(f)
    expect(layout.pages).toBe(3)
    expect(layout.rail).toEqual([{ run: 250, dead: 90 }])
    const atoms = simulate(items, layout)
    expect(atoms.map((a) => a.top)).toEqual([0, 340, 350])
  })
})

describe('realize: with the real geometry', () => {
  it('lays a 30-page-like flow out so every atom is inside its frame at 488 px and at 794 px', () => {
    for (const available of [320, 488, 900]) {
      const g = pageGeometry(available, 16)
      const f = new FlowBuilder(g.type.body.lineHeightPx)
      for (let i = 0; i < 40; i++) {
        f.heading()
        f.text(3 + (i % 9))
        f.gap(g.spacing.sectionBefore)
        if (i % 7 === 3)
          f.table([{ lines: 1, head: true }, ...Array.from({ length: 6 }, (_, r) => ({ lines: 1 + (r % 3) }))], {
            pad: g.cellPad,
          })
      }
      const breaks = placeBreaks(f.items, g.body)
      const layout = realize(f.items, breaks, g)
      expect(layout.pages).toBe(breaks.length + 1)
      expectInFrames(f.items, layout, g, g.body)
    }
  })
})
