/**
 * The Week view in My hours' address (specs/20261116-record-hours-in-place T10; plan § My hours' address, Decision
 * 5; design S6 "Filters card in the Week", G5): `view` and `week` are search params of the page, neither is a filter,
 * and in the Week the controls the Week does not show (`period`, `from`, `to`, `group`) neither count as "filtered"
 * nor are reset by Clear filters.
 */
import { describe, expect, it } from 'vitest'
import { applyFilterPatch, clearFilterSearch, isFiltered, readView, withView, withWeek } from './HoursFiltersState'
import { DEFAULT_FILTERS } from './HoursFiltersState'

const NO_PICKS = { project: null, deal: null }

describe('readView: ?view=week is the Week, anything else is the List (AC-5.1, AC-5.2)', () => {
  it('has no view: the List', () => {
    expect(readView({})).toBe('list')
  })

  it('reads week', () => {
    expect(readView({ view: 'week' })).toBe('week')
  })

  it('reads anything else as the List: a pasted link never lands on a view that does not exist', () => {
    for (const view of ['list', 'WEEK', 'month', '', 'week ', 3, null, ['week'], { view: 'week' }]) {
      expect(readView({ view }), String(view)).toBe('list')
    }
  })
})

describe('withView: the address of a view, a default left out (AC-5.1, AC-5.2)', () => {
  it('the Week sets view=week and keeps every other key', () => {
    expect(withView({ target: 'deal', period: 'lastMonth' }, 'week')).toEqual({
      target: 'deal',
      period: 'lastMonth',
      view: 'week',
    })
  })

  it('the List leaves view out, and keeps every other key, the week held for coming back included', () => {
    expect(withView({ view: 'week', week: '2026-11-02', category: 'tc-1' }, 'list')).toEqual({
      week: '2026-11-02',
      category: 'tc-1',
    })
  })

  it('does not change the object it is given', () => {
    const previous = { view: 'week' }
    withView(previous, 'list')
    expect(previous).toEqual({ view: 'week' })
  })
})

describe('withWeek: the week in the address, this week left out (AC-5.4, AC-5.5)', () => {
  // 2026-11-13 is a Friday: this week is Monday 9 – Sunday 15 November.
  const TODAY = '2026-11-13'

  it('another week is written as its Monday, every other key kept', () => {
    expect(withWeek({ view: 'week', target: 'deal' }, '2026-11-02', TODAY)).toEqual({
      view: 'week',
      target: 'deal',
      week: '2026-11-02',
    })
    expect(withWeek({ view: 'week' }, '2026-11-16', TODAY)).toEqual({ view: 'week', week: '2026-11-16' })
  })

  it('this week is the default: it is taken out of the address, so a bookmark keeps meaning "the current week"', () => {
    expect(withWeek({ view: 'week', week: '2026-11-02' }, '2026-11-09', TODAY)).toEqual({ view: 'week' })
  })

  it('does not change the object it is given', () => {
    const previous = { week: '2026-11-02' }
    withWeek(previous, '2026-11-09', TODAY)
    expect(previous).toEqual({ week: '2026-11-02' })
  })
})

describe('Clear filters keeps the view and the week (a view is not a filter)', () => {
  it('on the List it clears the filters and keeps view, week and Group by', () => {
    expect(
      clearFilterSearch({
        view: 'week',
        week: '2026-11-02',
        period: 'lastMonth',
        target: 'deal',
        category: 'tc-1',
        workType: 'wt-1',
        group: 'deal',
      }),
    ).toEqual({ view: 'week', week: '2026-11-02', group: 'deal' })
  })

  it('in the Week it clears only what the Week shows: Recorded on, Category and Work type', () => {
    expect(
      clearFilterSearch(
        {
          view: 'week',
          week: '2026-11-02',
          period: 'custom',
          from: '2026-10-01',
          to: '2026-10-31',
          target: 'deal',
          category: 'tc-1',
          workType: 'wt-1',
          group: 'deal',
        },
        'week',
      ),
    ).toEqual({
      view: 'week',
      week: '2026-11-02',
      period: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      group: 'deal',
    })
  })
})

describe('isFiltered: in the Week, period is not a filter (G5)', () => {
  const lastMonth = { ...DEFAULT_FILTERS, period: 'lastMonth' as const }

  it('a period other than the default is a filter of the List …', () => {
    expect(isFiltered(lastMonth, NO_PICKS)).toBe(true)
    expect(isFiltered(lastMonth, NO_PICKS, 'list')).toBe(true)
  })

  it('… and not of the Week, where its control is not there to clear', () => {
    expect(isFiltered(lastMonth, NO_PICKS, 'week')).toBe(false)
  })

  it('every control the Week shows counts in the Week', () => {
    expect(isFiltered({ ...DEFAULT_FILTERS, target: 'deal' }, NO_PICKS, 'week')).toBe(true)
    expect(isFiltered({ ...DEFAULT_FILTERS, categoryId: 'tc-1' }, NO_PICKS, 'week')).toBe(true)
    expect(isFiltered({ ...DEFAULT_FILTERS, workTypeId: 'wt-1' }, NO_PICKS, 'week')).toBe(true)
    expect(isFiltered(DEFAULT_FILTERS, { project: { id: 'p1' }, deal: null }, 'week')).toBe(true)
    expect(isFiltered(DEFAULT_FILTERS, { project: null, deal: { id: 'd1' } }, 'week')).toBe(true)
  })

  it('a period set while the Week shows does not make the other controls "unfiltered"', () => {
    expect(isFiltered({ ...lastMonth, target: 'project' }, NO_PICKS, 'week')).toBe(true)
  })
})

describe('applyFilterPatch keeps view and week', () => {
  it('a change of a filter writes its own key and leaves view and week as they are', () => {
    expect(applyFilterPatch({ view: 'week', week: '2026-11-02' }, { target: 'deal' })).toEqual({
      view: 'week',
      week: '2026-11-02',
      target: 'deal',
    })
  })
})
