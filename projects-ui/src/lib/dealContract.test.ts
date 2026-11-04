import { describe, expect, it } from 'vitest'
import { emptyTermsForm } from './contractTerms'
import type { TermsForm } from './contractTerms'
import { dealContractOf } from './dealContract'

const fixedPriceForm = (over: Partial<TermsForm> = {}): TermsForm => ({
  ...emptyTermsForm('fixed_price'),
  deadline: '2026-12-01',
  maxEffortManDays: '40',
  ...over,
})

describe('dealContractOf', () => {
  it('builds the contract of a take: dates, and the terms of the project type', () => {
    const { input, errors } = dealContractOf(
      'fixed_price',
      { startDate: '2026-11-01', endDate: '', terms: fixedPriceForm({ estimatedManDays: '12.5' }) },
      { estimateBacked: false },
    )
    expect(errors).toEqual({})
    expect(input).toEqual({
      startDate: '2026-11-01',
      terms: { deadline: '2026-12-01', estimatedManDays: 12.5, maxEffortManDays: 40 },
    })
  })

  it('sends the end date only when there is one', () => {
    const { input } = dealContractOf(
      'fixed_price',
      { startDate: '2026-11-01', endDate: '2027-01-31', terms: fixedPriceForm() },
      { estimateBacked: false },
    )
    expect(input.endDate).toBe('2027-01-31')
  })

  it('leaves estimatedManDays out entirely for a fixed-price contract the estimate backs: the server refuses it sent (AC-3.1)', () => {
    const { input, errors } = dealContractOf(
      'fixed_price',
      { startDate: '2026-11-01', endDate: '', terms: fixedPriceForm({ estimatedManDays: '99' }) },
      { estimateBacked: true },
    )
    expect(errors).toEqual({})
    expect(input.terms).toEqual({ deadline: '2026-12-01', maxEffortManDays: 40 })
    expect('estimatedManDays' in input.terms).toBe(false)
  })

  it('keeps the other types’ terms as they are even when an estimate backs the deal', () => {
    const { input } = dealContractOf(
      't_and_m',
      {
        startDate: '2026-11-01',
        endDate: '',
        terms: { ...emptyTermsForm('t_and_m'), positions: [{ profile: 'Developer', plannedManDays: '20' }] },
      },
      { estimateBacked: true },
    )
    expect(input.terms).toEqual({ positions: [{ profile: 'Developer', plannedManDays: 20 }] })
  })

  it('asks for a start date, an end date not before it, and the terms of the type', () => {
    const missing = dealContractOf(
      'fixed_price',
      { startDate: '', endDate: '', terms: emptyTermsForm('fixed_price') },
      { estimateBacked: false },
    )
    expect(Object.keys(missing.errors).sort()).toEqual(['startDate', 'terms.deadline', 'terms.maxEffortManDays'])

    const reversed = dealContractOf(
      'fixed_price',
      { startDate: '2026-11-01', endDate: '2026-10-01', terms: fixedPriceForm() },
      { estimateBacked: false },
    )
    expect(reversed.errors).toEqual({ endDate: 'The end date must not be before the start date.' })
  })
})
