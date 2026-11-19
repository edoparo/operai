/**
 * @vitest-environment jsdom
 *
 * The Week view under `<html lang="it">` (specs/20261116-record-hours-in-place T9; AC-4.6): the heading, the days, the
 * navigator, the names of the cell buttons and every state come from the Italian catalog and none of the English one,
 * a weekday and a date are written in Italian, and a name an administrator typed ("Formazione") is shown verbatim.
 * Completeness of the catalog is checked once for the whole app (strings.test.ts); this proves the view reads it.
 *
 * Its own file because the language is resolved when `strings` is first imported, so each test sets `<html lang>` and
 * imports the view afresh.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { EntryOn } from '../lib/hoursApi.types'
import { daysOf, holding } from '../lib/tablePeriod'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('lang')
  vi.resetModules()
})

const MONDAY = '2026-11-16'
const TODAY = '2026-11-19'

/** The view, its strings and a week of entries, all imported after the language is set. */
const setup = async (lang: 'it' | 'en') => {
  document.documentElement.setAttribute('lang', lang)
  const { default: TableView } = await import('./TableView')
  const { strings } = await import('../strings')
  const { tableGrid } = await import('../lib/tableGrid')
  const { dealOn, otherWorkOn, projectOn, timeEntryView } = await import('../test-support/fakeApi')
  const entry = (id: string, day: string, minutes: number, on: EntryOn) => timeEntryView({ id, day, minutes, on })
  const grid = tableGrid(
    [
      entry('a', '2026-11-16', 240, projectOn('p1', 'Alpenstrom')),
      entry('b', '2026-11-18', 60, projectOn('p2', 'Operai')),
      entry('c', '2026-11-18', 90, projectOn('p2', 'Operai')),
      entry('d', '2026-11-17', 60, dealOn('d1', 'Brera')),
      entry('e', '2026-11-19', 120, otherWorkOn('Formazione', 'c-training')),
      entry('f', '2026-11-17', 120, projectOn('p3', 'Segreto', 'hidden')),
    ],
    daysOf(holding('week', MONDAY)),
  )
  const draw = (props: Record<string, unknown> = {}) =>
    render(
      <TableView
        period={{ kind: 'week', monday: MONDAY }}
        today={TODAY}
        filtered={false}
        state={{ status: 'loaded', grid }}
        onPeriodChange={vi.fn()}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        onOpenCell={vi.fn()}
        {...props}
      />,
    )
  return { strings, draw, tableGrid }
}

