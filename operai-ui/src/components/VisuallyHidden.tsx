import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  /** Announce changes politely — the loading line of a list ("Loading your requests…"). */
  live?: boolean
}

/** VisuallyHidden — text for assistive technology only. */
export function VisuallyHidden({ children, live = false, className, ...rest }: VisuallyHiddenProps) {
  return (
    <span className={cx('visually-hidden', className)} aria-live={live ? 'polite' : undefined} {...rest}>
      {children}
    </span>
  )
}
