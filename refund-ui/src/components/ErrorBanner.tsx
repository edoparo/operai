/**
 * ErrorBanner — inline RFC 7807 error banner with a Retry action (T15,
 * specs/20260716-refund-service/tasks.md, design.md Component inventory:
 * "ErrorBanner — Reuse (ported pattern) — admin-ui/src/components/ErrorBanner.tsx").
 *
 * History: this used to be a re-authored copy of another remote's component
 * (a remote cannot import another remote's source, ADR 20260709-suite-frontend-module-federation). It now renders
 * @operai/ui's `Banner` (ADR 20261031-shared-ui-library-consumed-as-source) and only binds refund-ui's copy and test ids.
 *
 * Presentational: the caller extracts `detail`/`title` off its own
 * `ApiError`-shaped error (`src/lib/refundApi.ts`) and passes plain strings
 * in — this component has no knowledge of the Problem+JSON shape itself.
 *
 * Copy sourced from `strings.ts` (T14/T15 convention: no hardcoded UI
 * strings) — only the default retry label and the dismiss button's
 * `aria-label` are static; `message` itself is always caller-supplied.
 *
 * Now a thin adapter over @operai/ui's `Banner` (tone `warning`: a
 * recoverable failure with Retry), binding refund-ui's copy and test ids
 * (ADR 20261031-shared-ui-library-consumed-as-source).
 *
 * A11y: `role="alert"` — assistive tech announces the message as soon as it
 * is inserted, without requiring focus to move there. "Retry" and "Dismiss"
 * are real `<button>`s.
 */

import { Banner } from '@operai/ui'
import { strings } from '../strings'

export type ErrorBannerProps = {
  /** The error text to display (typically an RFC 7807 `detail`). */
  message: string
  /** Called when the user clicks "Retry". Omit to render without a Retry action. */
  onRetry?: () => void
  /** Label for the retry action. Defaults to strings.components.errorBanner.defaultRetryLabel. */
  retryLabel?: string
  /** Called when the user dismisses the banner. Omit to render without a dismiss action. */
  onDismiss?: () => void
}

export default function ErrorBanner({
  message,
  onRetry,
  retryLabel = strings.components.errorBanner.defaultRetryLabel,
  onDismiss,
}: ErrorBannerProps) {
  return (
    <Banner
      tone="warning"
      data-testid="error-banner"
      onRetry={onRetry}
      retryLabel={retryLabel}
      retryTestId="error-banner-retry"
      onDismiss={onDismiss}
      dismissLabel={strings.components.errorBanner.dismissLabel}
      dismissTestId="error-banner-dismiss"
    >
      {message}
    </Banner>
  )
}
