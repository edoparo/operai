/**
 * ConfirmDeleteModal — accessible confirmation dialog for destructive admin
 * actions (delete role / delete department — T15, specs/20260713-auth-roles-permissions,
 * design.md Dialog D1).
 *
 * Ported pattern from `estimai-ui/src/components/ConfirmDeleteModal.tsx`
 * (same props shape, same idle/deleting/error states, same focus-trap and
 * keyboard contract) — admin-ui cannot import across the Module Federation
 * boundary (ADR 20260709-suite-frontend-module-federation), so this is a near-verbatim re-authoring, generalised
 * from "estimate" to any named entity (role/department) via `title` +
 * `itemName` props.
 *
 * Deliberate a11y refinement over the source pattern (design.md
 * "Accessibility — Confirmation / guardrail dialogs"): `role="alertdialog"`
 * instead of `role="dialog"` — per WAI-ARIA authoring practices, alertdialog
 * is correct when a dialog interrupts to demand acknowledgement of something
 * consequential (a destructive delete). Scoped to admin-ui's own copy only —
 * not a retroactive change to estimai-ui's original.
 *
 * Presentational: all data and callbacks arrive via props. The screen that
 * uses this owns the state and the API call (later tasks, T17/T19).
 *
 * **Extended (T10, specs/20260713-user-invitations, design.md Dialog N2):** an
 * optional `body?: ReactNode` prop overrides the default hardcoded copy
 * ("'{itemName}' will be permanently deleted. This cannot be undone.") — a
 * hard-delete framing that is WRONG for this feature's three new call sites
 * (soft-deleting a user, bulk-deleting users, revoking an invitation, all of
 * which need their own accurate copy, not a literal "permanently deleted").
 * Omitting `body` preserves every existing caller's (`RolesPage`,
 * `RoleEditor`, `DepartmentsPage`) exact byte-for-byte copy — this is a
 * backward-compatible extension, not a breaking change. The body container
 * is a `<div>` (not a `<p>`) precisely so a new caller can nest block content
 * (e.g. the bulk-delete confirmation's scrollable `<ul>` of selected emails)
 * without invalid `<ul>`-inside-`<p>` nesting; `aria-describedby` still
 * targets it by the same `confirm-delete-body` id regardless of tag.
 *
 * A11y:
 *   • role="alertdialog" aria-modal="true" aria-labelledby + aria-describedby
 *   • Focus trap: Tab cycles only between Cancel and Delete while open.
 *   • Default focus: "Cancel" (safe default — avoids accidental destruction).
 *   • Escape = Cancel; no delete is triggered.
 *
 * States:
 *   • idle      — title + body + Cancel + Delete buttons
 *   • deleting  — "Deleting…" + spinner, both buttons disabled
 *   • error     — inline error text between body and footer; both buttons re-enabled
 *
 * Now a thin adapter over @operai/ui's `ConfirmDialog` (ADR 20261031-shared-ui-library-consumed-as-source, INC-09),
 * which owns the frame, the focus trap (every enabled control, × included),
 * Escape/backdrop = Cancel (never while deleting), focus return and the look;
 * this file keeps admin-ui's props, copy and test ids so no call site changed.
 */

import type { ReactNode } from 'react'
import { ConfirmDialog } from '@operai/ui'
import { strings } from '../strings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfirmDeleteModalProps = {
  /** The dialog title, from the caller's strings (e.g. `strings.roles.deleteTitle`). */
  title: string
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
  /**
   * Overrides the default body copy (design.md Dialog N2, T10 specs/20260713-user-invitations).
   * Omit to keep the original hard-delete wording verbatim (every T15/T17/T19
   * caller does this today — backward-compatible default).
   */
  body?: ReactNode
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ConfirmDeleteModal({
  title,
  itemName,
  isDeleting,
  errorMessage,
  onConfirm,
  onCancel,
  body,
}: ConfirmDeleteModalProps) {
  const displayName = itemName || strings.common.confirmDelete.untitled

  return (
    <ConfirmDialog
      title={title}
      confirmLabel={strings.common.actions.delete}
      busyLabel={strings.common.actions.deleting}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={isDeleting}
      error={errorMessage}
      onConfirm={onConfirm}
      onCancel={onCancel}
      testIdPrefix="confirm-delete"
      backdropTestId="confirm-delete-modal"
    >
      {body ?? <p>{strings.common.confirmDelete.body(displayName)}</p>}
    </ConfirmDialog>
  )
}
