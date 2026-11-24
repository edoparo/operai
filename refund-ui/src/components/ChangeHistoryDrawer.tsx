/**
 * ChangeHistoryDrawer — the change history of one thing, newest first
 * (specs/20261118-refund-accounting-export, design S6e, component #42). One component for three uses: the default
 * classification of an expense type, the foreign-currency VAT code, and one exchange rate.
 *
 * The caller passes the rows in the order the API sends them (oldest first, AC-2.1) plus the columns that
 * are specific to its subject; the drawer owns the "When" and "By" columns, the reversal and the empty
 * state. It is a `Drawer`: focus moves to the heading on open and back to the opener on close, Tab is
 * trapped, Escape and × close it. Mount to open, unmount to close.
 *
 * It reads: it holds no form and never writes.
 *
 * specs/20261124-receipt-numbers-from-the-register (T18, plan DS-4, design S4): two optional props for a history that
 * is fetched when the drawer opens (the receipt-code history), rather than embedded in a list.
 *   - `loading`: `SkeletonRows` and one polite line.
 *   - `error`: an `ErrorBanner` with Retry inside the drawer. It wins over `loading`: a caller that retries sets
 *     `loading` and keeps `error` until the answer is in, so the Retry button is not removed from under the user's
 *     focus; the polite line is then said without the skeleton.
 * With neither prop the drawer is exactly what it was.
 */

import { DataTable, Drawer, SkeletonRows, VisuallyHidden, formatDateTime } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { strings } from '../strings'
import ErrorBanner from './ErrorBanner'

export type HistoryRow = { at: string; byEmail: string }

export type ChangeHistoryDrawerProps<R extends HistoryRow> = {
  /** What the history is of, already in words: "Travel — train", "the foreign-currency VAT code". */
  subject: string
  /** Oldest first, as the API returns them. */
  rows: readonly R[]
  /** The columns that say what changed, shown after "When" and "By" (an account and a VAT code; a rate and its origin). */
  valueColumns: readonly DataTableColumn<R>[]
  onClose: () => void
  /** The rows are being fetched (DS-4). */
  loading?: boolean
  /** The fetch failed (DS-4): the message and the Retry that starts it again. */
  error?: { message: string; onRetry: () => void }
}

export default function ChangeHistoryDrawer<R extends HistoryRow>({
  subject,
  rows,
  valueColumns,
  onClose,
  loading = false,
  error,
}: ChangeHistoryDrawerProps<R>) {
  const t = strings.settings.history
  const newestFirst = rows.map((row, index) => ({ row, index })).reverse()

  const columns: DataTableColumn<{ row: R; index: number }>[] = [
    {
      id: 'when',
      header: t.columns.when,
      rowHeader: true,
      render: ({ row }) => <time dateTime={row.at}>{formatDateTime(row.at)}</time>,
    },
    { id: 'by', header: t.columns.by, render: ({ row }) => row.byEmail },
    ...valueColumns.map((column) => ({
      ...column,
      render: ({ row }: { row: R; index: number }) => column.render(row),
    })),
  ]

  return (
    <Drawer
      title={t.title(subject)}
      description={t.description}
      onClose={onClose}
      closeLabel={t.closeLabel}
      testIdPrefix="refund-history-drawer"
    >
      {loading && <VisuallyHidden live>{t.loading}</VisuallyHidden>}
      {error ? (
        <ErrorBanner message={error.message} onRetry={error.onRetry} />
      ) : loading ? (
        <SkeletonRows rows={4} testId="refund-history-loading" />
      ) : newestFirst.length === 0 ? (
        <p className="text-sm text-soft" data-testid="refund-history-empty">
          {t.empty}
        </p>
      ) : (
        <DataTable
          caption={t.title(subject)}
          columns={columns}
          rows={newestFirst}
          getRowKey={({ index }) => String(index)}
          testId="refund-history-table"
        />
      )}
    </Drawer>
  )
}
