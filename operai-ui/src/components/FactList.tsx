import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export type Fact = {
  id: string
  term: ReactNode
  value: ReactNode
}

export type FactListProps = {
  items: readonly Fact[]
  className?: string
  testId?: string
}

/**
 * FactList — label/value pairs (a detail page's "Details" card) as a <dl> on
 * an auto-filling grid, never two wide columns.
 */
export function FactList({ items, className, testId }: FactListProps) {
  return (
    <dl className={cx('fact-list', className)} data-testid={testId}>
      {items.map((item) => (
        <div key={item.id}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
