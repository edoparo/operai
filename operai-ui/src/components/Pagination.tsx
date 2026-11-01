import { Button } from './Button'

export type PaginationStatus = {
  page: number
  totalPages: number
  /** 1-based index of the first item shown; 0 when there are none. */
  rangeStart: number
  rangeEnd: number
  total: number
}

export type PaginationProps = {
  /** Current 1-based page. */
  page: number
  pageSize: number
  /** Items across all pages, from the API. */
  total: number
  onPageChange: (page: number) => void
  /** The nav landmark's accessible name ("Users pages"). */
  label: string
  previousLabel: string
  nextLabel: string
  /** The polite status line, e.g. `Page 2 of 5 — showing 26–50 of 112`. App-owned copy. */
  status: (status: PaginationStatus) => string
  testId?: string
}

/**
 * Pagination — Previous / Next over an OFFSET endpoint that reports a total
 * (INC-15). For a cursor endpoint (no total, no jumping) use `LoadMore`.
 * At the first and last page the button stays focusable but inert
 * (`aria-disabled`), so keyboard users do not lose their place.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  label,
  previousLabel,
  nextLabel,
  status,
  testId = 'pagination',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const isFirst = current <= 1
  const isLast = current >= totalPages
  const rangeStart = total === 0 ? 0 : (current - 1) * pageSize + 1
  const rangeEnd = Math.min(current * pageSize, total)

  return (
    <nav aria-label={label} className="pagination" data-testid={testId}>
      <Button
        size="sm"
        aria-disabled={isFirst}
        onClick={() => {
          if (!isFirst) onPageChange(current - 1)
        }}
        data-testid={`${testId}-previous`}
      >
        {previousLabel}
      </Button>
      <p aria-live="polite" className="pagination-status" data-testid={`${testId}-status`}>
        {status({ page: current, totalPages, rangeStart, rangeEnd, total })}
      </p>
      <Button
        size="sm"
        aria-disabled={isLast}
        onClick={() => {
          if (!isLast) onPageChange(current + 1)
        }}
        data-testid={`${testId}-next`}
      >
        {nextLabel}
      </Button>
    </nav>
  )
}
