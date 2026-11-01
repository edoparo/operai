import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export type NoticeDialogProps = {
  title: ReactNode
  /** Why the action was blocked, or what happened. */
  children: ReactNode
  acknowledgeLabel: string
  /** Called on the button, Escape and the backdrop — every way out acknowledges. */
  onAcknowledge: () => void
  /** data-testids: `${prefix}-backdrop`, `${prefix}-ok`. */
  testIdPrefix?: string
  /** See Dialog's `backdropTestId`. */
  backdropTestId?: string
}

/**
 * NoticeDialog — an `alertdialog` with one acknowledgement and nothing to
 * decide: a guardrail ("this request was already decided"), a conflict that
 * needs a reload. No ×, no Cancel; the one button has focus.
 */
export function NoticeDialog({
  title,
  children,
  acknowledgeLabel,
  onAcknowledge,
  testIdPrefix = 'notice-dialog',
  backdropTestId,
}: NoticeDialogProps) {
  const messageId = useId()
  const okRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      role="alertdialog"
      size="sm"
      title={title}
      describedBy={messageId}
      onClose={onAcknowledge}
      initialFocusRef={okRef}
      testIdPrefix={testIdPrefix}
      backdropTestId={backdropTestId}
    >
      <div id={messageId} className="dialog-body">
        {children}
      </div>
      <div className="dialog-footer">
        <Button ref={okRef} variant="primary" onClick={onAcknowledge} data-testid={`${testIdPrefix}-ok`}>
          {acknowledgeLabel}
        </Button>
      </div>
    </Dialog>
  )
}
