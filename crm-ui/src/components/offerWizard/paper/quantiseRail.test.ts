import { describe, expect, it } from 'vitest'
import { LAYOUT_UNIT, quantiseRail } from './quantiseRail'

const EPS = 0.05
const whole = (px: number) => Math.abs(px / LAYOUT_UNIT - Math.round(px / LAYOUT_UNIT)) < 1e-9

/** What a browser draws: each height cut down to 1/64 px, summed. */
const dropped = (heights: number[]) => {
  let at = 0
  for (const h of heights) at += Math.floor(h / LAYOUT_UNIT + 1e-9) * LAYOUT_UNIT
  return at
}

describe('quantiseRail (QE D24: the rail never drifts from the plan)', () => {
  // the 320 px case: a page 346.2127 px tall (not a multiple of 1/64) and the 16 px gap, 136 pages, one break each
  const period = (244.796875 * 297) / 210 + 16
  const plan = Array.from({ length: 136 }, (_, k) => ({
    run: k === 0 ? 120.4 : 230.7,
    dead: period - (k === 0 ? 120.4 : 230.7),
  }))

  it('draws only whole 1/64 px heights', () => {
    for (const step of quantiseRail(plan, EPS)) {
      expect(whole(step.run)).toBe(true)
      expect(whole(step.dead)).toBe(true)
      expect(step.run).toBeGreaterThanOrEqual(0)
      expect(step.dead).toBeGreaterThanOrEqual(0)
    }
  })

  it('ends every break within 1/64 px of the plan, at the last break as at the first', () => {
    const drawn = quantiseRail(plan, EPS)
    let planned = 0
    let placed = 0
    for (const [k, step] of drawn.entries()) {
      planned += plan[k]!.run + plan[k]!.dead
      placed += step.run + step.dead
      expect(Math.abs(placed - planned)).toBeLessThanOrEqual(LAYOUT_UNIT / 2 + 1e-9)
    }
  })

  it('is what the plain heights are not: the same plan drawn with each height cut loses more than a pixel', () => {
    const naive = plan.flatMap((s) => [s.run + EPS, s.dead - EPS])
    const total = plan.reduce((sum, s) => sum + s.run + s.dead, 0)
    expect(total - dropped(naive)).toBeGreaterThan(1)
    const drawn = quantiseRail(plan, EPS).flatMap((s) => [s.run, s.dead])
    expect(Math.abs(total - dropped(drawn))).toBeLessThanOrEqual(LAYOUT_UNIT)
  })

  it('starts each dead zone later than the plan, never earlier', () => {
    let planned = 0
    let placed = 0
    for (const [k, step] of quantiseRail(plan, EPS).entries()) {
      const startPlanned = planned + plan[k]!.run
      expect(placed + step.run).toBeGreaterThanOrEqual(startPlanned + EPS - LAYOUT_UNIT)
      planned += plan[k]!.run + plan[k]!.dead
      placed += step.run + step.dead
    }
  })

  it('keeps a dead zone shorter than the allowance non-negative, and an empty rail empty', () => {
    expect(quantiseRail([{ run: 100, dead: 0.01 }], EPS)[0]!.dead).toBeGreaterThanOrEqual(0)
    expect(quantiseRail([], EPS)).toEqual([])
  })
})
