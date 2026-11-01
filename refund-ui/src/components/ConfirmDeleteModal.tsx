/**
 * ConfirmDeleteModal — accessible confirmation dialog for a destructive
 * refund-ui action ("Delete request" — T15, specs/007-refund-service/tasks.md,
 * design.md F1 step 7: "'Delete request' → ConfirmDeleteModal (ported, own
 * copy) … used as-is"; Component inventory: "ConfirmDeleteModal — Reuse
 * (ported pattern) — admin-ui/src/components/ConfirmDeleteModal.tsx").
 *
 Now a thin adapter over @operai/ui's `ConfirmDialog` (ADR-0050), which
 * owns the frame, the focus trap, the keyboard contract and the look; this
 * file keeps refund-ui's props, copy and test ids so no call site changed.
 * It replaced a re-authoring of `admin-ui/src/components/ConfirmDeleteModal.tsx`
 * (a remote cannot import another remote's source, ADR-0006 — the reason the
 * shared library exists). Generalised to any named entity (here: a draft
 * refund request) via `entityLabel` + `itemName`. Used as-is by T16's "Delete request" flow —
 * design.md does not ask for an extended variant here (unlike `ApproveDialog`,
 * T18's ported+extended sibling).
 *
 * Presentational: all data and callbacks arrive via props. The screen that
 * uses this (T16) owns the state and the `DELETE /requests/:id` call.
 *
 * Copy sourced from `strings.ts` (T14/T15 convention: no hardcoded UI
 * strings) — `title`/`defaultBody` are functions because their exact wording
 * depends on the caller-supplied `entityLabel`/`itemName` (see strings.ts's
 * own doc comment on why these are functions, not template literals inlined
 * here).
 *
 * A11y:
 *   • role="alertdialog" aria-modal="true" aria-labelledby + aria-describedby
 *   • Focus trap over the dialog's buttons (×, Cancel, confirm).
 *   • Default focus: "Cancel" (safe default — avoids accidental destruction).
 *   • Escape / backdrop = Cancel, except while deleting; focus returns to the trigger.
 *
 * States:
 *   • idle      — title + body + Cancel + Delete buttons
 *   • deleting  — "Deleting…" + spinner, both buttons disabled, not dismissible
 *   • error     — inline error text between body and footer; both buttons re-enabled
 *
 * T18 extension (specs/007-refund-service/tasks.md, design.md Component
 * inventory: "ApproveDialog — Reuse (ported, extended) — ConfirmDeleteModal's
 * shell, ported + a new non-destructive tone='positive' variant … the same
 * kind of backward-compatible prop extension specs/006 already applied to
 * this component's body prop"): `tone` (`positive` = the
 * library's `primary` confirm button, `destructive` = `danger`)/`title`/`confirmLabel`/
 * `confirmingLabel`/`testIdPrefix` are all optional, defaulting to this
 * component's original hard-delete behavior verbatim — every existing call
 * site (and every test above) is untouched. `ApproveDialog.tsx` is a thin
 * wrapper supplying `tone="positive"` + refund-specific copy + its own
 * `testIdPrefix` so an "Approve" flow's tests never read "confirm-delete-*".
 */

import type { ReactNode } from 'react'
import { ConfirmDialog } from '@operai/ui'
import { strings } from '../strings'

export type ConfirmDeleteModalTone = 'destructive' | 'positive'

export type ConfirmDeleteModalProps = {
  /** Noun describing the kind of entity being deleted (e.g. "request"). */
  entityLabel: string
  /** Name of the entity being deleted — shown in the default body copy (ignored when `body` is supplied). */
  itemName: string
  /** Whether the DELETE request is currently in-flight. */
  isDeleting: boolean
  /** Inline error message shown if the DELETE request failed; null = no error. */
  errorMessage: string | null
  /** Called when the user confirms deletion (clicks "Delete"). */
  onConfirm: () => void
  /** Called when the user cancels (clicks "Cancel", "×", the backdrop, or presses Escape). */
  onCancel: () => void
  /** Overrides the default body copy. Omit to keep the default hard-delete wording. */
  body?: ReactNode
  /** `positive` for a non-destructive confirmation like Approve (primary button); defaults to `destructive` (danger button). */
  tone?: ConfirmDeleteModalTone
  /** Overrides the default `t.title(entityLabel)` heading. */
  title?: ReactNode
  /** Overrides the default "Delete" confirm-button label. */
  confirmLabel?: string
  /** Overrides the default "Deleting…" in-flight label. */
  confirmingLabel?: string
  /** Namespaces every `data-testid` this dialog renders (`-modal`, `-cancel`, `-confirm`, `-error`). Defaults to `'confirm-delete'`. */
  testIdPrefix?: string
}

export default function ConfirmDeleteModal({
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
}: ConfirmDeleteModalProps) {
  const t = strings.components.confirmDeleteModal

  return (
    <ConfirmDialog
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
    </ConfirmDialog>
  )
}
