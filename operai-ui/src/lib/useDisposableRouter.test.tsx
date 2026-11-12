import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDisposableRouter } from './useDisposableRouter'
import type { DisposableRouter } from './useDisposableRouter'

// Mimics @tanstack/history's createBrowserHistory: wrap pushState/replaceState, listen on the window,
// and undo exactly that — by writing back what it captured — in destroy().
interface FakeRouter extends DisposableRouter {
  pushes: number
}

function createFakeRouter(): FakeRouter {
  const originalPush = window.history.pushState
  const originalReplace = window.history.replaceState
  const onPop = () => undefined
  const router: FakeRouter = {
    pushes: 0,
    history: {
      destroy: () => {
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

function Probe({ create, seen }: { create: () => FakeRouter; seen?: (r: FakeRouter | null) => void }) {
  const router = useDisposableRouter(create)
  seen?.(router)
  return router ? <p>router</p> : null
}

const live = (spy: { mock: { calls: unknown[][] } }, type: string) => spy.mock.calls.filter((c) => c[0] === type).length

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useDisposableRouter', () => {
  it('renders the router it created, synchronously after mount', () => {
    const view = render(<Probe create={createFakeRouter} />)
    expect(view.getByText('router')).not.toBeNull()
  })

  for (const strict of [false, true]) {
    it(`${strict ? 'under StrictMode, ' : ''}leaves no listener and no wrapper behind after any number of mounts`, () => {
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
      }
      expect(live(add, 'popstate')).toBe(live(remove, 'popstate'))
      expect(live(add, 'beforeunload')).toBe(live(remove, 'beforeunload'))
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    })
  }

  it('under StrictMode the router that stays mounted is a live one (its wrapper is still installed)', () => {
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
    expect(made.length).toBe(2)
    window.history.pushState(null, '', '/')
    expect(made[0].pushes).toBe(0)
    expect(made[1].pushes).toBe(1)
    view.unmount()
  })

  it('builds the router once, however often the component re-renders', () => {
    const create = vi.fn(createFakeRouter)
    const view = render(<Probe create={create} />)
    view.rerender(<Probe create={create} />)
    view.rerender(<Probe create={() => createFakeRouter()} />)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('unmounting out of creation order never removes the wrapper of a router that is still mounted', () => {
    const { pushState, replaceState } = window.history
    let first: FakeRouter | null = null
    let second: FakeRouter | null = null
    const a = render(<Probe create={createFakeRouter} seen={(r) => (first = r ?? first)} />)
    const b = render(<Probe create={createFakeRouter} seen={(r) => (second = r ?? second)} />)

    a.unmount() // created first, released first: not the outermost wrapper
    window.history.pushState(null, '', '/')
    expect(second!.pushes).toBe(1) // the second router still hears pushes
    expect(first!.pushes).toBe(1) // and the first one's wrapper is still underneath, not yet destroyed

    b.unmount() // the last one lets go, which also releases the first
    expect(window.history.pushState).toBe(pushState)
    expect(window.history.replaceState).toBe(replaceState)
  })

  it("does not take the shell's (or any earlier) wrapper down with it", () => {
    const shellOwn = createFakeRouter() // module-scope router of the shell, never destroyed
    const wrapped = window.history.pushState
    render(<Probe create={createFakeRouter} />).unmount()
    expect(window.history.pushState).toBe(wrapped)
    window.history.pushState(null, '', '/')
    expect(shellOwn.pushes).toBe(1)
    shellOwn.history.destroy()
  })
})
