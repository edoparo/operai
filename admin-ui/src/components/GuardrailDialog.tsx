/**
 * GuardrailDialog — acknowledge-only dialog for a server-side guardrail that
 * genuinely blocked an action (T15, specs/20260713-auth-roles-permissions,
 * design.md Dialog D2: "Guardrail blocked").
 *
 * Fires for the last-admin-removal guard (AC-6.4) and the system-role-delete
 * race (a stale-UI bypass of the disabled-Delete-button guardrail on Screen
 * A2) — both are cases where the `422` means the action is simply not
 * possible right now, there is no "proceed anyway" override. New shape (no
 * existing "blocked, acknowledge-only" dialog in-repo): a single message +
 * a single "OK" acknowledgement, unlike `ConfirmDeleteModal`/Dialog D1 which
 * always has a destructive action to confirm or cancel.
 *
 * Presentational: all data and callbacks arrive via props. The screen that
 * uses this (later tasks, T18/T20) owns the state — it must NOT reset its
 * in-progress edit when this dialog is dismissed (design.md F4: "the
 * in-progress edit is preserved so the admin can adjust and retry").
 *
 * A11y (design.md "Accessibility — Confirmation / guardrail dialogs"):
 *   • role="alertdialog" aria-modal="true" aria-labelledby + aria-describedby
 *   • Full Tab focus trap (kept on the single "OK" button — there is nothing
 *     else to trap between).
 *   • Escape triggers the safe action — here that IS "OK" (D2 has no unsafe
 *     action to escape *to*).
 *   • Default focus on "OK".
 *   • Backdrop click matches Escape's behavior (also acknowledges).
 *
 * Now @operai/ui's `NoticeDialog` (ADR 20261031-shared-ui-library-consumed-as-source, INC-09), which owns the frame,
 * the single-button focus, Escape/backdrop = acknowledge and focus return;
 * this file binds admin-ui's copy and test ids.
 */

import { NoticeDialog } from '@operai/ui'
import { strings } from '../strings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardrailDialogProps = {
  /** Short dialog title (e.g. "Can't remove the last administrator"). */
  title: string
  /** Explanatory message — why the action was blocked. */
  message: string
  /** Called when the user acknowledges (clicks "OK", presses Escape, or clicks the backdrop). */
  onAcknowledge: () => void
  /** Label for the acknowledge button. Defaults to "OK". */
  acknowledgeLabel?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GuardrailDialog({
  title,
  message,
  onAcknowledge,
  acknowledgeLabel = strings.common.actions.ok,
}: GuardrailDialogProps) {
  return (
    <NoticeDialog
      title={title}
      acknowledgeLabel={acknowledgeLabel}
      onAcknowledge={onAcknowledge}
      testIdPrefix="guardrail-dialog"
      backdropTestId="guardrail-dialog"
    >
      <p>{message}</p>
    </NoticeDialog>
  )
}
