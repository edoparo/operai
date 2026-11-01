import { useId } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../lib/cx'

export type CardProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  /** The card's heading; also its accessible name. */
  title?: ReactNode
  /** Heading level of the title. Defaults to 3 (tool h1 → page h2 → card h3). */
  headingLevel?: 2 | 3 | 4
  titleTestId?: string
  /** The card's own action, on the right of the title row — a `secondary`, `sm` button. */
  action?: ReactNode
  children: ReactNode
}

/**
 * Card — one titled group of related content: a section of a detail page, a
 * filter bar, a composer. A detail page is a column of cards; never nest them.
 */
export function Card({ title, headingLevel = 3, titleTestId, action, children, className, ...rest }: CardProps) {
  const titleId = useId()
  const Heading = `h${headingLevel}` as const
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cx('card', className)} {...rest}>
      {(title || action) && (
        <div className="card-header">
          {title && (
            <Heading id={titleId} className="card-title" data-testid={titleTestId}>
              {title}
            </Heading>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
