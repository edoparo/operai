/**
 * @vitest-environment jsdom
 *
 * Browser back across suite modules (specs/022 AC-6.1, D52). The shell mounts the
 * remote at `/estimai/*`; moving to another module unmounts it and the browser's
 * back button remounts it. Whatever address the browser holds, the remote shows the
 * page of THAT address — never a page matched from the address of the module the
 * user went to or came from — and a remote that is unmounted leaves no history
 * listener.
 */
import { StrictMode, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { strings } from './strings'

vi.mock('./lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/estimatesApi')>()
  return { ...original, list: vi.fn(async () => []) }
})
vi.mock('./lib/api', () => ({ clearJwtCache: vi.fn(), apiFetch: vi.fn() }))

import App from './App'

const listHeading = () => screen.findByRole('heading', { level: 2, name: strings.estimatesList.heading })

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

describe('App (estimai-ui), moving to another module and back', () => {
  it('shows the estimates list throughout, never a page matched from the other module address', async () => {
    window.history.pushState(null, '', '/estimai/estimates')
    const firstMount = render(<App />)
    await listHeading()

    // The shell moves the URL to another module; the remote stays on screen while that module loads.
    window.history.pushState(null, '', '/admin/roles')
    await settle()
    expect(screen.queryByText('Not Found')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: strings.estimatesList.heading })).not.toBeNull()

    // Then the remote unmounts, and the browser's back button mounts it anew.
    firstMount.unmount()
    await afterPopState(() => window.history.back())
    expect(window.location.pathname).toBe('/estimai/estimates')
    render(<App />)

    expect(await listHeading()).not.toBeNull()
    expect(screen.queryByText('Not Found')).toBeNull()
  })

  it('leaves no history listener behind once unmounted, strict mode included', async () => {
    window.history.pushState(null, '', '/estimai/estimates')
    const pushState = window.history.pushState
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const popstateCalls = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === 'popstate').length

    const mounted = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    await listHeading()
    mounted.unmount()

    expect(popstateCalls(added)).toBeGreaterThan(0)
    expect(popstateCalls(removed)).toBe(popstateCalls(added))
    expect(window.history.pushState).toBe(pushState)
    added.mockRestore()
    removed.mockRestore()
  })
})

/**
 * Moving inside the module (`/estimai` redirects to the estimates list). While the
 * shell's access guard answers, the shell hides the mounted remote behind its pending
 * fallback (a Suspense boundary) and shows it again; under strict mode (the shell's
 * own, in development) React then runs the remote's effect cleanups and setups again
 * on the SAME instance, with no render in between (specs/022 AC-6.1, QE round 2: the
 * page came back blank).
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

describe('App (estimai-ui), moving inside the module', () => {
  it('shows the page of its address when the shell hides the mounted remote and shows it again', async () => {
    window.history.pushState(null, '', '/estimai')
    const view = render(shellLike(null))
    await listHeading()
    expect(window.location.pathname).toBe('/estimai/estimates')

    await hideThenShow(view)

    expect(await listHeading()).not.toBeNull()
    expect(screen.queryByTestId('shell-pending')).toBeNull()
  })

  it('shows the same page when the shell unmounts the remote and mounts it again at the same address', async () => {
    window.history.pushState(null, '', '/estimai')
    const firstMount = render(<App />)
    await listHeading()
    expect(window.location.pathname).toBe('/estimai/estimates')

    firstMount.unmount()
    render(<App />)

    expect(await listHeading()).not.toBeNull()
  })
})
