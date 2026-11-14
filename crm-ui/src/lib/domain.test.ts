import { describe, expect, it } from 'vitest'
import { fromLocalDateTimeInput, isOverdue, todayIso, toLocalDateTimeInput } from './dates'
import { centsToInput, formatTotals, weightedCents } from './money'
import { personName } from './people'
import { isHttpUrl } from './validate'
import { COMPANY_STATUS_MEANING, DEAL_STAGE_MEANING, TASK_STATE_MEANING } from './statusMeanings'
import { COMPANY_STATUSES, DEAL_STAGES, isOpenStage } from './types'

describe('status dictionary (INC-23, plan.md § UI)', () => {
  it('maps every company status and stage to one meaning', () => {
    expect(Object.keys(COMPANY_STATUS_MEANING).sort()).toEqual([...COMPANY_STATUSES].sort())
    expect(Object.keys(DEAL_STAGE_MEANING).sort()).toEqual([...DEAL_STAGES].sort())
  })

  it('uses the meanings the plan fixes', () => {
    expect(COMPANY_STATUS_MEANING).toEqual({ prospect: 'pending', customer: 'active', former: 'voided' })
    expect(DEAL_STAGE_MEANING.lead).toBe('draft')
    expect(DEAL_STAGE_MEANING.won).toBe('settled')
    expect(DEAL_STAGE_MEANING.lost).toBe('failed')
    expect(TASK_STATE_MEANING).toEqual({ open: 'pending', overdue: 'attention', blocked: 'pending', done: 'settled' })
  })

  it('only the first four stages are open', () => {
    expect(DEAL_STAGES.filter(isOpenStage)).toEqual(['lead', 'qualified', 'proposal', 'negotiation'])
  })
})

describe('money (D-9)', () => {
  it('weights once with round half up', () => {
    expect(weightedCents(1000, 25)).toBe(250)
    expect(weightedCents(1, 50)).toBe(1) // 0.5 → 1
    expect(weightedCents(3, 10)).toBe(0) // 0.3 → 0
    expect(weightedCents(5, 10)).toBe(1) // 0.5 → 1
    expect(weightedCents(123456, 75)).toBe(92592)
    expect(weightedCents(999, 0)).toBe(0)
  })

  it('formats per-currency totals, never summing currencies', () => {
    const totals = formatTotals(
      [
        { currency: 'EUR', amountCents: 100, weightedCents: 50 },
        { currency: 'CHF', amountCents: 200, weightedCents: 20 },
      ],
      'amountCents',
    )
    expect(totals).toHaveLength(2)
    expect(totals[0]).toContain('CHF')
    expect(totals[1]).toContain('EUR')
  })

  it('turns cents back into editable text', () => {
    expect(centsToInput(4500050)).toBe('45000.50')
    expect(centsToInput(4500000)).toBe('45000')
    expect(centsToInput(5)).toBe('0.05')
  })
})

describe('dates', () => {
  it('flags an open task due before today, never a done one or one without a date', () => {
    expect(isOverdue({ dueDate: '2026-10-31', completedAt: null }, '2026-11-01')).toBe(true)
    expect(isOverdue({ dueDate: '2026-11-01', completedAt: null }, '2026-11-01')).toBe(false)
    expect(isOverdue({ dueDate: '2026-10-01', completedAt: '2026-10-02T00:00:00Z' }, '2026-11-01')).toBe(false)
    expect(isOverdue({ dueDate: null, completedAt: null }, '2026-11-01')).toBe(false)
  })

  it('round-trips a datetime-local value', () => {
    const now = new Date(2026, 10, 1, 9, 30)
    expect(todayIso(now)).toBe('2026-11-01')
    expect(fromLocalDateTimeInput(toLocalDateTimeInput(now))).toBe(now.toISOString())
    expect(fromLocalDateTimeInput('nope')).toBeNull()
  })
})

describe('personName (ADR 20260807-live-identity-resolution-by-id-fail-soft)', () => {
  it('shows the live name of an active user and never a stale one', () => {
    expect(personName({ id: 'u1', name: 'Ada', status: 'active' })).toBe('Ada')
    expect(personName({ id: 'u1', name: 'Ada', status: 'active' }, 'u1')).toBe('Ada (You)')
    expect(personName({ id: 'u2', name: null, status: 'deleted' })).toBe('Deleted user')
    expect(personName({ id: 'u3', name: null, status: 'unknown' })).toBe('Unknown user')
    expect(personName({ id: 'system:x', name: null, status: 'system' })).toBe('System')
  })
})

describe('isHttpUrl (OWASP review: website href)', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://welld.ch')).toBe(true)
    expect(isHttpUrl('http://example.com/a')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,x')).toBe(false)
    expect(isHttpUrl('//evil.example')).toBe(false)
  })
})
