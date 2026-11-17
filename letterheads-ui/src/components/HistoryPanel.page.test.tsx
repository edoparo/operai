/**
 * @vitest-environment jsdom
 *
 * The configurator's history, older versions and restore (task T25; design F8, F9, F10, F11, S5, S6, S8; AC-8.7,
 * AC-4.2, AC-8.2; plan amendments G4, G6, G9). Mounted through `App`, so the requests are the real ones: the
 * Settings | History tabs, the names and the person in the table, an older version opened read-only and previewed
 * on its own layout, the restore after its confirmation (from the table and from the version's banner), and the
 * read-only modes, which render no Save, no Restore and no control that edits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { catalogFixture, defaultConfigFixture, fullConfigFixture } from '../lib/formStateFixtures'
import type { FormConfig } from '../lib/formStateTypes'
import type { LetterheadList } from '../lib/types'
import { fakeApi, letterheadList, previewAnswer, problem } from '../test-support/fakeApi'
import type { FakeAnswer, FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  registerNavigationBlocker: vi.fn(() => () => undefined),
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import App from '../App'

const IT = '/v1/letterheads/welld_it'
const manager = letterheadList({
  welld_it: { activeVersion: 3, canManage: true },
  welld_ch: { activeVersion: 2, canManage: true },
})

const configWith = (top: number): FormConfig => {
  const config = defaultConfigFixture()
  config.margins.top = top
  return config
}

/** welld_it: 3 is active (Ada), 2 (Bob) was saved on layout 2, 1 (Ada) is the first; each has its own top margin. */
const IT_HISTORY = [
  {
    version: 3,
    createdBy: { sub: 'u-ada', name: 'Ada Lovelace' },
    createdAt: '2026-11-12T10:15:00.000Z',
    changedSettings: ['margins'],
    restoredFrom: null,
  },
  {
    version: 2,
    createdBy: { sub: 'u-bob', name: 'Bob Barker' },
    createdAt: '2026-11-05T08:00:00.000Z',
    changedSettings: ['variants.first.footer', 'look.table'],
    restoredFrom: null,
  },
  {
    version: 1,
    createdBy: { sub: 'u-ada', name: 'Ada Lovelace' },
    createdAt: '2026-11-01T07:45:00.000Z',
    changedSettings: ['margins', 'fonts'],
    restoredFrom: null,
  },
]
const TOPS: Record<number, number> = { 1: 10, 2: 20, 3: 25 }
const LAYOUTS: Record<number, number> = { 1: 1, 2: 2, 3: 1 }

const versionRoute = (entity: string, n: number, top: number, layoutVersion = 1): Record<string, FakeHandler> => ({
  [`GET /v1/letterheads/${entity}/versions/${n}`]: () => ({
    status: 200,
    body: { version: n, layoutVersion, config: configWith(top) },
  }),
})

interface Options {
  list?: LetterheadList
  /** What `GET /v1/letterheads` answers from the second time on. */
  refreshed?: LetterheadList
  history?: unknown[] | (() => FakeAnswer)
  routes?: Record<string, FakeHandler>
  path?: string
  /** What to wait for: the form (default), or nothing. */
  ready?: 'form' | 'none'
}

async function renderPage({
  list = manager,
  refreshed,
  history = IT_HISTORY,
  routes = {},
  path = '/letterheads',
  ready = 'form',
}: Options = {}) {
  let listCalls = 0
  apiFetch.mockImplementation(
    fakeApi({
      'GET /v1/catalog': () => ({ status: 200, body: catalogFixture() }),
      'GET /v1/letterheads': () => ({ status: 200, body: ++listCalls > 1 && refreshed ? refreshed : list }),
      [`GET ${IT}/versions`]: () => (typeof history === 'function' ? history() : { status: 200, body: history }),
      'GET /v1/letterheads/welld_ch/versions': () => ({ status: 200, body: [] }),
      'POST /v1/letterheads/welld_it/preview': () => ({ status: 200, body: previewAnswer(1) }),
      'POST /v1/letterheads/welld_ch/preview': () => ({ status: 200, body: previewAnswer(1) }),
      ...Object.fromEntries([1, 2, 3].flatMap((n) => Object.entries(versionRoute('welld_it', n, TOPS[n], LAYOUTS[n])))),
      ...versionRoute('welld_ch', 2, 40),
      ...routes,
    }),
  )
  window.history.pushState(null, '', path)
  const view = render(<App />)
  await screen.findByTestId('letterheads-page')
  if (ready === 'form') await screen.findByTestId('letterheads-form')
  return view
}

