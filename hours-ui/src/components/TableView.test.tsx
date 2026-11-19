/**
 * @vitest-environment jsdom
 *
 * TableView — the Week card of My hours: a table of what the person worked on, row by row and day by day, with its
 * totals, its states and its navigator (specs/20261116-record-hours-in-place T9; design S7; AC-5.3, AC-5.5,
 * AC-5.9–AC-5.11, AC-5.14, AC-5.23, AC-5.24, AC-4.6; T20: AC-5.14, AC-5.24, AC-5.28, AC-5.32). Presentational: it is
 * handed a `TableGrid` (the pure fold of one complete read, T8) and what the page knows, and it computes nothing — every
 * figure is one the grid states. A cell that holds hours is a button that calls back; an empty cell is not a control.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatDate } from '@operai/ui'
import { strings } from '../strings'
import type { TimeEntryView } from '../lib/hoursApi.types'
import { rowName } from '../lib/names'
import { tableGrid } from '../lib/tableGrid'
import type { TableGrid } from '../lib/tableGrid'
import type { TablePeriod } from '../lib/tablePeriod'
import { dealOn, meetingOn, otherWorkOn, projectOn, timeEntryView } from '../test-support/fakeApi'
import TableView from './TableView'
import type { TableViewProps } from './TableView'

afterEach(() => cleanup())

const w = strings.table

// The week of Monday 16 to Sunday 22 November 2026, and today is its Thursday: Monday to Thursday are today or
// earlier, Friday to Sunday have not come.
const MONDAY = '2026-11-16'
const TODAY = '2026-11-19'
const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const [MON, TUE, WED, THU, FRI, , SUN] = DAYS as [string, string, string, string, string, string, string]
const RANGE = '16.11.2026 – 22.11.2026'
const week = (monday: string): TablePeriod => ({ kind: 'week', monday })

let sequence = 0
const entry = (day: string, minutes: number, on: TimeEntryView['on']): TimeEntryView =>
  timeEntryView({ id: `e${++sequence}`, day, minutes, on })

/** What the design draws: two projects, a deal, a meeting, other work and a project the person may not read. */
const ENTRIES = [
  entry(MON, 240, projectOn('p1', 'Alpenstrom')),
  entry(TUE, 300, projectOn('p1', 'Alpenstrom')),
  entry(TUE, 60, projectOn('p2', 'Operai')),
  entry(WED, 150, projectOn('p2', 'Operai')),
  entry(WED, 60, dealOn('d1', 'Brera')),
  entry(MON, 60, meetingOn('m1', 'Retrospective')),
  entry(THU, 120, otherWorkOn('Training', 'c-training')),
  entry(TUE, 120, projectOn('p3', 'Secret', 'hidden')),
]
const GRID: TableGrid = tableGrid(ENTRIES, DAYS)

const renderWeek = (props: Partial<TableViewProps> = {}) =>
  render(
    <TableView
      period={week(MONDAY)}
      today={TODAY}
      filtered={false}
      state={{ status: 'loaded', grid: GRID }}
      onPeriodChange={vi.fn()}
      onRetry={vi.fn()}
      onClearFilters={vi.fn()}
      {...props}
    />,
  )

const table = () => screen.getByRole('table')
const row = (key: string) => screen.getByTestId(`hours-table-row-${key}`)
/** The `td` of a row on a day: the seven day cells come first, the row total last. */
const dayCell = (key: string, day: string) => within(row(key)).getAllByRole('cell')[DAYS.indexOf(day)]!

