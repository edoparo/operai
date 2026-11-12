/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves EstimAI inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, Suspense, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import * as estimatesApi from './lib/estimatesApi'

// Only `get` (the estimate route's loader) is replaced; the list keeps going
// through the unmocked apiFetch stub, and shows its loading state first.
vi.mock('./lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/estimatesApi')>()
  return { ...original, get: vi.fn() }
})

const { default: App } = await import('./App')

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (estimai-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    vi.mocked(estimatesApi.get).mockRejectedValue(
      new estimatesApi.ApiError({ type: 't', title: 'Unavailable', status: 503, code: 'authz_unavailable' }),
    )
    window.history.pushState(null, '', '/estimai/estimates')
    const first = render(<App />)
    await screen.findByText(/loading your estimates/i)
    first.unmount()

    window.history.pushState(null, '', '/estimai/estimates/someone-elses')
    render(<App />)

    expect(await screen.findByTestId('estimate-route-error')).not.toBeNull()
    expect(screen.queryByText(/loading your estimates/i)).toBeNull()
  })
})

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => Promise.resolve()

describe('estimai-ui — the browser history of the router is released on unmount', () => {
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
      window.history.pushState(null, '', '/estimai/estimates')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByText(/loading your estimates/i)).not.toBeNull()
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
      window.history.pushState(null, '', '/estimai/estimates')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByText(/loading your estimates/i)).not.toBeNull()
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

describe('estimai-ui — the bare tool URL, as the shell mounts it (specs/029 D-5)', () => {
  // The index route redirects (/estimai -> /estimai/estimates). The shell mounts the remote inside a Suspense boundary and,
  // on any URL change, suspends above it: that hides the remote's tree and shows it again with its state kept.
  // The router must come back as the SAME router: a second one never reaches the tree (it is never loaded).
  const visible = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.style.display === 'none') return false
    return true
  }
  const find = () => screen.findByRole('heading', { level: 2, name: /estimates/i })

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
    it(`${strict ? 'under StrictMode, ' : ''}opening /estimai lands on /estimai/estimates and keeps it through a hide and reveal of the remote`, async () => {
      window.scrollTo = () => undefined
      const { default: App } = await import('./App')
      const { pushState, replaceState } = window.history
      window.history.pushState(null, '', '/estimai')
      const wrap = (hold: Hold | null) => {
        const tree = <Mounted App={App} hold={hold} />
        return strict ? <StrictMode>{tree}</StrictMode> : tree
      }
      const view = render(wrap(null))
      expect(await find()).not.toBeNull()
      expect(window.location.pathname).toBe('/estimai/estimates')

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
