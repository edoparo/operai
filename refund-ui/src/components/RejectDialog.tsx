/**
 * RejectDialog — destructive-outcome confirm dialog with an embedded,
 * REQUIRED motivation textarea (T18, specs/007-refund-service/tasks.md;
 * design.md F6 step 5, Component inventory: "RejectDialog — NEW — No
 * in-repo dialog combines a destructive confirm with an embedded
 * required-field form … ConfirmDeleteModal's shell (backdrop/trap/Escape/
 * focus) + InviteUserModal's disabled-until-valid submit, composed").
 *
 * Genuinely NEW (not a `ConfirmDeleteModal` extension like `ApproveDialog`)
 * because the tab sequence has THREE stops (textarea, Cancel, Confirm), not
 * two — `ConfirmDeleteModal`'s trap is hardcoded to exactly two buttons.
 *
 * The Confirm button stays disabled until the textarea is non-empty
 * (client-side; the server's 422 on an empty motivation is defense-in-depth,
 * AC-7.3) — a screen-reader/keyboard user tabbing to a disabled control gets
 * an immediately legible reason via the dialog's own instructional text
 * (design.md Accessibility).
 *
 * Built from @operai/ui (ADR-0050): the `Dialog` frame (as an
 * `alertdialog` — rejecting is a decision, not a form), a `Field` for the
 * motivation and library `Button`s. The library owns the focus trap (every
 * enabled control, × included), Escape/backdrop = Cancel (never while
 * deciding) and focus return; this file owns the copy and the motivation.
 *
 * A11y: role="alertdialog", aria-modal, labelled by the title, described by
 * the body; default focus lands on the
 * textarea — the user's very next action is always "type the reason", so
 * there is no safety reason to default elsewhere the way `ConfirmDeleteModal`
 * defaults to Cancel for an instantly-destructive action.
 */

import { useRef, useState } from 'react'
import { Button, Dialog, Field } from '@operai/ui'
import { strings } from '../strings'

export type RejectDialogProps = {
  /** The owning employee's display name — interpolated into the body copy. */
  employeeName: string
  isDeciding: boolean
  errorMessage: string | null
  onConfirm: (motivation: string) => void
  onCancel: () => void
}

export default function RejectDialog({
  employeeName,
  isDeciding,
  errorMessage,
  onConfirm,
  onCancel,
}: RejectDialogProps) {
  const t = strings.pages.reviewDetail.rejectDialog
  const [motivation, setMotivation] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canConfirm = motivation.trim().length > 0 && !isDeciding

  return (
    <Dialog
      role="alertdialog"
      size="sm"
      title={t.title}
      describedBy="reject-dialog-body"
      onClose={onCancel}
      dismissOnBackdrop={false}
      closeLabel={t.cancelAriaLabel}
      busy={isDeciding}
      initialFocusRef={textareaRef}
      testIdPrefix="reject-dialog"
      backdropTestId="reject-dialog-modal"
    >
      <div id="reject-dialog-body" className="dialog-body">
        <p>{t.body(employeeName)}</p>
      </div>

      <Field label={t.motivationLabel} hint={t.motivationHelp} required className="dialog-body">
        {(control) => (
          <textarea
            {...control}
            ref={textareaRef}
            required
            rows={3}
            value={motivation}
            disabled={isDeciding}
            onChange={(e) => setMotivation(e.target.value)}
            data-testid="reject-dialog-motivation"
          />
        )}
      </Field>

      {errorMessage && (
        <p role="alert" data-testid="reject-dialog-error" className="form-error dialog-body">
          {errorMessage}
        </p>
      )}

      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel} disabled={isDeciding} data-testid="reject-dialog-cancel">
          {t.cancelLabel}
        </Button>
        <Button
          variant="danger"
          onClick={() => onConfirm(motivation.trim())}
          disabled={!canConfirm}
          busy={isDeciding}
          data-testid="reject-dialog-confirm"
        >
          {isDeciding ? t.confirmingLabel : t.confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
