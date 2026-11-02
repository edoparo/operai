import { describe, expect, it } from 'vitest'
import { computeRelease } from './useEstimator'
import type { Activity, Parameters, Release } from '../types'

/**
 * Shared vectors with crm-api's `src/offers/timeline.ts` (specs/020 D-13): the
 * offer's {timeline} table mirrors the `best`/`worst` elapsed days of
 * `computeRelease`. crm-api/src/offers/timeline.test.ts asserts the SAME
 * numbers from the same inputs — if the elapsed chain changes here, change
 * both together.
 */
const act = (o: number, ml: number, p: number, risk = 0): Activity => ({
  id: 'a',
  num: '1',
  epic: 'E',
  act: 'A',
  prof: 'Backend Dev',
  o,
  ml,
  p,
  risk,
  notes: '',
  release: 'R',
})
const release = (fte: number): Release => ({ id: 'r', name: 'R', fte })
const params = (over: Partial<Parameters> = {}): Parameters => ({
  parallelism: 0.7,
  sprintDays: 10,
  workingDaysMonth: 20,
  qaDeployDays: 0,
  qaTestDays: 0,
  pmDays: 0,
  aiCostCoef: 10,
  aiGain: 0.3,
  ...over,
})

describe('elapsed-chain vectors shared with crm-api timeline.ts', () => {
  it('vector 1: 2 FTE, QA and PM overhead', () => {
    const acts = [act(2, 4, 9, 0.5), act(3, 5, 8), act(10, 20, 40, 2)]
    const result = computeRelease(acts, release(2), params({ qaDeployDays: 1, qaTestDays: 1, pmDays: 2 }))!
    expect({ best: result.best, worst: result.worst }).toEqual({ best: 14, worst: 42 })
  })

  it('vector 2: one FTE, no parallelism effect', () => {
    const result = computeRelease([act(5, 10, 20, 1), act(1, 2, 3)], release(1), params())!
    expect({ best: result.best, worst: result.worst }).toEqual({ best: 7, worst: 24 })
  })

  it('vector 3: 3 FTE, parallelism 0.5, sprint 5, 21 working days', () => {
    const acts = [act(20, 30, 50, 3), act(15, 25, 45), act(8, 12, 20, 1)]
    const result = computeRelease(acts, release(3), params({ parallelism: 0.5, sprintDays: 5, workingDaysMonth: 21 }))!
    expect({ best: result.best, worst: result.worst }).toEqual({ best: 34, worst: 85 })
  })

  it('vector 4: parameters left out fall back to 0.7 / 10 / 20 and one FTE', () => {
    const result = computeRelease([act(10, 20, 30)], release(0), {} as Parameters)!
    expect({ best: result.best, worst: result.worst }).toEqual({ best: 10, worst: 30 })
  })
})