describe('the grid is a table with the seven days of the week (AC-5.3)', () => {
  it('is a table with table semantics, named for the week, and not an ARIA grid', () => {
    renderWeek()
    expect(screen.getByRole('table', { name: w.grid.caption(RANGE) })).not.toBeNull()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('has "Recorded on", the seven days Monday to Sunday, each with its date, and "Total", as column headers, in that order', () => {
    renderWeek()
    const headers = within(table()).getAllByRole('columnheader')
    expect(headers).toHaveLength(9)
    expect(headers[0]?.textContent).toBe(strings.filters.recordedOn.label)
    expect(headers[8]?.textContent).toBe(w.grid.total)
    DAYS.forEach((day, index) => {
      const text = headers[index + 1]?.textContent ?? ''
      expect(text).toContain(w.weekday.short[index])
      expect(text).toContain(formatDate(day))
      expect(text.indexOf(w.weekday.short[index]!)).toBeLessThan(text.indexOf(formatDate(day)))
    })
    expect(headers.slice(1, 8).map((header) => header.getAttribute('scope'))).toEqual(Array(7).fill('col'))
  })

  it('marks today, and only today, in the header of its column, with a word and not only a colour', () => {
    renderWeek()
    const headers = within(table()).getAllByRole('columnheader').slice(1, 8)
    const marked = headers.filter((header) => header.textContent?.includes(w.today))
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain(formatDate(THU))
  })

  it('marks no day in a week that does not hold today', () => {
    renderWeek({ today: '2026-11-25' })
    expect(within(table()).queryByText(w.today)).toBeNull()
  })

  it('draws a row header for each row, scoped to the row, and no row the grid does not have', () => {
    renderWeek()
    const headers = within(table()).getAllByRole('rowheader')
    // six rows and the totals row
    expect(headers).toHaveLength(GRID.rows.length + 1)
    expect(headers.map((header) => header.getAttribute('scope'))).toEqual(Array(headers.length).fill('row'))
  })
})

describe('a day is named by its date, never by its column (R17)', () => {
  // Sunday 1 November 2026 begins a run of days that is not Monday-first: Sunday, Monday, Tuesday. A month that begins
  // there (T22) is drawn by the same code, so the first column must read "Sun", not "Mon".
  const RUN = ['2026-11-01', '2026-11-02', '2026-11-03']

  it('heads each column with the weekday of its date and the date', () => {
    const grid = tableGrid([entry(RUN[0]!, 60, projectOn('p1', 'Alpenstrom'))], RUN)
    renderWeek({ state: { status: 'loaded', grid } })
    const headers = within(table()).getAllByRole('columnheader').slice(1, 4)
    RUN.forEach((day, index) => {
      const text = headers[index]?.textContent ?? ''
      expect(text).toContain(['Sun', 'Mon', 'Tue'][index])
      expect(text).toContain(formatDate(day))
    })
    // The first column of a Monday-first week would say "Mon": the weekday does not come from the column's place.
    expect(headers[0]?.textContent).not.toContain('Mon')
  })

  it('names a cell button with the weekday of its date: 1 November 2026 is a Sunday', () => {
    const grid = tableGrid([entry(RUN[0]!, 60, projectOn('p1', 'Alpenstrom'))], RUN)
    renderWeek({ state: { status: 'loaded', grid }, onOpenCell: vi.fn() })
    const button = within(screen.getByTestId('hours-table-row-project:p1')).getByRole('button')
    expect(button.getAttribute('aria-label')).toBe(w.cell.open('1 h', 'Alpenstrom', 'Sunday 1 November 2026', 1))
    expect(button.getAttribute('aria-label')).toContain('Sunday 1 November 2026')
  })
})

describe('the figures: a cell, a row, a day and the week, each as the grid states it (AC-5.9, AC-5.10)', () => {
  it('shows in a cell the total of its row and day as hours and minutes, and nothing where the grid has no cell', () => {
    renderWeek()
    expect(dayCell('project:p1', MON).textContent).toBe('4 h')
    expect(dayCell('project:p1', TUE).textContent).toBe('5 h')
    expect(dayCell('project:p2', WED).textContent).toBe('2 h 30')
    expect(dayCell('deal:d1', WED).textContent).toBe('1 h')
    expect(dayCell('meeting:m1', MON).textContent).toBe('1 h')
    expect(dayCell('category:c-training', THU).textContent).toBe('2 h')
    // no cell in the grid, so nothing is drawn, never a "0 min"
    expect(dayCell('project:p1', WED).textContent).toBe('')
    expect(dayCell('project:p1', FRI).textContent).toBe('')
  })

  it('writes a duration as the suite does: 30 min, 2 h 30, and hours that are never capped', () => {
    const grid = tableGrid(
      [
        entry(MON, 30, projectOn('p1', 'A')),
        entry(TUE, 150, projectOn('p1', 'A')),
        entry(WED, 1440, projectOn('p1', 'A')),
      ],
      DAYS,
    )
    renderWeek({ state: { status: 'loaded', grid } })
    expect(dayCell('project:p1', MON).textContent).toBe('30 min')
    expect(dayCell('project:p1', TUE).textContent).toBe('2 h 30')
    expect(dayCell('project:p1', WED).textContent).toBe('24 h')
  })

  it('gives each row its total in the last column', () => {
    renderWeek()
    const total = (key: string) => within(row(key)).getAllByRole('cell')[7]?.textContent
    expect(total('project:p1')).toBe('9 h')
    expect(total('project:p2')).toBe('3 h 30')
    expect(total('deal:d1')).toBe('1 h')
    expect(total('meeting:m1')).toBe('1 h')
    expect(total('category:c-training')).toBe('2 h')
    expect(total('project:p3')).toBe('2 h')
  })

  it('ends with a row of day totals, "Total" as its header, and the week total in its last cell', () => {
    renderWeek()
    const totals = row('total')
    expect(within(totals).getByRole('rowheader').textContent).toBe(w.grid.total)
    const none = strings.common.none
    expect(
      within(totals)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['5 h', '8 h', '3 h 30', '2 h', none, none, none, '18 h 30'])
    expect(within(table()).getAllByRole('row').at(-1)).toBe(totals)
  })

  it('says a day with nothing with the catalog dash, never "0" and never a blank cell that could read as missing', () => {
    renderWeek()
    for (const day of [FRI, SUN]) {
      const text = within(row('total')).getAllByRole('cell')[DAYS.indexOf(day)]?.textContent
      expect(text).toBe(strings.common.none)
      expect(text).not.toMatch(/\d/)
    }
  })

  it('shows the grid figures and sums nothing itself: a total the rows do not add up to is shown as given', () => {
    // A grid no fold would make: every total differs from the sum of what it covers.
    const grid: TableGrid = {
      ...GRID,
      dayMinutes: [600, 0, 0, 0, 0, 0, 0],
      totalMinutes: 1200,
      rows: GRID.rows.map((gridRow) => ({ ...gridRow, minutes: 30 })),
    }
    renderWeek({ state: { status: 'loaded', grid } })
    const cells = within(row('total'))
      .getAllByRole('cell')
      .map((cell) => cell.textContent)
    expect(cells[0]).toBe('10 h')
    expect(cells[1]).toBe(strings.common.none)
    expect(cells[7]).toBe('20 h')
    expect(within(row('project:p1')).getAllByRole('cell')[7]?.textContent).toBe('30 min')
  })
})

describe('a cell that holds hours is the only control: an empty cell is a blank td (AC-5.14, AC-5.15, AC-5.24, AC-5.32)', () => {
  const rowOfKey = (key: string) => GRID.rows.find((gridRow) => gridRow.key === key)!
  const handlers = () => ({ onOpenCell: vi.fn() })
  const buttonIn = (key: string, day: string) => within(dayCell(key, day)).queryByRole('button')
  const recordButtons = () => screen.queryAllByRole('button', { name: /^Record hours on / })
  /** Every cell of the grid that holds no hours, with the row and the day it is on. */
  const emptyCells = (grid: TableGrid) =>
    grid.rows.flatMap((gridRow) => grid.days.filter((day) => !gridRow.cells[day]).map((day) => ({ gridRow, day })))
  /** What Tab reaches inside the table: a control, a link, a field, or anything with a tabindex that is not -1 (a row header's is, for focus by script). */
  const tabStopsIn = (container: HTMLElement) => [
    ...container.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    ),
  ]

  it('draws an empty cell as nothing: no text, no element in it, no name, on every row and every day', () => {
    renderWeek(handlers())
    const empties = emptyCells(GRID)
    // Six rows of seven days, less the cells that hold hours: the test has a body to look at.
    expect(empties.length).toBeGreaterThan(20)
    for (const { gridRow, day } of empties) {
      const cell = dayCell(gridRow.key, day)
      expect(cell.tagName, `${gridRow.key} ${day}`).toBe('TD')
      expect(cell.textContent, `${gridRow.key} ${day}`).toBe('')
      expect(cell.children, `${gridRow.key} ${day}`).toHaveLength(0)
      expect(cell.hasAttribute('data-cell'), `${gridRow.key} ${day}`).toBe(false)
      expect(cell.hasAttribute('tabindex'), `${gridRow.key} ${day}`).toBe(false)
      expect(cell.hasAttribute('aria-label'), `${gridRow.key} ${day}`).toBe(false)
    }
  })

  it('is blank on a day after today, on today and on an earlier day, on a row with a name (AC-5.14, AC-5.32)', () => {
    renderWeek(handlers())
    // Alpenstrom holds hours on Monday and Tuesday only: Wednesday (earlier), Thursday (today) and Friday (after) are empty.
    for (const day of [WED, THU, FRI, DAYS[5]!, SUN]) {
      expect(dayCell('project:p1', day).textContent).toBe('')
      expect(buttonIn('project:p1', day)).toBeNull()
    }
    expect(buttonIn('project:p1', MON)).not.toBeNull()
  })

  it('is blank on a row whose name the person cannot read and on a retired category: the same cell as any other (AC-5.24)', () => {
    const grid = tableGrid(
      [entry(TUE, 60, otherWorkOn('Old training', 'c-old', true)), entry(MON, 60, projectOn('p3', 'Secret', 'hidden'))],
      DAYS,
    )
    renderWeek({ ...handlers(), state: { status: 'loaded', grid }, today: '2026-11-30' })
    for (const key of ['category:c-old', 'project:p3']) {
      const blank = DAYS.filter((day) => dayCell(key, day).querySelector('[data-cell]') === null)
      expect(blank, key).toHaveLength(6)
      for (const day of blank) {
        expect(dayCell(key, day).children, `${key} ${day}`).toHaveLength(0)
        expect(dayCell(key, day).textContent, `${key} ${day}`).toBe('')
      }
    }
    expect(recordButtons()).toHaveLength(0)
  })

  it('offers no "Record hours on" button anywhere, in a week long past, in the current week or in one that has not come', () => {
    for (const today of ['2026-11-30', TODAY, '2026-11-09']) {
      renderWeek({ ...handlers(), today })
      expect(recordButtons(), today).toHaveLength(0)
      cleanup()
    }
  })

  it('has no tab stop but the cells that hold hours: a keyboard reaches only the figures', () => {
    renderWeek(handlers())
    const withHours = GRID.rows.flatMap((gridRow) => Object.keys(gridRow.cells).map((day) => `${gridRow.key}:${day}`))
    const stops = tabStopsIn(table())
    expect(stops).toHaveLength(withHours.length)
    expect(stops.map((stop) => stop.getAttribute('data-cell')).sort()).toEqual([...withHours].sort())
  })

  it('does nothing when an empty cell is pressed: no callback, and no cell button takes the focus', async () => {
    const { onOpenCell } = handlers()
    renderWeek({ onOpenCell })
    for (const [key, day] of [
      ['project:p1', WED],
      ['project:p2', MON],
      ['deal:d1', THU],
      ['project:p3', FRI],
    ] as const) {
      await userEvent.click(dayCell(key, day))
      // The click may land in the table's scroll region, which is focusable as a whole; it never lands on a cell.
      expect(document.activeElement?.hasAttribute('data-cell'), `${key} ${day}`).toBe(false)
    }
    expect(onOpenCell).not.toHaveBeenCalled()
  })

  it('makes a cell that holds hours a button with the figure and a name with the figure, the row, the day and the entries (AC-5.15)', () => {
    const grid = tableGrid(
      [
        entry(WED, 60, projectOn('p1', 'Alpenstrom')),
        entry(WED, 90, projectOn('p1', 'Alpenstrom')),
        entry(MON, 240, projectOn('p1', 'Alpenstrom')),
      ],
      DAYS,
    )
    renderWeek({ ...handlers(), state: { status: 'loaded', grid } })
    const two = within(dayCell('project:p1', WED)).getByRole('button', {
      name: '2 h 30 on Alpenstrom, Wednesday 18 November 2026, 2 entries',
    })
    expect(two.textContent).toBe('2 h 30')
    expect(two.getAttribute('aria-haspopup')).toBe('dialog')
    expect(buttonIn('project:p1', MON)?.getAttribute('aria-label')).toBe(
      '4 h on Alpenstrom, Monday 16 November 2026, 1 entry',
    )
  })

  it('calls back with the row and the day when a cell with hours is pressed (AC-5.15)', async () => {
    const { onOpenCell } = handlers()
    renderWeek({ onOpenCell })
    await userEvent.click(buttonIn('project:p1', TUE)!)
    expect(onOpenCell).toHaveBeenCalledExactlyOnceWith(rowOfKey('project:p1'), TUE)
  })

  it('opens a cell from the keyboard too, with Enter on the focused figure', async () => {
    const { onOpenCell } = handlers()
    renderWeek({ onOpenCell })
    buttonIn('deal:d1', WED)!.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpenCell).toHaveBeenCalledExactlyOnceWith(rowOfKey('deal:d1'), WED)
  })

  it('still opens the hours of a row with no name, named as the List names it, so they can be changed and deleted (AC-5.24)', () => {
    renderWeek(handlers())
    expect(buttonIn('project:p3', TUE)?.getAttribute('aria-label')).toBe(
      '2 h on a project not visible to you, Tuesday 17 November 2026, 1 entry',
    )
    expect(JSON.stringify(document.body.innerHTML)).not.toContain('Secret')
  })

  it('still opens the hours of a retired category (AC-5.24)', () => {
    const grid = tableGrid([entry(TUE, 60, otherWorkOn('Old training', 'c-old', true))], DAYS)
    renderWeek({ ...handlers(), state: { status: 'loaded', grid } })
    expect(buttonIn('category:c-old', TUE)?.getAttribute('aria-label')).toBe(
      '1 h on other work (Old training), Tuesday 17 November 2026, 1 entry',
    )
  })

  it('gives every cell button its row and day for the page to find it again after the week is read anew', () => {
    renderWeek(handlers())
    expect(buttonIn('project:p1', TUE)?.getAttribute('data-cell')).toBe(`project:p1:${TUE}`)
    expect(buttonIn('project:p2', WED)?.getAttribute('data-cell')).toBe(`project:p2:${WED}`)
  })

  it('offers no button where the page gave no handler: the grid is read-only and still shows every figure', () => {
    renderWeek()
    expect(within(table()).queryAllByRole('button')).toHaveLength(0)
    expect(dayCell('project:p1', MON).textContent).toBe('4 h')
  })
})

