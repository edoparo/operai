/**
 * @vitest-environment jsdom
 *
 * My hours, T10's part: the List | Week switch, the address of the Week, the week read, the filters in the Week and
 * the wide layout (specs/20261116-record-hours-in-place; AC-5.1, AC-5.2, AC-5.4, AC-5.5, AC-5.21, AC-5.22, AC-4.6;
 * plan Decision 1 and 5, § My hours' address; design F3, S6, S7, G5). Rendered through the inner router with a
 * memory history and `fakeApi` behind `apiFetch`, so an assertion about a request is about the query string the real
 * `hoursApi` builds. The week's own grid is T9's (`TableView`) and T8's (`tableGrid`); the cells' dialogs are T11's and
 * T12's.
 *
 * Today is Friday 13 November 2026 (`TODAY_INSTANT`): this week is Monday 9 – Sunday 15 November.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', async () => (await import('../test-support/fakeSession')).shellSessionMock(apiFetch))

import { createAppRouter } from '../router'
import HoursShell from '../components/HoursShell'
import { strings } from '../strings'
import {
  dealItem,
  dealOn,
  deferred,
  entriesPage,
  fakeApi,
  listsHandler,
  otherWorkOn,
  page,
  problem,
  projectItem,
  projectOn,
  requests,
  sequence,
  timeEntryView,
} from '../test-support/fakeApi'
import type { FakeAnswer, FakeHandler } from '../test-support/fakeApi'
import { LISTS, TODAY_INSTANT, totalsHandler } from '../test-support/fixtures/myHours'
import { typeDuration } from '../test-support/typeDuration'
import type { TimeEntryView } from '../lib/hoursApi.types'

const f = strings.filters
const w = strings.table

let api: ReturnType<typeof fakeApi>

// This week, Monday 9 – Sunday 15 November 2026, and the week before it.
const THIS_MONDAY = '2026-11-09'
const THIS_SUNDAY = '2026-11-15'
const LAST_MONDAY = '2026-11-02'
const LAST_SUNDAY = '2026-11-08'
const NEXT_MONDAY = '2026-11-16'

let entrySeq = 0
const entry = (day: string, minutes: number, on: TimeEntryView['on']): TimeEntryView =>
  timeEntryView({ id: `e${++entrySeq}`, day, minutes, on })

/** What the person worked on in the two weeks: 6 h 30 on a project and 1 h on a deal this week, 3 h on the project the week before. */
const ENTRIES: TimeEntryView[] = [
  entry('2026-11-09', 240, projectOn('p-alpha', 'Alpenstrom')),
  entry('2026-11-10', 150, projectOn('p-alpha', 'Alpenstrom')),
  entry('2026-11-11', 60, dealOn('d-brera', 'Brera configurator')),
  entry('2026-11-03', 180, projectOn('p-alpha', 'Alpenstrom')),
]

/** `GET /time-entries` over `items`: the ones whose day is within `from`..`to`, as the server answers a ranged read. */
const entriesInRange =
  (items: TimeEntryView[]): FakeHandler =>
  (url) => {
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    return { status: 200, body: entriesPage(items.filter((item) => item.day >= from && item.day <= to)) }
  }

const useApi = (overrides: Parameters<typeof fakeApi>[0] = {}) => {
  api = fakeApi({
    'GET /time-lists': listsHandler(LISTS),
    'GET /time-entries': entriesInRange(ENTRIES),
    'GET /time-entries/totals': totalsHandler,
    'GET /deals': () => ({ status: 200, body: page([dealItem({ id: 'd1', title: 'Acme renewal' })]) }),
    'GET /projects': () => ({
      status: 200,
      body: page([projectItem({ id: 'p1', name: 'Project Alpha' })]),
    }),
    ...overrides,
  })
  apiFetch.mockImplementation(api)
}

const renderPage = async (path = '/hours', root?: Parameters<typeof createAppRouter>[1]) => {
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createAppRouter('/hours', root, history)
  render(<RouterProvider router={router} />)
  await screen.findByTestId('hours-my-page')
  return router
}

const entriesCalls = () => requests(api, 'GET /time-entries')
const totalsCalls = () => requests(api, 'GET /time-entries/totals')
const urlOf = (router: Awaited<ReturnType<typeof renderPage>>) =>
  Object.fromEntries(new URLSearchParams(router.state.location.searchStr))

const viewTab = (name: string) => screen.getByRole('tab', { name })
const tableCard = () => screen.getByTestId('hours-table')
const heading = () => screen.getByTestId('hours-table-heading')
const rowOf = (key: string) => screen.getByTestId(`hours-table-row-${key}`)
const rangeOf = (monday: string, sunday: string) =>
  `${monday.split('-').reverse().join('.')} – ${sunday.split('-').reverse().join('.')}`

