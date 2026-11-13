import { useCallback, useEffect, useState } from 'react'

export type Fetcher<T> = (signal: AbortSignal) => Promise<T>

export type ResourceState<T> = {
  status: 'loading' | 'ready' | 'error'
  data: T | null
  /** True while a reload runs behind data already on screen (a retry, or a cached page revisited). */
  refreshing: boolean
  /** The thrown value of a failed load (an `ApiError`, or a network `TypeError`). */
  error: unknown
  /** Loads again (after a failure, or after a write elsewhere changed the data). */
  retry: () => void
  /** Replaces the loaded value with one a write returned, without a round trip. */
  replace: (data: T) => void
}

export type ResourceOptions = {
  /**
   * Opts the page into stale-while-revalidate: the last answer is remembered under this key, in memory,
   * for the life of the tab, so coming back to the page shows it at once and reloads it behind, and a
   * `retry` keeps it on screen instead of a skeleton. The key must name everything the fetcher depends
   * on (filters, page, id). Never persisted: memory only, like the JWT (ADR-0001).
   *
   * Leave it out where a reload must rebuild what is on screen (an editor that re-seeds its form from a
   * fresh load after a 409): there a retry still goes through `loading`.
   */
  cacheKey?: string
}

type Outcome<T> =
  | { fetcher: Fetcher<T>; attempt: number; ok: true; data: T }
  | { fetcher: Fetcher<T>; attempt: number; ok: false; error: unknown }

const cache = new Map<string, unknown>()

/** Forgets every remembered answer (tests; never needed by a page). */
export const clearResourceCache = (): void => cache.clear()

/**
 * useResource — loads `fetcher` and tracks one of loading / ready / error.
 *
 * `fetcher` must be stable (`useCallback`): a new fetcher (new filters, a new page, another record) is a
 * new load. An outcome counts only for the fetcher and attempt that produced it, so a slow answer for
 * page 1 can never replace page 2. The request is aborted on unmount and whenever it is superseded.
 *
 * With a `cacheKey`, data already on screen is never thrown away for a reload of the same thing: a
 * `retry` keeps the last answer (status `ready`, `refreshing` true) until the new one arrives, and the
 * page starts from the last answer for that key. Without one, every load shows `loading` first. A failed
 * reload is still an `error`.
 */
export function useResource<T>(fetcher: Fetcher<T>, options: ResourceOptions = {}): ResourceState<T> {
  const { cacheKey } = options
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetcher(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return
        if (cacheKey !== undefined) cache.set(cacheKey, data)
        setOutcome({ fetcher, attempt, ok: true, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setOutcome({ fetcher, attempt, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [fetcher, attempt, cacheKey])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])
  const replace = useCallback(
    (data: T) => {
      if (cacheKey !== undefined) cache.set(cacheKey, data)
      setOutcome({ fetcher, attempt, ok: true, data })
    },
    [fetcher, attempt, cacheKey],
  )

  const current = outcome !== null && outcome.fetcher === fetcher && outcome.attempt === attempt ? outcome : null
  if (current !== null) {
    return {
      status: current.ok ? 'ready' : 'error',
      data: current.ok ? current.data : null,
      refreshing: false,
      error: current.ok ? null : current.error,
      retry,
      replace,
    }
  }

  // Loading. Show what is already known for the same thing instead of a skeleton.
  const stale =
    cacheKey === undefined
      ? null
      : outcome !== null && outcome.ok && outcome.fetcher === fetcher
        ? { data: outcome.data }
        : cache.has(cacheKey)
          ? { data: cache.get(cacheKey) as T }
          : null
  return stale !== null
    ? { status: 'ready', data: stale.data, refreshing: true, error: null, retry, replace }
    : { status: 'loading', data: null, refreshing: false, error: null, retry, replace }
}
