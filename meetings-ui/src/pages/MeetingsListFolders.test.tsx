/**
 * @vitest-environment jsdom
 *
 * The meetings list's personal folders (ADR-0090): the filter, filing a row, and the folder dialogs.
 * Rendered inside the real inner router against `fakeApi` standing in for `shell/session`'s `apiFetch`.
 */
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({
  apps: ['meetings'] as string[],
}))

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getMeetingsApiBaseUrl: vi.fn(() => 'http://meetings-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
  navigateSuite: vi.fn(),
  registerNavigationBlocker: vi.fn(() => () => undefined),
  usePermissions: vi.fn(() => ({
    epoch: 0,
    apps: session.apps,
    roles: [],
    departments: [],
    permissions: [],
  })),
}))

import { apiFetch, navigateSuite } from 'shell/session'
import { createAppRouter, createMyMeetingsRouter } from '../router'
import { en } from '../strings'
import { crmDealHost, fakeApi, meetingRow, page, problem } from '../test-support/fakeApi'

beforeEach(() => {
  // jsdom does not implement scrolling; the router's scroll restoration calls it on navigation.
  window.scrollTo = () => undefined
  session.apps = ['meetings']
})

afterEach(() => {
  cleanup()
  vi.mocked(navigateSuite).mockReset()
  vi.mocked(apiFetch).mockReset()
})

const serve = (routes: Parameters<typeof fakeApi>[0]) => {
  const api = fakeApi({ 'GET /hosts': () => ({ status: 200, body: { items: [crmDealHost] } }), ...routes })
  vi.mocked(apiFetch).mockImplementation(api)
  return api
}

const renderList = async (mine = false, state?: { meetingDeleted?: boolean }) => {
  const base = mine ? '/my-meetings' : '/meetings'
  const history = createMemoryHistory({ initialEntries: [base] })
  if (state) history.replace(base, state)
  const router = mine
    ? createMyMeetingsRouter(base, undefined, history)
    : createAppRouter(base, undefined, history)
  render(<RouterProvider router={router} />)
  await screen.findByTestId('meetings-list-page')
}

/** The search params of every `GET /meetings` the page made, in order. */
const listQueries = () =>
  vi
    .mocked(apiFetch)
    .mock.calls.map(([input]) => new URL(String(input)))
    .filter((url) => url.pathname === '/meetings')
    .map((url) => Object.fromEntries(url.searchParams))

const lastQuery = () => listQueries().at(-1)

const FOLDERS = [
  { id: 'f-acme', name: 'ACME', meetingCount: 1 },
  { id: 'f-arch', name: 'Archive', meetingCount: 0 },
]
const rows = () => page([meetingRow({ id: 'm1', title: 'Kick-off', folderId: 'f-acme' }), meetingRow({ id: 'm2', title: 'Retro' })])
const calls = (method: string, path: string) =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(([input, init]) => (init?.method ?? 'GET') === method && new URL(String(input)).pathname === path)
    .map(([, init]) => (init?.body ? JSON.parse(String(init.body)) : null))

