/**
 * Pagination — shared paginated-list control (T15, specs/20260713-auth-roles-permissions,
 * design.md "Pagination control (shared within admin-ui)").
 *
 * Now an adapter over @operai/ui's Pagination (INC-15). Originally a
 * genuinely NEW primitive — design.md is explicit that no existing screen in
 * the repo paginates (`EstimatesPage`'s list is unpaginated), so there is no
 * pattern to port here. Built once, reused by the Users list (Screen C1,
 * `GET /admin/users`) and the Audit log (Screen D1) — both later tasks
 * (T20/T21) that consume this component rather than re-implement it.
 *
 * A11y (design.md "Accessibility — Data tables"):
 *   • Real `<button>`s for Previous/Next — never clickable `<div>`s.
 *   • `aria-disabled="true"` (not the native `disabled` attribute) at the
 *     bounds, so the control stays perceivable/focusable to assistive tech
 *     while activation is a no-op — mirrors the same "aria-disabled +
 *     explanation, not a bare CSS disabled state" posture design.md applies
 *     to the System-role Delete button.
 *   • `aria-live="polite"` region announcing "Showing X–Y of N" (and "Page N
 *     of M") on every page change, mirroring the existing
 *     `aria-live="polite"` loading-announcement convention (`EstimatesPage`,
 *     `RemoteMount`).
 *
 * Presentational: the caller (a later screen — Users list, Audit log) owns
 * the current page and re-fetches on `onPageChange`.
 */

import { Pagination as LibraryPagination } from '@operai/ui'
import type { PaginationStatus } from '@operai/ui'
import { strings } from '../strings'

export type PaginationProps = {
  /** Current 1-based page number. */
  page: number
  /** Number of items per page. */
  pageSize: number
  /** Total number of items across all pages. */
  total: number
  /** Called with the new 1-based page number when Previous/Next is activated. */
  onPageChange: (page: number) => void
}

/** admin-ui's status copy — unchanged from the local control this adapter replaced (INC-15). */
const statusText = ({ page, totalPages, rangeStart, rangeEnd, total }: PaginationStatus): string =>
  total === 0
    ? strings.common.pagination.statusEmpty(page, totalPages)
    : strings.common.pagination.status(page, totalPages, rangeStart, rangeEnd, total)

/**
 * Thin adapter over @operai/ui's `Pagination` (INC-15): admin-ui's offset
 * endpoints all report a total, so they page with Previous/Next. Supplies
 * admin-ui's copy; the behaviour (aria-disabled bounds, polite status, the
 * `pagination-*` test ids) is the library's.
 */
export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  return (
    <LibraryPagination
      page={page}
      pageSize={pageSize}
      total={total}
      onPageChange={onPageChange}
      label={strings.common.pagination.label}
      previousLabel={strings.common.pagination.previous}
      nextLabel={strings.common.pagination.next}
      status={statusText}
    />
  )
}
