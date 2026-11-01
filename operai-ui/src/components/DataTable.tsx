import { Fragment, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx'

export type DataTableColumn<T> = {
  /** Stable id (React key). */
  id: string
  /** Header text — app-owned copy. */
  header: ReactNode
  render: (row: T) => ReactNode
  /** Right-aligned DM Mono with tabular figures: amounts, years, counts. The cell text carries its own currency. */
  numeric?: boolean
  /** Render this column's cells as `<th scope="row">` (the row's name). */
  rowHeader?: boolean
}

export type DataTableProps<T> = {
  /** Names the table (sr-only caption) and, unless `regionLabel` is set, its scroll region. */
  caption: string
  /** Id of a visible heading that names the table instead of `caption` (the caption stays for the region). */
  labelledBy?: string
  /**
   * A detail row under a row, spanning every column, when this returns content
   * (an expanded audit entry). The row that toggles it owns an
   * `aria-expanded` control; the detail row is plain content.
   */
  renderDetail?: (row: T) => ReactNode
  regionLabel?: string
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  getRowKey: (row: T) => string
  /** Moves focus to this row's header cell — e.g. the row just added. */
  focusRowKey?: string | null
  /** Highlights rows on hover — when a cell holds the row's link. */
  interactiveRows?: boolean
  testId?: string
  /** data-testid for each row: `${rowTestIdPrefix}-${key}`. */
  rowTestIdPrefix?: string
}

/**
 * DataTable — the one table primitive (extracted from inventory-ui). An
 * sr-only caption, `scope` on every header, numeric columns right-aligned in
 * DM Mono, and a keyboard-scrollable region when wider than the viewport. It
 * never formats, sorts or paginates; empty and loading states are the page's
 * (render a StatePanel or SkeletonRows instead of an empty table).
 */
export function DataTable<T>({
  caption,
  labelledBy,
  renderDetail,
  regionLabel,
  columns,
  rows,
  getRowKey,
  focusRowKey = null,
  interactiveRows = false,
  testId,
  rowTestIdPrefix,
}: DataTableProps<T>) {
  const tableRef = useRef<HTMLTableElement>(null)

  useEffect(() => {
    if (focusRowKey === null) return
    const row = Array.from(tableRef.current?.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []).find(
      (candidate) => candidate.dataset.rowKey === focusRowKey,
    )
    row?.querySelector<HTMLElement>('th[scope="row"]')?.focus()
  }, [focusRowKey])

  return (
    <div role="region" aria-label={regionLabel ?? caption} tabIndex={0} className="table-region">
      <table ref={tableRef} className="data-table" aria-labelledby={labelledBy} data-testid={testId}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={cx(column.numeric && 'is-numeric')}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowKey = getRowKey(row)
            const detail = renderDetail?.(row)
            return (
              <Fragment key={rowKey}>
                <tr
                  data-row-key={rowKey}
                  data-testid={rowTestIdPrefix ? `${rowTestIdPrefix}-${rowKey}` : undefined}
                  className={cx(interactiveRows && 'is-interactive')}
                >
                  {columns.map((column) =>
                    column.rowHeader ? (
                      <th key={column.id} scope="row" tabIndex={-1} className={cx(column.numeric && 'is-numeric')}>
                        {column.render(row)}
                      </th>
                    ) : (
                      <td key={column.id} className={cx(column.numeric && 'is-numeric')}>
                        {column.render(row)}
                      </td>
                    ),
                  )}
                </tr>
                {detail !== undefined && detail !== null && detail !== false && (
                  <tr className="data-table-detail" data-row-detail={rowKey}>
                    <td colSpan={columns.length}>{detail}</td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
