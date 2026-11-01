import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export type StatePanelProps = {
  title: ReactNode
  children?: ReactNode
  /** One way forward ("Create your first request"), at most. */
  action?: ReactNode
  /** `alert` for a denial the user did not expect (permission denied); none for an ordinary empty state. */
  role?: 'alert' | 'status'
  /** Moves focus to the heading on mount — for a state that replaces the whole page. */
  focusOnMount?: boolean
  /** 1 only for a standalone screen with no ToolLayout around it (the shell's no-access screen). */
  headingLevel?: 1 | 2 | 3 | 4
  /** Id for the heading, so a surrounding <section aria-labelledby> can point at it. */
  titleId?: string
  testId?: string
  headingTestId?: string
}

/**
 * StatePanel — what a page shows in place of its content: an empty list,
 * permission denied, not found, nothing in scope. A centred heading and body;
 * not an error (that is a Banner).
 */
export function StatePanel({
  title,
  children,
  action,
  role,
  focusOnMount = false,
  headingLevel = 3,
  titleId,
  testId,
  headingTestId,
}: StatePanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const Heading = `h${headingLevel}` as const

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus()
  }, [focusOnMount])

  return (
    <div role={role} className="state-panel" data-testid={testId}>
      <Heading
        ref={headingRef}
        id={titleId}
        tabIndex={focusOnMount ? -1 : undefined}
        className="state-panel-title"
        data-testid={headingTestId}
      >
        {title}
      </Heading>
      {children && <div className="state-panel-body">{children}</div>}
      {action && <div className="state-panel-action">{action}</div>}
    </div>
  )
}
