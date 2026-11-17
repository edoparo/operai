/**
 * The "who" rule and the props of Record hours on the deal page (specs/20261116-record-hours-in-place
 * AC-2.1, AC-2.2; plan decisions 3 and 4, risk R10; ADR 20261116-record-hours-widget-through-the-host-extension-seam).
 * The rule decides only whether the button shows; hours-api decides every save.
 */
import { describe, expect, it } from 'vitest'
import { mayRecordOnDeal, recordHoursPropsOfDeal } from './recordHours'
import type { Deal, DealEstimate, PersonRef } from './types'

const person = (id: string, name = `Person ${id}`): PersonRef => ({ id, name, status: 'active' })

const estimate = (technical: PersonRef): DealEstimate => ({
  estimateId: 'e1',
  name: 'Estimate',
  technical,
  state: 'requested',
  requestedBy: person('u-requester'),
  requestedAt: '2026-11-01T10:00:00.000Z',
  readyAt: null,
})

const deal = (overrides: Partial<Deal> = {}): Deal => ({
  id: 'd1',
  title: 'Platform rebuild',
  company: { id: 'c1', name: 'Acme SA' },
  stage: 'proposal',
  entity: 'welld_ch',
  expectedCloseDate: null,
  owner: person('u-owner'),
  closedAt: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
  version: 1,
  estimateState: null,
  estimateOverridden: false,
  lostReason: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  estimate: null,
  estimateOverride: null,
  ...overrides,
})

describe('mayRecordOnDeal (AC-2.1, AC-2.2)', () => {
  it('is true for the deal’s owner', () => {
    expect(mayRecordOnDeal(deal(), 'u-owner')).toBe(true)
  })

  it('is true for the technical contact of the deal’s estimate', () => {
    const withEstimate = deal({ estimate: estimate(person('u-tech')) })
    expect(mayRecordOnDeal(withEstimate, 'u-tech')).toBe(true)
  })

  it('is false for someone who can only read the deal', () => {
    const withEstimate = deal({ estimate: estimate(person('u-tech')) })
    expect(mayRecordOnDeal(withEstimate, 'u-reader')).toBe(false)
  })

  it('is false for the requester of the estimate, who is neither owner nor technical contact', () => {
    const withEstimate = deal({ estimate: estimate(person('u-tech')) })
    expect(mayRecordOnDeal(withEstimate, 'u-requester')).toBe(false)
  })

  it('is false for a task assignee on the deal who is neither: the deal object does not even carry them (AC-2.2)', () => {
    // A person involved only through one of the deal's activities records from that task's row, never the page.
    expect(mayRecordOnDeal(deal(), 'u-assignee')).toBe(false)
  })

  it('is false when the deal has no estimate and the person is not the owner (no technical contact to match)', () => {
    expect(mayRecordOnDeal(deal({ estimate: null }), 'u-tech')).toBe(false)
  })

  it('is false while the session has not given the person’s id yet', () => {
    const withEstimate = deal({ estimate: estimate(person('u-tech')) })
    expect(mayRecordOnDeal(withEstimate, null)).toBe(false)
    expect(mayRecordOnDeal(withEstimate, '')).toBe(false)
  })

  it('never matches a missing owner or technical id against a missing person', () => {
    // A defensive case: an id the server did not send must not equal "no id yet".
    const odd = deal({ owner: { id: '', name: null, status: 'unknown' } })
    expect(mayRecordOnDeal(odd, '')).toBe(false)
    expect(mayRecordOnDeal(odd, null)).toBe(false)
  })
})

describe('recordHoursPropsOfDeal (AC-2.1, plan R10)', () => {
  it('gives the deal as {on:deal, id, title} with no task and the page placement', () => {
    expect(recordHoursPropsOfDeal(deal({ id: 'd7', title: 'Alpenstrom portal' }))).toEqual({
      on: 'deal',
      targetId: 'd7',
      targetName: 'Alpenstrom portal',
      activityId: '',
      activityName: '',
      placement: 'page',
    })
  })

  it('takes the id and the title from the same deal, so the name shown is the id recorded on (R10)', () => {
    const first = deal({ id: 'd-first', title: 'First deal' })
    const second = deal({ id: 'd-second', title: 'Second deal' })
    for (const d of [first, second]) {
      const props = recordHoursPropsOfDeal(d)
      expect(props.targetId).toBe(d.id)
      expect(props.targetName).toBe(d.title)
    }
  })

  it('says "" for a deal whose title is empty, never an id (the widget words it "this deal")', () => {
    expect(recordHoursPropsOfDeal(deal({ id: 'd1', title: '' })).targetName).toBe('')
  })
})
