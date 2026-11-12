import { StrictMode, Suspense, type ReactNode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DisposableRouterHost } from './DisposableRouterHost'
import type { DisposableRouter } from './DisposableRouterHost'

// Mimics @tanstack/history's createBrowserHistory: wrap pushState/replaceState, listen on the window,
// and undo exactly that — by writing back what it captured — in destroy().
interface FakeRouter extends DisposableRouter {
  pushes: number
  destroyed: boolean
}

function createFakeRouter(): FakeRouter {
  const originalPush = window.history.pushState
  const originalReplace = window.history.replaceState
  const onPop = () => undefined
  const router: FakeRouter = {
    pushes: 0,
    destroyed: false,
    history: {
      destroy: () => {
        router.destroyed = true
        window.history.pushState = originalPush
        window.history.replaceState = originalReplace
        window.removeEventListener('popstate', onPop)
        window.removeEventListener('beforeunload', onPop, { capture: true })
      },
    },
  }
  window.addEventListener('popstate', onPop)
  window.addEventListener('beforeunload', onPop, { capture: true })
  window.history.pushState = function (...args: Parameters<History['pushState']>) {
    router.pushes++
    return originalPush.apply(window.history, args)
  }
  window.history.replaceState = function (...args: Parameters<History['replaceState']>) {
    return originalReplace.apply(window.history, args)
  }
  return router
}

function Probe({ create, seen }: { create: () => FakeRouter; seen?: (r: FakeRouter) => void }) {
  return (
    <DisposableRouterHost create={create}>
      {(router) => {
        seen?.(router)
        return <p>router</p>
      }}
    </DisposableRouterHost>
  )
}

const live = (spy: { mock: { calls: unknown[][] } }, type: string) => spy.mock.calls.filter((c) => c[0] === type).length

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => act(async () => undefined)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DisposableRouterHost', () => {
  it('renders the router it created, synchronously after mount', () => {
    const view = render(<Probe create={createFakeRouter} />)
    expect(view.getByText('router')).not.toBeNull()
  })

  for (const strict of [false, true]) {
    it(`${strict ? 'under StrictMode, ' : ''}leaves no listener and no wrapper behind after any number of mounts`, async () => {
      const { pushState, replaceState } = window.history
      const add = vi.spyOn(window, 'addEventListener')
      const remove = vi.spyOn(window, 'removeEventListener')
      for (let i = 0; i < 5; i++) {
        const view = render(
          strict ? (
            <StrictMode>
              <Probe create={createFakeRouter} />
            </StrictMode>
          ) : (
            <Probe create={createFakeRouter} />
          ),
        )
        expect(view.getByText('router')).not.toBeNull()
        view.unmount()
        await removed()
      }
      expect(live(add, 'popstate')).toBe(live(remove, 'popstate'))
      expect(live(add, 'beforeunload')).toBe(live(remove, 'beforeunload'))
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    })
  }

  it('under StrictMode builds one router, and it is a live one (its wrapper is still installed)', async () => {
    const made: FakeRouter[] = []
    const create = () => {
      const r = createFakeRouter()
      made.push(r)
      return r
    }
    const view = render(
      <StrictMode>
        <Probe create={create} />
      </StrictMode>,
    )
    expect(made.length).toBe(1)
    window.history.pushState(null, '', '/')
    expect(made[0].pushes).toBe(1)
    view.unmount()
    await removed()
    expect(made[0].destroyed).toBe(true)
  })

  it('builds the router once, however often the component re-renders', () => {
    const create = vi.fn(createFakeRouter)
    const view = render(<Probe create={create} />)
    view.rerender(<Probe create={create} />)
    view.rerender(<Probe create={() => createFakeRouter()} />)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('builds no router for a render React throws away', () => {
    const create = vi.fn(createFakeRouter)
    const gate = new Promise<void>(() => undefined)
    function Never(): ReactNode {
      throw gate
    }
    // The first render of a boundary that has not committed yet is discarded: nothing may be created for it.
    render(
      <Suspense fallback={<p>loading</p>}>
        <Probe create={create} />
        <Never />
      </Suspense>,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('unmounting out of creation order never removes the wrapper of a router that is still mounted', async () => {
    const { pushState, replaceState } = window.history
    let first: FakeRouter | null = null
    let second: FakeRouter | null = null
    const a = render(<Probe create={createFakeRouter} seen={(r) => (first = r)} />)
    const b = render(<Probe create={createFakeRouter} seen={(r) => (second = r)} />)

    a.unmount() // created first, released first: not the outermost wrapper
    await removed()
    window.history.pushState(null, '', '/')
    expect(second!.pushes).toBe(1) // the second router still hears pushes
    expect(first!.pushes).toBe(1) // and the first one's wrapper is still underneath, not yet destroyed

    b.unmount() // the last one lets go, which also releases the first
    await removed()
    expect(window.history.pushState).toBe(pushState)
    expect(window.history.replaceState).toBe(replaceState)
  })

  it("does not take the shell's (or any earlier) wrapper down with it", async () => {
    const shellOwn = createFakeRouter() // module-scope router of the shell, never destroyed
    const wrapped = window.history.pushState
    render(<Probe create={createFakeRouter} />).unmount()
    await removed()
    expect(window.history.pushState).toBe(wrapped)
    window.history.pushState(null, '', '/')
    expect(shellOwn.pushes).toBe(1)
    shellOwn.history.destroy()
  })

  describe('while the shell hides the remote and shows it again (Suspense above it)', () => {
    interface Hold {
      open: boolean
      promise: Promise<void>
    }
    function Gate({ hold }: { hold: Hold | null }) {
      if (hold && !hold.open) throw hold.promise
      return null
    }
    const mounted = (create: () => FakeRouter, hold: Hold | null, seen?: (r: FakeRouter) => void) => (
      <StrictMode>
        <Suspense fallback={<p>shell loading</p>}>
          <Probe create={create} seen={seen} />
          <Gate hold={hold} />
        </Suspense>
      </StrictMode>
    )
    const newHold = (): Hold => {
      const hold: Hold = { open: false, promise: Promise.resolve() }
      hold.promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          hold.open = true
          resolve()
        }, 20)
      })
      return hold
    }

    it('keeps the very router it had, alive, and releases it when the page finally lets go', async () => {
      const { pushState, replaceState } = window.history
      const seen = new Set<FakeRouter>()
      const create = vi.fn(createFakeRouter)
      const view = render(mounted(create, null, (r) => seen.add(r)))
      const hold = newHold()
      view.rerender(mounted(create, hold, (r) => seen.add(r)))
      expect(view.getByText('shell loading')).not.toBeNull()
      await act(() => hold.promise)

      expect(view.queryByText('shell loading')).toBeNull()
      expect(create).toHaveBeenCalledTimes(1)
      expect([...seen].length).toBe(1)
      const [router] = [...seen]
      expect(router.destroyed).toBe(false)

      view.unmount()
      await removed()
      expect(router.destroyed).toBe(true)
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    })

    it('releases the router of a remote that is removed while it is still hidden', async () => {
      const { pushState, replaceState } = window.history
      const seen = new Set<FakeRouter>()
      const view = render(mounted(createFakeRouter, null, (r) => seen.add(r)))
      const hold = newHold()
      view.rerender(mounted(createFakeRouter, hold, (r) => seen.add(r)))
      expect(view.getByText('shell loading')).not.toBeNull()

      view.unmount() // the effect cleanups already ran when it was hidden, so none runs now
      await removed()
      const [router] = [...seen]
      expect(router.destroyed).toBe(true)
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
      await hold.promise
    })
  })
})
