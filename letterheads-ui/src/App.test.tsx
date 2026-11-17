/**
 * @vitest-environment jsdom
 *
 * App — the exposed `./App` (design F1): mounted at `/letterheads` it loads the frame and shows the page;
 * it ignores an address that is not its own, so no request leaves for a path the shell has moved on from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { catalogFixture } from './lib/formStateFixtures'
import { fakeApi, letterheadList } from './test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import App from './App'

beforeEach(() => {
  window.scrollTo = () => undefined
  apiFetch.mockImplementation(
    fakeApi({
      'GET /v1/catalog': () => ({ status: 200, body: catalogFixture() }),
      'GET /v1/letterheads': () => ({
        status: 200,
        body: letterheadList({
          welld_it: { activeVersion: null, canManage: true },
          welld_ch: { activeVersion: 2, canManage: false },
        }),
      }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('App', () => {
  it('mounts the tool at /letterheads: title, the entity tabs, then the form of the entity the person may change', async () => {
    window.history.pushState(null, '', '/letterheads')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Letterheads' })).not.toBeNull()
    expect(await screen.findByRole('tab', { name: 'wellD IT', selected: true })).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'wellD CH', selected: false })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'wellD IT' })).not.toBeNull()
    expect(await screen.findByTestId('letterheads-form')).not.toBeNull()
    expect(screen.getByText('No letterhead yet')).not.toBeNull()
  })

  it('does not route an address that is not its own', async () => {
    window.history.pushState(null, '', '/letterheads')
    render(<App />)
    await screen.findByTestId('letterheads-page')
    // The form asks for its live preview as soon as it is mounted, a moment after the page is (T22): let that one
    // go by, so that what is counted below is what the change of address asks for.
    await waitFor(() => expect(apiFetch.mock.calls.some(([url]) => String(url).endsWith('/preview'))).toBe(true))
    apiFetch.mockClear()
    await act(async () => {
      window.history.pushState(null, '', '/projects/abc')
    })
    expect(screen.queryByTestId('letterheads-not-found')).toBeNull()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('unmounts cleanly, and a second mount starts from a fresh router', async () => {
    window.history.pushState(null, '', '/letterheads')
    const first = render(<App />)
    await screen.findByTestId('letterheads-page')
    first.unmount()
    window.history.pushState(null, '', '/letterheads')
    render(<App />)
    expect(await screen.findByTestId('letterheads-page')).not.toBeNull()
  })
})
