/**
 * @vitest-environment jsdom
 *
 * The inner router: the one page route exists, resolved under the shell's `/letterheads` basepath, plus the
 * not-found fallback (design S11). A bare root stands in for LetterheadsShell, so the page reads
 * its context through a provider here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { LetterheadsContext } from './hooks/useLetterheads'
import { createAppRouter } from './router'
import { catalogFixture } from './lib/formStateFixtures'
import { letterheadList } from './test-support/fakeApi'
import type { RouteComponent } from '@tanstack/react-router'
import { Outlet } from '@tanstack/react-router'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const WithContext: RouteComponent = () => (
  <LetterheadsContext.Provider
    value={{
      catalog: catalogFixture(),
      letterheads: letterheadList({ welld_it: { activeVersion: null, canManage: true } }),
    }}
  >
    <Outlet />
  </LetterheadsContext.Provider>
)

const renderAt = (path: string, basepath = '/letterheads') => {
  window.history.pushState(null, '', path)
  render(<RouterProvider router={createAppRouter(basepath, WithContext)} />)
}

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => cleanup())

describe('createAppRouter', () => {
  it('serves the configurator at the tool root: both entities as tabs, the form of the first one the person may change', async () => {
    renderAt('/letterheads')
    expect(await screen.findByTestId('letterheads-page')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'wellD IT', selected: true })).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'wellD CH', selected: false })).not.toBeNull()
    expect(await screen.findByTestId('letterheads-form')).not.toBeNull()
  })

  it('serves the page for the trailing-slash path and for the search params the form will use', async () => {
    renderAt('/letterheads/?entity=welld_ch&view=history')
    expect(await screen.findByTestId('letterheads-page')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'wellD CH', selected: true })).not.toBeNull()
  })

  it('answers an unknown path with the not-found panel and a way back to the tool', async () => {
    renderAt('/letterheads/nope')
    expect(await screen.findByTestId('letterheads-not-found')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Back to letterheads' }).getAttribute('href')).toBe('/letterheads/')
  })
})
