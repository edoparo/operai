/**
 * tablePeriod — what differs by period in the table view of My hours, for the week (specs/20261116-record-hours-in-place
 * T18, T20; plan § `TablePeriod`, decisions 8, 9 and 12; AC-5.3, AC-5.4, AC-5.5, AC-5.28, AC-5.29). Pure arithmetic on `YYYY-MM-DD`: "today" is
 * passed in (`todayZurich()` in the app), never read here, so each case names its day. The boundary days are the ones the
 * plan names: Sunday 1 November 2026 (the last day of a week that is mostly October), the week Monday 30 November –
 * Sunday 6 December 2026 (it straddles two months) and Tuesday 1 September 2026 (a week that begins in August).
 */
import { describe, expect, it } from 'vitest'
import {
  clamp,
  current,
  daysOf,
  firstDayOf,
  hasNext,
  hasPrevious,
  holding,
  isCurrent,
  lastDayOf,
  referenceDay,
  shift,
} from './tablePeriod'
import type { TablePeriod } from './tablePeriod'
import { weekDays } from './week'

const week = (monday: string): TablePeriod => ({ kind: 'week', monday })

// 2026-11-01 is a Sunday, 2026-11-30 a Monday, 2026-09-01 a Tuesday.
const SUNDAY_1_NOV = '2026-11-01'
const MONDAY_30_NOV = '2026-11-30'
const TUESDAY_1_SEP = '2026-09-01'

describe('holding: the week a day is in, whichever day of it that is (AC-5.4)', () => {
  it('is the Monday of the week, for a Monday, a middle day and a Sunday', () => {
    expect(holding('week', MONDAY_30_NOV)).toEqual(week('2026-11-30'))
    expect(holding('week', '2026-12-02')).toEqual(week('2026-11-30'))
    expect(holding('week', '2026-12-06')).toEqual(week('2026-11-30'))
  })

  it('puts Sunday 1 November 2026 in the week that began on Monday 26 October', () => {
    expect(holding('week', SUNDAY_1_NOV)).toEqual(week('2026-10-26'))
  })

  it('puts Tuesday 1 September 2026 in the week that began on Monday 31 August', () => {
    expect(holding('week', TUESDAY_1_SEP)).toEqual(week('2026-08-31'))
  })

  it('refuses text that is not a day: a caller bug, never a week', () => {
    expect(() => holding('week', '2026-02-30')).toThrow(TypeError)
    expect(() => holding('week', '')).toThrow(TypeError)
  })
})

describe('daysOf, firstDayOf, lastDayOf: the days a week reads (AC-5.3, AC-5.4)', () => {
  it('is seven days, Monday to Sunday, the first and the last being the period`s span', () => {
    const days = daysOf(week('2026-11-16'))
    expect(days).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ])
    expect(firstDayOf(week('2026-11-16'))).toBe('2026-11-16')
    expect(lastDayOf(week('2026-11-16'))).toBe('2026-11-22')
  })

  it('runs from Monday 30 November into December without a gap, the Sunday being the 6th', () => {
    expect(daysOf(week(MONDAY_30_NOV))).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ])
    expect(firstDayOf(week(MONDAY_30_NOV))).toBe('2026-11-30')
    expect(lastDayOf(week(MONDAY_30_NOV))).toBe('2026-12-06')
  })

  it('ends on Sunday 1 November 2026 for the week before it, which began in October', () => {
    expect(firstDayOf(week('2026-10-26'))).toBe('2026-10-26')
    expect(lastDayOf(week('2026-10-26'))).toBe(SUNDAY_1_NOV)
  })

  it('is the days `week.ts` gives, so the read, the fold and the columns agree on one week', () => {
    expect(daysOf(week('2026-08-31'))).toEqual(weekDays('2026-08-31'))
  })

  it('refuses a "monday" that is not a Monday: the span it would read is not the week that was named', () => {
    const wednesday = week('2026-11-18')
    expect(() => daysOf(wednesday)).toThrow(TypeError)
    expect(() => firstDayOf(wednesday)).toThrow(TypeError)
    expect(() => lastDayOf(wednesday)).toThrow(TypeError)
  })
})