describe('personal folders (ADR-0090)', () => {
  it('shows no folder controls when the folders cannot be loaded; the list still works', async () => {
    serve({ 'GET /meetings': () => ({ status: 200, body: rows() }), 'GET /folders': () => ({ status: 503, body: problem(503) }) })
    await renderList()
    await screen.findByText('Kick-off')
    expect(screen.queryByTestId('meetings-list-folder-filter')).toBeNull()
    expect(screen.queryByTestId('meetings-list-folder-m1')).toBeNull()
  })

  it('filters on a folder, or on the meetings in none', async () => {
    serve({ 'GET /meetings': () => ({ status: 200, body: rows() }), 'GET /folders': () => ({ status: 200, body: { items: FOLDERS } }) })
    await renderList()
    const filter = await screen.findByTestId('meetings-list-folder-filter')
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual([
      en.folders.all,
      en.folders.none,
      'ACME (1)',
      'Archive (0)',
    ])

    await userEvent.selectOptions(filter, 'f-acme')
    await waitFor(() => expect(lastQuery()).toMatchObject({ folder: 'f-acme' }))
    await userEvent.selectOptions(filter, 'none')
    await waitFor(() => expect(lastQuery()).toMatchObject({ folder: 'none' }))
    // A folder is selected only now: its own actions appear.
    expect(screen.queryByTestId('meetings-list-folder-rename')).toBeNull()
  })

  it("files a row in one of the person's folders, or in none, and says so", async () => {
    serve({
      'GET /meetings': () => ({ status: 200, body: rows() }),
      'GET /folders': () => ({ status: 200, body: { items: FOLDERS } }),
      'PUT /meetings/:id/folder': (_url, init) => ({ status: 200, body: JSON.parse(String(init?.body)) }),
    })
    await renderList()
    const select = await screen.findByTestId('meetings-list-folder-m2')
    expect(select).toHaveProperty('value', '')
    expect(screen.getByRole('combobox', { name: en.folders.rowLabel('Retro') })).toBe(select)

    await userEvent.selectOptions(select, 'f-arch')
    await screen.findByText(en.folders.moved('Retro', 'Archive'))
    expect(calls('PUT', '/meetings/m2/folder')).toEqual([{ folderId: 'f-arch' }])

    await userEvent.selectOptions(screen.getByTestId('meetings-list-folder-m1'), '')
    await screen.findByText(en.folders.removed('Kick-off'))
    expect(calls('PUT', '/meetings/m1/folder')).toEqual([{ folderId: null }])
  })

  it('creates a folder, and a name already in use is said in the dialog, which stays open', async () => {
    let taken = true
    serve({
      'GET /meetings': () => ({ status: 200, body: rows() }),
      'GET /folders': () => ({ status: 200, body: { items: FOLDERS } }),
      'POST /folders': (_url, init) =>
        taken
          ? { status: 409, body: problem(409, 'folder_name_taken') }
          : { status: 201, body: { id: 'f-new', name: JSON.parse(String(init?.body)).name, meetingCount: 0 } },
    })
    await renderList()
    await userEvent.click(await screen.findByTestId('meetings-list-folder-new'))
    await userEvent.type(screen.getByTestId('folder-create-name'), 'acme')
    await userEvent.click(screen.getByTestId('folder-create-submit'))
    expect(await screen.findByText(en.common.errors.folder_name_taken)).not.toBeNull()

    taken = false
    await userEvent.clear(screen.getByTestId('folder-create-name'))
    await userEvent.type(screen.getByTestId('folder-create-name'), '  Clients ')
    await userEvent.click(screen.getByTestId('folder-create-submit'))
    await screen.findByText(en.folders.create.done('Clients'))
    expect(screen.queryByTestId('folder-create-name')).toBeNull()
    expect(calls('POST', '/folders').at(-1)).toEqual({ name: 'Clients' })
  })

  it('renames and deletes the selected folder; deleting it goes back to every meeting', async () => {
    serve({
      'GET /meetings': () => ({ status: 200, body: rows() }),
      'GET /folders': () => ({ status: 200, body: { items: FOLDERS } }),
      'PATCH /folders/:id': (_url, init) => ({ status: 200, body: { id: 'f-acme', name: JSON.parse(String(init?.body)).name, meetingCount: 1 } }),
      'DELETE /folders/:id': () => ({ status: 204 }),
    })
    await renderList()
    await userEvent.selectOptions(await screen.findByTestId('meetings-list-folder-filter'), 'f-acme')

    await userEvent.click(await screen.findByTestId('meetings-list-folder-rename'))
    const name = screen.getByTestId('folder-rename-name')
    expect(name).toHaveProperty('value', 'ACME')
    await userEvent.clear(name)
    await userEvent.type(name, 'Acme Corp')
    await userEvent.click(screen.getByTestId('folder-rename-submit'))
    await screen.findByText(en.folders.renameDialog.done('Acme Corp'))
    expect(calls('PATCH', '/folders/f-acme')).toEqual([{ name: 'Acme Corp' }])

    await userEvent.click(screen.getByTestId('meetings-list-folder-delete'))
    expect(screen.getByText(en.folders.deleteDialog.body)).not.toBeNull()
    await userEvent.click(screen.getByTestId('folder-delete-confirm'))
    await screen.findByText(en.folders.deleteDialog.done('ACME'))
    expect(calls('DELETE', '/folders/f-acme')).toHaveLength(1)
    await waitFor(() => expect(lastQuery()?.['folder']).toBeUndefined())
  })
})
