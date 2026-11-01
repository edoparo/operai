import type { ReactNode, Ref } from 'react'
import { cx } from '../lib/cx'

export type PageHeaderProps = {
  title: ReactNode
  /** Id for the heading, so the page's <section aria-labelledby> can point at it. */
  titleId?: string
  /** A status badge shown beside the title, outside the heading (so it is not part of the heading's accessible name). */
  status?: ReactNode
  /** One line under the title. */
  description?: ReactNode
  /** Page-level actions, right-aligned: at most one `primary`. */
  actions?: ReactNode
  /** A text link back to the parent list (an arrow-left `Icon` + "Back to …"), above the title. */
  back?: ReactNode
  /** 2 by default: the tool title is the page's h1. */
  headingLevel?: 1 | 2
  /** For a page that moves focus to its heading (after a navigation or a state change): pass a ref and `focusableHeading`. */
  headingRef?: Ref<HTMLHeadingElement>
  /** Makes the heading programmatically focusable (`tabIndex={-1}`), never a tab stop. */
  focusableHeading?: boolean
  headingTestId?: string
  className?: string
}

/**
 * PageHeader — the top of every page inside a tool: back link, title,
 * description, actions. Card actions go in the card, not here.
 */
export function PageHeader({
  title,
  titleId,
  status,
  description,
  actions,
  back,
  headingLevel = 2,
  headingRef,
  focusableHeading = false,
  headingTestId,
  className,
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={cx('page-header', className)}>
      {back && <div className="page-header-back">{back}</div>}
      <div>
        <div className="page-title-row">
          <Heading
            ref={headingRef}
            id={titleId}
            tabIndex={focusableHeading ? -1 : undefined}
            className="page-title"
            data-testid={headingTestId}
          >
            {title}
          </Heading>
          {status}
        </div>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}
