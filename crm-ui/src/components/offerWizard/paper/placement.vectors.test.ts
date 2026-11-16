/**
 * `placeBreaks`: one vector per rule R1..R8 of plan DD-68, with the O12 / O13 readings of DD-79
 * (specs/20261115-crm-offer-wizard T73, AC-11.11). Every vector uses a line height of 10 px and a page body of 100 px
 * (ten lines) unless it says otherwise, so the expected `at` of a break is a count of lines.
 */
import { describe, expect, it } from 'vitest'
import { FlowBuilder } from './flowBuilder'
import { placeBreaks } from './placement'
import type { Break, Relaxed } from './types'

interface Vector {
  rule: string
  name: string
  body?: number
  build: (f: FlowBuilder) => void
  /** [at, relaxed, extra fields] per break, in order. */
  expect: readonly (readonly [number, Relaxed | undefined, Partial<Break>?])[]
}

const VECTORS: readonly Vector[] = [
  // R1: a page holds what fits
  { rule: 'R1', name: 'ten lines exactly fill the page: no break', build: (f) => void f.text(10), expect: [] },
  {
    rule: 'R1',
    name: 'eleven lines: the last two go over (a widow is not left), the page keeps nine',
    build: (f) => void f.text(11),
    expect: [[90, undefined, { line: 9 }]],
  },
  {
    rule: 'R1',
    name: 'twenty-five lines run over three pages of ten',
    build: (f) => void f.text(25),
    expect: [
      [100, undefined, { line: 10 }],
      [200, undefined, { line: 20 }],
    ],
  },
  {
    rule: 'R1',
    name: 'a second block takes the rest of the page and its remainder goes over',
    build: (f) => {
      f.text(6)
      f.text(6)
    },
    expect: [[100, undefined, { item: 2, line: 4 }]],
  },
  {
    rule: 'R1',
    name: 'margin counts: a block that fits only without the margin before it moves',
    build: (f) => {
      f.text(9)
      f.gap(5)
      f.text(3)
    },
    expect: [[95, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R1',
    name: 'margin that leaves room: nothing moves',
    build: (f) => {
      f.text(5)
      f.gap(10)
      f.text(1)
    },
    expect: [],
  },
  // R2: widow / orphan (contractPdf.ts lines()): no 2- or 3-line block splits
  {
    rule: 'R2',
    name: 'a 2-line block with room for one line moves whole',
    build: (f) => {
      f.text(9)
      f.text(2)
    },
    expect: [[90, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R2',
    name: 'a 3-line block with room for two lines moves whole',
    build: (f) => {
      f.text(8)
      f.text(3)
    },
    expect: [[80, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R2',
    name: 'a 4-line block with room for two splits 2 + 2',
    build: (f) => {
      f.text(8)
      f.text(4)
    },
    expect: [[100, undefined, { item: 2, line: 2 }]],
  },
  {
    rule: 'R2',
    name: 'orphan: a 5-line block with room for one line moves whole',
    build: (f) => {
      f.text(9)
      f.text(5)
    },
    expect: [[90, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R2',
    name: 'widow: a 5-line block with room for four leaves two for the next page (3 + 2)',
    build: (f) => {
      f.text(6)
      f.text(5)
    },
    expect: [[90, undefined, { item: 2, line: 3 }]],
  },
  // R3: keep with next
  {
    rule: 'R3',
    name: 'a heading whose text does not fit under it moves with it',
    build: (f) => {
      f.text(9)
      f.heading()
      f.text(3)
    },
    expect: [[90, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R3',
    name: 'a heading stays when its first two lines fit; the text then splits where it can',
    build: (f) => {
      f.text(6)
      f.heading()
      f.text(10)
    },
    expect: [[100, undefined, { item: 3, line: 3 }]],
  },
  {
    rule: 'R3',
    name: 'a heading with one line too few for its two lines moves',
    build: (f) => {
      f.text(8)
      f.heading()
      f.text(10)
    },
    expect: [
      [80, undefined, { item: 2, line: 0 }],
      [170, undefined, { item: 3, line: 8 }],
    ],
  },
  {
    rule: 'R3',
    name: 'a chain (heading, mark, text) travels together',
    build: (f) => {
      f.text(7)
      f.heading()
      f.heading()
      f.text(4)
    },
    expect: [[70, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R3',
    name: 'a heading before a table needs the header row and the first body row beside it',
    build: (f) => {
      f.text(8)
      f.heading()
      f.table([{ lines: 1, head: true }, { lines: 1 }, { lines: 1 }])
    },
    expect: [[80, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R3',
    name: 'a heading with the table header and first row fitting stays; the table breaks later',
    build: (f) => {
      f.text(7)
      f.heading()
      f.table([{ lines: 1, head: true }, { lines: 1 }, { lines: 1 }, { lines: 1 }])
    },
    expect: [[100, undefined, { item: 3, row: 2 }]],
  },
  {
    rule: 'R3',
    name: 'a heading before the acceptance block moves with it',
    build: (f) => {
      f.text(6)
      f.heading()
      f.unit(50)
    },
    expect: [[60, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R3',
    name: 'a keepNext on the last item keeps nothing',
    build: (f) => {
      f.text(10)
      f.heading()
    },
    expect: [[100, undefined, { item: 2, line: 0 }]],
  },
  // R4: tables
  {
    rule: 'R4',
    name: 'a table breaks before a body row; the header is not repeated',
    build: (f) => {
      f.table([{ lines: 1, head: true }, ...Array.from({ length: 12 }, () => ({ lines: 1 }))])
    },
    expect: [[100, undefined, { row: 10 }]],
  },
  {
    rule: 'R4',
    name: 'never between the header and the first body row: the whole table moves',
    build: (f) => {
      f.text(9)
      f.table([{ lines: 1, head: true }, { lines: 1 }, { lines: 1 }])
    },
    expect: [[90, undefined, { item: 2, row: 0 }]],
  },
  {
    rule: 'R4',
    name: 'a row is never split: a 3-line row that does not fit starts the next page',
    build: (f) => {
      f.text(8)
      f.table([{ lines: 1 }, { lines: 3 }])
    },
    expect: [[90, undefined, { item: 2, row: 1 }]],
  },
  {
    rule: 'R4',
    name: 'without a header row the first row may be followed by a break',
    build: (f) => {
      f.text(9)
      f.table([{ lines: 1 }, { lines: 2 }])
    },
    expect: [[100, undefined, { item: 2, row: 1 }]],
  },
  // R5: the acceptance block
  {
    rule: 'R5',
    name: 'a unit that does not fit moves whole',
    build: (f) => {
      f.text(8)
      f.unit(40)
    },
    expect: [[80, undefined, { item: 2 }]],
  },
  { rule: 'R5', name: 'a unit that fits stays', build: (f) => void (f.text(5), f.unit(40)), expect: [] },
  // R6: annexes start a page, never a blank one
  {
    rule: 'R6',
    name: 'a text annex starts a new page',
    build: (f) => {
      f.text(3)
      f.text(2, { breakBefore: true })
    },
    expect: [[30, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R6',
    name: 'the first item needs no break before it',
    build: (f) => void f.text(3, { breakBefore: true }),
    expect: [],
  },
  {
    rule: 'R6',
    name: 'an annex right after a full page makes one break, not two',
    build: (f) => {
      f.text(10)
      f.text(3, { breakBefore: true })
    },
    expect: [[100, undefined, { item: 2, line: 0 }]],
  },
  {
    rule: 'R6',
    name: 'two annexes in a row: a page each, none blank',
    build: (f) => {
      f.text(3)
      f.text(3, { breakBefore: true })
      f.text(2, { breakBefore: true })
    },
    expect: [
      [30, undefined, { item: 2 }],
      [60, undefined, { item: 3 }],
    ],
  },
  {
    rule: 'R6',
    name: 'an empty item never makes a blank page and hands its break on',
    build: (f) => {
      f.text(3)
      f.text(0, { breakBefore: true })
      f.text(2)
    },
    expect: [[30, undefined, { item: 3, line: 0 }]],
  },
  {
    rule: 'R6',
    name: 'a break before the end of a keep chain starts the page at the chain (the heading goes with its annex)',
    build: (f) => {
      f.text(3)
      f.heading()
      f.text(4, { breakBefore: true })
    },
    expect: [[30, undefined, { item: 2, line: 0 }]],
  },
  // R7: relaxation, in the fixed order R3, R2, R5, R4
  {
    rule: 'R7',
    name: 'R3 first: a chain taller than an empty page gives up its keep, then R2 gives up on the text',
    body: 25,
    build: (f) => {
      f.heading()
      f.text(3)
    },
    expect: [
      [10, 'keep', { item: 2, line: 0 }],
      [30, 'widow', { item: 2, line: 2 }],
    ],
  },
  {
    rule: 'R7',
    name: 'R5: a unit taller than a page splits between its parts',
    build: (f) => void f.unit(250, { parts: [50, 50, 50, 50, 50] }),
    expect: [
      [100, 'unit', { line: 2 }],
      [200, 'unit', { line: 4 }],
    ],
  },
  {
    rule: 'R7',
    name: 'R5: a unit taller than a page, met mid-page, first moves whole, then splits',
    build: (f) => {
      f.text(3)
      f.unit(250, { parts: [50, 50, 50, 50, 50] })
    },
    expect: [
      [30, undefined, { item: 2 }],
      [130, 'unit', { item: 2, line: 2 }],
      [230, 'unit', { item: 2, line: 4 }],
    ],
  },
  {
    rule: 'R7',
    name: 'a unit taller than a page with no parts is one atom on its own page',
    build: (f) => {
      f.text(3)
      f.unit(150)
    },
    expect: [[30, undefined, { item: 2 }]],
  },
  {
    rule: 'R7',
    name: 'R4 / O13: a row taller than a page continues at a line boundary, nothing is lost, the header is not repeated',
    build: (f) => {
      f.table([{ lines: 1, head: true }, { lines: 25 }, { lines: 1 }], { pad: 5 })
    },
    expect: [
      [95, 'row', { row: 1, rowLine: 7 }],
      [195, 'row', { row: 1, rowLine: 17 }],
      [280, undefined, { row: 2 }],
    ],
  },
  {
    rule: 'R7',
    name: 'a row cut at a line boundary does not leave a single line on either side when it can avoid it',
    build: (f) => void f.table([{ lines: 11 }]),
    expect: [[90, 'row', { row: 0, rowLine: 9 }]],
  },
  {
    rule: 'R7',
    name: 'an over-tall row met mid-page starts on the next page first',
    build: (f) => {
      f.text(2)
      f.table([{ lines: 1 }, { lines: 14 }])
    },
    expect: [
      [30, undefined, { item: 2, row: 1 }],
      [130, 'row', { item: 2, row: 1, rowLine: 10 }],
    ],
  },
  {
    rule: 'R7',
    name: 'a page narrower than one line still holds one line at a time',
    body: 5,
    build: (f) => void f.text(3),
    expect: [
      [10, 'widow', { line: 1 }],
      [20, 'widow', { line: 2 }],
    ],
  },
  // R8: nothing lost, in order, one page at least
  { rule: 'R8', name: 'an offer with no items has one page', build: () => undefined, expect: [] },
  { rule: 'R8', name: 'an offer whose only text is empty has one page', build: (f) => void f.text(0), expect: [] },
]

describe('placeBreaks: vectors', () => {
  for (const vector of VECTORS) {
    it(`${vector.rule}: ${vector.name}`, () => {
      const f = new FlowBuilder(10)
      vector.build(f)
      const breaks = placeBreaks(f.items, vector.body ?? 100)
      expect(breaks.map((b) => b.at)).toEqual(vector.expect.map(([at]) => at))
      expect(breaks.map((b) => b.relaxed)).toEqual(vector.expect.map(([, relaxed]) => relaxed))
      vector.expect.forEach(([, , extra], i) => {
        if (extra) expect(breaks[i]).toMatchObject(extra)
      })
    })
  }

  it('covers every rule of DD-68', () => {
    const rules = new Set(VECTORS.map((v) => v.rule))
    for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']) expect(rules.has(rule)).toBe(true)
  })

  it('is deterministic and does not modify its input', () => {
    const f = new FlowBuilder(10)
    f.text(6)
    f.heading()
    f.text(12)
    f.table([{ lines: 1, head: true }, { lines: 3 }, { lines: 2 }, { lines: 4 }])
    const copy = JSON.stringify(f.items)
    const first = placeBreaks(f.items, 100)
    expect(JSON.stringify(f.items)).toBe(copy)
    expect(placeBreaks(f.items, 100)).toEqual(first)
  })
})
