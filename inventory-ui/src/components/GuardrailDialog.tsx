/**
 * GuardrailDialog — the single-action conflict acknowledgement (T25,
 * specs/015-hardware-inventory; design.md § Component inventory: "Conflict
 * acknowledgement — refund-ui/src/components/GuardrailDialog.tsx"). Every 409
 * in the error catalogue (`invalid_transition`, `assignment_pending`,
 * `asset_disposed`, `already_closed`) lands here, then the page refetches.
 *
 * Re-authored from refund-ui's component with the same props and behaviour
 * (ADR-0006: no cross-remote imports): an `alertdialog` with one action that is
 * focused on open; Escape and the backdrop acknowledge (there is no unsafe
 * action to escape to); Tab is pinned on the single button. Added: closing
 * returns focus to the element that had it before, when it is still in the page
 * (design.md § Accessibility).
 *
 * Now a thin adapter over @operai/ui's `NoticeDialog` (ADR-0050, INC-09/21):
 * same props, copy and data-testids (`guardrail-dialog` backdrop,
 * `guardrail-dialog-ok`).
 */

import { NoticeDialog } from '@operai/ui'
import { strings } from '../strings'

export type GuardrailDialogProps = {
  /** Short dialog title (e.g. "This asset changed"). */
  title: string
  /** Explanatory message — why the action was blocked. */
  message: string
  /** Called when the user acknowledges (clicks "OK", presses Escape, or clicks the backdrop). */
  onAcknowledge: () => void
  /** Label for the acknowledge button. Defaults to strings.common.guardrailDialog.defaultAcknowledgeLabel. */
  acknowledgeLabel?: string
}

export default function GuardrailDialog({
  title,
  message,
  onAcknowledge,
  acknowledgeLabel = strings.common.guardrailDialog.defaultAcknowledgeLabel,
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
