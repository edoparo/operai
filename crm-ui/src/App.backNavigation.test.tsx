/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/crm/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode, Suspense } from 'react'
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
      'GET /contacts': () => ({ status: 200, body: page([]) }),
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

/**
 * Moving inside the module (companies -> contacts). While the shell's access guard
 * answers, the shell hides the mounted remote behind its pending fallback (a Suspense
 * boundary) and shows it again; under strict mode (the shell's own, in development)
 * React then runs the remote's effect cleanups and setups again on the SAME instance,
 * with no render in between (specs/022 AC-6.1, QE round 2: the page came back blank).
 */
const Gate = ({ block }: { block: Promise<void> | null }) => {
  if (block) throw block
  return null
}

const shellLike = (block: Promise<void> | null) => (
  <StrictMode>
    <Suspense fallback={<p data-testid="shell-pending">pending</p>}>
      <App />
      <Gate block={block} />
    </Suspense>
  </StrictMode>
)

/** The shell hides the mounted remote, then shows it again. */
const hideThenShow = async (view: ReturnType<typeof render>) => {
  let reveal!: () => void
  view.rerender(shellLike(new Promise<void>((resolve) => (reveal = resolve))))
  await screen.findByTestId('shell-pending')
  reveal()
  view.rerender(shellLike(null))
}

describe('App (crm-ui), moving inside the module', () => {
  it('shows the new page when the shell hides the mounted remote and shows it again', async () => {
    window.history.pushState(null, '', '/crm/companies')
    const view = render(shellLike(null))
    await screen.findByTestId('crm-companies-page')

    window.history.pushState(null, '', '/crm/contacts')
    await screen.findByTestId('crm-contacts-page')
    await hideThenShow(view)

    expect(await screen.findByTestId('crm-contacts-page')).not.toBeNull()
    expect(screen.queryByTestId('crm-companies-page')).toBeNull()
    expect(screen.queryByTestId('shell-pending')).toBeNull()
  })

  it('shows the new page when the shell unmounts the remote and mounts it again at that address', async () => {
    window.history.pushState(null, '', '/crm/companies')
    const firstMount = render(<App />)
    await screen.findByTestId('crm-companies-page')

    window.history.pushState(null, '', '/crm/contacts')
    await screen.findByTestId('crm-contacts-page')
    firstMount.unmount()
    render(<App />)

    expect(await screen.findByTestId('crm-contacts-page')).not.toBeNull()
  })

  it('shows the same page when the shell unmounts the remote and mounts it again at the same address', async () => {
    window.history.pushState(null, '', '/crm/contacts')
    const firstMount = render(<App />)
    await screen.findByTestId('crm-contacts-page')

    firstMount.unmount()
    render(<App />)

    expect(await screen.findByTestId('crm-contacts-page')).not.toBeNull()
  })
})
