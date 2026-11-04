import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { useBackdropClick } from './Dialog'
import { Icon } from './Icon'
import { useDialogBehavior } from './useDialogBehavior'

export type DrawerProps = {
  /** The drawer's heading and accessible name. */
  title: ReactNode
  /** A line under the heading, used as the accessible description. */
  description?: ReactNode
  /** Called on ×, the backdrop and Escape. */
  onClose: () => void
  /** Accessible name of the × button. */
  closeLabel: string
  /** Namespaces data-testids: `${prefix}`, `${prefix}-backdrop`, `${prefix}-close`. */
  testIdPrefix?: string
  children: ReactNode
}

/**
 * Drawer — a modal panel that slides in from the right edge, for reference
 * content read alongside the page (help, a glossary, a long explanation). It
 * is a dialog in everything but shape: same focus/keyboard contract as Dialog
 * (useDialogBehavior — focus moves to the heading on open and back to the
 * trigger on close, Tab is trapped, Escape/backdrop/× close it, page scroll is
 * locked). Its body scrolls on its own. Mount to open, unmount to close.
 *
 * Not for a form or a confirmation: those are FormDialog and ConfirmDialog.
 */
export function Drawer({ title, description, onClose, closeLabel, testIdPrefix = 'drawer', children }: DrawerProps) {
  const baseId = useId()
  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-description`
  const drawerRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  const backdropClick = useBackdropClick(onClose)

  useDialogBehavior({ dialogRef: drawerRef, onClose, busy: false, initialFocusRef: titleRef })

  return (
    <div className="drawer-backdrop" {...backdropClick} data-testid={`${testIdPrefix}-backdrop`}>
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="drawer"
        data-testid={testIdPrefix}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <h2 ref={titleRef} id={titleId} tabIndex={-1} className="dialog-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="drawer-description">
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            iconOnly
            onClick={onClose}
            aria-label={closeLabel}
            data-testid={`${testIdPrefix}-close`}
          >
            <Icon name="close" />
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  )
}