beforeEach(() => {
  apiFetch.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(TODAY_INSTANT))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the List with a switch (AC-5.1)', () => {
  it('/hours opens on the List as before, with a tablist "View of your hours" holding List and Week, List current', async () => {
    useApi()
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')

    const tablist = screen.getByRole('tablist', { name: w.view.label })
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([w.view.list, w.view.week])
    expect(viewTab(w.view.list).getAttribute('aria-selected')).toBe('true')
    expect(viewTab(w.view.week).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByTestId('hours-table')).toBeNull()
  })

  it('the switch sits under the page header and above the Filters card, and the panel it controls holds everything below it', async () => {
    useApi()
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')

    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(viewTab(w.view.list).id)
    expect(viewTab(w.view.list).getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.contains(screen.getByTestId('hours-filters'))).toBe(true)
    expect(panel.contains(screen.getByTestId('hours-entries'))).toBe(true)
    // The header and the switch are outside the panel: they are the same on both views.
    expect(panel.contains(screen.getByTestId('hours-record'))).toBe(false)
    expect(panel.contains(screen.getByRole('tablist'))).toBe(false)
  })

  it('the List reads what it read before: entries, totals and day totals for the month, and nothing for a week', async () => {
    useApi()
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')

    expect(entriesCalls().map((request) => [request.query['from'], request.query['to']])).toEqual([
      ['2026-11-01', '2026-11-30'],
    ])
    expect(entriesCalls()[0]!.query['limit']).toBeUndefined()
    expect(
      totalsCalls()
        .map((request) => request.query['groupBy'])
        .sort(),
    ).toEqual(['day', 'project'])
  })
})

describe('the Week at its own address (AC-5.2, AC-5.4)', () => {
  it('/hours?view=week opens on the Week: Week current, the week card shown, the List’s cards not', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    expect(viewTab(w.view.week).getAttribute('aria-selected')).toBe('true')
    expect(viewTab(w.view.list).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(viewTab(w.view.week).id)
    expect(heading().textContent).toBe(w.title(rangeOf(THIS_MONDAY, THIS_SUNDAY)))
  })

  it('draws the rows of the week from the read: a row for the project and one for the deal, with the week’s figures', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    expect(within(rowOf('project:p-alpha')).getByText('Alpenstrom')).not.toBeNull()
    expect(within(rowOf('project:p-alpha')).getByText('6 h 30')).not.toBeNull()
    expect(within(rowOf('deal:d-brera')).getByText('Brera configurator')).not.toBeNull()
    // The hours of the week before are not in this one.
    expect(screen.queryByText('9 h 30')).toBeNull()
  })

  it('reads this week in full: whose=mine, from its Monday to its Sunday, a page of 500 (AC-5.4)', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    expect(entriesCalls()).toHaveLength(1)
    expect(entriesCalls()[0]!.query).toEqual({
      whose: 'mine',
      from: THIS_MONDAY,
      to: THIS_SUNDAY,
      limit: '500',
    })
  })

  it('asks for neither the List’s entries by page, nor any totals: the week is its own read', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    expect(totalsCalls()).toHaveLength(0)
    expect(entriesCalls().every((request) => request.query['cursor'] === undefined)).toBe(true)
  })

  it.each(['nope', '2026-02-30', '1999-12-27', '2026-1-5', ''])(
    'a week that is not a real day (%j) is this week: a pasted link never reaches the API as a refused request',
    async (week) => {
      useApi()
      await renderPage(`/hours?view=week&week=${week}`)
      await screen.findByTestId('hours-table-table')
      expect(entriesCalls().map((request) => [request.query['from'], request.query['to']])).toEqual([
        [THIS_MONDAY, THIS_SUNDAY],
      ])
    },
  )

  it('a week named by any day of it is the week holding that day, Monday to Sunday (AC-5.5)', async () => {
    useApi()
    await renderPage('/hours?view=week&week=2026-11-04')
    await screen.findByTestId('hours-table-table')
    expect(entriesCalls()[0]!.query).toMatchObject({ from: LAST_MONDAY, to: LAST_SUNDAY })
    expect(heading().textContent).toBe(w.title(rangeOf(LAST_MONDAY, LAST_SUNDAY)))
  })
})

