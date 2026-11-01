/**
 * LinesCard — a request's expense lines as one section of the detail page
 * (INC-33): a `Card` titled "Expense lines", the rows (`ExpenseLineRow`, each a
 * `.list-row`) in a `ListRows` list, or `empty` when there are none. Shared by
 * the employee's request page and accounting's review page, in every status.
 */

import { Children } from 'react'
import type { ReactNode } from 'react'
import { Card, ListRows } from '@operai/ui'

export type LinesCardProps = {
  title: string
  /** The rows: one `ExpenseLineRow` per line. */
  children: ReactNode
  /** Shown instead of the list when there is no row. */
  empty?: ReactNode
  headingTestId?: string
  testId?: string
}

export default function LinesCard({ title, children, empty, headingTestId, testId }: LinesCardProps) {
  const hasRows = Children.toArray(children).length > 0
  return (
    <Card title={title} titleTestId={headingTestId} data-testid={testId}>
      {hasRows ? <ListRows label={title}>{children}</ListRows> : empty}
    </Card>
  )
}