describe('a row is named as the List names an entry (AC-5.8, AC-5.23)', () => {
  const header = (key: string) => within(row(key)).getByRole('rowheader')

  it('has the kind badge the List has, then the name, with no link and no id', () => {
    renderWeek()
    expect(within(header('project:p1')).getByText(strings.entries.type.project)).not.toBeNull()
    expect(within(header('project:p1')).getByText('Alpenstrom')).not.toBeNull()
    expect(within(header('deal:d1')).getByText(strings.entries.type.deal)).not.toBeNull()
    expect(within(header('meeting:m1')).getByText(strings.entries.type.meeting)).not.toBeNull()
    expect(within(header('category:c-training')).getByText(strings.entries.type.none)).not.toBeNull()
    expect(within(header('category:c-training')).getByText('Training')).not.toBeNull()
    expect(within(table()).queryAllByRole('link')).toHaveLength(0)
    // no id is shown, in the text or in a name (the row keys are attributes, never read out)
    const labels = [...table().querySelectorAll('[aria-label]')].map((element) => element.getAttribute('aria-label'))
    expect(`${table().textContent} ${labels.join(' ')}`).not.toMatch(/\bp[1-4]\b|\bd1\b|\bm1\b|c-training/)
  })

  it('says of a project the person may not read what the List says of its entry, and never its name', () => {
    const hidden = ENTRIES.find((candidate) => candidate.on.type === 'project' && candidate.on.visibility === 'hidden')!
    renderWeek()
    expect(within(header('project:p3')).getByText(rowName(hidden.on)!.text)).not.toBeNull()
    expect(within(header('project:p3')).getByText(strings.names.hidden)).not.toBeNull()
    // the kind stays, so the row still says what sort of work it was
    expect(within(header('project:p3')).getByText(strings.entries.type.project)).not.toBeNull()
    expect(document.body.textContent).not.toContain('Secret')
  })

  it('says "Name unavailable" for a deal whose owner did not answer, and for a visible one that arrived without a label', () => {
    const grid = tableGrid(
      [entry(MON, 60, dealOn('d2', 'Unseen', 'unavailable')), entry(TUE, 60, projectOn('p4', null))],
      DAYS,
    )
    renderWeek({ state: { status: 'loaded', grid } })
    expect(within(header('deal:d2')).getByText(strings.names.unavailable)).not.toBeNull()
    expect(within(header('project:p4')).getByText(strings.names.unavailable)).not.toBeNull()
  })

  it('tells a retired category as the List does', () => {
    const grid = tableGrid([entry(TUE, 60, otherWorkOn('Old training', 'c-old', true))], DAYS)
    renderWeek({ state: { status: 'loaded', grid } })
    expect(within(header('category:c-old')).getByText(strings.entries.retired('Old training'))).not.toBeNull()
  })

  it('draws the rows in the order the grid gives, projects, deals, meetings, other work, and the totals last', () => {
    renderWeek()
    const keys = [...table().querySelectorAll('tbody tr')].map((tr) => tr.getAttribute('data-row-key'))
    expect(keys).toEqual([...GRID.rows.map((gridRow) => gridRow.key), 'total'])
    expect(GRID.rows.map((gridRow) => gridRow.kind)).toEqual([
      'project',
      'project',
      'project',
      'deal',
      'meeting',
      'none',
    ])
  })
})

