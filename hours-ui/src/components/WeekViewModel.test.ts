/**
 * WeekViewModel — what the Week view says about a week and about a row (specs/20261116-record-hours-in-place T9;
 * design S7; AC-5.5, AC-5.23). Pure: the week as two dates, a row's name and the phrase that names it in a button,
 * both worded by the List's own functions (`lib/names.ts`) so the two views never disagree about one entry.
 */
import { describe, expect, it } from 'vitest'
import { formatDate } from '@operai/ui'
import { strings } from '../strings'
import type { EntryOn } from '../lib/hoursApi.types'
import { onPhrase, rowName } from '../lib/names'
import { weekGrid } from '../lib/weekGrid'
import type { WeekRow } from '../lib/weekGrid'
import { dealOn, meetingOn, otherWorkOn, projectOn, timeEntryView } from '../test-support/fakeApi'
import { rowLabel, rowPhrase, weekRange } from './WeekViewModel'

const MONDAY = '2026-11-16'

/** The one row an entry on `on` makes in the week of `MONDAY`. */
const rowOf = (on: EntryOn): WeekRow => {
  const [row] = weekGrid([timeEntryView({ id: 'e', day: MONDAY, minutes: 60, on })], MONDAY).rows
  if (!row) throw new Error('no row')
  return row
}

describe('weekRange: the week as two formatDates with an en dash (AC-5.5)', () => {
  it('is the Monday and the Sunday of the week, each as the suite writes a date, with an en dash between', () => {
    expect(weekRange('2026-11-16')).toBe(`${formatDate('2026-11-16')} – ${formatDate('2026-11-22')}`)
    expect(weekRange('2026-11-16')).toBe('16.11.2026 – 22.11.2026')
  })

  it('runs over a month and over a year, because the Sunday is six days on, not a date built by hand', () => {
    expect(weekRange('2026-11-30')).toBe('30.11.2026 – 06.12.2026')
    expect(weekRange('2026-12-28')).toBe('28.12.2026 – 03.01.2027')
  })

  it('refuses a day that is not a Monday, as the week functions do: it would name another week', () => {
    expect(() => weekRange('2026-11-17')).toThrow(TypeError)
  })
})

describe('rowLabel: a row is named as the list names an entry (AC-5.23)', () => {
  it.each<[string, EntryOn]>([
    ['a project', projectOn('p1', 'Alpenstrom')],
    ['a deal', dealOn('d1', 'Brera')],
    ['a meeting', meetingOn('m1', 'Retrospective')],
    ['a project the viewer may not read', projectOn('p2', 'Secret', 'hidden')],
    ['a deal whose owner did not answer', dealOn('d2', 'Unseen', 'unavailable')],
    ['a meeting the viewer may not read', meetingOn('m2', 'Closed', { state: 'none' }, 'hidden')],
    ['a project that arrived visible with no label', projectOn('p3', null)],
  ])('says for %s what rowName says of the entry', (_name, on) => {
    expect(rowLabel(rowOf(on))).toBe(rowName(on)?.text)
  })

  it('shows the placeholders of the catalog, never a name, for the two reasons a name is withheld', () => {
    expect(rowLabel(rowOf(projectOn('p2', 'Secret', 'hidden')))).toBe(strings.names.hidden)
    expect(rowLabel(rowOf(dealOn('d2', 'Unseen', 'unavailable')))).toBe(strings.names.unavailable)
  })

  it('names other work by its category, and says so when the category is retired, as the list does', () => {
    expect(rowLabel(rowOf(otherWorkOn('Training', 'c1')))).toBe('Training')
    expect(rowLabel(rowOf(otherWorkOn('Old training', 'c2', true)))).toBe(strings.entries.retired('Old training'))
  })
})

describe('rowPhrase: how a row is named inside a button (AC-5.23)', () => {
  it.each<[string, EntryOn]>([
    ['a project', projectOn('p1', 'Alpenstrom')],
    ['a deal', dealOn('d1', 'Brera')],
    ['a meeting', meetingOn('m1', 'Retrospective')],
    ['a project the viewer may not read', projectOn('p2', 'Secret', 'hidden')],
    ['a deal whose owner did not answer', dealOn('d2', 'Unseen', 'unavailable')],
    ['a meeting the viewer may not read', meetingOn('m2', 'Closed', { state: 'none' }, 'hidden')],
    ['a meeting whose owner did not answer', meetingOn('m3', 'Silent', { state: 'none' }, 'unavailable')],
    ['other work', otherWorkOn('Training', 'c1')],
  ])('is for %s what onPhrase says of the entry', (_name, on) => {
    expect(rowPhrase(rowOf(on))).toBe(onPhrase(on))
  })

  it('never carries the name of a record the viewer may not read', () => {
    expect(rowPhrase(rowOf(projectOn('p2', 'Secret', 'hidden')))).not.toContain('Secret')
  })
})
