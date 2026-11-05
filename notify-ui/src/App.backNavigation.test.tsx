/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/notify/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('./lib/notificationsApi', () => ({
  listNotifications: vi.fn(() => new Promise(() => {})),
  markAllRead: vi.fn(() => new Promise(() => {})),
}))

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

describe('App (notify-ui), moving to another module and back', () => {
  it('shows the notification center throughout, never a page matched from the other module address', async () => {
    window.history.pushState(null, '', '/notify')
    const firstMount = render(<App />)
    await screen.findByTestId('notify-center-heading')

    // The shell moves the URL to another module; the remote stays on screen while that module loads.
    window.history.pushState(null, '', '/admin/roles')
    await settle()
    expect(screen.queryByTestId('notify-not-found-page')).toBeNull()
    expect(screen.getByTestId('notify-center-heading')).not.toBeNull()

    // Then the remote unmounts, and the browser's back button mounts it anew.
    firstMount.unmount()
    await afterPopState(() => window.history.back())
    expect(window.location.pathname).toBe('/notify')
    render(<App />)

    expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
    expect(screen.queryByTestId('notify-not-found-page')).toBeNull()
  })

  it('leaves no history listener behind once unmounted, strict mode included', async () => {
    window.history.pushState(null, '', '/notify')
    const pushState = window.history.pushState
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const popstateCalls = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'popstate').length

    const mounted = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await screen.findByTestId('notify-center-heading')
    mounted.unmount()

    expect(popstateCalls(added)).toBeGreaterThan(0)
    expect(popstateCalls(removed)).toBe(popstateCalls(added))
    expect(window.history.pushState).toBe(pushState)
    added.mockRestore()
    removed.mockRestore()
  })
})
