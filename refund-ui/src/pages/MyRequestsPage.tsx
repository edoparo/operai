import { useCallback, useEffect, useRef, useState } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import {
  Banner,
  ListRows,
  PageHeader,
  StatePanel,
  VisuallyHidden,
  buttonClassName,
  listRowClassName,
  listRowMetaClassName,
} from '@operai/ui'
import { strings } from '../strings'
import * as requestsApi from '../lib/requestsApi'
import type { RequestListItem } from '../lib/requestsApi'
import { ApiError } from '../lib/refundApi'
import { formatDate } from '../lib/dates'
import { formatSubtotalsPreview } from '../lib/subtotals'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import PermissionDenied from '../components/PermissionDenied'
import RequestStatusBadge from '../components/RequestStatusBadge'

const route = getRouteApi('/requests')

/**
 * MyRequestsPage — Screen R1 ("My requests", `/refund/requests` — T16,
 * specs/20260716-refund-service/tasks.md, design.md "Screen R1"). Replaces T14's
 * placeholder with the real screen: a flat list of the caller's own
 * requests (status badge + last-updated date + a compact per-currency
 * subtotal preview), "New request", and every list state design.md names.
 *
 * States (design.md "L/E/P/Err/PD"):
 *   L   — SkeletonListRows + an sr-only aria-live loading announcement.
 *   E   — true first-time zero-requests onboarding CTA.
 *   P   — the row list; each row opens Screen R2.
 *   Err — ErrorBanner + Retry.
 *   PD  — PermissionDenied (403 on `GET /requests`) — no Retry (design.md:
 *         "a 403 here isn't transient").
 *
 * No pagination — `GET /requests` is a bare array in plan.md's contract
 * (design.md Gap #6); this screen renders every row it gets.
 *
 * Fetch pattern: an explicit Promise chain, not async/await invoked from the
 * effect — mirrors `admin-ui/src/pages/RolesPage.tsx`'s own doc comment
 * (`react-hooks/set-state-in-effect` flags an async function that calls a
 * state setter anywhere in its body, even after an `await`).
 */

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; items: RequestListItem[] }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }

const errorMessageFor = (error: unknown): string => {
  if (error instanceof ApiError) return error.detail ?? error.title
  return strings.pages.myRequests.loadErrorFallback
}

export default function MyRequestsPage() {
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const t = strings.pages.myRequests
  const { confirmation } = route.useSearch()
  const navigate = useNavigate()
  // INC-19: a one-shot confirmation from the page that navigated here (deleting
  // a draft) — announced by the live region, shown by the banner, then
  // stripped from the URL so a refresh never repeats it.
  const [liveMessage, setLiveMessage] = useState('')
  const [visibleConfirmation, setVisibleConfirmation] = useState<string | null>(null)
  const strippedConfirmationRef = useRef(false)

  useEffect(() => {
    if (!confirmation || strippedConfirmationRef.current) return
    strippedConfirmationRef.current = true
    setLiveMessage(confirmation)
    setVisibleConfirmation(confirmation)
    void navigate({ to: '/requests', search: {}, replace: true })
  }, [confirmation, navigate])

  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setListState({ status: 'loading' })
      })
      .then(() => requestsApi.list())
      .then((items) => {
        if (!cancelled) setListState({ status: 'loaded', items })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) {
          setListState({ status: 'forbidden' })
        } else {
          setListState({ status: 'error', message: errorMessageFor(error) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const handleRetry = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return (
    <section aria-labelledby="refund-my-requests-heading" data-testid="refund-my-requests-page">
      <PageHeader
        title={t.heading}
        titleId="refund-my-requests-heading"
        actions={
          listState.status !== 'forbidden' && (
            <Link
              to="/requests/new"
              data-testid="my-requests-new-button"
              className={buttonClassName({ variant: 'primary' })}
            >
              {t.newRequestButton}
            </Link>
          )
        }
      />

      <VisuallyHidden live data-testid="my-requests-live-message">
        {liveMessage}
      </VisuallyHidden>

      {/* The visible copy — `aria-live="off"`: the live region above announces it once. */}
      {visibleConfirmation && (
        <Banner
          tone="success"
          compact
          aria-live="off"
          autoDismiss
          onDismiss={() => setVisibleConfirmation(null)}
          dismissLabel={t.confirmationDismissLabel}
          className="mb-4"
          data-testid="my-requests-confirmation"
        >
          {visibleConfirmation}
        </Banner>
      )}

      <div>
        {listState.status === 'forbidden' && <PermissionDenied />}

        {listState.status === 'loading' && (
          <>
            <VisuallyHidden live>{t.loadingAnnouncement}</VisuallyHidden>
            <SkeletonListRows />
          </>
        )}

        {listState.status === 'error' && <ErrorBanner message={listState.message} onRetry={handleRetry} />}

        {listState.status === 'loaded' && listState.items.length === 0 && (
          // No action here — the header's "New request" already serves this;
          // a centred second button would be redundant.
          <StatePanel title={t.empty.heading} testId="my-requests-empty-state">
            {t.empty.body}
          </StatePanel>
        )}

        {listState.status === 'loaded' && listState.items.length > 0 && (
          <ListRows testId="my-requests-list">
            {listState.items.map((item) => {
              const preview = formatSubtotalsPreview(item.subtotals)
              const updated = formatDate(item.updatedAt)
              return (
                <Link
                  to="/requests/$id"
                  params={{ id: item.id }}
                  key={item.id}
                  data-testid={`my-requests-row-${item.id}`}
                  aria-label={t.row.openLabel(updated)}
                  className={listRowClassName}
                >
                  <span className="flex items-center gap-3">
                    <RequestStatusBadge status={item.status} />
                    <span className={listRowMetaClassName}>{t.row.updatedLabel(updated)}</span>
                  </span>
                  {preview && <span className="text-sm font-mono">{preview}</span>}
                </Link>
              )
            })}
          </ListRows>
        )}
      </div>
    </section>
  )
}
