/**
 * @vitest-environment jsdom
 *
 * HistoryPanel (task T25; design F8, S8; AC-8.7, AC-4.2): the table of versions with the names from the G9
 * vocabulary and the person's name, Open, and Restore after the confirmation: the request it posts, the busy
 * dialog, a 409 that loads the history again, a 403, and a failure that leaves the dialog open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { fakeApi, problem } from '../test-support/fakeApi'
import type { FakeAnswer, FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
}))

import { HistoryPanel } from './HistoryPanel'
import type { HistoryPanelProps } from './HistoryPanel'

const HISTORY = '/v1/letterheads/welld_it/versions'
const RESTORE = (n: number) => `/v1/letterheads/welld_it/versions/${n}/restore`

const row = (version: number, over: Record<string, unknown> = {}) => ({
  version,
  createdBy: { sub: `sub-${version}`, name: `Person ${version}` },
  createdAt: `2026-11-0${version}T09:30:00.000Z`,
  changedSettings: ['margins', 'variants.first.footer'],
  restoredFrom: null,
  ...over,
})

/** Four versions: 4 restored 2 and is active; 3 changed the look; 2 and 1 are saves. */
const FOUR = [
  row(4, { restoredFrom: 2, changedSettings: ['fonts'] }),
  row(3, { changedSettings: ['look.headings', 'look.table'] }),
  row(2),
  row(1, { changedSettings: [] }),
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

interface Setup {
  rows?: unknown[] | (() => FakeAnswer)
  routes?: Record<string, FakeHandler>
  props?: Partial<HistoryPanelProps>
}

function panel({ rows = FOUR, routes = {}, props = {} }: Setup = {}) {
  apiFetch.mockImplementation(
    fakeApi({
      [`GET ${HISTORY}`]: () => (typeof rows === 'function' ? rows() : { status: 200, body: rows }),
      ...routes,
    }),
  )
  const handlers = {
    onOpen: vi.fn(),
    onRestored: vi.fn(),
    onLost: vi.fn(),
    onConflict: vi.fn(),
    wouldLose: vi.fn(() => false),
  }
  const view = render(<HistoryPanel entity="welld_it" canRestore {...handlers} {...props} />)
  return { ...handlers, ...view }
}

const table = () => screen.findByTestId('letterheads-history-table')
const rowOf = (n: number) => screen.getByTestId(`letterheads-history-row-${n}`)
const posts = (path: string) =>
  apiFetch.mock.calls.filter(
    ([url, init]) => new URL(String(url)).pathname === path && (init as RequestInit | undefined)?.method === 'POST',
  )
const body = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

describe('the table (F8, S8; AC-8.7)', () => {
  it('lists every version newest first with its number, who saved it, when and the names of what changed', async () => {
    panel()
    await table()
    expect(screen.getByRole('table', { name: 'Versions of wellD IT' })).toBeTruthy()
    expect(
      within(screen.getByRole('table'))
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Version', 'Saved by', 'Saved on', 'What changed', 'Actions'])
    const bodyRows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(bodyRows.map((tr) => within(tr).getAllByRole('rowheader')[0].textContent)).toEqual([
      '4ActiveRestored from version 2',
      '3',
      '2',
      '1',
    ])
    const cells = (n: number) =>
      within(rowOf(n))
        .getAllByRole('cell')
        .map((td) => td.textContent)
    expect(cells(3).slice(0, 3)).toEqual(['Person 3', '03.11.2026 ' + cells(3)[1].slice(-5), 'Headings, Tables'])
    expect(cells(2)[2]).toBe('Margins, First page footer')
    // A restore says whose settings it copied, not the names it happened to differ in.
    expect(cells(4)[2]).toBe('Same settings as version 2')
    expect(cells(1)[2]).toBe('No settings changed')
  })

  it('shows the person’s name, not their account id, and a date in the suite’s format with its instant', async () => {
    panel()
    await table()
    expect(rowOf(3).textContent).toContain('Person 3')
    expect(rowOf(3).textContent).not.toContain('sub-3')
    const time = rowOf(3).querySelector('time')!
    expect(time.getAttribute('datetime')).toBe('2026-11-03T09:30:00.000Z')
    expect(time.textContent).toMatch(/^03\.11\.2026 \d{2}:\d{2}$/)
  })

  it('marks only the highest version Active, by a word and not by colour', async () => {
    panel({ rows: [row(2), row(7), row(5)] })
    await table()
    expect(screen.getAllByText('Active')).toHaveLength(1)
    expect(within(rowOf(7)).getByText('Active')).toBeTruthy()
  })

  it('names the buttons by the version they act on, and Restore as opening a dialog', async () => {
    panel()
    await table()
    expect(within(rowOf(3)).getByRole('button', { name: 'Open version 3 in the preview' }).textContent).toBe('Open')
    const restore = within(rowOf(3)).getByRole('button', { name: 'Restore version 3' })
    expect(restore.textContent).toBe('Restore')
    expect(restore.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('offers Open on every row, the active one included, and Restore on every row but the active one', async () => {
    panel()
    await table()
    for (const n of [1, 2, 3, 4])
      expect(within(rowOf(n)).queryByRole('button', { name: `Open version ${n} in the preview` })).not.toBeNull()
    expect(within(rowOf(4)).queryByRole('button', { name: /^Restore/ })).toBeNull()
    for (const n of [1, 2, 3])
      expect(within(rowOf(n)).queryByRole('button', { name: `Restore version ${n}` })).not.toBeNull()
  })

  it('offers no Restore at all to someone who may not change the letterhead, and still lets them open a version', async () => {
    const { onOpen } = panel({ props: { canRestore: false } })
    await table()
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull()
    await userEvent.click(within(rowOf(2)).getByRole('button', { name: 'Open version 2 in the preview' }))
    expect(onOpen).toHaveBeenCalledWith(2)
  })

  it('shows an empty history as "No versions yet"', async () => {
    panel({ rows: [] })
    expect((await screen.findByTestId('letterheads-history-empty')).textContent).toBe('No versions yet')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows a skeleton with a polite line while it loads', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    panel({
      rows: () => {
        throw new Error('replaced below')
      },
      routes: {
        [`GET ${HISTORY}`]: async () => {
          await gate
          return { status: 200, body: FOUR }
        },
      },
    })
    expect(screen.getByTestId('letterheads-loading').textContent).toContain('Loading the history…')
    release()
    await table()
    expect(screen.queryByTestId('letterheads-loading')).toBeNull()
  })

  it('says it could not load, with Retry, and loads again', async () => {
    let calls = 0
    panel({ rows: () => (++calls === 1 ? problem(500) : { status: 200, body: FOUR }) })
    await screen.findByTestId('letterheads-load-error')
    await userEvent.click(screen.getByTestId('letterheads-load-error-retry'))
    await table()
    expect(calls).toBe(2)
  })

  it('treats an answer that is not a list as a failure to load, not as an empty history', async () => {
    panel({ rows: () => ({ status: 200, body: { versions: [] } }) })
    await screen.findByTestId('letterheads-load-error')
    expect(screen.queryByTestId('letterheads-history-empty')).toBeNull()
  })

  it('has no accessibility violations', async () => {
    const { container } = panel()
    await table()
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('Restore (F8; AC-4.2)', () => {
  const openDialog = async (n = 2) => {
    await table()
    await userEvent.click(within(rowOf(n)).getByRole('button', { name: `Restore version ${n}` }))
    return screen.findByRole('alertdialog')
  }

  it('asks first: says what it creates and that the history stays, and posts nothing until it is confirmed', async () => {
    panel()
    const dialog = await openDialog(2)
    expect(within(dialog).getByText('Restore version 2?')).toBeTruthy()
    expect(dialog.textContent).toContain(
      'This creates version 5 with the same settings and logos as version 2 and makes it the active one. Version 4 and the rest of the history stay as they are.',
    )
    expect(within(dialog).queryByTestId('letterheads-restore-discards')).toBeNull()
    expect(posts(RESTORE(2))).toHaveLength(0)
    // Cancel is where focus starts, and cancelling leaves everything as it was.
    expect(document.activeElement).toBe(screen.getByTestId('letterheads-restore-cancel'))
    await userEvent.click(screen.getByTestId('letterheads-restore-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(posts(RESTORE(2))).toHaveLength(0)
  })

  it('posts the base version it is looking at, and hands the new version to the page', async () => {
    const { onRestored } = panel({ routes: { [`POST ${RESTORE(2)}`]: () => ({ status: 201, body: { version: 5 } }) } })
    await openDialog(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(5, 2))
    expect(posts(RESTORE(2))).toHaveLength(1)
    expect(body(posts(RESTORE(2))[0])).toEqual({ baseVersion: 4 })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns that unsaved changes in the form are lost when there are some', async () => {
    panel({ props: { wouldLose: () => true } })
    const dialog = await openDialog(3)
    expect(within(dialog).getByTestId('letterheads-restore-discards').textContent).toBe(
      'The unsaved changes in the form are lost.',
    )
  })

  it('is busy while it runs: Confirm cannot be pressed twice and the dialog cannot be closed', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { onRestored } = panel({
      routes: {
        [`POST ${RESTORE(2)}`]: async () => {
          await gate
          return { status: 201, body: { version: 5 } }
        },
      },
    })
    await openDialog(2)
    const confirm = screen.getByTestId('letterheads-restore-confirm') as HTMLButtonElement
    await userEvent.click(confirm)
    await waitFor(() => expect(confirm.textContent).toBe('Restoring…'))
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    expect((screen.getByTestId('letterheads-restore-cancel') as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(confirm)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeNull()
    release()
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    expect(posts(RESTORE(2))).toHaveLength(1)
  })

  it('on 409 says a newer version was saved, loads the history again behind the dialog and uses it next time', async () => {
    let listCalls = 0
    let restoreCalls = 0
    const { onConflict, onRestored } = panel({
      rows: () => ({ status: 200, body: ++listCalls === 1 ? FOUR : [row(5), ...FOUR] }),
      routes: {
        [`POST ${RESTORE(2)}`]: () =>
          ++restoreCalls === 1
            ? problem(409, 'version_conflict', { currentVersion: 5 })
            : { status: 201, body: { version: 6 } },
      },
    })
    await openDialog(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'A newer version was saved meanwhile. Reload the history and try again.',
    )
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    // The history behind it is the new one: 5 is active, so the dialog now says what a restore would do.
    await waitFor(() => expect(screen.getByRole('alertdialog').textContent).toContain('creates version 6'))
    expect(listCalls).toBe(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(6, 2))
    expect(posts(RESTORE(2)).map(body)).toEqual([{ baseVersion: 4 }, { baseVersion: 5 }])
  })

  it('on 403 says the grant is gone, tells the page, and leaves the dialog open', async () => {
    const { onLost, onRestored } = panel({ routes: { [`POST ${RESTORE(2)}`]: () => problem(403, 'out_of_scope') } })
    await openDialog(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'You can no longer change this letterhead',
    )
    expect(onLost).toHaveBeenCalledTimes(1)
    expect(onRestored).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it.each([
    ['a server error', () => problem(500)],
    ['a busy service', () => problem(429, 'busy')],
    ['a version that is not there', () => problem(404, 'letterhead_version_not_found')],
  ])('on %s says nothing changed, stays open, and a second try can succeed', async (_name, failure) => {
    let calls = 0
    const { onRestored, onLost, onConflict } = panel({
      routes: { [`POST ${RESTORE(3)}`]: () => (++calls === 1 ? failure() : { status: 201, body: { version: 5 } }) },
    })
    await openDialog(3)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    expect((await screen.findByTestId('letterheads-restore-error')).textContent).toBe(
      'Version 3 was not restored. Nothing changed. Try again.',
    )
    expect(onLost).not.toHaveBeenCalled()
    expect(onConflict).not.toHaveBeenCalled()
    expect((screen.getByTestId('letterheads-restore-confirm') as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(5, 3))
  })

  it('says it again after a network failure and clears the sentence when it is tried again', async () => {
    let calls = 0
    panel({
      routes: {
        [`POST ${RESTORE(2)}`]: () => {
          if (++calls === 1) throw new TypeError('Failed to fetch')
          return { status: 201, body: { version: 5 } }
        },
      },
    })
    await openDialog(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await screen.findByTestId('letterheads-restore-error')
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(screen.queryByTestId('letterheads-restore-error')).toBeNull())
  })

  it('a 201 with no readable body is still a restore: the version after the base', async () => {
    const { onRestored } = panel({ routes: { [`POST ${RESTORE(2)}`]: () => ({ status: 201, body: {} }) } })
    await openDialog(2)
    await userEvent.click(screen.getByTestId('letterheads-restore-confirm'))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(5, 2))
  })

  it('has no accessibility violations with the dialog open', async () => {
    panel()
    await openDialog(2)
    expect(await axeViolations(document.body)).toEqual([])
  })
})
