/**
 * ConfirmDialog — the generic confirm `alertdialog` (T25, specs/015-hardware-
 * inventory; design.md § Component inventory: "Confirm dialogs (return, lost,
 * cancel assignment, decline) — refund-ui/src/components/ConfirmDeleteModal.tsx
 * (generic title/body/tone props)").
 *
 * Re-authored from refund-ui's ConfirmDeleteModal with the same props and
 * behaviour (ADR-0006: no cross-remote imports): Cancel is the default focus,
 * Escape / backdrop / × cancel, Tab is trapped between the two buttons, an
 * in-flight state disables both and shows a spinner, an inline `role="alert"`
 * error sits above the footer. The default copy is the hard-delete wording;
 * every inventory use overrides `title`, `body`, `confirmLabel` and
 * `confirmingLabel` (`isDeleting` simply means "the request is in flight").
 *
 * Added for design.md § Accessibility ("every dialog"):
 *   - in flight the dialog is not dismissible — Escape and the backdrop are
 *     no-ops, and the confirm button is `aria-busy`;
 *   - closing returns focus to the element that had it when the dialog opened,
 *     if it is still in the page (else the page moves focus to its heading).
 *
 * Now a thin adapter over @operai/ui's `ConfirmDialog` (ADR-0050, INC-09/21),
 * which was extracted from this component: same props, copy and data-testids
 * (the backdrop keeps `${testIdPrefix}-modal`). The library traps Tab over
 * every enabled control, the header × included.
 */

import type { ReactNode } from 'react'
import { ConfirmDialog as LibraryConfirmDialog } from '@operai/ui'
import { strings } from '../strings'

export type ConfirmDialogTone = 'destructive' | 'positive'

export type ConfirmDialogProps = {
  /** Noun describing the kind of entity being acted on (e.g. "assignment"). */
  entityLabel: string
  /** Name of the entity — shown in the default body copy (ignored when `body` is supplied). */
  itemName: string
  /** Whether the request is currently in flight. */
  isDeleting: boolean
  /** Inline error message shown if the request failed; null = no error. */
  errorMessage: string | null
  /** Called when the user confirms. */
  onConfirm: () => void
  /** Called when the user cancels (clicks "Cancel", "×", the backdrop, or presses Escape). */
  onCancel: () => void
  /** Overrides the default body copy. */
  body?: ReactNode
  /** Confirm-button variant: `'destructive'` -> `danger` (default), `'positive'` -> `primary`. */
  tone?: ConfirmDialogTone
  /** Overrides the default `title(entityLabel)` heading. */
  title?: ReactNode
  /** Overrides the default "Delete" confirm-button label. */
  confirmLabel?: string
  /** Overrides the default "Deleting…" in-flight label. */
  confirmingLabel?: string
  /** Namespaces every `data-testid` this dialog renders. Defaults to `'confirm-delete'`. */
  testIdPrefix?: string
}

export default function ConfirmDialog({
  entityLabel,
  itemName,
  isDeleting,
  errorMessage,
  onConfirm,
  onCancel,
  body,
  tone = 'destructive',
  title,
  confirmLabel,
  confirmingLabel,
  testIdPrefix = 'confirm-delete',
}: ConfirmDialogProps) {
  const t = strings.common.confirmDialog

  return (
    <LibraryConfirmDialog
      title={title ?? t.title(entityLabel)}
      tone={tone === 'positive' ? 'primary' : 'danger'}
      confirmLabel={confirmLabel ?? t.deleteLabel}
      busyLabel={confirmingLabel ?? t.deletingLabel}
      cancelLabel={t.cancelLabel}
      closeLabel={t.cancelAriaLabel}
      busy={isDeleting}
      error={errorMessage}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testIdPrefix={testIdPrefix}
      backdropTestId={`${testIdPrefix}-modal`}
    >
      {body ?? <p>{t.defaultBody(itemName || t.untitledFallback)}</p>}
    </LibraryConfirmDialog>
  )
}
