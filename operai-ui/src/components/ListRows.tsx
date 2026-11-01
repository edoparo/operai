import { Children } from 'react'
import type { ReactNode } from 'react'

export type ListRowsProps = {
  /** Accessible name of the list. */
  label?: string
  /** One element per row — a router <Link className="list-row"> for a row that opens a record. */
  children: ReactNode
  testId?: string
}

/**
 * ListRows — a card-style list where each row opens one record (My requests,
 * Batch history). Use a DataTable instead when rows have more than ~3
 * comparable columns.
 */
export function ListRows({ label, children, testId }: ListRowsProps) {
  return (
    <ul className="list-rows" aria-label={label} data-testid={testId}>
      {Children.toArray(children).map((child, index) => (
        <li key={index}>{child}</li>
      ))}
    </ul>
  )
}

/** The class a row link carries; `listRowMetaClassName` for its secondary text. */
export const listRowClassName = 'list-row'
export const listRowMetaClassName = 'list-row-meta'
