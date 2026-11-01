import { SkeletonRows, VisuallyHidden } from '@operai/ui'
import { strings } from '../strings'

/**
 * SkeletonListRows — admin-ui's loading state (INC-22): a thin adapter over
 * the library's `SkeletonRows`, always paired with a polite visually hidden
 * line announcing the load (`strings.common.loading` unless the caller names
 * what is loading). Keeps the `skeleton-list-rows` test id on the rows.
 */
export type SkeletonListRowsProps = {
  /** Number of placeholder rows to render. Defaults to 3. */
  rows?: number
  /**
   * The announced loading text; defaults to `strings.common.loading`. `null`
   * when a sibling skeleton on the same screen already announces the load.
   */
  label?: string | null
}

export default function SkeletonListRows({ rows = 3, label = strings.common.loading }: SkeletonListRowsProps) {
  return (
    <>
      {label !== null && <VisuallyHidden live>{label}</VisuallyHidden>}
      <SkeletonRows rows={rows} testId="skeleton-list-rows" />
    </>
  )
}