describe('changing the week (AC-5.5)', () => {
  it('Previous week reads the week before and writes its Monday as ?week in the address', async () => {
    useApi()
    const router = await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByRole('button', { name: w.nav.previous }))

    await waitFor(() => expect(entriesCalls()).toHaveLength(2))
    expect(entriesCalls()[1]!.query).toMatchObject({ whose: 'mine', from: LAST_MONDAY, to: LAST_SUNDAY })
    expect(urlOf(router)).toEqual({ view: 'week', week: LAST_MONDAY })
    await waitFor(() => expect(heading().textContent).toBe(w.title(rangeOf(LAST_MONDAY, LAST_SUNDAY))))
    await screen.findByTestId('hours-table-table')
    // The one entry of the week before, in its day's cell and in the row's total.
    expect(within(rowOf('project:p-alpha')).getAllByText('3 h')).toHaveLength(2)
  })

  it('Next week reads the week after, and a week that has not started is drawn as such, with no entry asked for it twice', async () => {
    useApi()
    const router = await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByRole('button', { name: w.nav.next }))

    await waitFor(() => expect(entriesCalls()).toHaveLength(2))
    expect(entriesCalls()[1]!.query).toMatchObject({ from: NEXT_MONDAY, to: '2026-11-22' })
    expect(urlOf(router)).toEqual({ view: 'week', week: NEXT_MONDAY })
    await screen.findByText(w.emptyFuture.title)
  })

  it('This week goes back to the current week and takes ?week out of the address: this week is the default', async () => {
    useApi()
    const router = await renderPage(`/hours?view=week&week=${LAST_MONDAY}`)
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByRole('button', { name: w.nav.thisWeek }))

    await waitFor(() => expect(entriesCalls()).toHaveLength(2))
    expect(entriesCalls()[1]!.query).toMatchObject({ from: THIS_MONDAY, to: THIS_SUNDAY })
    expect(urlOf(router)).toEqual({ view: 'week' })
  })

  it('stepping forward onto this week from the week before also leaves ?week out', async () => {
    useApi()
    const router = await renderPage(`/hours?view=week&week=${LAST_MONDAY}`)
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByRole('button', { name: w.nav.next }))

    await waitFor(() => expect(entriesCalls()).toHaveLength(2))
    expect(urlOf(router)).toEqual({ view: 'week' })
  })

  it('shows the skeleton at once, never the previous week’s figures under the new span', async () => {
    const slow = deferred<{ status: number; body: unknown }>()
    useApi({
      'GET /time-entries': (url, init, params) =>
        url.searchParams.get('from') === LAST_MONDAY ? slow.promise : entriesInRange(ENTRIES)(url, init, params),
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByRole('button', { name: w.nav.previous }))

    expect(screen.queryByTestId('hours-table-table')).toBeNull()
    expect(screen.getByTestId('hours-table-skeleton')).not.toBeNull()
    slow.resolve({ status: 200, body: entriesPage([]) })
    await screen.findByText(w.empty.title)
  })

  it('a week left before its answer came is never drawn: the answer of the week asked for last wins', async () => {
    const slow = deferred<{ status: number; body: unknown }>()
    useApi({
      'GET /time-entries': (url, init, params) =>
        url.searchParams.get('from') === THIS_MONDAY ? slow.promise : entriesInRange(ENTRIES)(url, init, params),
    })
    await renderPage('/hours?view=week')
    await waitFor(() => expect(entriesCalls()).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: w.nav.previous }))
    await screen.findByTestId('hours-table-table')
    slow.resolve({ status: 200, body: entriesPage([ENTRIES[2]!]) })
    await Promise.resolve()

    expect(heading().textContent).toBe(w.title(rangeOf(LAST_MONDAY, LAST_SUNDAY)))
    expect(screen.queryByTestId('hours-table-row-deal:d-brera')).toBeNull()
  })
})

describe('the switch between the views (AC-5.1, AC-5.2)', () => {
  it('choosing Week writes ?view=week and reads the week; choosing List takes it out and reads the List again', async () => {
    useApi()
    const router = await renderPage('/hours')
    await screen.findByTestId('hours-entries')

    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')
    expect(urlOf(router)).toEqual({ view: 'week' })
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: THIS_MONDAY, to: THIS_SUNDAY, limit: '500' })
    expect(screen.queryByTestId('hours-entries')).toBeNull()

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    expect(urlOf(router)).toEqual({})
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: '2026-11-01', to: '2026-11-30' })
    expect(screen.queryByTestId('hours-table')).toBeNull()
  })

  it('the arrow keys switch too, and focus stays on the selected tab', async () => {
    useApi()
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')

    viewTab(w.view.list).focus()
    await userEvent.keyboard('{ArrowRight}')

    await screen.findByTestId('hours-table-table')
    expect(document.activeElement).toBe(viewTab(w.view.week))
  })

  it('the week held in the address is the week shown when the person comes back to the Week', async () => {
    useApi()
    const router = await renderPage(`/hours?view=week&week=${LAST_MONDAY}`)
    await screen.findByTestId('hours-table-table')

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    expect(urlOf(router)).toEqual({ week: LAST_MONDAY })
    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')

    expect(heading().textContent).toBe(w.title(rangeOf(LAST_MONDAY, LAST_SUNDAY)))
  })
})

describe('the column (C1)', () => {
  it('is wide on the Week and the default width on the List, under the tool’s own shell', async () => {
    useApi()
    await renderPage('/hours', HoursShell)
    await screen.findByTestId('hours-entries')
    expect(screen.getByTestId('hours-shell').className).not.toContain('tool-width')

    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')
    expect(screen.getByTestId('hours-shell').classList.contains('tool-width-wide')).toBe(true)

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    expect(screen.getByTestId('hours-shell').className).not.toContain('tool-width')
  })
})

/** Picks the deal "Acme renewal" in the Deal filter, as a person would. */
const pickDeal = async () => {
  await userEvent.type(screen.getByRole('combobox', { name: f.deal.label }), 'a')
  await userEvent.click(await screen.findByRole('option', { name: /Acme renewal/ }))
}

