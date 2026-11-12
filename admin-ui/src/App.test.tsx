/**
 * @vitest-environment jsdom
 *
 * Component tests for App.tsx — admin-ui's exposed `./App` (T14,
 * specs/004-auth-roles-permissions/tasks.md).
 *
 * T13's placeholder tests (heading + coming-soon copy + shared-session
 * demonstration) are superseded: T14 replaces that static placeholder with
 * admin-ui's own inner TanStack Router (src/router.tsx), rebased to
 * basepath `/admin` (src/App.tsx's `createAppRouter('/admin')`). This file
 * proves the EXACT exposed component — with its hardcoded `/admin`
 * basepath, not the bare `createAppRouter()` factory — mounts and resolves
 * under that prefix; src/router.test.tsx separately covers the router's
 * structure and per-section navigation in more depth using the basepath-less
 * factory (mirrors estimai-ui/src/router.test.tsx's split between router
 * structure and the exposed remote's own basepath wiring).
 *
 * `shell/tokens.css` is a side-effect-only import — vitest.config.ts's
 * `resolve.alias` points the bare specifier at a real (empty) local stub so
 * Vite's import-analysis is satisfied; nothing to assert on for it here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, Suspense, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const { default: App } = await import('./App')

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (admin-ui, mounted under /admin)', () => {
  it('landing on /admin redirects to /admin/roles and renders the section nav + Roles content', async () => {
    window.history.pushState(null, '', '/admin')

    render(<App />)

    expect(await screen.findByTestId('admin-roles-page')).not.toBeNull()
    expect(window.location.pathname).toBe('/admin/roles')

    const nav = screen.getByRole('navigation', { name: 'Admin sections' })
    expect(nav).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Roles' }).getAttribute('aria-current')).toBe('page')
  })

  it('section links carry the /admin basepath in their href', async () => {
    window.history.pushState(null, '', '/admin')

    render(<App />)
    await screen.findByTestId('admin-roles-page')

    expect(screen.getByRole('link', { name: 'Departments' }).getAttribute('href')).toBe('/admin/departments')
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/admin/users')
    expect(screen.getByRole('link', { name: 'Audit' }).getAttribute('href')).toBe('/admin/audit')
  })

  it('deep-linking to a section (e.g. /admin/audit) renders that section directly, not the redirect target', async () => {
    window.history.pushState(null, '', '/admin/audit')

    render(<App />)

    expect(await screen.findByTestId('admin-audit-page')).not.toBeNull()
    expect(screen.queryByTestId('admin-roles-page')).toBeNull()
  })
})

describe('App (admin-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.history.pushState(null, '', '/admin/roles')
    const first = render(<App />)
    expect(await screen.findByTestId('admin-roles-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/admin/audit')
    render(<App />)

    expect(await screen.findByTestId('admin-audit-page')).not.toBeNull()
    expect(screen.queryByTestId('admin-roles-page')).toBeNull()
  })
})

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => Promise.resolve()

describe('admin-ui — the browser history of the router is released on unmount', () => {
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
      window.history.pushState(null, '', '/admin/roles')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('admin-roles-page')).not.toBeNull()
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
      window.history.pushState(null, '', '/admin/roles')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('admin-roles-page')).not.toBeNull()
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

describe('admin-ui — the bare tool URL, as the shell mounts it (specs/029 D-5)', () => {
  // The index route redirects (/admin -> /admin/roles). The shell mounts the remote inside a Suspense boundary and,
  // on any URL change, suspends above it: that hides the remote's tree and shows it again with its state kept.
  // The router must come back as the SAME router: a second one never reaches the tree (it is never loaded).
  const visible = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.style.display === 'none') return false
    return true
  }
  const find = () => screen.findByTestId('admin-roles-page')

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
    it(`${strict ? 'under StrictMode, ' : ''}opening /admin lands on /admin/roles and keeps it through a hide and reveal of the remote`, async () => {
      window.scrollTo = () => undefined
      const { default: App } = await import('./App')
      const { pushState, replaceState } = window.history
      window.history.pushState(null, '', '/admin')
      const wrap = (hold: Hold | null) => {
        const tree = <Mounted App={App} hold={hold} />
        return strict ? <StrictMode>{tree}</StrictMode> : tree
      }
      const view = render(wrap(null))
      expect(await find()).not.toBeNull()
      expect(window.location.pathname).toBe('/admin/roles')

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
