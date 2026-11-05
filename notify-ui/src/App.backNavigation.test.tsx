/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/notify/*`; moving to another module unmounts it and the browser's back
 * button remounts it. Whatever address the browser holds, the remote shows the page
 * of THAT address — never a page matched from the address of the module the user
 * went to or came from — and a remote that is unmounted leaves no history listener.
 */
import { StrictMode, Suspense } from 'react'
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

/**
 * Staying on the module's one page while the shell hides it and shows it again. While
 * the shell's access guard answers, the shell hides the mounted remote behind its
 * pending fallback (a Suspense boundary) and shows it again; under strict mode (the
 * shell's own, in development) React then runs the remote's effect cleanups and setups
 * again on the SAME instance, with no render in between (specs/022 AC-6.1, QE round 2:
 * the page came back blank).
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

describe('App (notify-ui), moving inside the module', () => {
  it('shows the notification center when the shell hides the mounted remote and shows it again', async () => {
    window.history.pushState(null, '', '/notify')
    const view = render(shellLike(null))
    await screen.findByTestId('notify-center-heading')

    await hideThenShow(view)

    expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
    expect(screen.queryByTestId('shell-pending')).toBeNull()
  })

  it('shows the same page when the shell unmounts the remote and mounts it again at the same address', async () => {
    window.history.pushState(null, '', '/notify')
    const firstMount = render(<App />)
    await screen.findByTestId('notify-center-heading')

    firstMount.unmount()
    render(<App />)

    expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
  })
})