describe('the same markup for a 42 h week and a 1 h week, and nothing compares a day with a target (AC-5.11)', () => {
  // Four cells in two rows, the same in both weeks: only the durations differ.
  const weekOf = (minutesEach: number) =>
    tableGrid(
      [
        entry(MON, minutesEach, projectOn('p1', 'Alpenstrom')),
        entry(TUE, minutesEach, projectOn('p1', 'Alpenstrom')),
        entry(WED, minutesEach, dealOn('d1', 'Brera')),
        entry(THU, minutesEach, dealOn('d1', 'Brera')),
      ],
      DAYS,
    )
  const BIG = weekOf(630) // 4 × 10 h 30 = 42 h
  const SMALL = weekOf(15) // 4 × 15 min = 1 h

  /** The page with every figure (a duration, short or spoken) replaced by one word: what is left is the markup. */
  const markup = (html: string) =>
    html
      .replace(/_r_[0-9a-z]+_/g, 'ID') // React's generated ids differ from one render to the next
      .replace(/\d+ hours?(, \d+ minutes?)?|\d+ minutes?/g, 'D')
      .replace(/\d+ h( \d+)?|\d+ min/g, 'D')

  const render42or1 = (grid: TableGrid) => {
    const { container, unmount } = renderWeek({
      state: { status: 'loaded', grid },
      onOpenCell: vi.fn(),
    })
    const html = container.innerHTML
    const text = container.textContent ?? ''
    const roles = screen.queryAllByRole('progressbar').length + screen.queryAllByRole('meter').length
    unmount()
    return { html, text, roles }
  }

  it('states 42 h and 1 h as the weeks they are, so the comparison below is between two different figures', () => {
    expect(BIG.totalMinutes).toBe(42 * 60)
    expect(SMALL.totalMinutes).toBe(60)
    renderWeek({ state: { status: 'loaded', grid: BIG } })
    expect(within(row('total')).getAllByRole('cell').at(-1)?.textContent).toBe('42 h')
  })

  it('renders the two weeks as one markup, figures aside: no class, mark or element depends on how much was worked', () => {
    const big = render42or1(BIG)
    const small = render42or1(SMALL)
    expect(big.html).not.toBe(small.html)
    expect(markup(big.html)).toBe(markup(small.html))
  })

  it('says nothing of a target, a completeness or a comparison, for either week', () => {
    for (const grid of [BIG, SMALL]) {
      const { text, roles } = render42or1(grid)
      expect(text).not.toMatch(
        /target|incomplete|complete|missing|remaining|overtime|contract|short of|of 42|\/ ?42|%/i,
      )
      expect(roles).toBe(0)
    }
  })
})

