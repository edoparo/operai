/**
 * ReceiptCodesCard — the receipt code of each employee
 * (specs/20261124-receipt-numbers-from-the-register, design S2, S3b, S4, S5, F1 to F5, RC-3, RC-8 to RC-10, plan
 * DS-2 to DS-4 and DS-8; AC-4.1, AC-4.3, AC-4.6, AC-4.7, AC-4.8, AC-4.9, AC-4.11).
 *
 * One row per employee the API lists, in its order (RC-10: no search, paging or client sort). Columns: Employee (the
 * row header: name, else email, with the email under a name), Code, Prefix in use, Last number, Last changed (DS-2),
 * Status and the actions. The prefix, the initials and `sharesPrefix` come from the API; nothing here derives them.
 *
 *   - **Set code** / **Change** open `ReceiptCodeDialog`. **Clear** (only when a code is set) is a row action with its
 *     own `ConfirmDialog` (DS-3). **History** opens the `ChangeHistoryDrawer`, fetched when it opens (DS-4).
 *   - "Shares prefix" (DS-8) is a badge with a glyph and text on EVERY row whose `sharesPrefix` is true, with or without
 *     a code, plus one static note with the count of those rows. No other employee is named anywhere. The row's
 *     Set code / Change button is described by the hint, so a keyboard user hears why.
 *   - A save or clear replaces the row with the 200 body and says what happened (S5). The other rows' flags are the
 *     server's as of the last load: they follow on the next load, nothing is derived here.
 *   - 403 is `PermissionDenied` in place of the card (RC-3): the card can be the whole page, and blank is the worst
 *     state. Loading is one polite line; an error has Retry; no employee is an empty state.
 *
 * Focus: after Set/Change and after a cancelled Clear it goes back to the button that opened the dialog (it persists);
 * after a Clear, whose button is gone, to the row header (`focusRowKey`); after the drawer, to History. The dialogs and
 * the drawer are mounted BESIDE the card (ADR 20261118 dialog-beside-form).
 */

import { useId, useRef, useState } from 'react'
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  SkeletonRows,
  StatePanel,
  StatusBadge,
  VisuallyHidden,
  formatDate,
} from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { strings } from '../../strings'
import { getCodeHistory, listReceiptCodes, putCode, receiptCodeErrorCode } from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee, ReceiptCodeHistoryEntry } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
import { useLoadedResource } from '../../lib/useLoadedResource'
import ChangeHistoryDrawer from '../ChangeHistoryDrawer'
import ErrorBanner from '../ErrorBanner'
import PermissionDenied from '../PermissionDenied'
import SuccessBanner from '../SuccessBanner'
import ReceiptCodeDialog from './ReceiptCodeDialog'

const t = strings.settings.receiptCodes
const tc = strings.settings.catalog
const th = strings.settings.history

const displayName = (employee: ReceiptCodeEmployee): string => employee.name ?? employee.email

/** One row of the history as the drawer takes it. */
type HistoryRow = { at: string; byEmail: string; before: string | null; after: string | null }

/**
 * The history of one employee, fetched when the drawer mounts (DS-4): a fresh state per employee, so another
 * employee's rows never show first. The API is newest first and the drawer takes oldest first (and reverses again).
 * A retry keeps the error banner, and with it the focus on Retry, until the answer is in.
 */
function ReceiptCodeHistory({ employee, onClose }: { employee: ReceiptCodeEmployee; onClose: () => void }) {
  const resource = useLoadedResource(() => getCodeHistory(employee.userId))
  const [retrying, setRetrying] = useState(false)

  const rows: HistoryRow[] =
    resource.status === 'loaded'
      ? [...resource.data].reverse().map((entry: ReceiptCodeHistoryEntry) => ({
          at: entry.changedAt,
          byEmail: entry.changedBy.email,
          before: entry.codeBefore,
          after: entry.codeAfter,
        }))
      : []
  const failed = resource.status === 'error' || resource.status === 'forbidden'

  return (
    <ChangeHistoryDrawer<HistoryRow>
      subject={displayName(employee)}
      rows={rows}
      valueColumns={[
        { id: 'before', header: th.columns.before, render: (row) => row.before ?? t.none },
        { id: 'after', header: th.columns.after, render: (row) => row.after ?? t.none },
      ]}
      loading={resource.status === 'loading'}
      error={
        failed || (retrying && resource.status === 'loading')
          ? {
              message: resource.status === 'forbidden' ? tc.forbidden : th.loadError,
              onRetry: () => {
                setRetrying(true)
                resource.reload()
              },
            }
          : undefined
      }
      onClose={onClose}
    />
  )
}

