/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/refund/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode } from 'react'
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
