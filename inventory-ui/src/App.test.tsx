/**
 * @vitest-environment jsdom
 *
 * App wiring (T28, specs/015-hardware-inventory): the exposed `./App` root
 * mounts the inner router rebased to `/inventory` with InventoryShell as its
 * root layout, so the shell's chrome, the capability tabs and the routed page
 * all appear for `/inventory/assets`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, Suspense, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

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

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => Promise.resolve()

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
        await removed()
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
        await removed()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })
})

describe('inventory-ui — the bare tool URL, as the shell mounts it (specs/029 D-5)', () => {
  // The index route redirects (/inventory -> /inventory/assets). The shell mounts the remote inside a Suspense boundary and,
  // on any URL change, suspends above it: that hides the remote's tree and shows it again with its state kept.
  // The router must come back as the SAME router: a second one never reaches the tree (it is never loaded).
  const visible = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.style.display === 'none') return false
    return true
  }
  const find = () => screen.findByTestId('inventory-assets-page')

  // Suspends while `hold` is set and not yet open, the way the shell does while it revalidates.
  interface Hold {
    open: boolean
    promise: Promise<void>
  }
  function Gate({ hold }: { hold: Hold | null }) {
    if (hold && !hold.open) throw hold.promise
    return null
  }
  function Mounted({ App, hold }: { App: ComponentType; hold: Hold | null }) {
    return (
      <Suspense fallback={<p>shell loading</p>}>
        <App />
        <Gate hold={hold} />
      </Suspense>
    )
  }

  for (const strict of [false, true]) {
    it(`${strict ? 'under StrictMode, ' : ''}opening /inventory lands on /inventory/assets and keeps it through a hide and reveal of the remote`, async () => {
      window.scrollTo = () => undefined
      const { default: App } = await import('./App')
      const { pushState, replaceState } = window.history
      window.history.pushState(null, '', '/inventory')
      const wrap = (hold: Hold | null) => {
        const tree = <Mounted App={App} hold={hold} />
        return strict ? <StrictMode>{tree}</StrictMode> : tree
      }
      const view = render(wrap(null))
      expect(await find()).not.toBeNull()
      expect(window.location.pathname).toBe('/inventory/assets')

      const hold: Hold = { open: false, promise: Promise.resolve() }
      hold.promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          hold.open = true
          resolve()
        }, 50)
      })
      view.rerender(wrap(hold))
      expect(await screen.findByText('shell loading')).not.toBeNull()
      await act(() => hold.promise)
      await waitFor(() => expect(screen.queryByText('shell loading')).toBeNull())
      expect(visible(await find())).toBe(true)

      view.unmount()
      await removed()
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    })
  }
})
