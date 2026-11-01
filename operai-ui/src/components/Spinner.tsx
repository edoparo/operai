import { cx } from '../lib/cx'

export type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Spinner — a small rotating ring in the current text colour. Decorative
 * (`aria-hidden`): the busy state is announced by the control's own label and
 * `aria-busy`, or by a polite live region. Stops under reduced motion.
 */
export function Spinner({ size = 'sm', className }: SpinnerProps) {
  return <span aria-hidden="true" className={cx('spinner', size !== 'sm' && `spinner-${size}`, className)} />
}
