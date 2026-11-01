/**
 * ConfirmDeleteModal — accessible confirmation dialog for destructive estimate
 * deletion (US-3, AC-3.1, AC-3.2, specs/001-estimate-persistence).
 *
 * Presentational: all data and callbacks arrive via props. EstimatesPage owns
 * the state and the API call.
 *
 * Generalized (T19, specs/013-estimate-sharing, AC-5.2/AC-6.1) — `title` /
 * `bodyText` / `confirmLabel` are optional overrides so this same dialog also
 * backs the Remove-collaborator and Leave-estimate confirmations (design.md's
 * component inventory). All three default to the delete-estimate copy.
 *
 * Now a thin adapter over @operai/ui's `ConfirmDialog` (ADR-0050, INC-09):
 * `role="alertdialog"`, focus on Cancel on open, Tab trapped over every
 * enabled control (the header × included), Escape/backdrop/× cancel except
 * while in flight, focus returned to the trigger on close. Cancel is `ghost`,
 * the confirm button `danger`. Every `data-testid` the e2e suite and unit
 * tests target (`confirm-delete-modal`, `-cancel`, `-confirm`, `-error`) is
 * kept through `testIdPrefix` + `backdropTestId`.
 */

import { ConfirmDialog } from '@operai/ui'
import { strings } from '../strings'

export type ConfirmDeleteModalProps = {
  /** Name of the estimate being deleted — shown in the default body copy. */
  estimateName: string
  /** Whether the confirm action is currently in-flight. */
  isDeleting: boolean
  /** Inline error message shown if the action failed; null = no error. */
  errorMessage: string | null
  /** Called when the user confirms (clicks the confirm button). */
  onConfirm: () => void
  /** Called when the user cancels (clicks "Cancel", "×", the backdrop, or presses Escape). */
  onCancel: () => void
  /** Dialog heading. Defaults to "Delete estimate?" */
  title?: string
  /**
   * Body copy. Defaults to the delete-estimate copy built from `estimateName`
   * ("'{name}' will be permanently deleted. This cannot be undone."). Pass a
   * fully-composed string (e.g. "{email} will lose access …") for other flows.
   */
  bodyText?: string
  /** Confirm-button label shown in the idle state. Defaults to "Delete". */
  confirmLabel?: string
  /** Confirm-button label while in flight. Defaults to "Deleting…". */
  busyLabel?: string
}

export default function ConfirmDeleteModal({
  estimateName,
  isDeleting,
  errorMessage,
  onConfirm,
  onCancel,
  title,
  bodyText,
  confirmLabel,
  busyLabel,
}: ConfirmDeleteModalProps) {
  const t = strings.confirmDelete
  const body = bodyText ?? t.body(estimateName || t.untitled)

  return (
    <ConfirmDialog
      title={title ?? t.title}
      tone="danger"
      confirmLabel={confirmLabel ?? t.confirm}
      busyLabel={busyLabel ?? t.busy}
      cancelLabel={t.cancel}
      closeLabel={t.close}
      busy={isDeleting}
      error={errorMessage}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testIdPrefix="confirm-delete"
      backdropTestId="confirm-delete-modal"
    >
      <p>{body}</p>
    </ConfirmDialog>
  )
}
