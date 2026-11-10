import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export type ConfirmDialogProps = {
  title: ReactNode
  /** What will happen, and whether it can be undone. */
  children: ReactNode
  confirmLabel: string
  /** Label while in flight ("Deleting…"). */
  busyLabel: string
  cancelLabel: string
  closeLabel: string
  /** `danger` (default) for destructive or irreversible; `primary` for a positive confirmation (Approve). */
  tone?: 'danger' | 'primary'
  /**
   * For an act that cannot be undone and moves money or closes books: the whole
   * acknowledgement sentence, the label of a checkbox that must be ticked before
   * Confirm is enabled.
   */
  acknowledgeLabel?: string
  /** Fields the act needs (a date, a reason), disabled as a group in flight; the first one takes focus. */
  fields?: ReactNode
  busy: boolean
  /** Inline error from the failed request; null = none. The dialog stays open. */
  error: string | null
  onConfirm: () => void
  onCancel: () => void
  /** data-testids: `${prefix}-backdrop`, `-close`, `-cancel`, `-confirm`, `-error`, `-checkbox`. */
  testIdPrefix?: string
  /** See Dialog's `backdropTestId`. */
  backdropTestId?: string
}

/**
 * ConfirmDialog — an `alertdialog` asking to confirm one action. Cancel takes
 * focus on open (the safe default; the first field when there are `fields`);
 * in flight the controls are disabled, the confirm button is busy and the
 * dialog cannot be dismissed. Replaces `window.confirm()` everywhere.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel,
  closeLabel,
  tone = 'danger',
  acknowledgeLabel,
  fields,
  busy,
  error,
  onConfirm,
  onCancel,
  testIdPrefix = 'confirm-dialog',
  backdropTestId,
}: ConfirmDialogProps) {
  const baseId = useId()
  const bodyId = `${baseId}-body`
  const checkboxId = `${baseId}-ack`
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const hasFields = fields !== undefined && fields !== null
  const canConfirm = !busy && (acknowledgeLabel === undefined || acknowledged)

  return (
    <Dialog
      role="alertdialog"
      size={hasFields ? 'md' : 'sm'}
      title={title}
      describedBy={bodyId}
      onClose={onCancel}
      // A dialog holding typed input ignores the backdrop, as FormDialog does:
      // a stray click must not throw away a reason the user has written.
      dismissOnBackdrop={!hasFields}
      closeLabel={closeLabel}
      busy={busy}
      initialFocusRef={hasFields ? undefined : cancelRef}
      fallbackFocusRef={cancelRef}
      testIdPrefix={testIdPrefix}
      backdropTestId={backdropTestId}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (canConfirm) onConfirm()
        }}
      >
        {/* A <div>, not a <p>, so the body can hold block content. */}
        <div id={bodyId} className="dialog-body">
          {children}
        </div>
        {hasFields && (
          <fieldset disabled={busy} className="dialog-fields">
            {fields}
          </fieldset>
        )}
        {acknowledgeLabel !== undefined && (
          <div className="dialog-acknowledge">
            <input
              id={checkboxId}
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.target.checked)}
              data-testid={`${testIdPrefix}-checkbox`}
            />
            <label htmlFor={checkboxId}>{acknowledgeLabel}</label>
          </div>
        )}
        {error && (
          <p role="alert" className="form-error dialog-body" data-testid={`${testIdPrefix}-error`}>
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            data-testid={`${testIdPrefix}-cancel`}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={tone}
            disabled={!canConfirm}
            busy={busy}
            data-testid={`${testIdPrefix}-confirm`}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
