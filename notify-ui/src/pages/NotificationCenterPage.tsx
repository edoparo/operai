import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Banner,
  Button,
  ListRows,
  PageHeader,
  SkeletonRows,
  StatePanel,
  VisuallyHidden,
  useFocusOnMount,
} from '@operai/ui'
import { resetUnreadCount } from 'shell/session'
import NotificationItem from '../components/NotificationItem'
import { listNotifications, markAllRead } from '../lib/notificationsApi'
import type { Notification } from '../lib/notificationsApi'
import { strings } from '../strings'

/**
 * NotificationCenterPage — notify-ui's single, flat screen (T15,
 * specs/20260713-notification-center/tasks.md, design.md "Notification center
 * page" / Flow 2 / Flow 3 / Flow 4). Replaces T14's placeholder.
 *
 * `GET /notifications` (US-2, AC-2.2/2.3/2.4) drives four states — Loading /
 * Populated / Empty / Error — the same L/E/P/Err shape every other admin-ui
 * list screen uses (`../pages/UsersPage.tsx` etc.), re-authored locally
 * since admin-ui's `SkeletonListRows`/`ErrorBanner` can't be imported across
 * the Module Federation boundary (ADR 20260709-suite-frontend-module-federation) and this page's own scope
 * (T15's touch list) is the page + `NotificationItem` + the severity lookup
 * only — not a library of new shared components.
 *
 * The "mark unread as read on open" sequence (US-3, AC-3.1, design.md Flow
 * 3) runs exactly once per mount, the instant `GET /notifications` first
 * resolves successfully (loaded OR empty — both are a "response", AC-2.4's
 * empty case still triggers a harmless no-op mark-all-read):
 *   1. capture the response's unread (`readAt === null`) id set — this
 *      becomes THIS viewing session's "was-unread" set, used only to render
 *      the affordance (AC-3.2), never sent anywhere;
 *   2. `resetUnreadCount()` (shell/session) — instant local Bell badge clear
 *      in this tab;
 *   3. `POST /notifications/mark-all-read` (fire-and-forget, best-effort —
 *      server truth + the `unread-reset` SSE broadcast to sibling tabs is
 *      handled entirely server-side; a failure here must not block or
 *      re-render the already-successfully-loaded list).
 * `capturedRef` guards this to run once: a Retry after an error re-runs the
 * fetch effect, and Retry's own success is legitimately "the first response
 * of this viewing session" (nothing was captured yet) — but nothing else in
 * this component ever re-triggers the fetch effect, so the guard cannot
 * double-fire. Because this is *component-local* state with no persistence,
 * unmounting and remounting (leaving `/notify` and coming back, or a reload)
 * starts a brand-new `capturedRef`/`wasUnreadIds` — the previous session's
 * "New" tags are gone (AC-3.3), and only notifications that arrived since
 * the last mark-all-read (i.e. genuinely `readAt: null` in the fresh
 * response) get tagged this time. See design.md's "Gaps found" #1 for why
 * this is the deliberate reading of AC-3.2 vs AC-3.3 under the locked
 * page-only architecture (no separate panel-open/closed event to track).
 *
 * The explicit "Mark all as read" control (AC-3.4) is a always-enabled,
 * separate, idempotent trigger: it clears the local "was-unread" set
 * immediately (every "New" tag disappears without waiting on the network)
 * and re-fires `POST /notifications/mark-all-read` — a harmless no-op
 * server-side (nothing to do) since step 3 above already ran.
 */

type CenterState =
  { status: 'loading' } | { status: 'loaded'; items: Notification[] } | { status: 'error'; message: string }

const errorMessageFor = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return strings.center.loadFailedDetail
}

export default function NotificationCenterPage() {
  // The page heading takes focus on mount (INC-30), through the library hook.
  const headingRef = useFocusOnMount<HTMLHeadingElement>()
  const capturedRef = useRef(false)

  const [state, setState] = useState<CenterState>({ status: 'loading' })
  const [wasUnreadIds, setWasUnreadIds] = useState<Set<string>>(new Set())
  const [reloadToken, setReloadToken] = useState(0)

  // Fetches the list on mount, and again whenever `reloadToken` is bumped by
  // "Retry" (the only other trigger — see module doc for why a Promise chain
  // rather than async/await, mirrors ../../admin-ui/src/pages/UsersPage.tsx's
  // identical `react-hooks/set-state-in-effect` workaround).
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setState({ status: 'loading' })
      })
      .then(() => listNotifications())
      .then((response) => {
        if (cancelled) return

        if (!capturedRef.current) {
          capturedRef.current = true
          const unread = new Set(response.items.filter((item) => item.readAt === null).map((item) => item.id))
          setWasUnreadIds(unread)
          // Flow 3, step 1: instant local badge clear, then best-effort
          // server-side mark-all-read. Never blocks/affects the rendered
          // list — a failed POST here is silently swallowed; the user still
          // sees their (already-fetched) notifications.
          resetUnreadCount()
          void markAllRead().catch(() => {
            // Best-effort — see module doc. A retried/explicit "Mark all as
            // read" click, or the next visit, can still succeed.
          })
        }

        setState({ status: 'loaded', items: response.items })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessageFor(error) })
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const handleRetry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleMarkAllRead = useCallback(() => {
    // AC-3.4: clears every "New" tag immediately, client-side, without
    // waiting on the network; harmless no-op server-side when nothing is
    // unread (already the case right after open — Flow 3 already ran).
    setWasUnreadIds(new Set())
    void markAllRead().catch(() => {
      // Best-effort — see module doc.
    })
  }, [])

  return (
    <section aria-labelledby="notify-center-heading" data-testid="notify-center-page">
      <PageHeader
        title={strings.center.title}
        titleId="notify-center-heading"
        headingRef={headingRef}
        focusableHeading
        headingTestId="notify-center-heading"
        actions={
          <Button onClick={handleMarkAllRead} data-testid="notify-mark-all-read">
            {strings.center.markAllRead}
          </Button>
        }
      />

      {/* Loading/populated/empty/error announcement — mirrors EstimatesPage's/
          RemoteMount's/Pagination's `aria-live="polite"` sr-only convention. */}
      <VisuallyHidden live>
        {state.status === 'loading' && strings.center.loading}
        {state.status === 'loaded' && strings.center.loaded(state.items.length)}
        {state.status === 'error' && strings.center.loadFailed}
      </VisuallyHidden>

      {state.status === 'loading' && <SkeletonRows actions={0} testId="notify-skeleton" />}

      {state.status === 'error' && (
        <Banner
          tone="warning"
          data-testid="notify-error-banner"
          onRetry={handleRetry}
          retryLabel={strings.center.retry}
          retryTestId="notify-error-retry"
        >
          {state.message}
        </Banner>
      )}

      {state.status === 'loaded' && state.items.length === 0 && (
        <StatePanel title={strings.center.emptyTitle} testId="notify-empty-state">
          {strings.center.emptyBody}
        </StatePanel>
      )}

      {state.status === 'loaded' && state.items.length > 0 && (
        <ListRows label={strings.center.listLabel} testId="notify-list">
          {state.items.map((item) => (
            <NotificationItem key={item.id} notification={item} wasUnread={wasUnreadIds.has(item.id)} />
          ))}
        </ListRows>
      )}
    </section>
  )
}
