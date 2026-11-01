import { Button } from './Button'
import { VisuallyHidden } from './VisuallyHidden'

export type LoadMoreProps = {
  /** True while the API returned a next cursor. */
  hasMore: boolean
  /** True while the next page is in flight. */
  loading: boolean
  onLoadMore: () => void
  label: string
  /** Label while in flight ("Loading more…"). */
  loadingLabel: string
  /** Polite announcement after a page arrives ("25 more assets loaded"); '' announces nothing. */
  announcement?: string
  /** Why the last load failed; the button retries. */
  error?: string | null
  testId?: string
}

/**
 * LoadMore — appends the next page of a CURSOR endpoint (INC-15; no total, no
 * jumping). For an offset endpoint with a total use `Pagination`. A failed load
 * is recoverable — the same button retries — so its message is the warning
 * tone (design-system.md § Feedback).
 */
export function LoadMore({
  hasMore,
  loading,
  onLoadMore,
  label,
  loadingLabel,
  announcement = '',
  error = null,
  testId = 'load-more',
}: LoadMoreProps) {
  return (
    <div className="load-more" data-testid={testId}>
      {error && (
        <p role="alert" className="load-more-error">
          {error}
        </p>
      )}
      {hasMore && (
        <Button
          variant="secondary"
          busy={loading}
          aria-disabled={loading || undefined}
          onClick={() => {
            if (!loading) onLoadMore()
          }}
        >
          {loading ? loadingLabel : label}
        </Button>
      )}
      <VisuallyHidden live role="status">
        {announcement}
      </VisuallyHidden>
    </div>
  )
}
