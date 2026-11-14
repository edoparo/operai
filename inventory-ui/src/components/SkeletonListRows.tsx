/**
 * SkeletonListRows — presentational loading skeleton (T25, specs/015-hardware-
 * inventory; design.md § Screens & states: "Loading: SkeletonListRows plus an
 * sr-only aria-live="polite" line"). Re-authored from refund-ui's component
 * (ADR 20260709-suite-frontend-module-federation: no cross-remote imports) with the same props and markup:
 * placeholder rows with an animated pulse, a name column plus a trailing
 * actions column, `rows` defaulting to 3.
 *
 * The rows are aria-hidden because they carry no semantic content; the parent
 * screen provides the aria-live line that announces the loading state
 * (`strings.common.skeletonListRows.loadingLabel` is the default text).
 *
 * Now a thin adapter over @operai/ui's `SkeletonRows` (ADR 20261031-shared-ui-library-consumed-as-source), keeping the
 * `skeleton-list-rows` test id and the four trailing action placeholders.
 */

import { SkeletonRows } from '@operai/ui'

export type SkeletonListRowsProps = {
  /** Number of placeholder rows to render. Defaults to 3. */
  rows?: number
}

export default function SkeletonListRows({ rows = 3 }: SkeletonListRowsProps) {
  return <SkeletonRows rows={rows} actions={4} testId="skeleton-list-rows" />
}