describe('Italian', () => {
  it('words the heading, the navigator and the table in Italian, with the week as two dates and an en dash', async () => {
    const { draw } = await setup('it')
    draw()
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Settimana 16.11.2026 – 22.11.2026')
    const navigator = screen.getByRole('group', { name: 'Scegli una settimana' })
    expect(within(navigator).getByRole('button', { name: 'Settimana precedente' })).not.toBeNull()
    expect(within(navigator).getByRole('button', { name: 'Questa settimana' })).not.toBeNull()
    expect(within(navigator).getByRole('button', { name: 'Settimana successiva' })).not.toBeNull()
    expect(
      screen.getByRole('table', {
        name: 'Ore per progetto, opportunità, riunione e altro lavoro, 16.11.2026 – 22.11.2026',
      }),
    ).not.toBeNull()
  })

  it('has Monday to Sunday as Lun to Dom, marks today "Oggi", and calls the last column and the last row "Totale"', async () => {
    const { draw } = await setup('it')
    draw()
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader')
    expect(headers.slice(1, 8).map((header) => header.textContent?.slice(0, 3))).toEqual([
      'Lun',
      'Mar',
      'Mer',
      'Gio',
      'Ven',
      'Sab',
      'Dom',
    ])
    expect(headers[4]?.textContent).toContain('Oggi')
    expect(headers[8]?.textContent).toBe('Totale')
    expect(within(screen.getByTestId('hours-table-row-total')).getByRole('rowheader').textContent).toBe('Totale')
  })

  it('names the cell buttons with the Italian weekday and date, and the entries in the singular and the plural', async () => {
    const { draw } = await setup('it')
    draw()
    expect(
      screen.getByRole('button', { name: '2 h 30 su Operai, mercoledì 18 novembre 2026, 2 registrazioni' }),
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: '4 h su Alpenstrom, lunedì 16 novembre 2026, 1 registrazione' }),
    ).not.toBeNull()
    expect(
      screen.getByRole('button', {
        name: '2 h su altro lavoro (Formazione), giovedì 19 novembre 2026, 1 registrazione',
      }),
    ).not.toBeNull()
  })

  it('has a button only for a cell that holds hours: an empty cell offers no "Registra ore" and no name of any kind (AC-5.32)', async () => {
    const { draw } = await setup('it')
    draw()
    expect(screen.queryAllByRole('button', { name: /^Registra ore/ })).toHaveLength(0)
    // five cells hold hours in this week, and nothing else in the table is a button
    expect(within(screen.getByRole('table')).getAllByRole('button')).toHaveLength(5)
  })

  it('shows a category as its administrator typed it, the kinds and the hidden name in Italian, and no English', async () => {
    const { draw } = await setup('it')
    const { container } = draw()
    const training = within(screen.getByTestId('hours-table-row-category:c-training')).getByRole('rowheader')
    expect(within(training).getByText('Altro lavoro')).not.toBeNull()
    expect(within(training).getByText('Formazione')).not.toBeNull()
    const hidden = within(screen.getByTestId('hours-table-row-project:p3')).getByRole('rowheader')
    expect(within(hidden).getByText('Progetto')).not.toBeNull()
    expect(within(hidden).getByText('Non visibile a te')).not.toBeNull()
    expect(container.textContent).not.toMatch(/\b(Week|Total|Project|Deal|Mon|Tue|Today|Not visible)\b/)
    expect(container.textContent).not.toContain('Segreto')
  })

  it('announces the week and its total in Italian, and says so in Italian when it is empty or still loading', async () => {
    const { draw, tableGrid } = await setup('it')
    const { unmount } = draw()
    expect(screen.getByTestId('hours-table-live').textContent).toBe(
      '16.11.2026 – 22.11.2026: 11 ore e 30 minuti in totale.',
    )
    unmount()
    draw({ state: { status: 'loaded', grid: tableGrid([], daysOf(holding('week', MONDAY))) } })
    expect(screen.getByTestId('hours-table-live').textContent).toBe('16.11.2026 – 22.11.2026: nessuna ora registrata.')
    cleanup()
    draw({ state: { status: 'loading' } })
    expect(screen.getByTestId('hours-table-live').textContent).toBe('Caricamento della tua settimana…')
  })

  it('words the empty week, the empty filtered week and the error in Italian, and has no sentence for a week that has not started', async () => {
    const { draw, tableGrid } = await setup('it')
    const loaded = { status: 'loaded', grid: tableGrid([], daysOf(holding('week', MONDAY))) }
    draw({ state: loaded })
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('Nessuna ora registrata in questa settimana')
    cleanup()
    draw({ state: loaded, filtered: true })
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe(
      'Nessuna registrazione corrisponde a questi filtri',
    )
    expect(screen.getByRole('button', { name: 'Azzera i filtri' })).not.toBeNull()
    cleanup()
    draw({ state: { status: 'error', message: 'Riprova tra un momento.' } })
    expect(within(screen.getByTestId('hours-table-error')).getByText('Impossibile caricare le tue ore')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Riprova' })).not.toBeNull()
  })

  it('says in Italian that the grid scrolls sideways, under the heading and before the table, and not in English', async () => {
    const { draw } = await setup('it')
    draw()
    const hint = screen.getByText('Scorri di lato per vedere tutti e sette i giorni.')
    expect(hint.getAttribute('aria-hidden')).toBe('true')
    expect(hint.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Scroll sideways to see all seven days.')).toBeNull()
  })

  it('keeps English as English, so the test above proves the view follows the language and not a default', async () => {
    const { draw } = await setup('en')
    draw()
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Week 16.11.2026 – 22.11.2026')
    expect(screen.getByRole('button', { name: '4 h on Alpenstrom, Monday 16 November 2026, 1 entry' })).not.toBeNull()
  })
})
