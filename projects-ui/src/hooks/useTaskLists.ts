import { useCallback, useEffect, useRef, useState } from 'react'
import type { MyTask, ProjectTaskQuery } from '../lib/activitiesApi'
import type { Page } from '../lib/types'

/** One answer of `GET /tasks`; My tasks may name hosts it left out (`unavailable`, AC-7.5). */
export type TaskPage = Page<MyTask> & { unavailable?: string[] }

/** Reads one page of tasks: `listProjectTasks` for a project, `listMyTasks` for the person. */
export type TaskLister = (query: ProjectTaskQuery, init: { signal: AbortSignal }) => Promise<TaskPage>

type PageFetcher = (page: number, signal: AbortSignal) => Promise<TaskPage>

/** What is loaded of one list: its items in the server's order, its total, how many pages were read. */
export type LoadedTasks = {
  items: MyTask[]
  total: number
  pages: number
  /** The rows the pages held, before removing a task two pages both returned. */
  received: number
  /** The rows the last page held; an empty page ends "Load more" whatever the total says. */
  lastCount: number
  unavailable: string[]
}

type Inner = {
  fetcher: PageFetcher
  data: LoadedTasks | null
  failed: boolean
  error: unknown
  refreshing: boolean
  loadingMore: boolean
  moreError: unknown
}

export type TaskList = {
  status: 'loading' | 'ready' | 'error'
  data: LoadedTasks | null
  error: unknown
  /** A re-read runs behind the rows already on screen. */
  refreshing: boolean
  /** The total exceeds what is loaded: "Load more" is offered. */
  hasMore: boolean
  loadingMore: boolean
  /** Why the last "Load more" failed (the same button retries). */
  moreError: unknown
  /** Reads every page loaded so far again, keeping the rows on screen until the answer lands. */
  reload: () => void
  /** Appends the next page. */
  loadMore: () => void
}

const merge = (pages: readonly TaskPage[], into: LoadedTasks | null = null): LoadedTasks => {
  const items = [...(into?.items ?? [])]
  const seen = new Set(items.map((item) => item.id))
  const unavailable = new Set(into?.unavailable ?? [])
  let received = into?.received ?? 0
  for (const page of pages) {
    received += page.items.length
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
    for (const host of page.unavailable ?? []) unavailable.add(host)
  }
  const last = pages.at(-1)
  return {
    items,
    total: last?.total ?? into?.total ?? 0,
    pages: (into?.pages ?? 0) + pages.length,
    received,
    lastCount: last?.items.length ?? 0,
    unavailable: [...unavailable],
  }
}

/**
 * usePagedTasks — one list of tasks read page by page, "Load more" appending the next page.
 *
 * `fetcher` must be stable: a new fetcher (another project, another filter) is a new list and starts from `loading`.
 * A `reload` (after a write) reads every page loaded so far again and keeps the rows on screen meanwhile (`refreshing`),
 * so a card, and the drawer it opened, stay mounted (specs/20261116-record-hours-in-place design S3); a failed re-read
 * is an `error`, never rows shown as if they were current. An answer counts only for the fetcher and the request that
 * asked for it: everything in flight is aborted when it is superseded and on unmount.
 */
function usePagedTasks(fetcher: PageFetcher): TaskList {
  const [inner, setInner] = useState<Inner | null>(null)
  const requests = useRef<{ main: AbortController | null; more: AbortController | null }>({ main: null, more: null })

  const read = useCallback(
    (pages: number) => {
      requests.current.main?.abort()
      requests.current.more?.abort()
      const controller = new AbortController()
      requests.current.main = controller
      Promise.all(Array.from({ length: pages }, (_, index) => fetcher(index + 1, controller.signal))).then(
        (answers) => {
          if (controller.signal.aborted) return
          const data = merge(answers)
          setInner({
            fetcher,
            data,
            failed: false,
            error: null,
            refreshing: false,
            loadingMore: false,
            moreError: null,
          })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          setInner({ fetcher, data: null, failed: true, error, refreshing: false, loadingMore: false, moreError: null })
        },
      )
      return controller
    },
    [fetcher],
  )

  useEffect(() => {
    const controller = read(1)
    const current = requests.current
    return () => {
      controller.abort()
      current.more?.abort()
    }
  }, [read])

  const current = inner !== null && inner.fetcher === fetcher ? inner : null

  const reload = () => {
    const pages = current?.data?.pages ?? 1
    setInner((previous) =>
      previous !== null && previous.fetcher === fetcher
        ? { ...previous, failed: false, error: null, refreshing: true, loadingMore: false, moreError: null }
        : previous,
    )
    read(pages)
  }

  const loadMore = () => {
    const data = current?.data
    if (!data) return
    requests.current.more?.abort()
    const controller = new AbortController()
    requests.current.more = controller
    setInner((previous) => (previous !== null ? { ...previous, loadingMore: true, moreError: null } : previous))
    fetcher(data.pages + 1, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        setInner((previous) =>
          previous !== null && previous.fetcher === fetcher && previous.data !== null
            ? { ...previous, data: merge([answer], previous.data), loadingMore: false }
            : previous,
        )
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setInner((previous) => (previous !== null ? { ...previous, loadingMore: false, moreError: error } : previous))
      },
    )
  }

  const data = current?.data ?? null
  const status = data !== null ? 'ready' : current?.failed ? 'error' : 'loading'
  return {
    status,
    data,
    error: current?.failed ? current.error : null,
    refreshing: current?.refreshing ?? false,
    hasMore: data !== null && data.received < data.total && data.lastCount > 0,
    loadingMore: current?.loadingMore ?? false,
    moreError: current?.moreError ?? null,
    reload,
    loadMore,
  }
}

/** Cards a lane reads at once; "Load more" appends the next page. */
export const TASK_PAGE_SIZE = 100

/** How far back the Done lane reaches until the person asks for older tasks. */
export const DONE_WINDOW_DAYS = 30

export type TaskLists = {
  /** `status=open`: the Open AND In progress lanes (split by each task's own status). */
  active: TaskList
  /** `status=done`: the last 30 days, or every done task once `olderDone`. */
  done: TaskList
  olderDone: boolean
  /** "Show older": the Done lane reads every done task, not just the last 30 days. */
  showOlderDone: () => void
  /** Reads both lists again (after a write), keeping the cards on screen. */
  reload: () => void
}

/**
 * useTaskLists — the two reads behind a task board: the open tasks (in progress included), and the done ones of the
 * last 30 days (`completedSince`, which an older activities-api ignores, answering every done task), 100 a page each,
 * in the order the server sends (due date first for open ones, most recently completed first for done ones).
 */
export function useTaskLists(list: TaskLister): TaskLists {
  const [since] = useState(() => new Date(Date.now() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString())
  const [olderDone, setOlderDone] = useState(false)

  const activeFetcher = useCallback<PageFetcher>(
    (page, signal) => list({ status: 'open', page, pageSize: TASK_PAGE_SIZE }, { signal }),
    [list],
  )
  const doneFetcher = useCallback<PageFetcher>(
    (page, signal) =>
      list(
        { status: 'done', page, pageSize: TASK_PAGE_SIZE, ...(olderDone ? {} : { completedSince: since }) },
        { signal },
      ),
    [list, olderDone, since],
  )
  const active = usePagedTasks(activeFetcher)
  const done = usePagedTasks(doneFetcher)

  return {
    active,
    done,
    olderDone,
    showOlderDone: () => setOlderDone(true),
    reload: () => {
      active.reload()
      done.reload()
    },
  }
}
