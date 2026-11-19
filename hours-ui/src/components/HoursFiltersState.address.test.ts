/**
 * My hours' address (specs/20261116-record-hours-in-place T19; plan § The address of My hours, decision 10; AC-5.1,
 * AC-5.2, AC-5.4, AC-5.22): one `view` parameter, `list` or the table view, with the table's week as the default —
 * `/hours` is the current week, `?week=<day>` another, `?view=list` the List, and the first contract's
 * `?view=week[&week=<day>]` still opens its week (read, never written). `view`, `week`, `month` are search params of
 * the page, none of them a filter; in the table view the controls it does not show (`period`, `from`, `to`, `group`)
 * neither count as "filtered" nor are reset by Clear filters (design G5).
 *
 * Today is Wednesday 2 December 2026 unless a case says otherwise: this week is Monday 30 November – Sunday 6 December,
 * a week that straddles two months. The other boundary days are the plan's: Sunday 1 November 2026 (the last day of a
 * week that is mostly October) and Tuesday 1 September 2026 (a week that begins in August).
 *
 * The month is not an address yet (T22 gives `TablePeriod` its second member): its keys are reserved, see the last block.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  applyFilterPatch,
  clearFilterSearch,
  isFiltered,
  readMyHoursAddress,
  withList,
  withTable,
  withTablePeriod,
} from './HoursFiltersState'
import { holding } from '../lib/tablePeriod'
import type { TablePeriod } from '../lib/tablePeriod'

const NO_PICKS = { project: null, deal: null }

const WEDNESDAY = '2026-12-02'
const THIS_MONDAY = '2026-11-30'
const week = (monday: string): TablePeriod => ({ kind: 'week', monday })
const table = (monday: string) => ({ view: 'table', period: week(monday) })

describe('readMyHoursAddress: no view is the table view, and no week the current week (AC-5.1, AC-5.4)', () => {
  it('/hours is the current week', () => {
    expect(readMyHoursAddress({}, WEDNESDAY)).toEqual(table(THIS_MONDAY))
  })

  it.each([
    ['a Monday', '2026-11-30'],
    ['a Sunday', '2026-12-06'],
    ['a Tuesday that begins a month', '2026-09-01'],
  ])('the current week when today is %s: Monday to Sunday of the week holding it', (_name, today) => {
    expect(readMyHoursAddress({}, today)).toEqual(table(holding('week', today).monday))
  })

  it('Sunday 1 November 2026 is in the week that began on Monday 26 October', () => {
    expect(readMyHoursAddress({}, '2026-11-01')).toEqual(table('2026-10-26'))
  })

  it('view=week without a week is the same: the first contract’s address, read and still opening its week', () => {
    expect(readMyHoursAddress({ view: 'week' }, WEDNESDAY)).toEqual(table(THIS_MONDAY))
  })
})

describe('readMyHoursAddress: a week named by any day of it (AC-5.2)', () => {
  it.each([
    ['a Monday', '2026-11-02', '2026-11-02'],
    ['a Wednesday', '2026-11-04', '2026-11-02'],
    ['a Sunday', '2026-11-08', '2026-11-02'],
    ['the Sunday that ends October’s week', '2026-11-01', '2026-10-26'],
  ])('?week=%s is the Monday of the week holding it', (_name, day, monday) => {
    expect(readMyHoursAddress({ week: day }, WEDNESDAY)).toEqual(table(monday))
  })

  it('?view=week&week=<day> is the same week (legacy, ADR first contract)', () => {
    expect(readMyHoursAddress({ view: 'week', week: '2026-11-04' }, WEDNESDAY)).toEqual(table('2026-11-02'))
  })

  it.each(['nope', '2026-02-30', '1999-12-27', '2026-1-5', '', 3, null, ['2026-11-04'], { week: '2026-11-04' }])(
    'a week that is not a real day (%j) is the current week: a pasted link never reaches the API as a refused request',
    (named) => {
      expect(readMyHoursAddress({ week: named }, WEDNESDAY)).toEqual(table(THIS_MONDAY))
    },
  )
})

describe('readMyHoursAddress: ?view=list is the List (AC-5.1, AC-5.2)', () => {
  it('opens the List, whatever else the address holds', () => {
    expect(readMyHoursAddress({ view: 'list' }, WEDNESDAY)).toEqual({ view: 'list' })
    expect(
      readMyHoursAddress({ view: 'list', week: '2026-11-04', period: 'lastMonth', target: 'deal' }, WEDNESDAY),
    ).toEqual({ view: 'list' })
  })

  it('is the List only for exactly "list": anything else lands on the table view, so a pasted link lands somewhere real', () => {
    for (const view of ['LIST', 'List', 'list ', '', 3, null, ['list'], { view: 'list' }, 'nope']) {
      expect(readMyHoursAddress({ view }, WEDNESDAY), String(view)).toEqual(table(THIS_MONDAY))
    }
  })

  it('an old List link without a view (/hours?period=lastMonth) opens the table view on the current week, its period kept for the List', () => {
    const search = { period: 'lastMonth', target: 'deal' }
    expect(readMyHoursAddress(search, WEDNESDAY)).toEqual(table(THIS_MONDAY))
    expect(search).toEqual({ period: 'lastMonth', target: 'deal' })
  })

  it('does not change the object it is given', () => {
    const search = { view: 'week', week: 'nope' }
    readMyHoursAddress(search, WEDNESDAY)
    expect(search).toEqual({ view: 'week', week: 'nope' })
  })
})

describe('withTablePeriod: the table view at a week, a default left out (AC-5.4, AC-5.5)', () => {
  it('another week is written as its Monday, every other key kept', () => {
    expect(withTablePeriod({ target: 'deal' }, week('2026-11-23'), WEDNESDAY)).toEqual({
      target: 'deal',
      week: '2026-11-23',
    })
    expect(withTablePeriod({ week: '2026-11-02' }, week('2026-12-07'), WEDNESDAY)).toEqual({ week: '2026-12-07' })
  })

  it('the current week is the default: it is taken out of the address, so a bookmark keeps meaning "the current week"', () => {
    expect(withTablePeriod({ week: '2026-11-23', target: 'deal' }, week(THIS_MONDAY), WEDNESDAY)).toEqual({
      target: 'deal',
    })
  })

  it('takes the first contract’s view=week out: the week is the default view now, and the address is rewritten only on a write', () => {
    expect(withTablePeriod({ view: 'week', week: '2026-11-02' }, week('2026-11-09'), WEDNESDAY)).toEqual({
      week: '2026-11-09',
    })
    expect(withTablePeriod({ view: 'week' }, week(THIS_MONDAY), WEDNESDAY)).toEqual({})
  })

  it('takes a month out of it: the week is the period shown', () => {
    expect(withTablePeriod({ view: 'month', month: '2026-10' }, week('2026-10-12'), WEDNESDAY)).toEqual({
      week: '2026-10-12',
    })
  })

  it('keeps the List’s period, dates and grouping, and every filter, untouched (design G5)', () => {
    const held = {
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      group: 'deal',
      target: 'deal',
      category: 'tc-1',
      workType: 'wt-1',
    }
    expect(withTablePeriod(held, week('2026-11-23'), WEDNESDAY)).toEqual({ ...held, week: '2026-11-23' })
  })

  it('does not change the object it is given', () => {
    const previous = { view: 'week', week: '2026-11-02' }
    withTablePeriod(previous, week('2026-11-09'), WEDNESDAY)
    expect(previous).toEqual({ view: 'week', week: '2026-11-02' })
  })
})

describe('withList and withTable: the switch between the views keeps what the person set (AC-5.1, AC-5.22)', () => {
  it('the List sets view=list, and keeps every other key: the week held for coming back included', () => {
    expect(withList({ week: '2026-11-02', category: 'tc-1', target: 'deal' })).toEqual({
      view: 'list',
      week: '2026-11-02',
      category: 'tc-1',
      target: 'deal',
    })
    expect(withList({})).toEqual({ view: 'list' })
  })

  it('the List replaces the first contract’s view=week, and takes a month out: the week was the period shown', () => {
    expect(withList({ view: 'week', week: '2026-11-02' })).toEqual({ view: 'list', week: '2026-11-02' })
    expect(withList({ view: 'month', month: '2026-10' })).toEqual({ view: 'list' })
  })

  it('the table view takes view out, and keeps every other key: the week held and the List’s own period', () => {
    expect(
      withTable({ view: 'list', week: '2026-11-02', period: 'lastMonth', target: 'deal', category: 'tc-1' }),
    ).toEqual({ week: '2026-11-02', period: 'lastMonth', target: 'deal', category: 'tc-1' })
    expect(withTable({ view: 'list' })).toEqual({})
  })

  it('List then the table view returns to the address it left: the current week, and a past week', () => {
    for (const left of [
      { target: 'deal' },
      { week: '2026-11-02', period: 'custom', from: '2026-10-01', to: '2026-10-09' },
    ]) {
      expect(withTable(withList(left)), JSON.stringify(left)).toEqual(left)
    }
  })

  it('and the week held in the address is the week shown when the person comes back', () => {
    const left = withTablePeriod({}, week('2026-11-02'), WEDNESDAY)
    expect(readMyHoursAddress(withTable(withList(left)), WEDNESDAY)).toEqual(table('2026-11-02'))
  })

  it('does not change the object it is given', () => {
    const previous = { view: 'list' }
    withTable(previous)
    expect(previous).toEqual({ view: 'list' })
    withList(previous)
    expect(previous).toEqual({ view: 'list' })
  })
})

describe('Clear filters keeps the view and the week (a view is not a filter)', () => {
  it('on the List it clears the filters and keeps view, week and Group by', () => {
    expect(
      clearFilterSearch({
        view: 'list',
        week: '2026-11-02',
        period: 'lastMonth',
        target: 'deal',
        category: 'tc-1',
        workType: 'wt-1',
        group: 'deal',
      }),
    ).toEqual({ view: 'list', week: '2026-11-02', group: 'deal' })
  })

  it('in the table view it clears only what the table shows: Recorded on, Category and Work type', () => {
    expect(
      clearFilterSearch(
        {
          week: '2026-11-02',
          period: 'custom',
          from: '2026-10-01',
          to: '2026-10-31',
          target: 'deal',
          category: 'tc-1',
          workType: 'wt-1',
          group: 'deal',
        },
        'table',
      ),
    ).toEqual({
      week: '2026-11-02',
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      group: 'deal',
    })
  })
})

describe('isFiltered: in the table view, period is not a filter (G5)', () => {
  const lastMonth = { ...DEFAULT_FILTERS, period: 'lastMonth' as const }

  it('a period other than the default is a filter of the List …', () => {
    expect(isFiltered(lastMonth, NO_PICKS)).toBe(true)
    expect(isFiltered(lastMonth, NO_PICKS, 'list')).toBe(true)
  })

  it('… and not of the table view, where its control is not there to clear', () => {
    expect(isFiltered(lastMonth, NO_PICKS, 'table')).toBe(false)
  })

  it('every control the table view shows counts in it', () => {
    expect(isFiltered({ ...DEFAULT_FILTERS, target: 'deal' }, NO_PICKS, 'table')).toBe(true)
    expect(isFiltered({ ...DEFAULT_FILTERS, categoryId: 'tc-1' }, NO_PICKS, 'table')).toBe(true)
    expect(isFiltered({ ...DEFAULT_FILTERS, workTypeId: 'wt-1' }, NO_PICKS, 'table')).toBe(true)
    expect(isFiltered(DEFAULT_FILTERS, { project: { id: 'p1' }, deal: null }, 'table')).toBe(true)
    expect(isFiltered(DEFAULT_FILTERS, { project: null, deal: { id: 'd1' } }, 'table')).toBe(true)
  })

  it('a period set while the table view shows does not make the other controls "unfiltered"', () => {
    expect(isFiltered({ ...lastMonth, target: 'project' }, NO_PICKS, 'table')).toBe(true)
  })
})

describe('applyFilterPatch keeps view and week', () => {
  it('a change of a filter writes its own key and leaves view and week as they are', () => {
    expect(applyFilterPatch({ view: 'list', week: '2026-11-02' }, { target: 'deal' })).toEqual({
      view: 'list',
      week: '2026-11-02',
      target: 'deal',
    })
    expect(applyFilterPatch({ week: '2026-11-02' }, { target: 'deal' })).toEqual({ week: '2026-11-02', target: 'deal' })
  })
})

describe('the month’s keys are reserved until T22 (plan § The address: ?view=month, ?view=month&month=<YYYY-MM>)', () => {
  // `TablePeriod` has no month yet. Until it does the keys are neither read nor written as a period: an address that names
  // one shows the current week, and nothing of it reaches a request. T22 replaces this block with the month's rows.
  it('?view=month and ?month= name no period yet: the current week shows', () => {
    expect(readMyHoursAddress({ view: 'month' }, WEDNESDAY)).toEqual(table(THIS_MONDAY))
    expect(readMyHoursAddress({ view: 'month', month: '2026-10' }, WEDNESDAY)).toEqual(table(THIS_MONDAY))
    expect(readMyHoursAddress({ month: '2026-10' }, WEDNESDAY)).toEqual(table(THIS_MONDAY))
  })
})
