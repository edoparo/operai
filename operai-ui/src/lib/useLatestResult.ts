import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The service answered "busy" and said when to come back (HTTP 503/429 with
 * `Retry-After`). Throw it from the fetcher; `useLatestResult` waits that long
 * and asks again (at most `maxBusyRetries` times), keeping the previous result
 * on screen meanwhile.
 */
export class LatestResultBusyError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number, message = 'The service is busy') {
    super(message)
    this.name = 'LatestResultBusyError'
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * A `Retry-After` header value ("3" seconds, or an HTTP date) in milliseconds,
 * never negative; `undefined` when the header is absent or unreadable.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  const text = value?.trim()
  if (!text) return undefined
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000)
  const at = Date.parse(text)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}

export type LatestResultStatus =
  /** `enabled` is false: nothing is asked. */
  | 'idle'
  /** A request is waiting for the debounce, in flight, or waiting to retry `busy`. */
  | 'pending'
  /** The latest input has been answered. */
  | 'ready'
  /** The latest input failed; `result` still holds the previous answer, if any. */
  | 'failed'

export type LatestResultOptions = {
  /** Wait after the last change before asking, ms. The very first request is not delayed. Default 300. */
  debounceMs?: number
  /** False asks nothing and cancels what is running (the previous result is kept). Default true. */
  enabled?: boolean
  /** How many times a `LatestResultBusyError` is retried before it counts as a failure. Default 2. */
  maxBusyRetries?: number
  /** The longest a `Retry-After` is honoured, ms (a bigger one is cut to this). Default 10000. */
  maxRetryDelayMs?: number
}

export type LatestResult<R> = {
  status: LatestResultStatus
  /** The last answer that was still current when it arrived; kept while a newer one is awaited or failed. */
  result: R | undefined
  /** The failure of the latest input; set only while `status` is `failed`. */
  error: unknown
  /** Asks again for the current input now, without waiting for the debounce. */
  retry: () => void
}

type Settled = { signature: string; attempt: number; error: unknown; failed: boolean }

/**
 * useLatestResult — the request discipline of a live preview: one request
 * after a pause in the edits, the older one aborted, an answer that arrives
 * after a newer one was asked for discarded, the previous result kept on
 * screen while the next is made or when it fails, and `busy` retried after
 * the service's `Retry-After`.
 *
 * `input` is compared by value (JSON), so a fresh object each render is fine;
 * it must be JSON-serialisable. `fetcher` receives the input and an
 * `AbortSignal`; the latest `fetcher` is always the one called, so it need
 * not be memoised. A rejection caused by the abort is ignored.
 */
export function useLatestResult<I, R>(
  input: I,
  fetcher: (input: I, signal: AbortSignal) => Promise<R>,
  options: LatestResultOptions = {},
): LatestResult<R> {
  const { debounceMs = 300, enabled = true, maxBusyRetries = 2, maxRetryDelayMs = 10_000 } = options
  const signature = JSON.stringify(input) ?? ''
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [answer, setAnswer] = useState<{ value: R } | null>(null)

  // Latest values for the async work, written after render.
  const latest = useRef({ input, fetcher, debounceMs, maxBusyRetries, maxRetryDelayMs })
  useEffect(() => {
    latest.current = { input, fetcher, debounceMs, maxBusyRetries, maxRetryDelayMs }
  })
  const hasAsked = useRef(false)
  const lastAttempt = useRef(0)
  const sequence = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    const mine = ++sequence.current // this input's sequence id: any older answer is stale from now on
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const isCurrent = () => sequence.current === mine && !controller.signal.aborted

    const run = (busyRetries: number) => {
      const { input: current, fetcher: ask } = latest.current
      hasAsked.current = true
      ask(current, controller.signal).then(
        (value) => {
          if (!isCurrent()) return
          setAnswer({ value })
          setSettled({ signature, attempt, error: undefined, failed: false })
        },
        (error: unknown) => {
          if (!isCurrent()) return
          if (error instanceof LatestResultBusyError && busyRetries < latest.current.maxBusyRetries) {
            const wait = Math.min(Math.max(0, error.retryAfterMs), latest.current.maxRetryDelayMs)
            timer = setTimeout(() => run(busyRetries + 1), wait)
            return
          }
          setSettled({ signature, attempt, error, failed: true })
        },
      )
    }

    // The first request goes at once; a change after it waits for a pause (a retry() does not wait).
    const isRetry = attempt !== lastAttempt.current
    lastAttempt.current = attempt
    timer = setTimeout(() => run(0), hasAsked.current && !isRetry ? latest.current.debounceMs : 0)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [signature, attempt, enabled])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const upToDate = settled !== null && settled.signature === signature && settled.attempt === attempt
  const status: LatestResultStatus = !enabled ? 'idle' : !upToDate ? 'pending' : settled.failed ? 'failed' : 'ready'
  return {
    status,
    result: answer?.value,
    error: status === 'failed' ? settled?.error : undefined,
    retry,
  }
}
