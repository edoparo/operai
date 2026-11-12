/**
 * @vitest-environment jsdom
 *
 * App wiring (T28, specs/015-hardware-inventory): the exposed `./App` root
 * mounts the inner router rebased to `/inventory` with InventoryShell as its
 * root layout, so the shell's chrome, the capability tabs and the routed page
 * all appear for `/inventory/assets`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getInventoryApiBaseUrl: vi.fn(() => 'http://inventory-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
  usePermissions: vi.fn(() => ({
    epoch: 0,
    apps: ['inventory'],
    roles: [],
    departments: [],
    permissions: [{ resource: 'asset', action: 'manage' }],
  })),
}))
vi.mock('./lib/scopeApi', () => ({ getScope: vi.fn(async () => ({ asset: ['welld_ch'], ledger: [] })) }))

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App', () => {
  it('mounts InventoryShell as the root layout under /inventory', async () => {
    window.history.pushState(null, '', '/inventory/assets')
    // jsdom does not implement scrolling; the router's scroll restoration calls it on navigation.
    window.scrollTo = () => undefined
    const { default: App } = await import('./App')

    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Inventory' })).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Inventory sections' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Assets' }).getAttribute('href')).toBe('/inventory/assets')
    expect(await screen.findByTestId('inventory-assets-page')).not.toBeNull()
  })

  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.scrollTo = () => undefined
    const { default: App } = await import('./App')
    window.history.pushState(null, '', '/inventory/assets')
    const first = render(<App />)
    expect(await screen.findByTestId('inventory-assets-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/inventory/nope/nothing')
    render(<App />)

    expect(await screen.findByTestId('inventory-not-found-page')).not.toBeNull()
    expect(screen.queryByTestId('inventory-assets-page')).toBeNull()
  })
})

describe('inventory-ui — the browser history of the router is released on unmount', () => {
  // Every router builds a browser history that wraps window.history.pushState/replaceState and adds
  // popstate/beforeunload listeners; only history.destroy() undoes that (specs/029 security L5).
  const footprint = () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const live = (type: string) =>
      add.mock.calls.filter((c) => c[0] === type).length - remove.mock.calls.filter((c) => c[0] === type).length
    return {
      listeners: () => [live('popstate'), live('beforeunload')],
      restore: () => {
        add.mockRestore()
        remove.mockRestore()
      },
    }
  }

  it('App: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: App } = await import('./App')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/inventory/assets')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('inventory-assets-page')).not.toBeNull()
        mounted.unmount()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })

  it('under React.StrictMode, App: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: App } = await import('./App')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/inventory/assets')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('inventory-assets-page')).not.toBeNull()
        mounted.unmount()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })
})
