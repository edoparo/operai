/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves EstimAI inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
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
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })
})
