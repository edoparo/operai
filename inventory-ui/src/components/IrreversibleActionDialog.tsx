/**
 * IrreversibleActionDialog — the acknowledged confirm for acts that cannot be
 * undone (T26, specs/015-hardware-inventory). Dispose, close fiscal year and
 * new depreciation rule render through it.
 *
 * Presentational: the page owns the request, `isConfirming` and the error, and
 * keeps the dialog mounted on a failure so a form slot's values survive.
 *
 * A thin adapter over @operai/ui's `ConfirmDialog` with `acknowledgeLabel` and
 * `fields` (decisions D-59): the library owns the alertdialog semantics, the
 * focus rules (Cancel for a pure confirm, the first field with a form slot),
 * Confirm disabled until the acknowledgement is ticked, and the lock in flight.
 * This keeps the inventory copy and the `irreversible-dialog` test ids.
 */

import type { ReactNode } from 'react'
import { ConfirmDialog } from '@operai/ui'
import { strings } from '../strings'

export type IrreversibleActionDialogProps = {
  /** The dialog's accessible name and heading, e.g. "Close fiscal year 2025?". */
  title: string
  /** What happens and that it cannot be undone; the dialog's description. */
  consequence: ReactNode
  /** The acknowledgement sentence, used whole as the checkbox label. */
  acknowledgeLabel: string
  confirmLabel: string
  /** Confirm button label in flight, e.g. "Closing…". */
  confirmingLabel: string
  /** Whether the request is currently in flight. */
  isConfirming: boolean
  /** Inline error from the last attempt (503, conflict, network); null = none. */
  errorMessage: string | null
  onConfirm: () => void
  /** Called on Cancel, ×, the backdrop and Escape — never while `isConfirming`. */
  onCancel: () => void
  /** Form slot: fields the act needs (e.g. disposal date and reason), disabled in flight. */
  children?: ReactNode
  /** Namespaces the `data-testid`s. Defaults to `'irreversible-dialog'`. */
  testIdPrefix?: string
}

export default function IrreversibleActionDialog({
  title,
  consequence,
  acknowledgeLabel,
  confirmLabel,
  confirmingLabel,
  isConfirming,
  errorMessage,
  onConfirm,
  onCancel,
  children,
  testIdPrefix = 'irreversible-dialog',
}: IrreversibleActionDialogProps) {
  const t = strings.common.formModal

  return (
    <ConfirmDialog
      title={title}
      acknowledgeLabel={acknowledgeLabel}
      fields={children}
      confirmLabel={confirmLabel}
      busyLabel={confirmingLabel}
      cancelLabel={t.cancelLabel}
      closeLabel={t.closeAriaLabel}
      busy={isConfirming}
      error={errorMessage}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testIdPrefix={testIdPrefix}
    >
      {consequence}
    </ConfirmDialog>
  )
}
