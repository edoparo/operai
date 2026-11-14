/**
 * MarkPaidDialog — the irreversible, money-moving confirm for marking a
 * compiled batch as paid (T12, specs/20260719-refund-monthly-processing/tasks.md,
 * design.md F4 step 2, Component inventory, Accessibility).
 *
 * Shows the batch's request count + per-currency totals (`BatchSubtotalsPanel`)
 * so the user isn't confirming blind, the current email delivery status as an
 * FYI line (AC-4.2), explicit consequence copy, and the required
 * acknowledgement gating Confirm.
 *
 * A thin adapter over @operai/ui's `ConfirmDialog` with `acknowledgeLabel`
 * (decisions D-59), which inventory's IrreversibleActionDialog shares: an
 * alertdialog described by the whole body, Cancel focused on open (a stray
 * Space must not tick the checkbox), Confirm disabled until the acknowledgement
 * — whose label is the full sentence — is ticked, nothing dismissible in
 * flight. Confirm is `primary`: marking paid is the dialog's one positive
 * action, not a destructive one.
 */

import { ConfirmDialog } from '@operai/ui'
import { strings } from '../strings'
import type { BatchEmailStatus, BatchSubtotal } from '../lib/batchesApi'
import BatchSubtotalsPanel from './BatchSubtotalsPanel'

export type MarkPaidDialogProps = {
  requestCount: number
  subtotals: readonly BatchSubtotal[]
  emailStatus: BatchEmailStatus
  isConfirming: boolean
  errorMessage: string | null
  onConfirm: () => void
  onCancel: () => void
}

export default function MarkPaidDialog({
  requestCount,
  subtotals,
  emailStatus,
  isConfirming,
  errorMessage,
  onConfirm,
  onCancel,
}: MarkPaidDialogProps) {
  const t = strings.components.markPaidDialog
  const emailLabels = strings.pages.batchDetail.email
  const emailLabel = emailLabels[emailStatus ?? 'notAttempted']

  return (
    <ConfirmDialog
      tone="primary"
      title={t.title}
      acknowledgeLabel={t.acknowledgeLabel}
      confirmLabel={t.confirmLabel}
      busyLabel={t.confirmingLabel}
      cancelLabel={t.cancelLabel}
      closeLabel={t.cancelAriaLabel}
      busy={isConfirming}
      error={errorMessage}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testIdPrefix="mark-paid-dialog"
      backdropTestId="mark-paid-dialog-modal"
    >
      <div className="flex flex-col gap-3">
        <p>{t.requestCountLabel(requestCount)}</p>
        <BatchSubtotalsPanel subtotals={subtotals} />
        <p className="text-xs text-soft" data-testid="mark-paid-dialog-email-fyi">
          {emailLabel}
          {emailStatus === 'failed' ? ` — ${t.emailFailedFyi}` : ''}
        </p>
        <p>{t.consequence(requestCount)}</p>
      </div>
    </ConfirmDialog>
  )
}