const calls = (method: string, pathname: string) =>
  apiFetch.mock.calls.filter(
    ([url, init]) =>
      new URL(String(url)).pathname === pathname && ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  )
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)
const previewBodies = () => calls('POST', `${IT}/preview`).map(bodyOf)

const input = (name: string | RegExp) => screen.getByRole('textbox', { name }) as HTMLInputElement
const heading = () => screen.getByTestId('letterheads-entity-heading')
const status = () => screen.getByTestId('letterheads-status').textContent
const historyTab = () => screen.getByRole('tab', { name: 'History' })
const settingsTab = () => screen.getByRole('tab', { name: 'Settings' })
const table = () => screen.findByTestId('letterheads-history-table')
const rowOf = (n: number) => screen.getByTestId(`letterheads-history-row-${n}`)
const search = () => new URLSearchParams(window.location.search)

async function edit(name: string | RegExp, value: string) {
  await userEvent.clear(input(name))
  await userEvent.type(input(name), value)
}

async function openHistory() {
  await userEvent.click(historyTab())
  await table()
}

/** Every control of the form's fieldset that edits, as the browser sees it: all of them are disabled. */
const editingControls = () =>
  Array.from(
    document
      .querySelector('[data-testid="letterheads-form"] fieldset')!
      .querySelectorAll<HTMLElement>('input, select, textarea, button'),
  )

const MUTATING_BUTTON = /^(save|restore|upload|remove|choose file|add a line)/i
const enabledMutating = () =>
  screen
    .queryAllByRole('button')
    .filter(
      (button) =>
        MUTATING_BUTTON.test(button.textContent ?? '') || MUTATING_BUTTON.test(button.getAttribute('aria-label') ?? ''),
    )

