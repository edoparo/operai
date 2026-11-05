/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/refund/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { default: App } = await import('./App')

const afterPopState = (move: () => void) =>
  new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
    move()
  })

/** Lets the mounted remote react to an address change, if it is going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (refund-ui), moving to another module and back', () => {
  it('shows My requests throughout, never a page matched from the other module address', async () => {
    window.history.pushState(null, '', '/refund/requests')
    const firstMount = render(<App />)
    await screen.findByTestId('refund-my-requests-page')

    // The shell moves the URL to another module; the remote stays on screen while that module loads.
    window.history.pushState(null, '', '/admin/roles')
    await settle()
    expect(screen.queryByTestId('refund-not-found-page')).toBeNull()
    expect(screen.getByTestId('refund-my-requests-page')).not.toBeNull()

    // Then the remote unmounts, and the browser's back button mounts it anew.
    firstMount.unmount()
    await afterPopState(() => window.history.back())
    expect(window.location.pathname).toBe('/refund/requests')
    render(<App />)

    expect(await screen.findByTestId('refund-my-requests-page')).not.toBeNull()
    expect(screen.queryByTestId('refund-not-found-page')).toBeNull()
  })

  it('leaves no history listener behind once unmounted, strict mode included', async () => {
    window.history.pushState(null, '', '/refund/requests')
    const pushState = window.history.pushState
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const popstateCalls = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'popstate').length

    const mounted = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByTestId('refund-my-requests-page')
    mounted.unmount()

    expect(popstateCalls(added)).toBeGreaterThan(0)
    expect(popstateCalls(removed)).toBe(popstateCalls(added))
    expect(window.history.pushState).toBe(pushState)
    added.mockRestore()
    removed.mockRestore()
  })
})

/**
 * Moving inside the module (My requests -> new request). While the shell's access
 * guard answers, the shell hides the mounted remote behind its pending fallback (a
 * Suspense boundary) and shows it again; under strict mode (the shell's own, in
 * development) React then runs the remote's effect cleanups and setups again on the
 * SAME instance, with no render in between (specs/022 AC-6.1, QE round 2: the page
 * came back blank).
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

describe('App (refund-ui), moving inside the module', () => {
  it('shows the new page when the shell hides the mounted remote and shows it again', async () => {
    window.history.pushState(null, '', '/refund/requests')
    const view = render(shellLike(null))
    await screen.findByTestId('refund-my-requests-page')

    window.history.pushState(null, '', '/refund/requests/new')
    await screen.findByTestId('refund-new-request-page')
    await hideThenShow(view)

    expect(await screen.findByTestId('refund-new-request-page')).not.toBeNull()
    expect(screen.queryByTestId('refund-my-requests-page')).toBeNull()
    expect(screen.queryByTestId('shell-pending')).toBeNull()
  })

  it('shows the new page when the shell unmounts the remote and mounts it again at that address', async () => {
    window.history.pushState(null, '', '/refund/requests')
    const firstMount = render(<App />)
    await screen.findByTestId('refund-my-requests-page')

    window.history.pushState(null, '', '/refund/requests/new')
    await screen.findByTestId('refund-new-request-page')
    firstMount.unmount()
    render(<App />)

    expect(await screen.findByTestId('refund-new-request-page')).not.toBeNull()
  })

  it('shows the same page when the shell unmounts the remote and mounts it again at the same address', async () => {
    window.history.pushState(null, '', '/refund/requests/new')
    const firstMount = render(<App />)
    await screen.findByTestId('refund-new-request-page')

    firstMount.unmount()
    render(<App />)

    expect(await screen.findByTestId('refund-new-request-page')).not.toBeNull()
  })
})