export default function ReceiptCodesCard() {
  const resource = useLoadedResource(listReceiptCodes)
  const [editing, setEditing] = useState<string | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  const [history, setHistory] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [focusRowKey, setFocusRowKey] = useState<string | null>(null)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  // The button that opened the dialog or the drawer: focus goes back to it.
  const lastOpenerRef = useRef<HTMLButtonElement | null>(null)
  // A 404 said the list is stale: it is reloaded when the dialog that saw it is closed.
  const staleRef = useRef(false)
  const hintIdPrefix = useId()

  const rows = resource.status === 'loaded' ? resource.data : null
  const rowOf = (userId: string | null) =>
    userId === null ? null : (rows?.find((row) => row.userId === userId) ?? null)

  const open = (button: HTMLButtonElement) => {
    lastOpenerRef.current = button
    setFocusRowKey(null)
  }

  const finishDialog = () => {
    if (staleRef.current) {
      staleRef.current = false
      resource.reload()
    }
    lastOpenerRef.current?.focus()
  }

  const replaceRow = (saved: ReceiptCodeEmployee) =>
    resource.replace((current) => current.map((row) => (row.userId === saved.userId ? saved : row)))

  const closeEditing = () => {
    setEditing(null)
    finishDialog()
  }

  const handleSaved = (saved: ReceiptCodeEmployee) => {
    const before = rowOf(saved.userId)
    replaceRow(saved)
    setSuccess(
      before !== null && before.code === saved.code && saved.code !== null
        ? t.unchanged(displayName(saved))
        : t.saved(displayName(saved), saved.code ?? saved.prefix),
    )
    closeEditing()
  }

  const closeClearing = () => {
    setClearing(null)
    setClearError(null)
    finishDialog()
  }

  const handleClear = async (employee: ReceiptCodeEmployee) => {
    setClearError(null)
    setClearBusy(true)
    let saved: ReceiptCodeEmployee
    try {
      saved = await putCode(employee.userId, null)
    } catch (error) {
      setClearBusy(false)
      const kind = receiptCodeErrorCode(error)
      if (kind === 'employee_not_found') {
        staleRef.current = true
        setClearError(t.errors.notFound)
      } else if (kind === 'forbidden' || (error instanceof ApiError && error.status === 403)) {
        setClearError(tc.forbidden)
      } else {
        setClearError(tc.genericError)
      }
      return
    }
    setClearBusy(false)
    replaceRow(saved)
    setSuccess(t.cleared(displayName(saved), saved.initials))
    setClearing(null)
    // The Clear button no longer exists: focus goes to the row header.
    setFocusRowKey(saved.userId)
  }

  const closeHistory = () => {
    setHistory(null)
    lastOpenerRef.current?.focus()
  }

  // 403: the card is left out for a message in its place, never null (RC-3). After every hook.
  if (resource.status === 'forbidden') return <PermissionDenied headingLevel={3} />

  const shared = rows === null ? 0 : rows.filter((row) => row.sharesPrefix).length
  const hintId = (row: ReceiptCodeEmployee) => `${hintIdPrefix}-hint-${row.userId}`

  const columns: DataTableColumn<ReceiptCodeEmployee>[] = [
    {
      id: 'employee',
      header: t.columns.employee,
      rowHeader: true,
      render: (row) => (
        <span className="flex flex-col">
          <span>{displayName(row)}</span>
          {row.name !== null && <span className="text-xs text-soft">{row.email}</span>}
        </span>
      ),
    },
    {
      id: 'code',
      header: t.columns.code,
      render: (row) =>
        row.code === null ? <span className="text-soft">{t.none}</span> : <span className="font-mono">{row.code}</span>,
    },
    {
      id: 'prefix',
      header: t.columns.prefix,
      render: (row) => (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <span className="font-mono">{row.prefix}</span>
          {row.prefixSource === 'initials' && <span className="text-xs text-soft">{t.fromInitials}</span>}
        </span>
      ),
    },
    {
      id: 'lastNumber',
      header: t.columns.lastNumber,
      render: (row) =>
        row.lastNumber === null ? (
          <span className="text-soft">{t.noNumberYet}</span>
        ) : (
          <span className="font-mono whitespace-nowrap">{row.lastNumber}</span>
        ),
    },
    {
      id: 'changed',
      header: t.columns.changed,
      render: (row) =>
        row.changedAt === null ? (
          <span className="text-soft">{t.notSet}</span>
        ) : (
          t.changedBy(row.changedByEmail ?? '', formatDate(row.changedAt))
        ),
    },
    {
      id: 'status',
      header: t.columns.status,
      render: (row) =>
        row.sharesPrefix ? (
          <>
            <StatusBadge status="attention">{t.sharesPrefix}</StatusBadge>
            <VisuallyHidden>
              <span id={hintId(row)}>{t.sharesPrefixHint}</span>
            </VisuallyHidden>
          </>
        ) : null,
    },
    {
      id: 'actions',
      header: t.columns.actions,
      render: (row) => {
        const name = displayName(row)
        const hasCode = row.code !== null
        return (
          <span className="inline-flex flex-wrap gap-2">
            <Button
              size="sm"
              aria-haspopup="dialog"
              aria-label={hasCode ? t.changeLabel(name) : t.setLabel(name)}
              aria-describedby={row.sharesPrefix ? hintId(row) : undefined}
              onClick={(event) => {
                open(event.currentTarget)
                setEditing(row.userId)
              }}
              data-testid={`receipt-code-edit-${row.userId}`}
            >
              {hasCode ? t.change : t.set}
            </Button>
            {hasCode && (
              <Button
                size="sm"
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={t.clearLabel(name)}
                onClick={(event) => {
                  open(event.currentTarget)
                  setClearing(row.userId)
                }}
                data-testid={`receipt-code-clear-${row.userId}`}
              >
                {t.clear}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-haspopup="dialog"
              aria-label={t.historyLabel(name)}
              onClick={(event) => {
                open(event.currentTarget)
                setHistory(row.userId)
              }}
              data-testid={`receipt-code-history-${row.userId}`}
            >
              {th.open}
            </Button>
          </span>
        )
      },
    },
  ]

  const editingRow = rowOf(editing)
  const clearingRow = rowOf(clearing)
  const historyRow = rowOf(history)

  return (
    <>
      <Card title={t.title} data-testid="receipt-codes-card">
        <p className="text-sm text-soft mb-4">{t.description}</p>

        {resource.status === 'loading' && (
          <>
            <VisuallyHidden live>{t.loading}</VisuallyHidden>
            <SkeletonRows rows={5} testId="skeleton-list-rows" />
          </>
        )}

        {resource.status === 'error' && <ErrorBanner message={t.loadError} onRetry={resource.reload} />}

        {rows && (
          <div className="flex flex-col gap-4">
            <SuccessBanner message={success} onDismiss={() => setSuccess(null)} testId="receipt-codes-success" />

            {shared > 0 && (
              <Banner tone="warning" live="off" aria-label={t.shareNoteLabel} data-testid="receipt-codes-share-note">
                {t.shareNote(shared)}
              </Banner>
            )}

            {rows.length === 0 ? (
              <StatePanel title={t.empty.title} headingLevel={4} testId="receipt-codes-empty">
                {t.empty.body}
              </StatePanel>
            ) : (
              <DataTable
                caption={t.caption}
                columns={columns}
                rows={rows}
                getRowKey={(row) => row.userId}
                focusRowKey={focusRowKey}
                testId="receipt-codes-table"
                rowTestIdPrefix="receipt-code-row"
              />
            )}
          </div>
        )}
      </Card>

      {editingRow && (
        <ReceiptCodeDialog
          employee={editingRow}
          onCancel={closeEditing}
          onSaved={handleSaved}
          onNotFound={() => {
            staleRef.current = true
          }}
        />
      )}

      {clearingRow && (
        <ConfirmDialog
          tone="primary"
          title={t.clearDialog.title(displayName(clearingRow))}
          confirmLabel={t.clearDialog.confirm}
          busyLabel={t.clearDialog.busy}
          cancelLabel={tc.cancel}
          closeLabel={tc.cancel}
          busy={clearBusy}
          error={clearError}
          onConfirm={() => void handleClear(clearingRow)}
          onCancel={closeClearing}
          testIdPrefix="receipt-code-clear"
        >
          {t.clearDialog.body(clearingRow.initials)}
        </ConfirmDialog>
      )}

      {historyRow && <ReceiptCodeHistory key={historyRow.userId} employee={historyRow} onClose={closeHistory} />}
    </>
  )
}
