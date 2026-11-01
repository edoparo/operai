/**
 * @vitest-environment jsdom
 *
 * INC-25: the Italian wiring end to end. The shell sets `<html lang="it">` for
 * an Italian user; the library resolves the language ONCE (`resolveLocale`)
 * when the strings module is first evaluated, so the attribute is set in
 * `vi.hoisted`, before any import. The page then renders the Italian catalog,
 * and figures follow the Italian number format.
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  document.documentElement.lang = 'it'
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import MyRequestsPage from './MyRequestsPage'
import { catalogs, strings } from '../strings'
import type { RequestListItem } from '../lib/requestsApi'

vi.mock('../lib/requestsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/requestsApi')>()
  return { ...original, list: vi.fn() }
})

import * as requestsApi from '../lib/requestsApi'

function renderPage() {
  window.history.pushState(null, '', '/requests')
  const rootRoute = createRootRoute()
  const requestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/requests',
    component: MyRequestsPage,
    validateSearch: (search: Record<string, unknown>): { confirmation?: string } => ({
      confirmation: typeof search.confirmation === 'string' ? search.confirmation : undefined,
    }),
  })
  const newRoute = createRoute({ getParentRoute: () => rootRoute, path: '/requests/new', component: () => null })
  const detailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/requests/$id', component: () => null })
  const router = createRouter({ routeTree: rootRoute.addChildren([requestsRoute, newRoute, detailRoute]) })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

afterAll(() => {
  document.documentElement.lang = ''
})

const submitted: RequestListItem = {
  id: 'req-it',
  status: 'submitted',
  updatedAt: '2026-07-15T00:00:00.000Z',
  subtotals: [{ currency: 'EUR', requestedCents: 123456, approvedCents: null }],
}

describe('MyRequestsPage in Italian (INC-25)', () => {
  it('selects the Italian catalog when <html lang="it">', () => {
    expect(strings).toBe(catalogs.it)
  })

  it('renders the page heading, action and empty state in Italian', async () => {
    vi.mocked(requestsApi.list).mockResolvedValue([])
    renderPage()

    expect(await screen.findByRole('heading', { level: 2, name: 'Le mie richieste' })).not.toBeNull()
    expect(screen.getByTestId('my-requests-new-button').textContent).toBe('Nuova richiesta')
    await waitFor(() => expect(screen.getByTestId('my-requests-empty-state')).not.toBeNull())
    expect(screen.getByTestId('my-requests-empty-state').textContent).toContain(
      catalogs.it.pages.myRequests.empty.heading,
    )
  })

  it('renders a row with the Italian status label, an Italian-formatted amount and a dd.mm.yyyy date', async () => {
    vi.mocked(requestsApi.list).mockResolvedValue([submitted])
    renderPage()

    await waitFor(() => expect(screen.getByTestId('my-requests-list')).not.toBeNull())
    const row = screen.getByTestId(`my-requests-row-${submitted.id}`)
    expect(row.textContent).toContain('In attesa di decisione')
    expect(row.textContent).toContain('1234,56 EUR')
    expect(row.textContent).toContain('Aggiornata il 15.07.2026')
  })
})