/** Picks the project "Project Alpha" in the Project filter. */
const pickProject = async () => {
  await userEvent.type(screen.getByRole('combobox', { name: f.project.label }), 'p')
  await userEvent.click(await screen.findByRole('option', { name: /Project Alpha/ }))
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const input = (name: string) => screen.getByRole('combobox', { name }) as HTMLInputElement

describe('the filters apply to the week (AC-5.21)', () => {
  it('Recorded on, Category and Work type in the address are in the read, with the week’s span', async () => {
    useApi()
    await renderPage('/hours?view=week&target=project&category=tc-admin&workType=wt-p-dev')
    await screen.findByTestId('hours-table-table')

    // One read: a link that names a category or work type waits for the lists rather than asking without it.
    expect(entriesCalls()).toHaveLength(1)
    expect(entriesCalls()[0]!.query).toEqual({
      whose: 'mine',
      from: THIS_MONDAY,
      to: THIS_SUNDAY,
      target: 'project',
      categoryId: 'tc-admin',
      workTypeId: 'wt-p-dev',
      limit: '500',
    })
  })

  it('the picked project and deal are in the read: projectId and dealId', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    await pickProject()
    await waitFor(() => expect(entriesCalls().at(-1)!.query['projectId']).toBe('p1'))
    await pickDeal()
    await waitFor(() => expect(entriesCalls().at(-1)!.query['dealId']).toBe('d1'))

    expect(entriesCalls().at(-1)!.query).toEqual({
      whose: 'mine',
      from: THIS_MONDAY,
      to: THIS_SUNDAY,
      projectId: 'p1',
      dealId: 'd1',
      limit: '500',
    })
  })

  it('all five at once: category, work type, recorded on, project and deal', async () => {
    useApi()
    await renderPage('/hours?view=week&target=deal&category=tc-admin&workType=wt-d-demo')
    await screen.findByTestId('hours-table-table')
    await pickProject()
    await pickDeal()

    await waitFor(() => expect(entriesCalls().at(-1)!.query['dealId']).toBe('d1'))
    expect(entriesCalls().at(-1)!.query).toMatchObject({
      whose: 'mine',
      from: THIS_MONDAY,
      to: THIS_SUNDAY,
      target: 'deal',
      categoryId: 'tc-admin',
      workTypeId: 'wt-d-demo',
      projectId: 'p1',
      dealId: 'd1',
    })
  })

  it('changing a filter reads the same week again and keeps the week in the address', async () => {
    useApi()
    const router = await renderPage(`/hours?view=week&week=${LAST_MONDAY}`)
    await screen.findByTestId('hours-table-table')

    await userEvent.selectOptions(select(f.recordedOn.label), 'deal')

    await waitFor(() => expect(entriesCalls()).toHaveLength(2))
    expect(entriesCalls()[1]!.query).toMatchObject({ target: 'deal', from: LAST_MONDAY, to: LAST_SUNDAY })
    expect(urlOf(router)).toEqual({ view: 'week', week: LAST_MONDAY, target: 'deal' })
  })

  it('a category the lists do not hold (a mangled link) is not sent, as in the List', async () => {
    useApi()
    await renderPage('/hours?view=week&category=tc-nope')
    await screen.findByTestId('hours-table-table')
    expect(entriesCalls().every((request) => request.query['categoryId'] === undefined)).toBe(true)
  })
})

describe('the filters go with the person from one view to the other (AC-5.22)', () => {
  it('List → Week → List keeps category, work type, recorded on and period in the address, and the picked project and deal', async () => {
    useApi()
    const router = await renderPage('/hours?period=lastMonth&target=deal&category=tc-admin&workType=wt-d-demo')
    await screen.findByTestId('hours-entries')
    await pickProject()
    await pickDeal()
    await waitFor(() => expect(entriesCalls().at(-1)!.query['dealId']).toBe('d1'))

    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')
    // In the Week: the address says what the List held, the controls hold it, the read carries it.
    expect(urlOf(router)).toEqual({
      period: 'lastMonth',
      target: 'deal',
      category: 'tc-admin',
      workType: 'wt-d-demo',
      view: 'week',
    })
    expect(select(f.recordedOn.label).value).toBe('deal')
    expect(select(f.category.label).value).toBe('tc-admin')
    expect(select(f.workType.label).value).toBe('wt-d-demo')
    expect(input(f.project.label).value).toBe('Project Alpha')
    expect(input(f.deal.label).value).toBe('Acme renewal')
    expect(entriesCalls().at(-1)!.query).toMatchObject({
      from: THIS_MONDAY,
      to: THIS_SUNDAY,
      target: 'deal',
      categoryId: 'tc-admin',
      workTypeId: 'wt-d-demo',
      projectId: 'p1',
      dealId: 'd1',
    })

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    expect(urlOf(router)).toEqual({
      period: 'lastMonth',
      target: 'deal',
      category: 'tc-admin',
      workType: 'wt-d-demo',
    })
    expect(select(f.period.label).value).toBe('lastMonth')
    expect(select(f.recordedOn.label).value).toBe('deal')
    expect(input(f.project.label).value).toBe('Project Alpha')
    expect(input(f.deal.label).value).toBe('Acme renewal')
    expect(entriesCalls().at(-1)!.query).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      target: 'deal',
      categoryId: 'tc-admin',
      workTypeId: 'wt-d-demo',
      projectId: 'p1',
      dealId: 'd1',
    })
  })

  it('a filter set in the Week is still set in the List', async () => {
    useApi()
    const router = await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    await userEvent.selectOptions(select(f.category.label), 'tc-admin')
    await pickDeal()

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')

    expect(urlOf(router)).toEqual({ category: 'tc-admin' })
    expect(select(f.category.label).value).toBe('tc-admin')
    expect(input(f.deal.label).value).toBe('Acme renewal')
    expect(entriesCalls().at(-1)!.query).toMatchObject({ categoryId: 'tc-admin', dealId: 'd1' })
  })

  it('a Custom range held in the address is kept untouched while the Week shows, and read again by the List', async () => {
    useApi()
    const router = await renderPage('/hours?period=custom&from=2026-10-05&to=2026-10-09')
    await screen.findByTestId('hours-entries')

    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')
    expect(urlOf(router)).toEqual({ period: 'custom', from: '2026-10-05', to: '2026-10-09', view: 'week' })
    // The week's span is the week's, whatever the period says.
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: THIS_MONDAY, to: THIS_SUNDAY })

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: '2026-10-05', to: '2026-10-09' })
  })

  it('an invalid Custom range of the List blocks nothing in the Week: the week is read', async () => {
    useApi()
    await renderPage('/hours?view=week&period=custom&from=2026-10-09&to=2026-10-05')
    await screen.findByTestId('hours-table-table')
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: THIS_MONDAY, to: THIS_SUNDAY })
  })
})