beforeEach(() => {
  window.scrollTo = () => undefined
  if (typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== 'function') {
    Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the History view (F8, S8; AC-8.7)', () => {
  it('is a second tab of the entity, Settings first, and shows the table of versions with their names and who saved them', async () => {
    await renderPage()
    expect(screen.getByRole('tablist', { name: 'Views of this letterhead' })).toBeTruthy()
    expect(settingsTab().getAttribute('aria-selected')).toBe('true')
    expect(calls('GET', `${IT}/versions`)).toHaveLength(0)

    await openHistory()
    expect(historyTab().getAttribute('aria-selected')).toBe('true')
    expect(search().get('view')).toBe('history')
    expect(screen.getByRole('table', { name: 'Versions of wellD IT' })).toBeTruthy()
    const cells = (n: number) =>
      within(rowOf(n))
        .getAllByRole('cell')
        .map((td) => td.textContent)
    expect(within(rowOf(3)).getByRole('rowheader').textContent).toBe('3Active')
    expect(cells(3)[0]).toBe('Ada Lovelace')
    expect(cells(3)[2]).toBe('Margins')
    expect(cells(2)[0]).toBe('Bob Barker')
    expect(cells(2)[2]).toBe('First page footer, Tables')
    expect(cells(1)[2]).toBe('Margins, Fonts')
    // The account id never reaches the screen.
    expect(screen.getByTestId('letterheads-history').textContent).not.toContain('u-ada')
  })

  it('keeps the preview beside the table, and a Preview button for the narrow layout', async () => {
    await renderPage()
    await openHistory()
    expect(screen.getByTestId('letterheads-preview-aside')).toBeTruthy()
    expect(screen.getByTestId('letterheads-preview-open')).toBeTruthy()
    await userEvent.click(screen.getByTestId('letterheads-preview-open'))
    expect(await screen.findByTestId('letterheads-preview-drawer-backdrop')).toBeTruthy()
  })

  it('opens from the address (?view=history) and answers the keyboard: ArrowLeft moves to Settings, ArrowRight back', async () => {
    await renderPage({ path: '/letterheads?view=history' })
    await table()
    expect(historyTab().getAttribute('aria-selected')).toBe('true')
    historyTab().focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(settingsTab().getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(settingsTab())
    expect(search().get('view')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Top' })).toBeTruthy()
    await userEvent.keyboard('{ArrowRight}')
    expect(historyTab().getAttribute('aria-selected')).toBe('true')
    expect(search().get('view')).toBe('history')
    await table()
  })

  it('does not lose what was typed in the form by looking at the history and coming back', async () => {
    await renderPage()
    await edit('Top', '30')
    expect(status()).toBe('Unsaved changes')
    await openHistory()
    // The form is hidden, not gone: nothing of it is reachable by the keyboard or read out, and nothing asks to leave.
    expect(screen.queryByRole('textbox', { name: 'Top' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await userEvent.click(settingsTab())
    expect(input('Top').value).toBe('30')
    expect(status()).toBe('Unsaved changes')
    // No second request for the version, and the preview was not asked for again by the round trip.
    expect(calls('GET', `${IT}/versions/3`)).toHaveLength(1)
  })

  it('shows an entity with no versions as "No versions yet" (a manager may open it before the first save)', async () => {
    await renderPage({
      list: letterheadList({ welld_it: { activeVersion: null, canManage: true }, welld_ch: manager.welld_ch }),
      history: [],
    })
    await openHistory().catch(() => undefined)
    expect((await screen.findByTestId('letterheads-history-empty')).textContent).toBe('No versions yet')
  })

  it('shows a failed history with Retry and keeps the form for the way back', async () => {
    let calls_ = 0
    await renderPage({
      history: () => (++calls_ === 1 ? problem(503, 'service_unavailable') : { status: 200, body: IT_HISTORY }),
    })
    await userEvent.click(historyTab())
    await screen.findByTestId('letterheads-load-error')
    await userEvent.click(screen.getByTestId('letterheads-load-error-retry'))
    await table()
  })

  it('goes with the entity: the other entity’s history is shown when the tab changes, and an open version is left', async () => {
    await renderPage({ path: '/letterheads?version=2' })
    await screen.findByTestId('letterheads-version-banner')
    await userEvent.click(screen.getByRole('tab', { name: 'wellD CH' }))
    await waitFor(() => expect(input('Top').value).toBe('40'))
    expect(search().get('entity')).toBe('welld_ch')
    expect(search().get('version')).toBeNull()
    expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()
    await userEvent.click(historyTab())
    expect((await screen.findByTestId('letterheads-history-empty')).textContent).toBe('No versions yet')
    await userEvent.click(screen.getByRole('tab', { name: 'wellD IT' }))
    await table()
    expect(search().get('view')).toBe('history')
  })

  it('has no accessibility violations', async () => {
    const { container } = await renderPage()
    await openHistory()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('an older version (F8, S6; AC-8.7; G6)', () => {
  it('opens from the table: the form loads that version read-only, under a banner that says who saved it and when', async () => {
    await renderPage()
    await openHistory()
    await userEvent.click(within(rowOf(2)).getByRole('button', { name: 'Open version 2 in the preview' }))
    const banner = await screen.findByTestId('letterheads-version-banner')
    expect(search().get('version')).toBe('2')
    expect(search().get('view')).toBeNull()
    expect(within(banner).getByRole('heading', { name: 'Viewing version 2' })).toBeTruthy()
    await waitFor(() =>
      expect(banner.textContent).toMatch(
        /Saved by Bob Barker on 05\.11\.2026 \d{2}:\d{2}\. This is not the active version\./,
      ),
    )
    expect(banner.getAttribute('role')).toBe('note')
    // The Settings tab is the one selected, and the form is that version's.
    expect(settingsTab().getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('2')
    expect(input('Top').value).toBe('20')
    // Focus is on the banner's heading.
    expect(document.activeElement).toBe(within(banner).getByRole('heading'))
  })

  it('is read-only whatever the person may change: no Save, every control disabled, no second banner about permissions', async () => {
    await renderPage({ path: '/letterheads?version=2' })
    await screen.findByTestId('letterheads-version-banner')
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    expect(screen.queryByTestId('letterheads-status')).toBeNull()
    expect(screen.queryByTestId('letterheads-readonly-banner')).toBeNull()
    const controls = editingControls()
    expect(controls.length).toBeGreaterThan(30)
    expect(controls.every((control) => control.matches(':disabled'))).toBe(true)
    expect(input('Top').matches(':disabled')).toBe(true)
  })

  it('previews that version on the layout it was saved with; the form of the active version does not send one', async () => {
    await renderPage()
    await waitFor(() => expect(previewBodies().length).toBeGreaterThan(0))
    expect(previewBodies().every((body) => !('layoutVersion' in body))).toBe(true)
    cleanup()
    apiFetch.mockClear()

    await renderPage({ path: '/letterheads?version=2' })
    await waitFor(() => expect(previewBodies().length).toBeGreaterThan(0))
    const [first] = previewBodies()
    expect(first.layoutVersion).toBe(2)
    expect(first.config.margins.top).toBe(20)
    // A viewing choice keeps the layout: the language changes, the layout does not.
    await userEvent.click(screen.getByTestId('letterheads-preview-language-it'))
    await waitFor(() => expect(previewBodies().some((body) => body.language === 'it')).toBe(true))
    expect(previewBodies().every((body) => body.layoutVersion === 2)).toBe(true)
  })

  it('goes back to the active version: its form, the address without the version, focus on the page heading', async () => {
    await renderPage({ path: '/letterheads?version=2' })
    const banner = await screen.findByTestId('letterheads-version-banner')
    await userEvent.click(within(banner).getByRole('button', { name: 'Back to the active version' }))
    await screen.findByTestId('letterheads-save')
    expect(search().get('version')).toBeNull()
    expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()
    expect(input('Top').value).toBe('25')
    expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('3')
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('treats the active version as the Settings view, and what is not a version number as none', async () => {
    await renderPage({ path: '/letterheads?version=3' })
    expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()
    expect(screen.getByTestId('letterheads-save')).toBeTruthy()
    cleanup()
    for (const text of ['abc', '0', '-2', '1.5', '2abc']) {
      await renderPage({ path: `/letterheads?version=${text}` })
      expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()
      expect(screen.getByTestId('letterheads-save')).toBeTruthy()
      cleanup()
    }
  })

  it('wins over the History view when both are in the address: it is shown, in Settings', async () => {
    await renderPage({ path: '/letterheads?view=history&version=1' })
    await screen.findByTestId('letterheads-version-banner')
    expect(settingsTab().getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByTestId('letterheads-history')).toBeNull()
  })

  it('says a version that does not exist could not be loaded, and offers the way back', async () => {
    await renderPage({
      path: '/letterheads?version=99',
      ready: 'none',
      routes: { [`GET ${IT}/versions/99`]: () => problem(404, 'letterhead_version_not_found') },
    })
    const notFound = await screen.findByTestId('letterheads-version-notfound')
    expect(notFound.textContent).toContain('This version could not be loaded.')
    expect(screen.queryByTestId('letterheads-form')).toBeNull()
    await userEvent.click(within(notFound).getByRole('button', { name: 'Back to the active version' }))
    await screen.findByTestId('letterheads-save')
    expect(search().get('version')).toBeNull()
  })

  it('retries a version that failed to load for another reason', async () => {
    let attempts = 0
    await renderPage({
      path: '/letterheads?version=2',
      ready: 'none',
      routes: {
        [`GET ${IT}/versions/2`]: () =>
          ++attempts === 1
            ? problem(500)
            : { status: 200, body: { version: 2, layoutVersion: 1, config: configWith(20) } },
      },
    })
    await screen.findByTestId('letterheads-load-error')
    await userEvent.click(screen.getByTestId('letterheads-load-error-retry'))
    await screen.findByTestId('letterheads-version-banner')
    expect(input('Top').value).toBe('20')
  })

  it('still opens when the history cannot say who saved it: the banner says only that it is not the active version', async () => {
    await renderPage({ path: '/letterheads?version=2', history: () => problem(503, 'service_unavailable') })
    const banner = await screen.findByTestId('letterheads-version-banner')
    expect(banner.textContent).toContain('Viewing version 2')
    expect(banner.textContent).toContain('This is not the active version.')
    expect(banner.textContent).not.toContain('Saved by')
  })

  it('asks before leaving unsaved changes to open a version: Keep editing stays, Open and discard goes', async () => {
    await renderPage()
    await edit('Top', '30')
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Open version 1 in the preview' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Leave without saving?')).toBeTruthy()
    expect(dialog.textContent).toContain('You have unsaved changes to the letterhead of wellD IT.')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(search().get('version')).toBeNull()
    await userEvent.click(settingsTab())
    expect(input('Top').value).toBe('30')
    // Now the other way.
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Open version 1 in the preview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open and discard' }))
    await screen.findByTestId('letterheads-version-banner')
    expect(search().get('version')).toBe('1')
    expect(input('Top').value).toBe('10')
  })

  it('opens without asking when nothing is unsaved', async () => {
    await renderPage()
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Open version 1 in the preview' }))
    await screen.findByTestId('letterheads-version-banner')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('"opens" the active version as the Settings view, and a form with changes is reloaded on it after the question', async () => {
    await renderPage()
    await openHistory()
    await userEvent.click(within(rowOf(3)).getByRole('button', { name: 'Open version 3 in the preview' }))
    await screen.findByTestId('letterheads-save')
    expect(search().get('version')).toBeNull()
    expect(search().get('view')).toBeNull()
    expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()

    await edit('Top', '31')
    await openHistory()
    await userEvent.click(within(rowOf(3)).getByRole('button', { name: 'Open version 3 in the preview' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open and discard' }))
    await waitFor(() => expect(status()).toBe('No unsaved changes'))
    expect(input('Top').value).toBe('25')
  })

  it('has no accessibility violations, with the banner and with the dialog', async () => {
    const { container } = await renderPage({ path: '/letterheads?version=2' })
    await screen.findByTestId('letterheads-version-banner')
    await waitFor(() => expect(screen.getByTestId('letterheads-version-banner').textContent).toContain('Saved by'))
    expect(await axeViolations(container)).toEqual([])
    await userEvent.click(screen.getByTestId('letterheads-version-restore'))
    await screen.findByRole('alertdialog')
    expect(await axeViolations(document.body)).toEqual([])
  })
})

describe('Restore (F8; AC-4.2)', () => {
  const restored = (n: number, top: number) => ({
    ...versionRoute('welld_it', n, top),
    [`POST ${IT}/versions/1/restore`]: () => ({ status: 201, body: { version: n } }),
  })
  const after = letterheadList({
    welld_it: { activeVersion: 4, canManage: true },
    welld_ch: manager.welld_ch,
  })

  it('from the table: asks, posts the active version as the base, then shows the new version, editable, with its confirmation', async () => {
    await renderPage({ refreshed: after, routes: restored(4, 10) })
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('creates version 4 with the same settings and logos as version 1')
    expect(dialog.textContent).toContain('Version 3 and the rest of the history stay as they are.')
    expect(calls('POST', `${IT}/versions/1/restore`)).toHaveLength(0)

    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const [post, ...more] = calls('POST', `${IT}/versions/1/restore`)
    expect(more).toEqual([])
    expect(bodyOf(post)).toEqual({ baseVersion: 3 })

    // The page is the Settings view of the new active version, editable, with the confirmation.
    await waitFor(() => expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('4'))
    expect(settingsTab().getAttribute('aria-selected')).toBe('true')
    expect(search().get('view')).toBeNull()
    expect(input('Top').value).toBe('10')
    expect(input('Top').matches(':disabled')).toBe(false)
    expect(screen.getByTestId('letterheads-save').textContent).toBe('Save as version 5')
    expect(screen.getByTestId('letterheads-restored').textContent).toBe('Version 4 created from version 1')
    expect(screen.getByTestId('letterheads-restored').getAttribute('role')).toBe('status')
    expect(screen.getByText('Active version 4')).toBeTruthy()
    expect(status()).toBe('No unsaved changes')
    // Focus is on the page heading, and the shell's list was read again.
    await waitFor(() => expect(document.activeElement).toBe(heading()))
    expect(calls('GET', '/v1/letterheads').length).toBeGreaterThanOrEqual(2)
    // The old versions are untouched: only a restore was posted, nothing was saved.
    expect(calls('POST', `${IT}/versions`)).toHaveLength(0)
  })

  it('the history that follows shows the restore as the active version', async () => {
    await renderPage({ refreshed: after, routes: restored(4, 10) })
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    await userEvent.click(await screen.findByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('4'))
    const next = [
      {
        version: 4,
        createdBy: { sub: 'u-ada', name: 'Ada Lovelace' },
        createdAt: '2026-11-17T09:00:00.000Z',
        changedSettings: ['margins'],
        restoredFrom: 1,
      },
      ...IT_HISTORY,
    ]
    apiFetch.mockImplementation(
      fakeApi({
        [`GET ${IT}/versions`]: () => ({ status: 200, body: next }),
        'POST /v1/letterheads/welld_it/preview': () => ({ status: 200, body: previewAnswer(1) }),
      }),
    )
    await openHistory()
    expect(within(rowOf(4)).getByRole('rowheader').textContent).toBe('4ActiveRestored from version 1')
    expect(within(rowOf(4)).getAllByRole('cell')[2].textContent).toBe('Same settings as version 1')
    expect(within(rowOf(4)).queryByRole('button', { name: /^Restore/ })).toBeNull()
    expect(within(rowOf(3)).queryByRole('button', { name: 'Restore version 3' })).not.toBeNull()
  })

  it('from the version’s banner: the same confirmation and request, and the version is left for the new active one', async () => {
    await renderPage({ path: '/letterheads?version=1', refreshed: after, routes: restored(4, 10) })
    const banner = await screen.findByTestId('letterheads-version-banner')
    await userEvent.click(within(banner).getByRole('button', { name: 'Restore this version' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Restore version 1?')).toBeTruthy()
    expect(dialog.textContent).toContain('creates version 4')
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('4'))
    expect(bodyOf(calls('POST', `${IT}/versions/1/restore`)[0])).toEqual({ baseVersion: 3 })
    expect(search().get('version')).toBeNull()
    expect(screen.queryByTestId('letterheads-version-banner')).toBeNull()
    expect(screen.getByTestId('letterheads-restored').textContent).toBe('Version 4 created from version 1')
    expect(input('Top').matches(':disabled')).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('says unsaved changes are lost when the form holds some, and they are', async () => {
    await renderPage({ refreshed: after, routes: restored(4, 10) })
    await edit('Top', '31')
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByTestId('letterheads-restore-discards').textContent).toBe(
      'The unsaved changes in the form are lost.',
    )
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('4'))
    expect(input('Top').value).toBe('10')
    expect(status()).toBe('No unsaved changes')
  })

  it('does not warn about unsaved changes when there are none', async () => {
    await renderPage()
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    await screen.findByRole('alertdialog')
    expect(screen.queryByTestId('letterheads-restore-discards')).toBeNull()
  })

  it('does nothing when cancelled: no request, the history stays, focus returns to the button that opened it', async () => {
    await renderPage()
    await openHistory()
    const button = within(rowOf(2)).getByRole('button', { name: 'Restore version 2' })
    await userEvent.click(button)
    await userEvent.click(await screen.findByTestId('letterheads-restore-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls('POST', `${IT}/versions/2/restore`)).toHaveLength(0)
    expect(document.activeElement).toBe(button)
    expect(screen.queryByTestId('letterheads-restored')).toBeNull()
  })

  it('on 409 says a newer version was saved, asks for the history and the list again, and the next try is based on the new one', async () => {
    let restoreCalls = 0
    let historyCalls = 0
    const newer = [{ ...IT_HISTORY[0], version: 4 }, ...IT_HISTORY]
    await renderPage({
      history: () => ({ status: 200, body: ++historyCalls === 1 ? IT_HISTORY : newer }),
      routes: {
        [`POST ${IT}/versions/1/restore`]: () =>
          ++restoreCalls === 1
            ? problem(409, 'version_conflict', { currentVersion: 4 })
            : { status: 201, body: { version: 5 } },
        ...versionRoute('welld_it', 5, 10),
      },
    })
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    await userEvent.click(await screen.findByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'A newer version was saved meanwhile. Reload the history and try again.',
    )
    // The history behind the dialog is the new one, and so is the shell's list.
    await waitFor(() => expect(within(rowOf(4)).getByText('Active')).toBeTruthy())
    expect(calls('GET', '/v1/letterheads').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('alertdialog').textContent).toContain('creates version 5')
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.getByTestId('letterheads-form').getAttribute('data-version')).toBe('5'))
    expect(calls('POST', `${IT}/versions/1/restore`).map(bodyOf)).toEqual([{ baseVersion: 3 }, { baseVersion: 4 }])
  })

  it('on 403 says the grant is gone, and the page turns read-only: no Restore, no Save, Open still works', async () => {
    await renderPage({ routes: { [`POST ${IT}/versions/1/restore`]: () => problem(403, 'out_of_scope') } })
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    await userEvent.click(await screen.findByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'You can no longer change this letterhead',
    )
    await userEvent.click(screen.getByTestId('letterheads-restore-cancel'))
    expect(screen.getByTestId('letterheads-lost')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
    expect(within(rowOf(1)).queryByRole('button', { name: 'Open version 1 in the preview' })).not.toBeNull()
    await userEvent.click(settingsTab())
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    expect(input('Top').matches(':disabled')).toBe(true)
  })

  it('on a failure says nothing changed, stays on the history, and does not claim a new version', async () => {
    await renderPage({ routes: { [`POST ${IT}/versions/1/restore`]: () => problem(500) } })
    await openHistory()
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' }))
    await userEvent.click(await screen.findByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'Version 1 was not restored. Nothing changed. Try again.',
    )
    await userEvent.click(screen.getByTestId('letterheads-restore-cancel'))
    expect(screen.queryByTestId('letterheads-restored')).toBeNull()
    expect(screen.getByTestId('letterheads-history-table')).toBeTruthy()
    expect(search().get('view')).toBe('history')
  })
})

describe('read-only modes: no mutating control (F10, F11, S5; AC-8.2; G4)', () => {
  const accessOnly = letterheadList({
    welld_it: { activeVersion: 3, canManage: false },
    welld_ch: { activeVersion: 2, canManage: false },
  })

  it('access only, Settings: the reason, a disabled form, no Save, no Restore, nothing that uploads or edits', async () => {
    await renderPage({ list: accessOnly })
    expect(screen.getByTestId('letterheads-readonly-banner').textContent).toContain('you cannot change it')
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    expect(editingControls().every((control) => control.matches(':disabled'))).toBe(true)
    expect(screen.queryByRole('button', { name: /^(Save|Restore)/ })).toBeNull()
    // Everything that would change the form is inert, and hidden from sight and from assistive technology.
    expect(document.querySelector('[data-testid="letterheads-form"] fieldset')!.className).toContain(
      '[&_button]:hidden',
    )
    // The history, the preview and the language switch work.
    expect(screen.getByTestId('letterheads-preview-language-it')).toBeTruthy()
    await openHistory()
  })

  it('access only, History: lists everything and opens a version, and offers no Restore on any row', async () => {
    await renderPage({ list: accessOnly })
    await openHistory()
    expect(screen.getAllByRole('button', { name: /^Open version/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
    expect(enabledMutating()).toEqual([])
    await userEvent.click(within(rowOf(2)).getByRole('button', { name: 'Open version 2 in the preview' }))
    const banner = await screen.findByTestId('letterheads-version-banner')
    expect(within(banner).getByRole('button', { name: 'Back to the active version' })).toBeTruthy()
    expect(within(banner).queryByRole('button', { name: 'Restore this version' })).toBeNull()
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    expect(editingControls().every((control) => control.matches(':disabled'))).toBe(true)
    expect(input('Top').value).toBe('20')
  })

  it('access only: an older version from a link is the same, and a restore can never be posted', async () => {
    await renderPage({ list: accessOnly, path: '/letterheads?version=1' })
    await screen.findByTestId('letterheads-version-banner')
    expect(screen.queryByTestId('letterheads-version-restore')).toBeNull()
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull()
    expect(calls('POST', `${IT}/versions/1/restore`)).toHaveLength(0)
  })

  it('a manager of one entity: the other one is read-only with the more specific reason, and offers no Restore', async () => {
    await renderPage({
      path: '/letterheads?entity=welld_ch&view=history',
      list: letterheadList({
        welld_it: { activeVersion: 3, canManage: true },
        welld_ch: { activeVersion: 2, canManage: false },
      }),
      routes: {
        'GET /v1/letterheads/welld_ch/versions': () => ({
          status: 200,
          body: [
            { ...IT_HISTORY[1], version: 2 },
            { ...IT_HISTORY[2], version: 1 },
          ],
        }),
      },
    })
    await table()
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Open version/ })).toHaveLength(2)
    await userEvent.click(settingsTab())
    expect(screen.getByTestId('letterheads-readonly-banner').textContent).toBe(
      'You can change only the letterhead of wellD IT. This one is read-only for you.',
    )
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
    // Their own entity is editable, with Restore.
    await userEvent.click(screen.getByRole('tab', { name: 'wellD IT' }))
    await screen.findByTestId('letterheads-save')
    await openHistory()
    expect(within(rowOf(1)).getByRole('button', { name: 'Restore version 1' })).toBeTruthy()
  })

  it('an entity with nothing saved, for someone who cannot change it, has no tabs and no history to open', async () => {
    await renderPage({ list: letterheadList(), ready: 'none' })
    expect(screen.getByTestId('letterheads-empty-readonly')).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: 'Views of this letterhead' })).toBeNull()
    expect(calls('GET', `${IT}/versions`)).toHaveLength(0)
  })

  it('has no accessibility violations read-only in the History view and in the version view', async () => {
    const { container } = await renderPage({ list: accessOnly })
    await openHistory()
    expect(await axeViolations(container)).toEqual([])
    await userEvent.click(within(rowOf(1)).getByRole('button', { name: 'Open version 1 in the preview' }))
    await screen.findByTestId('letterheads-version-banner')
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('the version of an entity with a full configuration', () => {
  it('shows everything the version holds (variants, logo, background) read-only', async () => {
    await renderPage({
      path: '/letterheads?version=2',
      routes: {
        [`GET ${IT}/versions/2`]: () => ({
          status: 200,
          body: { version: 2, layoutVersion: 1, config: fullConfigFixture() },
        }),
      },
    })
    await screen.findByTestId('letterheads-version-banner')
    const controls = editingControls()
    expect(controls.length).toBeGreaterThan(200)
    expect(controls.every((control) => control.matches(':disabled'))).toBe(true)
    expect(screen.queryByTestId('letterheads-save')).toBeNull()
  })
})