describe('the card: the week is its heading and the navigator its action, in every state (AC-5.5)', () => {
  const heading = () => screen.getByRole('heading', { level: 3 })
  const EMPTY: TableGrid = tableGrid([], DAYS)

  it('is headed with the week as two formatDates and an en dash', () => {
    renderWeek()
    expect(heading().textContent).toBe(w.title(RANGE))
    expect(heading().textContent).toBe('Week 16.11.2026 – 22.11.2026')
    expect(screen.getByRole('region', { name: w.title(RANGE) })).toBe(screen.getByTestId('hours-table'))
  })

  it('names the week it is told, not the one the figures belong to, so a week that is still loading has its own heading', () => {
    renderWeek({ period: week('2026-11-09'), state: { status: 'loading' } })
    expect(heading().textContent).toBe('Week 09.11.2026 – 15.11.2026')
  })

  it('has the navigator, which asks for the week before the one shown, the week after it and this week', async () => {
    const onPeriodChange = vi.fn()
    renderWeek({ period: week('2026-11-09'), onPeriodChange })
    const navigator = screen.getByRole('group', { name: strings.table.nav.label })
    await userEvent.click(within(navigator).getByRole('button', { name: strings.table.nav.next }))
    expect(onPeriodChange).toHaveBeenLastCalledWith(week(MONDAY))
    await userEvent.click(within(navigator).getByRole('button', { name: strings.table.nav.previous }))
    expect(onPeriodChange).toHaveBeenLastCalledWith(week('2026-11-02'))
    expect(
      within(navigator).getByRole('button', { name: strings.table.nav.thisWeek }).getAttribute('aria-disabled'),
    ).toBeNull()
  })

  it('has Next and This week unavailable on the current week, and a press of Next asks for nothing (AC-5.28)', async () => {
    const onPeriodChange = vi.fn()
    renderWeek({ onPeriodChange })
    const navigator = screen.getByRole('group', { name: strings.table.nav.label })
    const nextWeek = within(navigator).getByRole('button', { name: strings.table.nav.next })
    expect(nextWeek.getAttribute('aria-disabled')).toBe('true')
    expect(
      within(navigator).getByRole('button', { name: strings.table.nav.thisWeek }).getAttribute('aria-disabled'),
    ).toBe('true')
    await userEvent.click(nextWeek)
    expect(onPeriodChange).not.toHaveBeenCalled()
  })

  it('asks for this week from another week: the week that holds today', async () => {
    const onPeriodChange = vi.fn()
    renderWeek({ period: week('2026-11-02'), onPeriodChange })
    await userEvent.click(screen.getByRole('button', { name: strings.table.nav.thisWeek }))
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week(MONDAY))
  })

  it.each<[string, Partial<TableViewProps>]>([
    ['loading', { state: { status: 'loading' } }],
    ['loaded', { state: { status: 'loaded', grid: GRID } }],
    ['an empty week', { state: { status: 'loaded', grid: EMPTY } }],
    ['an error', { state: { status: 'error', message: 'nope' } }],
    ['a state the page supplies', { state: { status: 'replaced', content: <p>the page says so</p> } }],
  ])('keeps the heading and the navigator in %s', (_name, props) => {
    renderWeek(props)
    expect(heading().textContent).toBe(w.title(RANGE))
    expect(screen.getByRole('group', { name: strings.table.nav.label })).not.toBeNull()
  })
})