describe('current and isCurrent: the week holding today (AC-5.4, AC-5.5)', () => {
  it('is the week holding today, for today a Monday, a Sunday and a Tuesday', () => {
    expect(current('week', MONDAY_30_NOV)).toEqual(week('2026-11-30'))
    expect(current('week', SUNDAY_1_NOV)).toEqual(week('2026-10-26'))
    expect(current('week', TUESDAY_1_SEP)).toEqual(week('2026-08-31'))
  })

  it('knows every day of the week holding today, the Monday and the Sunday included, and no day of its neighbours', () => {
    const shown = week('2026-11-30')
    expect(isCurrent(shown, '2026-11-30')).toBe(true)
    expect(isCurrent(shown, '2026-12-03')).toBe(true)
    expect(isCurrent(shown, '2026-12-06')).toBe(true)
    expect(isCurrent(shown, '2026-11-29')).toBe(false)
    expect(isCurrent(shown, '2026-12-07')).toBe(false)
  })

  it('reads a week that holds only a day of last month as the current one when today is that day', () => {
    // Sunday 1 November: the week of Monday 26 October is the one in progress, not the week of Monday 2 November.
    expect(isCurrent(week('2026-10-26'), SUNDAY_1_NOV)).toBe(true)
    expect(isCurrent(week('2026-11-02'), SUNDAY_1_NOV)).toBe(false)
  })

  it('refuses a period that is not a week, and a today that is not a day: caller bugs', () => {
    expect(() => isCurrent(week('2026-11-18'), SUNDAY_1_NOV)).toThrow(TypeError)
    expect(() => isCurrent(week('2026-11-16'), 'today')).toThrow(TypeError)
    expect(() => current('week', '')).toThrow(TypeError)
  })
})

describe('shift: the previous and the next week (AC-5.5)', () => {
  it('moves a whole number of weeks, back and forth, from the week shown and not from today', () => {
    expect(shift(week('2026-11-16'), 1)).toEqual(week('2026-11-23'))
    expect(shift(week('2026-11-16'), -1)).toEqual(week('2026-11-09'))
    expect(shift(week('2026-11-16'), 3)).toEqual(week('2026-12-07'))
    expect(shift(week('2026-11-16'), 0)).toEqual(week('2026-11-16'))
  })

  it('crosses a month, from the week that straddles two, and a year', () => {
    expect(shift(week(MONDAY_30_NOV), 1)).toEqual(week('2026-12-07'))
    expect(shift(week(MONDAY_30_NOV), -1)).toEqual(week('2026-11-23'))
    expect(shift(week('2026-12-28'), 1)).toEqual(week('2027-01-04'))
    expect(shift(week('2027-01-04'), -1)).toEqual(week('2026-12-28'))
  })

  it('steps over the week that ends on Sunday 1 November 2026 and the one that begins in August', () => {
    expect(shift(week('2026-10-26'), 1)).toEqual(week('2026-11-02'))
    expect(shift(week('2026-08-31'), -1)).toEqual(week('2026-08-24'))
  })

  it('does not touch the period it was given', () => {
    const shown = week('2026-11-16')
    shift(shown, 1)
    expect(shown).toEqual(week('2026-11-16'))
  })

  it('refuses a fraction of a week and a period that is not a week: caller bugs', () => {
    expect(() => shift(week('2026-11-16'), 0.5)).toThrow(TypeError)
    expect(() => shift(week('2026-11-18'), 1)).toThrow(TypeError)
  })
})

describe('referenceDay: the day the date field shows for a week (AC-5.30, plan § `TablePeriod`)', () => {
  it('is today in the current week, whichever day of it today is', () => {
    expect(referenceDay(week('2026-11-30'), '2026-12-02')).toBe('2026-12-02')
    expect(referenceDay(week('2026-11-30'), MONDAY_30_NOV)).toBe(MONDAY_30_NOV)
    expect(referenceDay(week('2026-10-26'), SUNDAY_1_NOV)).toBe(SUNDAY_1_NOV)
  })

  it('is the Monday of any other week: a past one is shown by its first day', () => {
    expect(referenceDay(week('2026-11-23'), '2026-12-02')).toBe('2026-11-23')
    expect(referenceDay(week('2026-08-24'), TUESDAY_1_SEP)).toBe('2026-08-24')
    expect(referenceDay(week('2026-10-26'), '2026-11-02')).toBe('2026-10-26')
  })

  it('is today again for the week that begins in August once today is its Tuesday 1 September', () => {
    expect(referenceDay(week('2026-08-31'), TUESDAY_1_SEP)).toBe(TUESDAY_1_SEP)
  })
})

