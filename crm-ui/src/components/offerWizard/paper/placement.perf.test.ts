/**
 * The pure pagination core against the plan's budget (specs/20261115-crm-offer-wizard T73, plan R32): <= 100 ms of work
 * for 30 pages and <= 200 ms for 60, geometry + `placeBreaks` + `realize` together. The browser's own measuring adds to
 * this in T74; the core alone is far below it, and the assertion is the plan's number, not the machine's best.
 */
import { describe, expect, it } from 'vitest'
import { FlowBuilder } from './flowBuilder'
import { frameViolations } from './layoutSim'
import { pageGeometry } from './geometry'
import { placeBreaks } from './placement'
import { realize } from './realize'

/** An offer-shaped flow of about `target` pages: numbered sections, lists, cost tables, annexes, the acceptance block. */
function offerOf(lineHeight: number, cellPad: number, sections: number): FlowBuilder {
  const f = new FlowBuilder(lineHeight)
  f.text(6)
  f.gap(10)
  f.text(1)
  f.gap(14)
  for (let s = 0; s < sections; s++) {
    f.gap(7)
    f.heading()
    for (let p = 0; p < 4; p++) {
      f.text(2 + ((s + p * 3) % 9))
      f.gap(6)
    }
    if (s % 5 === 2) {
      f.heading()
      f.table(
        [{ lines: 1, head: true }, ...Array.from({ length: 8 + (s % 4) }, (_, r) => ({ lines: 1 + ((r + s) % 3) }))],
        { pad: cellPad },
      )
      f.gap(8)
    }
    if (s % 11 === 6) f.text(3 + (s % 5), { breakBefore: true })
  }
  f.gap(10)
  f.unit(240, { parts: [30, 44, 44, 44, 44, 34] })
  return f
}

function timed(fn: () => void, runs = 15): number {
  const samples: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? 0
}

function pipeline(sections: number): { pages: number; ms: number } {
  const g = pageGeometry(488, 16)
  const f = offerOf(g.type.body.lineHeightPx, g.cellPad, sections)
  let pages = 0
  const ms = timed(() => {
    const geometry = pageGeometry(488, 16)
    const breaks = placeBreaks(f.items, geometry.body)
    pages = realize(f.items, breaks, geometry).pages
  })
  return { pages, ms }
}

describe('pagination budget', () => {
  it('30 pages in the pane of the default layout: under 100 ms', () => {
    let sections = 20
    let result = pipeline(sections)
    while (result.pages < 30) result = pipeline((sections += 6))
    expect(result.pages).toBeGreaterThanOrEqual(30)
    expect(result.ms).toBeLessThan(100)
  })

  it('60 pages: under 200 ms', () => {
    let sections = 40
    let result = pipeline(sections)
    while (result.pages < 60) result = pipeline((sections += 8))
    expect(result.pages).toBeGreaterThanOrEqual(60)
    expect(result.ms).toBeLessThan(200)
  })

  it('and the long offer still has every line inside a frame', () => {
    const g = pageGeometry(488, 16)
    const f = offerOf(g.type.body.lineHeightPx, g.cellPad, 120)
    const layout = realize(f.items, placeBreaks(f.items, g.body), g)
    expect(layout.pages).toBeGreaterThanOrEqual(30)
    expect(frameViolations(f.items, layout, g, g.body)).toEqual([])
  })
})
