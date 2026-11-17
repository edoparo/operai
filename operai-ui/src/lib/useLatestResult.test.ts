import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { LatestResultBusyError, parseRetryAfter, useLatestResult } from './useLatestResult'

type Deferred = { resolve: (v: string) => void; reject: (e: unknown) => void; signal: AbortSignal; input: string }

/** A fetcher whose every call stays open until the test settles it. */
function controlledFetcher() {
  const calls: Deferred[] = []
  const fetcher = (input: string, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ resolve, reject, signal, input })
    })
  return { calls, fetcher }
}

const flush = () => act(async () => {})
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useLatestResult', () => {
  it('asks at once the first time, pending until the answer arrives', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result } = renderHook(() => useLatestResult('a', fetcher))
    expect(result.current.status).toBe('pending')
    await advance(0)
    expect(calls.map((c) => c.input)).toEqual(['a'])
    await act(async () => calls[0].resolve('A'))
    expect(result.current).toMatchObject({ status: 'ready', result: 'A', error: undefined })
  })

  it('sends one request after a burst of edits, and aborts the one in flight', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 300 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    await act(async () => calls[0].resolve('A'))

    rerender({ v: 'ab' })
    await advance(200)
    rerender({ v: 'abc' })
    await advance(200)
    expect(calls).toHaveLength(1) // 200 ms after the last edit: nothing yet
    await advance(100)
    expect(calls.map((c) => c.input)).toEqual(['a', 'abc'])
    expect(result.current.status).toBe('pending')

    rerender({ v: 'abcd' }) // an edit while 'abc' is in flight aborts it
    expect(calls[1].signal.aborted).toBe(true)
  })

  it('discards an answer that arrives after a newer one was asked for', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 50 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    await act(async () => calls[0].resolve('A'))
    rerender({ v: 'b' })
    await advance(50)
    rerender({ v: 'c' })
    await advance(50)
    expect(calls.map((c) => c.input)).toEqual(['a', 'b', 'c'])

    await act(async () => calls[2].resolve('C'))
    expect(result.current).toMatchObject({ status: 'ready', result: 'C' })
    await act(async () => calls[1].resolve('B (stale)')) // the fetcher ignored the abort
    expect(result.current).toMatchObject({ status: 'ready', result: 'C' })
  })

  it('discards a stale answer even when it is the only thing that arrives (newer still waiting)', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 50 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    await act(async () => calls[0].resolve('A'))
    rerender({ v: 'b' })
    await advance(50)
    rerender({ v: 'c' }) // 'b' is stale now, 'c' not sent yet
    await act(async () => calls[1].resolve('B (stale)'))
    expect(result.current).toMatchObject({ status: 'pending', result: 'A' })
  })

  it('keeps the previous result while the next is made, and when it fails', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 10 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    await act(async () => calls[0].resolve('A'))
    rerender({ v: 'b' })
    expect(result.current).toMatchObject({ status: 'pending', result: 'A' })
    await advance(10)
    const boom = new Error('boom')
    await act(async () => calls[1].reject(boom))
    expect(result.current).toMatchObject({ status: 'failed', result: 'A', error: boom })
  })

  it('compares the input by value, so a fresh equal object asks nothing', async () => {
    const { calls, fetcher } = controlledFetcher()
    const f = (input: { n: number }, signal: AbortSignal) => fetcher(JSON.stringify(input), signal)
    const { rerender } = renderHook(({ n }) => useLatestResult({ n }, f, { debounceMs: 10 }), { initialProps: { n: 1 } })
    await advance(0)
    await act(async () => calls[0].resolve('A'))
    rerender({ n: 1 })
    await advance(100)
    expect(calls).toHaveLength(1)
  })

  it('retries busy after Retry-After, keeping the previous result, then gives the answer', async () => {
    const answers = [new LatestResultBusyError(2000), 'B']
    const seen: number[] = []
    const fetcher = vi.fn((input: string) => {
      seen.push(Date.now())
      if (input === 'a') return Promise.resolve('A')
      const next = answers.shift()
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next as string)
    })
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 10 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    expect(result.current.result).toBe('A')
    rerender({ v: 'b' })
    await advance(10)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current).toMatchObject({ status: 'pending', result: 'A' })
    await advance(1900)
    expect(fetcher).toHaveBeenCalledTimes(2) // not before Retry-After
    await advance(100)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result.current).toMatchObject({ status: 'ready', result: 'B' })
    expect(seen[2] - seen[1]).toBe(2000)
  })

  it('fails with the busy error once the retries are used up, and caps the wait', async () => {
    const busy = new LatestResultBusyError(60_000)
    const fetcher = vi.fn(() => Promise.reject(busy))
    const { result } = renderHook(() => useLatestResult('a', fetcher, { maxBusyRetries: 1, maxRetryDelayMs: 1000 }))
    await advance(0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current).toMatchObject({ status: 'failed', error: busy })
  })

  it('a newer input cancels a pending busy retry', async () => {
    const fetcher = vi.fn((input: string) =>
      input === 'a' ? Promise.reject(new LatestResultBusyError(1000)) : Promise.resolve('B'),
    )
    const { result, rerender } = renderHook(({ v }) => useLatestResult(v, fetcher, { debounceMs: 10 }), {
      initialProps: { v: 'a' },
    })
    await advance(0)
    rerender({ v: 'b' })
    await advance(10)
    expect(result.current).toMatchObject({ status: 'ready', result: 'B' })
    await advance(5000)
    expect(fetcher.mock.calls.map(([i]) => i)).toEqual(['a', 'b'])
  })

  it('retry() asks again for the same input at once, without the debounce', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result } = renderHook(() => useLatestResult('a', fetcher, { debounceMs: 5000 }))
    await advance(0)
    await act(async () => calls[0].reject(new Error('x')))
    expect(result.current.status).toBe('failed')
    act(() => result.current.retry())
    expect(result.current.status).toBe('pending')
    await advance(0)
    expect(calls).toHaveLength(2)
    await act(async () => calls[1].resolve('A'))
    expect(result.current).toMatchObject({ status: 'ready', result: 'A' })
  })

  it('enabled=false asks nothing and cancels the request in flight, keeping the result', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { result, rerender } = renderHook(({ on }) => useLatestResult('a', fetcher, { enabled: on }), {
      initialProps: { on: true },
    })
    await advance(0)
    expect(calls).toHaveLength(1)
    rerender({ on: false })
    expect(calls[0].signal.aborted).toBe(true)
    expect(result.current.status).toBe('idle')
    await act(async () => calls[0].resolve('late'))
    expect(result.current.result).toBeUndefined()
  })

  it('aborts and ignores everything after unmount', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { unmount } = renderHook(() => useLatestResult('a', fetcher))
    await advance(0)
    unmount()
    expect(calls[0].signal.aborted).toBe(true)
    await act(async () => calls[0].reject(new DOMException('aborted', 'AbortError')))
    await flush()
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, and nothing else', () => {
    expect(parseRetryAfter('3')).toBe(3000)
    expect(parseRetryAfter(' 0.5 ')).toBe(500)
    const now = Date.parse('2026-11-16T10:00:00Z')
    expect(parseRetryAfter('Mon, 16 Nov 2026 10:00:04 GMT', now)).toBe(4000)
    expect(parseRetryAfter('Mon, 16 Nov 2026 09:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('')).toBeUndefined()
  })
})
