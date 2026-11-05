/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/crm/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeApi, page } from './test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import App from './App'

const afterPopState = (move: () => void) =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
    move()
  })

/** Lets the mounted remote react to an address change, if it is going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  window.scrollTo = () => undefined
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({
        status: 200,
        body: { deal: ['welld_ch'], canErase: false, financials: false, managesAll: false },
      }),
      'GET /companies': () => ({ status: 200, body: page([]) }),
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.pushState(null, '', '/')
})

describe('App (crm-ui), moving to another module and back', () => {
  it('shows the companies page throughout, never a page matched from the other module address', async () => {
    window.history.pushState(null, '', '/crm/companies')
    const firstMount = render(<App />)
    await screen.findByTestId('crm-companies-page')

    // The shell moves the URL to another module; the remote stays on screen while that module loads.
    window.history.pushState(null, '', '/admin/roles')
    await settle()
    expect(screen.queryByTestId('crm-not-found')).toBeNull()
    expect(screen.getByTestId('crm-companies-page')).not.toBeNull()

    // Then the remote unmounts, and the browser's back button mounts it anew.
    firstMount.unmount()
    await afterPopState(() => window.history.back())
    expect(window.location.pathname).toBe('/crm/companies')
    render(<App />)

    expect(await screen.findByTestId('crm-companies-page')).not.toBeNull()
    expect(screen.queryByTestId('crm-not-found')).toBeNull()
  })

  it('leaves no history listener behind once unmounted, strict mode included', async () => {
    window.history.pushState(null, '', '/crm/companies')
    const pushState = window.history.pushState
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const popstateCalls = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'popstate').length

    const mounted = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByTestId('crm-companies-page')
    mounted.unmount()

    expect(popstateCalls(added)).toBeGreaterThan(0)
    expect(popstateCalls(removed)).toBe(popstateCalls(added))
    expect(window.history.pushState).toBe(pushState)
    added.mockRestore()
    removed.mockRestore()
  })
})