describe('what the Week does not have (WA5, WA10)', () => {
  it('has no Period, From or To, no Totals card, no Entries card and no Export', async () => {
    useApi()
    await renderPage('/hours?view=week&period=custom&from=2026-10-05&to=2026-10-09')
    await screen.findByTestId('hours-table-table')

    expect(screen.queryByRole('combobox', { name: f.period.label })).toBeNull()
    expect(screen.queryByTestId('hours-filter-from')).toBeNull()
    expect(screen.queryByTestId('hours-filter-to')).toBeNull()
    expect(screen.queryByTestId('hours-totals')).toBeNull()
    expect(screen.queryByTestId('hours-entries')).toBeNull()
    expect(screen.queryByTestId('hours-export')).toBeNull()
    expect(screen.queryByRole('button', { name: strings.export.button })).toBeNull()
  })

  it('has the cards in this order: Filters, then the week', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      f.title,
      w.title(rangeOf(THIS_MONDAY, THIS_SUNDAY)),
    ])
  })

  it('keeps Record hours in the header, and the page description', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    expect(screen.getByTestId('hours-record')).not.toBeNull()
    expect(screen.getByText(strings.myHours.description)).not.toBeNull()
  })
})

describe('Clear filters in the Week (G5)', () => {
  const clearButton = () => within(screen.getByTestId('hours-filters')).queryByRole('button', { name: f.clear })

  it('is not offered for a period alone: its control is not there to clear', async () => {
    useApi()
    await renderPage('/hours?view=week&period=lastMonth')
    await screen.findByTestId('hours-table-table')
    expect(clearButton()).toBeNull()
  })

  it('is offered for a filter the Week shows, and clears it and the picks, but not the period, the dates, the group or the view and week', async () => {
    useApi()
    const router = await renderPage(
      `/hours?view=week&week=${LAST_MONDAY}&period=custom&from=2026-10-05&to=2026-10-09&group=deal&target=deal&category=tc-admin&workType=wt-d-demo`,
    )
    await screen.findByTestId('hours-table-table')
    await pickDeal()

    await userEvent.click(clearButton()!)

    await waitFor(() => expect(entriesCalls().at(-1)!.query['dealId']).toBeUndefined())
    expect(urlOf(router)).toEqual({
      view: 'week',
      week: LAST_MONDAY,
      period: 'custom',
      from: '2026-10-05',
      to: '2026-10-09',
      group: 'deal',
    })
    expect(entriesCalls().at(-1)!.query).toEqual({
      whose: 'mine',
      from: LAST_MONDAY,
      to: LAST_SUNDAY,
      limit: '500',
    })
    expect(input(f.deal.label).value).toBe('')
    expect(clearButton()).toBeNull()
  })

  it('the period it left alone is the List’s when the person goes back', async () => {
    useApi()
    await renderPage('/hours?view=week&period=lastMonth&target=deal')
    await screen.findByTestId('hours-table-table')
    await userEvent.click(clearButton()!)
    await waitFor(() => expect(entriesCalls().at(-1)!.query['target']).toBeUndefined())

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')

    expect(select(f.period.label).value).toBe('lastMonth')
    expect(select(f.recordedOn.label).value).toBe('')
  })

  it('an empty week under a filter says no entry matches, and its own Clear filters clears it', async () => {
    useApi({ 'GET /time-entries': () => ({ status: 200, body: entriesPage([]) }) })
    const router = await renderPage('/hours?view=week&target=deal')
    await screen.findByText(strings.entries.emptyFiltered.title)

    await userEvent.click(screen.getByTestId('hours-table-clear'))

    await screen.findByText(w.empty.title)
    expect(urlOf(router)).toEqual({ view: 'week' })
  })
})

const refused = (): FakeAnswer => ({ status: 503, body: problem(503, 'host_unavailable') })

/** Refuses (503 `host_unavailable`) any read that carries a `dealId`, else answers the two weeks as usual. */
const refusingUnderDeal: FakeHandler = (url, init, params) =>
  url.searchParams.has('dealId') ? refused() : entriesInRange(ENTRIES)(url, init, params)

