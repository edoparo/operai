import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import type { DialogSize } from './Dialog'

export type FormDialogProps = {
  title: ReactNode
  /** A notice under the title ("cannot be edited once saved"); the dialog's description. */
  description?: ReactNode
  /** The fields — disabled as a group while `busy`. */
  children: ReactNode
  submitLabel: string
  busyLabel: string
  cancelLabel: string
  closeLabel: string
  /** `danger` when submitting is irreversible (dispose, reject); `primary` otherwise. */
  tone?: 'primary' | 'danger'
  busy: boolean
  /** False keeps submit disabled (a required field is empty). */
  canSubmit?: boolean
  /** A non-field error (503, network, conflict). Field errors belong on each <Field>. */
  error: string | null
  onSubmit: () => void
  onCancel: () => void
  size?: DialogSize
  /** data-testids: `${prefix}-backdrop`, `-close`, `-cancel`, `-submit`, `-error`. */
  testIdPrefix?: string
  /** See Dialog's `backdropTestId`. */
  backdropTestId?: string
}

/**
 * FormDialog — a `dialog` holding a short form. Focus starts on the first
 * field (or `data-autofocus`); Enter submits; on failure the dialog stays open
 * with every value kept, because it never unmounts its children. The page owns
 * the field state and the request.
 */
export function FormDialog({
  title,
  description,
  children,
  submitLabel,
  busyLabel,
  cancelLabel,
  closeLabel,
  tone = 'primary',
  busy,
  canSubmit = true,
  error,
  onSubmit,
  onCancel,
  size = 'md',
  testIdPrefix = 'form-dialog',
  backdropTestId,
}: FormDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      title={title}
      description={description}
      size={size}
      onClose={onCancel}
      closeLabel={closeLabel}
      busy={busy}
      fallbackFocusRef={cancelRef}
      testIdPrefix={testIdPrefix}
      backdropTestId={backdropTestId}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (canSubmit && !busy) onSubmit()
        }}
      >
        <fieldset disabled={busy} className="dialog-fields">
          {children}
        </fieldset>
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
            disabled={!canSubmit || busy}
            busy={busy}
            data-testid={`${testIdPrefix}-submit`}
          >
            {busy ? busyLabel : submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
