import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from '../lib/cx'

export type TooltipProps = {
  /** What the tooltip says. Short: one or two sentences. */
  content: ReactNode
  /** Opens below the trigger aligned to its start (default) or its end. */
  align?: 'start' | 'end'
  /**
   * The trigger. Spread `describedBy` on the focusable element so a screen
   * reader announces the tooltip with it.
   */
  children: (describedBy: { 'aria-describedby': string }) => ReactNode
  className?: string
}

/**
 * Tooltip — a short explanation of a control, shown while the pointer is over
 * it or it has keyboard focus, and dismissed with Escape (WCAG 1.4.13). The
 * text is never the only place something essential is said: a tooltip
 * explains, it does not instruct. Takes its copy as a prop like every library
 * component.
 */
export function Tooltip({ content, align = 'start', children, className }: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const show = () => setOpen(true)
  const hide = () => setOpen(false)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      hide()
    }
  }

  return (
    <span
      className={cx('tooltip', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={onKeyDown}
    >
      {children({ 'aria-describedby': id })}
      <span id={id} role="tooltip" className={cx('tooltip-content', align === 'end' && 'tooltip-end')} hidden={!open}>
        {content}
      </span>
    </span>
  )
}
