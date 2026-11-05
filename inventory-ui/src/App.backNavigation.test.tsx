/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/inventory/*`; moving to another module unmounts it and the browser's
 * back button remounts it. Whatever address the browser holds, the remote shows the
 * page of THAT address — never a page matched from the address of the module the
 * user went to or came from — and a remote that is unmounted leaves no history
 * listener.
 */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import App from './App'

const afterPopState = (move: () => void) =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
    move()
  })

/** Lets the mounted remote react to an address change, if it is going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  // jsdom does not implement scrolling; the router's scroll restoration calls it on navigation.
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (inventory-ui), moving to another module and back', () => {
  it('shows the assets page throughout, never a page matched from the other module address', async () => {
    window.history.pushState(null, '', '/inventory/assets')
    const firstMount = render(<App />)
    await screen.findByTestId('inventory-assets-page')

    // The shell moves the URL to another module; the remote stays on screen while that module loads.
    window.history.pushState(null, '', '/admin/roles')
    await settle()
    expect(screen.queryByTestId('inventory-not-found-page')).toBeNull()
    expect(screen.getByTestId('inventory-assets-page')).not.toBeNull()

    // Then the remote unmounts, and the browser's back button mounts it anew.
    firstMount.unmount()
    await afterPopState(() => window.history.back())
    expect(window.location.pathname).toBe('/inventory/assets')
    render(<App />)

    expect(await screen.findByTestId('inventory-assets-page')).not.toBeNull()
    expect(screen.queryByTestId('inventory-not-found-page')).toBeNull()
  })

  it('leaves no history listener behind once unmounted, strict mode included', async () => {
    window.history.pushState(null, '', '/inventory/assets')
    const pushState = window.history.pushState
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const popstateCalls = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'popstate').length

    const mounted = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByTestId('inventory-assets-page')
    mounted.unmount()

    expect(popstateCalls(added)).toBeGreaterThan(0)
    expect(popstateCalls(removed)).toBe(popstateCalls(added))
    expect(window.history.pushState).toBe(pushState)
    added.mockRestore()
    removed.mockRestore()
  })
})
