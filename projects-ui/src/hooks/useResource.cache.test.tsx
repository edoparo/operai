/**
 * @vitest-environment jsdom
 *
 * useResource with a `cacheKey`: a page revisited starts from its last answer and a retry keeps the data on
 * screen, so navigating or reloading never blanks the page with a skeleton.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { clearResourceCache, useResource } from './useResource'

afterEach(() => clearResourceCache())

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useResource with a cacheKey', () => {
  it('keeps the data on screen during a retry, marked as refreshing', async () => {
    let next = deferred<string>()
    const fetcher = () => next.promise
    const { result } = renderHook(() => useResource(fetcher, { cacheKey: 'list' }))
    expect(result.current.status).toBe('loading')
    await act(async () => next.resolve('first'))
    await waitFor(() => expect(result.current.data).toBe('first'))

    next = deferred<string>()
    act(() => result.current.retry())
    expect(result.current).toMatchObject({ status: 'ready', data: 'first', refreshing: true })
    await act(async () => next.resolve('second'))
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', data: 'second', refreshing: false }))
  })

  it('starts a revisited page from its last answer, then replaces it with the fresh one', async () => {
    const first = renderHook(() => useResource(async () => 'remembered', { cacheKey: 'templates' }))
    await waitFor(() => expect(first.result.current.data).toBe('remembered'))
    first.unmount()

    const fresh = deferred<string>()
    const fetcher = () => fresh.promise
    const again = renderHook(() => useResource(fetcher, { cacheKey: 'templates' }))
    expect(again.result.current).toMatchObject({ status: 'ready', data: 'remembered', refreshing: true })
    await act(async () => fresh.resolve('fresh'))
    await waitFor(() => expect(again.result.current).toMatchObject({ data: 'fresh', refreshing: false }))
  })

  it('a different key knows nothing: it loads', () => {
    const { result } = renderHook(() => useResource(() => new Promise<string>(() => {}), { cacheKey: 'other' }))
    expect(result.current.status).toBe('loading')
  })

  it('without a key a retry still goes through loading (editors re-seed their form from it)', async () => {
    let calls = 0
    const fetcher = async () => ++calls
    const { result } = renderHook(() => useResource(fetcher))
    await waitFor(() => expect(result.current.data).toBe(1))
    act(() => result.current.retry())
    expect(result.current.status).toBe('loading')
  })
})