describe('hasNext: the next week exists only while the week shown is before the current one (AC-5.5, AC-5.28)', () => {
  it('is false in the current week, whichever day of it today is', () => {
    expect(hasNext(week('2026-11-30'), MONDAY_30_NOV)).toBe(false)
    expect(hasNext(week('2026-11-30'), '2026-12-02')).toBe(false)
    expect(hasNext(week('2026-11-30'), '2026-12-06')).toBe(false)
    expect(hasNext(week('2026-10-26'), SUNDAY_1_NOV)).toBe(false)
  })

  it('is true in any week before the current one, the week just before it included', () => {
    expect(hasNext(week('2026-11-23'), '2026-12-02')).toBe(true)
    expect(hasNext(week('2026-10-26'), '2026-11-02')).toBe(true)
    expect(hasNext(week('2026-08-24'), TUESDAY_1_SEP)).toBe(true)
    expect(hasNext(week('2000-01-03'), '2026-11-18')).toBe(true)
  })

  it('is false in a week after the current one, which no address can show (AC-5.29)', () => {
    expect(hasNext(week('2026-12-07'), '2026-12-02')).toBe(false)
    expect(hasNext(week('9999-12-20'), '2026-11-18')).toBe(false)
  })

  it('moves with today: the week that was current yesterday has a next the day the new week begins', () => {
    expect(hasNext(week('2026-11-23'), '2026-11-29')).toBe(false) // a Sunday
    expect(hasNext(week('2026-11-23'), '2026-11-30')).toBe(true) // the Monday after
  })

  it('refuses a period that is not a week, and a today that is not a day: caller bugs', () => {
    expect(() => hasNext(week('2026-11-18'), SUNDAY_1_NOV)).toThrow(TypeError)
    expect(() => hasNext(week('2026-11-16'), 'today')).toThrow(TypeError)
  })
})

describe('hasPrevious: the previous week exists down to the first day hours-api takes (plan decision 12)', () => {
  it('is true while the week before begins on or after 2000-01-01', () => {
    expect(hasPrevious(week('2026-11-16'))).toBe(true)
    expect(hasPrevious(week('2000-01-10'))).toBe(true) // the week before is Monday 3 January 2000
  })

  it('is false on the first week an address accepts: Monday 3 January 2000, whose week before began in 1999', () => {
    // 2000-01-01 is a Saturday: the week holding it began on Monday 27 December 1999, before the floor, so the first Monday
    // an address accepts is 3 January 2000 (`readWeekParam`).
    expect(hasPrevious(week('2000-01-03'))).toBe(false)
  })

  it('refuses a period that is not a week: a caller bug', () => {
    expect(() => hasPrevious(week('2026-11-18'))).toThrow(TypeError)
  })
})

describe('clamp: a period after the current one is the current one (AC-5.29)', () => {
  it('leaves the current week and every week before it as they are', () => {
    expect(clamp(week('2026-11-30'), '2026-12-02')).toEqual(week('2026-11-30'))
    expect(clamp(week('2026-11-23'), '2026-12-02')).toEqual(week('2026-11-23'))
    expect(clamp(week('2000-01-03'), '2026-12-02')).toEqual(week('2000-01-03'))
  })

  it('gives the current week for the next one, for a week long after, and at the end of the calendar', () => {
    expect(clamp(week('2026-12-07'), '2026-12-02')).toEqual(week('2026-11-30'))
    expect(clamp(week('2027-06-07'), '2026-12-02')).toEqual(week('2026-11-30'))
    expect(clamp(week('9999-12-20'), '2026-12-02')).toEqual(week('2026-11-30'))
  })

  it('moves with today: a Sunday still holds the week that began six days before, the Monday after does not', () => {
    expect(clamp(week('2026-11-30'), '2026-11-29')).toEqual(week('2026-11-23'))
    expect(clamp(week('2026-11-30'), '2026-11-30')).toEqual(week('2026-11-30'))
  })

  it('does not touch the period it was given', () => {
    const shown = week('2026-12-07')
    clamp(shown, '2026-12-02')
    expect(shown).toEqual(week('2026-12-07'))
  })

  it('refuses a period that is not a week, and a today that is not a day: caller bugs', () => {
    expect(() => clamp(week('2026-11-18'), '2026-12-02')).toThrow(TypeError)
    expect(() => clamp(week('2026-11-16'), 'today')).toThrow(TypeError)
  })
})
