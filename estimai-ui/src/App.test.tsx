/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves EstimAI inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
