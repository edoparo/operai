/**
 * SkeletonListRows — presentational loading skeleton for refund-ui's list
 * screens (R1 "My requests", A1 "Review queue" — T15, specs/007-refund-service/
 * tasks.md, design.md Component inventory: "SkeletonListRows — Reuse (ported
 * pattern) — admin-ui/src/components/SkeletonListRows.tsx").
 *
 * History: this used to be a re-authored copy of another remote's component
 * (a remote cannot import another remote's source, ADR-0006). It now renders
 * @operai/ui's `SkeletonRows` (ADR-0050) and only binds refund-ui's copy and test ids.
 *
 * The rows are aria-hidden because they carry no semantic content; the
 * parent screen is responsible for providing an aria-live region that
 * announces the loading state to assistive technologies (design.md Screen
 * R1: 'the same aria-live="polite" "Loading your requests" sr-only
 * announcement EstimatesPage.tsx uses').
 */

import { SkeletonRows } from '@operai/ui'

export type SkeletonListRowsProps = {
  /** Number of placeholder rows to render. Defaults to 3. */
  rows?: number
}

// Now @operai/ui's `SkeletonRows` (ADR-0050), kept under this name so the
// pages and tests that use it are unchanged.
export default function SkeletonListRows({ rows = 3 }: SkeletonListRowsProps) {
  return <SkeletonRows rows={rows} actions={4} testId="skeleton-list-rows" />
}
