import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ListRows,
  PageHeader,
  StatePanel,
  VisuallyHidden,
  buttonClassName,
  listRowClassName,
  listRowMetaClassName,
} from '@operai/ui'
import { strings } from '../strings'
import * as batchesApi from '../lib/batchesApi'
import type { BatchSummary } from '../lib/batchesApi'
import { ApiError } from '../lib/refundApi'
import { formatDateTime } from '../lib/dates'
import { formatBatchSubtotalsPreview } from '../lib/batchSubtotals'
import SkeletonListRows from '../components/SkeletonListRows'
import ErrorBanner from '../components/ErrorBanner'
import PermissionDenied from '../components/PermissionDenied'
import BatchStatusBadge from '../components/BatchStatusBadge'

/**
 * BatchHistoryPage — Screen B1 ("Batch history", `/refund/batches` — T13,
 * specs/008-refund-monthly-processing/tasks.md, design.md "Screen B1"/F8).
 * Replaces T9's placeholder: the entry point for every accounting
 * monthly-processing flow — a flat list of EVERY batch regardless of status
 * (AC-8.2, never filtered to only `compiled`), mirroring `MyRequestsPage`/
 * `ReviewQueuePage`'s own list-screen shape.
 *
 * States (design.md "L/E/P/Err/PD"):
 *   L   — SkeletonListRows + an sr-only aria-live loading announcement.
 *   E   — a true first-time zero-batches-ever state (distinct from PD — a
 *         real, successful, empty result), + the same "Compile new batch"
 *         CTA the populated header also shows.
 *   P   — the row list (cutoff, `BatchStatusBadge`, request count,
 *         per-currency totals, compact email-status indicator); each row
 *         opens Screen B3.
 *   Err — ErrorBanner + Retry.
 *   PD  — PermissionDenied (AC-8.3, no `request:review` at all), no Retry —
 *         defense-in-depth for a direct URL even though the shell's own nav
 *         already hides this entry point for non-accounting users.
 *
 * No pagination — `GET /batches` is a bare array in plan.md's contract
 * (design.md Gap #6, carried from 007's own Gap #6).
 *
 * "Compile new batch" is visible regardless of the caller's exact
 * capabilities (design.md F8 step 3 — mirrors `RefundShell`'s Gap #7
 * reasoning: refund-ui has no cheap client-side way to know if THIS caller
 * specifically holds `request:review`; a harmless dead end caught by
 * `CompileBatchPage`'s own PD state).
 *
 * No `confirmation` search param is read here (design.md Gap #4) — F1's
 * post-compile confirmation lands on the new batch's own Screen B3, not back
 * on B1 (unlike 007's Approve/Reject, which DO return to their list) — this
 * screen deliberately does not carry that unused scaffolding.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'loaded'; items: BatchSummary[] }
  | { status: 'error'; message: string }
  | { status: 'forbidden' }

const errorMessageFor = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) return error.detail ?? error.title
  return fallback
}

export default function BatchHistoryPage() {
  const [listState, setListState] = useState<ListState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const t = strings.pages.batchHistory
  const emailLabels = strings.pages.batchDetail.email

  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setListState({ status: 'loading' })
      })
      .then(() => batchesApi.list())
      .then((items) => {
        if (!cancelled) setListState({ status: 'loaded', items })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 403) {
          setListState({ status: 'forbidden' })
        } else {
          setListState({ status: 'error', message: errorMessageFor(error, t.loadErrorFallback) })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken, t.loadErrorFallback])

  const handleRetry = useCallback(() => {
    setReloadToken((n) => n + 1)
  }, [])

  return (
    <section aria-labelledby="refund-batch-history-heading" data-testid="refund-batch-history-page">
      <PageHeader
        title={t.heading}
        titleId="refund-batch-history-heading"
        actions={
          listState.status !== 'forbidden' && (
            // Was a white label on --acc (4.3:1, below AA); the primary button uses --acc-solid.
            <Link
              to="/batches/new"
              data-testid="batch-history-new-button"
              className={buttonClassName({ variant: 'primary' })}
            >
              {t.newBatchButton}
            </Link>
          )
        }
      />

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
          // No action here — the header's "Compile new batch" already serves this.
          <StatePanel title={t.empty.heading} testId="batch-history-empty-state">
            {t.empty.body}
          </StatePanel>
        )}

        {listState.status === 'loaded' && listState.items.length > 0 && (
          <ListRows testId="batch-history-list">
            {listState.items.map((batch) => {
              const cutoff = formatDateTime(batch.cutoff)
              const preview = formatBatchSubtotalsPreview(batch.subtotals)
              return (
                <Link
                  to="/batches/$id"
                  params={{ id: batch.id }}
                  key={batch.id}
                  data-testid={`batch-history-row-${batch.id}`}
                  aria-label={t.row.openLabel(cutoff, strings.badges.batchStatus[batch.status])}
                  className={`${listRowClassName} flex-wrap`}
                >
                  <span className="flex items-center gap-3">
                    <BatchStatusBadge status={batch.status} />
                    <span className={listRowMetaClassName}>{t.row.cutoffLabel(cutoff)}</span>
                    <span className={listRowMetaClassName}>{t.row.countLabel(batch.requestCount)}</span>
                    <span className={listRowMetaClassName} data-testid={`batch-history-row-${batch.id}-email`}>
                      {emailLabels[batch.emailStatus ?? 'notAttempted']}
                    </span>
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
