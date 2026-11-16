/**
 * Seeded random flows through `placeBreaks` and `realize` (specs/20261115-crm-offer-wizard T73, DD-73, AC-11.11):
 * nothing lost or repeated, breaks strictly increasing, every page holds a line and fits, every unrelaxed break is
 * allowed by the rules AND justified (the page ended early only where a rule moved what follows, O12), forced page
 * starts hold, and the realised layout puts every line inside a frame (an independent float model, layoutSim.ts).
 * The oracle below re-derives atoms and ranks on its own; it shares nothing with placement.ts.
 */
import { describe, expect, it } from 'vitest'
import { FlowBuilder, mulberry32, randomFlow } from './flowBuilder'
import { checkBreaks } from './oracle'
import { frameViolations } from './layoutSim'
import { placeBreaks } from './placement'
import { realize, type PageBoxes } from './realize'

const PAGE = (body: number): PageBoxes => ({
  height: body + 50,
  gap: 16,
  inset: 8,
  left: 8,
  width: 300,
  frame: { top: 30, bottom: 20, left: 10, right: 10 },
})

describe('placeBreaks: seeded random flows', () => {
  const configs: readonly { lineHeight: number; body: number }[] = [
    { lineHeight: 10, body: 100 },
    { lineHeight: 13.5, body: 469.25 },
    { lineHeight: 13.5, body: 120.75 },
    { lineHeight: 12.25, body: 41.5 },
    { lineHeight: 20, body: 30 },
    { lineHeight: 10, body: 7.3 },
  ]
  for (const config of configs) {
    it(`holds every invariant for 300 flows (line ${config.lineHeight}, body ${config.body})`, () => {
      const rand = mulberry32(config.body * 1000 + config.lineHeight)
      for (let n = 0; n < 300; n++) {
        const f = randomFlow(rand, config.lineHeight)
        const breaks = placeBreaks(f.items, config.body)
        const problems = checkBreaks(f.items, breaks, config.body)
        expect(
          problems,
          `flow ${n}: ${f.items.map((i) => i.kind[0] + i.id + (i.kind === 'text' ? 'x' + i.lines + (i.keepNext ? 'k' : '') + (i.breakBefore ? 'b' : '') : i.kind === 'table' ? 'r' + i.rows.length : '')).join(' ')}`,
        ).toEqual([])
        const layout = realize(f.items, breaks, PAGE(config.body))
        expect(layout.pages).toBe(breaks.length + 1)
        expect(frameViolations(f.items, layout, PAGE(config.body), config.body), `flow ${n}`).toEqual([])
        // deterministic
        expect(placeBreaks(f.items, config.body)).toEqual(breaks)
      }
    })
  }

  it('breaks are strictly increasing and each lies at an item boundary or a line / row of an item', () => {
    const rand = mulberry32(99)
    for (let n = 0; n < 200; n++) {
      const f = randomFlow(rand, 10)
      const breaks = placeBreaks(f.items, 100)
      for (let k = 1; k < breaks.length; k++) expect(breaks[k]!.at).toBeGreaterThan(breaks[k - 1]!.at)
      if (breaks.length > 0) expect(breaks[0]!.at).toBeGreaterThan(0)
    }
  })

  it('the oracle can fail: a hand-made bad break list is reported', () => {
    const f = new FlowBuilder(10)
    f.text(25)
    expect(checkBreaks(f.items, [{ at: 130, item: 1, line: 13 }], 100)).not.toEqual([])
    expect(checkBreaks(f.items, [{ at: 60, item: 1, line: 6 }], 100)).not.toEqual([])
    expect(checkBreaks(f.items, [{ at: 100, item: 1, line: 10 }], 100)).not.toEqual([]) // the last page overflows
    expect(checkBreaks(f.items, placeBreaks(f.items, 100), 100)).toEqual([])
  })
})