describe('the grid on a phone and a laptop: the label floor and the scroll hint (design S7 "Columns", "Phone"; QE observation, G10)', () => {
  const hint = () => screen.queryByText(w.scrollHint)

  it('floors a row label at 7 rem (min-w-28), not the 11 rem that left a phone with a column of names and a laptop 10 px of scroll', () => {
    renderWeek()
    const labels = GRID.rows.map((r) => within(row(r.key)).getByRole('rowheader').firstElementChild as HTMLElement)
    expect(labels).toHaveLength(GRID.rows.length)
    for (const label of labels) {
      expect(label.classList.contains('min-w-28')).toBe(true)
      expect(label.classList.contains('min-w-44')).toBe(false)
    }
    expect(table().querySelector('.min-w-44')).toBeNull()
  })

  it('says under the heading that the grid scrolls sideways, as a line for the eye that only a screen below 1024 px sees', () => {
    renderWeek()
    expect(w.scrollHint).toBe('Scroll sideways to see all seven days.')
    const line = hint()!
    expect(line).not.toBeNull()
    expect(line.tagName).toBe('P')
    expect(line.classList.contains('lg:hidden')).toBe(true)
    // a cue for the eye: the region is already a labelled, focusable scroll region and a screen reader moves by cell
    expect(line.getAttribute('aria-hidden')).toBe('true')
    expect(within(line).queryByRole('button')).toBeNull()
    // between the card's heading and the grid, in that order
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.compareDocumentPosition(table()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is on a grid only: not while the week loads, on an empty week, on an error nor on a state the page supplies', () => {
    const EMPTY = tableGrid([], DAYS)
    const without: [string, Partial<TableViewProps>][] = [
      ['loading', { state: { status: 'loading' } }],
      ['an empty week', { state: { status: 'loaded', grid: EMPTY } }],
      ['an empty filtered week', { filtered: true, state: { status: 'loaded', grid: EMPTY } }],
      ['an error', { state: { status: 'error', message: 'nope' } }],
      ['a state the page supplies', { state: { status: 'replaced', content: <p>the page says so</p> } }],
    ]
    for (const [name, props] of without) {
      renderWeek(props)
      expect(hint(), name).toBeNull()
      cleanup()
    }
    renderWeek()
    expect(hint()).not.toBeNull()
  })
})

describe('loading: a skeleton, one polite line, and no figure of another week (design S7 States)', () => {
  it('shows the skeleton hidden from assistive technology and says "Loading your week…" once, politely', () => {
    renderWeek({ state: { status: 'loading' } })
    expect(screen.getByTestId('hours-table-skeleton').getAttribute('aria-hidden')).toBe('true')
    const live = screen.getByTestId('hours-table-live')
    expect(live.textContent).toBe(w.loading)
    expect(live.getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('takes the previous figures off the screen the moment the week is asked for again', () => {
    const { rerender } = renderWeek()
    expect(screen.getByRole('table')).not.toBeNull()
    rerender(
      <TableView
        period={week('2026-11-09')}
        today={TODAY}
        filtered={false}
        state={{ status: 'loading' }}
        onPeriodChange={vi.fn()}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    )
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Alpenstrom')).toBeNull()
    expect(screen.getByTestId('hours-table-skeleton')).not.toBeNull()
  })
})

describe('a week with no entries (design S7 States; AC-5.14)', () => {
  const EMPTY = tableGrid([], DAYS)
  const empty = (props: Partial<TableViewProps> = {}) =>
    renderWeek({ state: { status: 'loaded', grid: EMPTY }, ...props })

  it('says there are no hours this week, in a state panel under the card heading, with no action and no table', () => {
    empty()
    const panel = screen.getByTestId('hours-table-empty')
    expect(within(panel).getByRole('heading', { level: 4, name: w.empty.title })).not.toBeNull()
    expect(panel.textContent).toContain(w.empty.body)
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('has no "not started" state: whatever day today is, an empty week says the same, and a filter offers Clear filters (AC-5.28, AC-5.29)', () => {
    // No period after today is ever shown, so a week that begins after it needs no sentence of its own.
    for (const today of [MONDAY, '2026-11-09', '2026-11-30']) {
      empty({ today })
      expect(screen.getByRole('heading', { level: 4, name: w.empty.title }), today).not.toBeNull()
      expect(screen.getByTestId('hours-table-empty').textContent).not.toMatch(/not started|has not come/i)
      cleanup()
    }
    empty({ period: week('2026-11-23'), filtered: true })
    expect(screen.getByRole('heading', { level: 4, name: strings.entries.emptyFiltered.title })).not.toBeNull()
    expect(screen.getByRole('button', { name: strings.filters.clear })).not.toBeNull()
  })

  it('says no entry matches the filters, as the List does, and offers Clear filters, which asks the page to clear them', async () => {
    const onClearFilters = vi.fn()
    empty({ filtered: true, onClearFilters })
    const panel = screen.getByTestId('hours-table-empty')
    expect(within(panel).getByRole('heading', { level: 4, name: strings.entries.emptyFiltered.title })).not.toBeNull()
    expect(panel.textContent).toContain(strings.entries.emptyFiltered.body)
    await userEvent.click(within(panel).getByRole('button', { name: strings.filters.clear }))
    expect(onClearFilters).toHaveBeenCalledOnce()
  })

  it('offers Clear filters only when a filter is set', () => {
    empty({ filtered: false })
    expect(screen.queryByRole('button', { name: strings.filters.clear })).toBeNull()
  })
})

describe('a failed read: one error with Retry and no grid, never a partial one (design S7 States)', () => {
  it("shows the warning with the List's title, the message, and a Retry that asks the page to read again", async () => {
    const onRetry = vi.fn()
    renderWeek({ state: { status: 'error', message: 'Try again in a moment.' }, onRetry })
    const banner = screen.getByTestId('hours-table-error')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(within(banner).getByText(strings.entries.error.title)).not.toBeNull()
    expect(banner.textContent).toContain('Try again in a moment.')
    await userEvent.click(within(banner).getByRole('button', { name: strings.common.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByTestId('hours-table-empty')).toBeNull()
  })
})

describe('a state the page supplies in place of the grid, such as the deal filter that cannot be answered', () => {
  it('shows what the page gives, under the heading and the navigator, and draws no grid', () => {
    renderWeek({ state: { status: 'replaced', content: <p data-testid="from-the-page">Nothing is shown.</p> } })
    expect(screen.getByTestId('from-the-page')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByTestId('hours-table-empty')).toBeNull()
  })
})

describe('what a screen reader is told when a week arrives (design S7 "Announcements")', () => {
  const live = () => screen.getByTestId('hours-table-live')

  it('hears the week and its total, spoken, once the week has loaded, and the live region is polite', () => {
    renderWeek()
    expect(live().textContent).toBe(w.announce(RANGE, '18 hours, 30 minutes'))
    expect(live().getAttribute('aria-live')).toBe('polite')
  })

  it('hears that nothing was recorded in a week with no entries', () => {
    renderWeek({ state: { status: 'loaded', grid: tableGrid([], DAYS) } })
    expect(live().textContent).toBe(w.announceEmpty(RANGE))
  })

  it('hears nothing of its own on an error, which is an alert already, and keeps one region across the states', () => {
    const { rerender } = renderWeek({ state: { status: 'loading' } })
    const region = live()
    rerender(
      <TableView
        period={week(MONDAY)}
        today={TODAY}
        filtered={false}
        state={{ status: 'loaded', grid: GRID }}
        onPeriodChange={vi.fn()}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    )
    // the same element changed its text: that is what a live region needs to be read
    expect(live()).toBe(region)
    expect(region.textContent).toContain('18 hours, 30 minutes')
    rerender(
      <TableView
        period={week(MONDAY)}
        today={TODAY}
        filtered={false}
        state={{ status: 'error', message: 'nope' }}
        onPeriodChange={vi.fn()}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
      />,
    )
    expect(live().textContent).toBe('')
  })
})
