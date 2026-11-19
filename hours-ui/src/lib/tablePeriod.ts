/**
 * tablePeriod — everything that differs by period in the table view of My hours (specs/20261116-record-hours-in-place
 * T18; plan § `TablePeriod`, decisions 8 and 9; AC-5.3, AC-5.4, AC-5.5): the days a period reads and draws, the period
 * holding a day, the current one, the previous and the next, and the day the date field shows. The fold (`tableGrid`),
 * the card (`TableView`), the cell dialog and the page take a `TablePeriod` and know nothing else about how one kind
 * differs from another.
 *
 * Only the week is written so far: the month, `switchTo` and the date field's bounds arrive with the tasks that need
 * them (T22, T23), as further members of the union and further functions of this module. The availability of the
 * previous and the next period and the clamp to today (T20) are written here for the week and say nothing a month
 * cannot say: each is a comparison of first days, which is how the month joins them.
 *
 * Like `week.ts` and `period.ts`, everything is arithmetic on days written `YYYY-MM-DD`, done in UTC on the date alone,
 * so a time zone or a daylight-saving change cannot move a day, and "today" is never read here: the caller passes
 * `todayZurich()`. A caller bug (a `monday` that is not a Monday, a `today` that is not a day, a fractional `n`) is a
 * `TypeError`, as in `week.ts`.
 */
import { MIN_DAY } from './period'
import { mondayOf, shiftWeek, weekDays } from './week'

export type TablePeriodKind = 'week'

/** What the table view shows: a week, by its Monday (`YYYY-MM-DD`, always a Monday). */
export type TablePeriod = { kind: 'week'; monday: string }

/** The days of the period, consecutive and ascending: seven for a week, Monday first (AC-5.3). */
export const daysOf = (period: TablePeriod): string[] => weekDays(period.monday)

/** The period's first day: what a read asks `from` (AC-5.4). */
export const firstDayOf = (period: TablePeriod): string => daysOf(period)[0]!

/** The period's last day: what a read asks `to` (AC-5.4). */
export const lastDayOf = (period: TablePeriod): string => daysOf(period).at(-1)!

/** The period of `kind` that holds `day`, whichever day of it that is (AC-5.30). */
export const holding = (_kind: TablePeriodKind, day: string): TablePeriod => ({ kind: 'week', monday: mondayOf(day) })

/** The period of `kind` holding today: where My hours opens (AC-5.4) and what "This week" returns to (AC-5.5). */
export const current = (kind: TablePeriodKind, today: string): TablePeriod => holding(kind, today)

/** Whether `period` is the one holding today. */
export const isCurrent = (period: TablePeriod, today: string): boolean =>
  firstDayOf(period) === current(period.kind, today).monday

/**
 * The period `n` whole periods after `period` (negative: before): the navigator's previous (-1) and next (+1) (AC-5.5).
 * A week outside the calendar the format can write is a `RangeError`, as `shiftWeek` says.
 */
export const shift = (period: TablePeriod, n: number): TablePeriod => ({
  kind: 'week',
  monday: shiftWeek(period.monday, n),
})

/**
 * The day the date field shows for `period` (AC-5.30): today while the period holds it, else the period's first day. It
 * is what the address says, never what was just picked, so the field keeps no state of its own.
 */
export const referenceDay = (period: TablePeriod, today: string): string =>
  isCurrent(period, today) ? today : firstDayOf(period)

/**
 * Whether the period after `period` can be shown: only while `period` is before the current one (AC-5.5, AC-5.28). The
 * future is not browsed, so the navigator's Next is unavailable on the current period and nothing asks for one after it.
 */
export const hasNext = (period: TablePeriod, today: string): boolean =>
  firstDayOf(period) < firstDayOf(current(period.kind, today))

/**
 * Whether the period before `period` can be shown: while it begins on or after `MIN_DAY`, the first day hours-api answers
 * for (plan decision 12). A defensive rule no AC asks for: the navigator never writes an address the reader would refuse.
 */
export const hasPrevious = (period: TablePeriod): boolean => firstDayOf(shift(period, -1)) >= MIN_DAY

/**
 * `period`, or the current period of its kind when it is after it (AC-5.29): an address naming the future shows the
 * present, with Next unavailable. The same rule `readWeekParam` applies to a `week` in an address, for a period that is
 * already made.
 */
export const clamp = (period: TablePeriod, today: string): TablePeriod => {
  const now = current(period.kind, today)
  return firstDayOf(period) > firstDayOf(now) ? now : period
}
