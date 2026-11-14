/**
 * GuardrailDialog — acknowledge-only dialog for a server-side guardrail that
 * genuinely blocked an action (T15, specs/20260716-refund-service/tasks.md,
 * design.md F2 steps 2/6, F6 step 6: "409 on either action … GuardrailDialog";
 * Component inventory: "GuardrailDialog — Reuse (ported pattern) —
 * admin-ui/src/components/GuardrailDialog.tsx — 409-race, genuinely-blocked
 * cases").
 *
 * History: this used to be a re-authored copy of another remote's component
 * (a remote cannot import another remote's source, ADR 20260709-suite-frontend-module-federation). It now renders
 * @operai/ui's `NoticeDialog` (ADR 20261031-shared-ui-library-consumed-as-source) and only binds refund-ui's copy and test ids.
 *
 * Fires for every 409-race case this feature's design names: withdraw after
 * a decision (F2 step 2), a stale-UI submit/edit/delete attempt on an
 * already-decided request (F2 step 3), and an accounting decision race
 * (F6 step 6) — all cases where the response means the action is simply not
 * possible right now; there is no "proceed anyway" override. Unlike
 * `ConfirmDeleteModal`, there is only a single acknowledgement, no
 * confirm/cancel pair.
 *
 * Presentational: all data and callbacks arrive via props. The screen that
 * uses this (T16/T18) owns the state — it must NOT discard in-progress edits
 * when this dialog is dismissed; it should reload the record so the screen
 * reflects the real, current (decided, read-only) state (design.md F2 step 2).
 *
 * Copy sourced from `strings.ts` for the one static default
 * (`acknowledgeLabel`) — `title`/`message` are always caller-supplied,
 * dialog-specific text (different for withdraw-race vs. decision-race), so
 * they arrive as props exactly as the source component already does.
 *
 * A11y:
 *   • role="alertdialog" aria-modal="true" aria-labelledby + aria-describedby
 *   • Full Tab focus trap (kept on the single "OK" button — there is nothing
 *     else to trap between).
 *   • Escape triggers the safe action — here that IS "OK".
 *   • Default focus on "OK".
 *   • Backdrop click matches Escape's behavior (also acknowledges).
  *
 * Now @operai/ui's `NoticeDialog` (ADR 20261031-shared-ui-library-consumed-as-source), which owns the frame, the
 * single-button focus, Escape/backdrop = acknowledge, and focus return.
 */


import { NoticeDialog } from '@operai/ui'
import { strings } from '../strings'

export type GuardrailDialogProps = {
  /** Short dialog title (e.g. "This request was already decided"). */
  title: string
  /** Explanatory message — why the action was blocked. */
  message: string
  /** Called when the user acknowledges (clicks "OK", presses Escape, or clicks the backdrop). */
  onAcknowledge: () => void
  /** Label for the acknowledge button. Defaults to strings.components.guardrailDialog.defaultAcknowledgeLabel. */
  acknowledgeLabel?: string
}

export default function GuardrailDialog({
  title,
  message,
  onAcknowledge,
  acknowledgeLabel = strings.components.guardrailDialog.defaultAcknowledgeLabel,
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