describe('a read that fails (design S7 States)', () => {
  const blocker = () => screen.getByTestId('hours-deal-filter-unavailable')
  const retryButton = () => within(blocker()).getByRole('button', { name: strings.common.retry })

  it('under a deal filter, a 503 host_unavailable is the List’s ONE alert in the card, with no grid and no empty state', async () => {
    useApi({ 'GET /time-entries': refusingUnderDeal })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    await pickDeal()

    await screen.findByTestId('hours-deal-filter-unavailable')
    expect(blocker().getAttribute('role')).toBe('alert')
    expect(within(blocker()).getByText(strings.entries.dealFilterUnavailable.title)).not.toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByTestId('hours-table-table')).toBeNull()
    expect(screen.queryByTestId('hours-table-empty')).toBeNull()
    expect(screen.queryByTestId('hours-table-error')).toBeNull()
    // The card keeps its heading and navigator, and the Filters card keeps the deal.
    expect(within(tableCard()).getByRole('button', { name: w.nav.next })).not.toBeNull()
    expect(tableCard().contains(blocker())).toBe(true)
    expect(input(f.deal.label).value).toBe('Acme renewal')
  })

  it('a refusal without a deal filter is an ordinary failed read', async () => {
    useApi({ 'GET /time-entries': () => refused() })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-error')
    expect(screen.queryByTestId('hours-deal-filter-unavailable')).toBeNull()
  })

  it('Retry of the refusal asks the week again; once it works the grid is drawn', async () => {
    let healthy = false
    useApi({
      'GET /time-entries': (url, init, params) =>
        url.searchParams.has('dealId') && !healthy ? refused() : entriesInRange(ENTRIES)(url, init, params),
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    await pickDeal()
    await screen.findByTestId('hours-deal-filter-unavailable')
    const before = entriesCalls().length
    healthy = true

    await userEvent.click(retryButton())

    await screen.findByTestId('hours-table-table')
    expect(entriesCalls()).toHaveLength(before + 1)
    expect(screen.queryByTestId('hours-deal-filter-unavailable')).toBeNull()
  })

  it('Retry of a refusal that goes on puts focus back on the alert: the Retry button that had it is gone', async () => {
    useApi({ 'GET /time-entries': refusingUnderDeal })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    await pickDeal()
    await screen.findByTestId('hours-deal-filter-unavailable')

    await userEvent.click(retryButton())

    await waitFor(() => expect(document.activeElement).toBe(blocker()))
  })

  it('Clear the deal filter in the alert drops the deal and reads the week without it', async () => {
    useApi({ 'GET /time-entries': refusingUnderDeal })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    await pickDeal()
    await screen.findByTestId('hours-deal-filter-unavailable')

    await userEvent.click(screen.getByTestId('hours-deal-filter-unavailable-clear'))

    await screen.findByTestId('hours-table-table')
    expect(entriesCalls().at(-1)!.query['dealId']).toBeUndefined()
  })

  it.each([
    ['a 500', () => ({ status: 500, body: problem(500) }) as FakeAnswer],
    ['a 503 authz_unavailable', () => ({ status: 503, body: problem(503, 'authz_unavailable') }) as FakeAnswer],
  ])('%s is an error with Retry and no grid, in the person’s words', async (_name, handler) => {
    useApi({ 'GET /time-entries': handler })
    await renderPage('/hours?view=week')

    const error = await screen.findByTestId('hours-table-error')
    expect(error.getAttribute('role')).toBe('alert')
    expect(within(error).getByText(strings.entries.error.title)).not.toBeNull()
    expect(within(error).getByText(strings.entries.error.body)).not.toBeNull()
    expect(screen.queryByTestId('hours-table-table')).toBeNull()
    expect(screen.queryByTestId('hours-table-empty')).toBeNull()
    // The heading and the navigator stay, so a person can leave the week that failed.
    expect(within(tableCard()).getByRole('button', { name: w.nav.previous })).not.toBeNull()
  })

  it('a request that never got an answer says so, in the network words', async () => {
    useApi({
      'GET /time-entries': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await renderPage('/hours?view=week')
    const error = await screen.findByTestId('hours-table-error')
    expect(within(error).getByText(strings.common.networkError)).not.toBeNull()
  })

  it('Retry reads the same week again', async () => {
    useApi({
      'GET /time-entries': sequence(
        () => ({ status: 500, body: problem(500) }),
        (url, init, params) => entriesInRange(ENTRIES)(url, init, params),
      ),
    })
    await renderPage(`/hours?view=week&week=${LAST_MONDAY}`)
    await userEvent.click(await screen.findByTestId('hours-table-error-retry'))

    await screen.findByTestId('hours-table-table')
    expect(entriesCalls()).toHaveLength(2)
    expect(entriesCalls()[1]!.query).toMatchObject({ from: LAST_MONDAY, to: LAST_SUNDAY })
  })

  // QE observation: the Retry button that had focus is gone while the week is read again; nothing then gave focus anywhere.
  describe('where focus goes after Retry of a failed read (design S7, QE)', () => {
    const failing = () => ({ status: 500, body: problem(500) }) as FakeAnswer
    const works: FakeHandler = (url, init, params) => entriesInRange(ENTRIES)(url, init, params)

    it('a Retry that works puts focus on the Week card’s heading, as it does for the deal filter’s refusal', async () => {
      useApi({ 'GET /time-entries': sequence(failing, works) })
      await renderPage('/hours?view=week')
      await userEvent.click(await screen.findByTestId('hours-table-error-retry'))

      await screen.findByTestId('hours-table-table')
      await waitFor(() => expect(document.activeElement).toBe(heading()))
    })

    it('a Retry that fails again puts focus on the new Retry button: the one that had it was replaced', async () => {
      useApi({ 'GET /time-entries': sequence(failing, failing, works) })
      await renderPage('/hours?view=week')
      await userEvent.click(await screen.findByTestId('hours-table-error-retry'))

      await waitFor(() => expect(entriesCalls()).toHaveLength(2))
      const retry = await screen.findByTestId('hours-table-error-retry')
      await waitFor(() => expect(document.activeElement).toBe(retry))

      // And that one works the same way.
      await userEvent.click(retry)
      await screen.findByTestId('hours-table-table')
      await waitFor(() => expect(document.activeElement).toBe(heading()))
    })

    it('a Retry whose week was left before it answered moves no focus: the person is on the navigator', async () => {
      const slow = deferred<FakeAnswer>()
      useApi({ 'GET /time-entries': sequence(failing, () => slow.promise, works) })
      await renderPage('/hours?view=week')
      await userEvent.click(await screen.findByTestId('hours-table-error-retry'))
      await waitFor(() => expect(entriesCalls()).toHaveLength(2))

      await userEvent.click(screen.getByRole('button', { name: w.nav.previous }))
      await screen.findByTestId('hours-table-table')
      slow.resolve({ status: 200, body: entriesPage([]) })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(document.activeElement).toBe(screen.getByRole('button', { name: w.nav.previous }))
    })
  })

  it('is all or nothing: a later page that fails is an error, never the grid of the pages that arrived', async () => {
    useApi({
      'GET /time-entries': (url) =>
        url.searchParams.has('cursor')
          ? { status: 500, body: problem(500) }
          : { status: 200, body: entriesPage([ENTRIES[0]!], { nextCursor: 'c1' }) },
    })
    await renderPage('/hours?view=week')

    await screen.findByTestId('hours-table-error')
    expect(screen.queryByTestId('hours-table-table')).toBeNull()
    expect(screen.queryByTestId('hours-table-row-project:p-alpha')).toBeNull()
  })

  it('an entry that is not of the week asked for is a failed read, not a page that throws', async () => {
    useApi({
      'GET /time-entries': () => ({
        status: 200,
        body: entriesPage([entry('2026-10-01', 60, projectOn('p1', 'Late'))]),
      }),
    })
    await renderPage('/hours?view=week')

    const error = await screen.findByTestId('hours-table-error')
    expect(within(error).getByText(strings.entries.error.body)).not.toBeNull()
    expect(screen.queryByTestId('hours-table-table')).toBeNull()
  })
})

describe('one complete read (plan Decision 1)', () => {
  it('walks every page of the week by cursor and folds them into one grid: the figures add up across pages', async () => {
    useApi({
      'GET /time-entries': (url) =>
        url.searchParams.get('cursor') === 'c1'
          ? { status: 200, body: entriesPage([ENTRIES[1]!, ENTRIES[2]!]) }
          : { status: 200, body: entriesPage([ENTRIES[0]!], { nextCursor: 'c1' }) },
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    expect(entriesCalls().map((request) => request.query['cursor'])).toEqual([undefined, 'c1'])
    expect(entriesCalls().every((request) => request.query['limit'] === '500')).toBe(true)
    expect(within(rowOf('project:p-alpha')).getByText('6 h 30')).not.toBeNull()
    expect(within(rowOf('deal:d-brera')).getAllByText('1 h')).toHaveLength(2)
  })

  it('an empty week is the empty state, with no row and nothing to total', async () => {
    useApi({ 'GET /time-entries': () => ({ status: 200, body: entriesPage([]) }) })
    await renderPage('/hours?view=week')
    await screen.findByText(w.empty.title)
    expect(screen.queryByTestId('hours-table-table')).toBeNull()
  })
})

describe('the notes about names (AC-4.7, AC-4.10, as the List has them)', () => {
  it('names the sources the walk could not ask, once, in one polite note', async () => {
    useApi({
      'GET /time-entries': () => ({
        status: 200,
        body: entriesPage([ENTRIES[0]!], { unavailable: ['crm', 'projects'] }),
      }),
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    const banner = screen.getByTestId('hours-banner-unavailable')
    expect(banner.textContent).toContain(strings.names.sources.projects)
    expect(banner.textContent).toContain(strings.names.sources.crm)
    expect(screen.queryByTestId('hours-banner-deal-grouping')).toBeNull()
  })

  it('unions what each page said it could not ask', async () => {
    useApi({
      'GET /time-entries': (url) =>
        url.searchParams.get('cursor') === 'c1'
          ? { status: 200, body: entriesPage([ENTRIES[1]!], { unavailable: ['meetings'] }) }
          : { status: 200, body: entriesPage([ENTRIES[0]!], { nextCursor: 'c1', unavailable: ['crm'] }) },
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')

    const banner = screen.getByTestId('hours-banner-unavailable')
    expect(banner.textContent).toContain(strings.names.sources.crm)
    expect(banner.textContent).toContain(strings.names.sources.meetings)
  })

  it('shows the standing note when a row is a project the person may not read, and not otherwise', async () => {
    useApi({
      'GET /time-entries': () => ({
        status: 200,
        body: entriesPage([entry('2026-11-10', 60, projectOn('p-secret', 'Secret', 'hidden'))]),
      }),
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    expect(screen.queryByTestId('hours-banner-hidden')).not.toBeNull()
    // The row says so in the List's words (AC-5.23), never the name.
    expect(within(rowOf('project:p-secret')).getByText(strings.names.hidden)).not.toBeNull()
    expect(screen.queryByText('Secret')).toBeNull()
    cleanup()

    apiFetch.mockReset()
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    expect(screen.queryByTestId('hours-banners')).toBeNull()
  })

  it('shows no note from the other view: the Week’s are not the List’s', async () => {
    useApi({
      'GET /time-entries': (url) =>
        url.searchParams.get('limit') === '500'
          ? { status: 200, body: entriesPage([ENTRIES[0]!], { unavailable: ['crm'] }) }
          : { status: 200, body: entriesPage([ENTRIES[0]!]) },
    })
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')
    expect(screen.queryByTestId('hours-banner-unavailable')).toBeNull()

    await userEvent.click(viewTab(w.view.week))
    await screen.findByTestId('hours-table-table')
    expect(screen.queryByTestId('hours-banner-unavailable')).not.toBeNull()

    await userEvent.click(viewTab(w.view.list))
    await screen.findByTestId('hours-entries')
    await waitFor(() => expect(screen.queryByTestId('hours-banner-unavailable')).toBeNull())
  })

  it('the List’s notes do not stay on screen while the Week is read: they were about the List', async () => {
    const slow = deferred<FakeAnswer>()
    useApi({
      'GET /time-entries': (url) =>
        url.searchParams.get('limit') === '500'
          ? slow.promise
          : { status: 200, body: entriesPage([ENTRIES[0]!], { unavailable: ['crm'] }) },
    })
    await renderPage('/hours')
    await screen.findByTestId('hours-entries')
    await screen.findByTestId('hours-banner-unavailable')

    await userEvent.click(viewTab(w.view.week))

    await screen.findByTestId('hours-table-skeleton')
    expect(screen.queryByTestId('hours-banner-unavailable')).toBeNull()
    slow.resolve({ status: 200, body: entriesPage([ENTRIES[0]!]) })
    await screen.findByTestId('hours-table-table')
  })
})

describe('the live region of the week (design S7 "Announcements")', () => {
  it('says the week and its total politely when it has arrived', async () => {
    useApi()
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    expect(screen.getByTestId('hours-table-live').textContent).toBe(
      w.announce(rangeOf(THIS_MONDAY, THIS_SUNDAY), '7 hours, 30 minutes'),
    )
  })
})

describe('a write while the Week is shown reads the week again (plan § Components, MyHoursPage)', () => {
  const e = strings.entry

  it('Record hours in the header saves the entry, says "Entry saved." and asks the same week again, not the List’s reads', async () => {
    const written: TimeEntryView[] = []
    useApi({
      'GET /time-entries': (url, init, params) => entriesInRange([...ENTRIES, ...written])(url, init, params),
      'POST /time-entries': (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { day: string; minutes: number }
        written.push(entry(body.day, body.minutes, otherWorkOn('Formazione', 'tc-formazione')))
        return { status: 201, body: written.at(-1) }
      },
    })
    await renderPage('/hours?view=week')
    await screen.findByTestId('hours-table-table')
    const before = entriesCalls().length

    await userEvent.click(screen.getByTestId('hours-record'))
    const dialog = within(screen.getByRole('dialog', { name: e.dialog.recordTitle }))
    await typeDuration(dialog.getByRole('textbox', { name: e.fields.duration.label }), '1:30')
    await userEvent.click(dialog.getByRole('radio', { name: e.fields.on.options.none }))
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: e.fields.category.label }), 'Formazione')
    await userEvent.click(dialog.getByRole('button', { name: e.dialog.save }))

    await screen.findByTestId('hours-entry-saved')
    expect(screen.getByTestId('hours-entry-saved').textContent).toContain(e.saved)
    // The week is read again, and the new row is in it: the figures follow without a reload.
    await waitFor(() => expect(screen.queryByTestId('hours-table-row-category:tc-formazione')).not.toBeNull())
    expect(entriesCalls().length).toBeGreaterThan(before)
    expect(entriesCalls().at(-1)!.query).toMatchObject({ from: THIS_MONDAY, to: THIS_SUNDAY, limit: '500' })
    expect(totalsCalls()).toHaveLength(0)
  })

  it('a save on a day outside the period says nothing about a period the Week does not show', async () => {
    useApi()
    await renderPage(`/hours?view=week&period=lastMonth`)
    await screen.findByTestId('hours-table-table')

    await userEvent.click(screen.getByTestId('hours-record'))
    const dialog = within(screen.getByRole('dialog', { name: e.dialog.recordTitle }))
    await typeDuration(dialog.getByRole('textbox', { name: e.fields.duration.label }), '1:30')
    await userEvent.click(dialog.getByRole('radio', { name: e.fields.on.options.none }))
    await userEvent.selectOptions(dialog.getByRole('combobox', { name: e.fields.category.label }), 'Formazione')
    await userEvent.click(dialog.getByRole('button', { name: e.dialog.save }))

    await screen.findByTestId('hours-entry-saved')
    expect(screen.getByTestId('hours-entry-saved').textContent).toBe(e.saved)
  })
})
