import type { CSSProperties } from 'react'
import { cx } from '../lib/cx'

export type SkeletonProps = {
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  className?: string
}

/** Skeleton — one placeholder bar. Decorative; pair the loading view with a polite VisuallyHidden line. */
export function Skeleton({ width = '100%', height = 12, className }: SkeletonProps) {
  return <span aria-hidden="true" className={cx('skeleton', className)} style={{ width, height }} />
}

export type SkeletonRowsProps = {
  rows?: number
  /** Placeholder action buttons per row. */
  actions?: number
  testId?: string
}

/**
 * SkeletonRows — the loading shape of a list page: rows with a title, a meta
 * line and trailing actions. aria-hidden; the page announces "Loading …".
 */
export function SkeletonRows({ rows = 3, actions = 2, testId }: SkeletonRowsProps) {
  return (
    <div className="skeleton-rows" aria-hidden="true" data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-row-text">
            <Skeleton width="50%" height={14} />
            <Skeleton width="25%" height={10} />
          </div>
          {actions > 0 && (
            <div className="skeleton-row-actions">
              {Array.from({ length: actions }, (_, j) => (
                <Skeleton key={j} width={40} height={24} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
