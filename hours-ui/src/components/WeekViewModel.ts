/**
 * WeekViewModel — what the Week view says about a week and about a row (specs/20261116-record-hours-in-place T9;
 * design S7; AC-5.5, AC-5.23). Pure functions, so the component stays markup.
 *
 * A row is named by the List's own functions (`lib/names.ts`: `rowName`, `onPhrase`), fed an `EntryOn` made from
 * the row, so a project the viewer may not read is "Not visible to you" here exactly as it is in the List and in the
 * export, and no second copy of that rule can drift. The row carries no link and no id (design G6).
 */
import { formatDate, formatDateLong } from '@operai/ui'
import type { EntryOn } from '../lib/hoursApi.types'
import { onPhrase, rowName } from '../lib/names'
import { weekDays } from '../lib/week'
import type { WeekCell, WeekGrid, WeekRow } from '../lib/weekGrid'
import { strings } from '../strings'

/**
 * The week as two `formatDate`s with an en dash, "16.11.2026 – 22.11.2026" (AC-5.5): the card's heading, the
 * table's caption and the sentence read when a week arrives. The Sunday is the seventh day of the week, never a
 * date built by hand, so a week that crosses a month or a year reads right.
 */
export const weekRange = (monday: string): string => {
  const days = weekDays(monday)
  return `${formatDate(days[0]!)} – ${formatDate(days[6]!)}`
}

/**
 * A day as a button names it, "Thursday 19 November 2026": the weekday from the catalog by the day's place in the
 * week (Monday is 0; the library has no weekday formatter) and the date as `formatDateLong` writes it.
 */
export const longDay = (day: string, index: number): string =>
  `${strings.week.weekday.long[index]} ${formatDateLong(day)}`

/** The row as the entry it holds would be for `rowName` and `onPhrase`: its kind, its name and why it may have none. */
const onOf = (row: WeekRow): EntryOn => {
  if (row.kind === 'none')
    return { type: 'none', category: { id: row.key, name: row.name ?? '', retired: row.retired } }
  const named = { id: null, label: row.name, href: null, visibility: row.visibility }
  return row.kind === 'meeting' ? { type: 'meeting', ...named, deal: { state: 'none' } } : { type: row.kind, ...named }
}

/**
 * The row's name as the List writes it (AC-5.23): the label of a project, deal or meeting the viewer may read,
 * "Not visible to you" or "Name unavailable" for one they may not or whose owner did not answer, the category's name
 * for other work — and, for a retired category, "(retired)" after it, as the List writes that too.
 */
export const rowLabel = (row: WeekRow): string => {
  if (row.kind === 'none') return row.retired ? strings.entries.retired(row.name ?? '') : (row.name ?? '')
  return rowName(onOf(row))?.text ?? ''
}

/**
 * How the row is named inside a button's accessible name ("Record hours on <this>", "2 h on <this>, …"): the List's
 * `onPhrase`, so "a project not visible to you" and "other work (Training)" read the same in both views. Never the
 * name of a record the viewer may not read.
 */
export const rowPhrase = (row: WeekRow): string => onPhrase(onOf(row))

/**
 * The cell of the grid a cell dialog was opened on (design S8): the row, the cell and the day's place in the week
 * (Monday is 0), looked up by the row's key and the day because the grid itself is replaced every time the week is read
 * again. `null` once the cell holds no entry — the row is gone from the week, or this day of it is empty — which is the
 * page's cue that the dialog has nothing left to list.
 */
export const cellOf = (
  grid: WeekGrid,
  rowKey: string,
  day: string,
): { row: WeekRow; cell: WeekCell; index: number } | null => {
  const row = grid.rows.find((candidate) => candidate.key === rowKey)
  const cell = row?.cells[day]
  const index = grid.days.indexOf(day)
  return row !== undefined && cell !== undefined && cell.entries.length > 0 && index !== -1
    ? { row, cell, index }
    : null
}
