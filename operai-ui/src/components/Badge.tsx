import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'muted'

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  /** A glyph shown before the label (decorative). Pair every tone with one so colour is never the only signal. */
  glyph?: ReactNode
  children: ReactNode
}

/**
 * Badge — a status, entity or currency label: glyph + text + tone. An app maps
 * its own domain values (request status, asset status, …) to a tone and a
 * glyph in one place, and renders this.
 */
export function Badge({ tone = 'neutral', glyph, children, className, ...rest }: BadgeProps) {
  return (
    <span className={cx('badge', tone !== 'neutral' && `badge-${tone}`, className)} {...rest}>
      {glyph !== undefined && <span aria-hidden="true">{glyph}</span>}
      <span>{children}</span>
    </span>
  )
}
