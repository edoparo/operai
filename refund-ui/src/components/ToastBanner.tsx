/**
 * ToastBanner — a toast strip for expense-line auto-save feedback
 * (content-app auto-save, specs/NNN). Two tones (`tone` prop, default
 * `'error'`):
 *
 *   - `'error'`:   persistent, only dismissed by the user's own "×" click.
 *     `role="alert"` — screen readers announce immediately on insertion.
 *   - `'success'`: auto-dismisses ~3s after mount by calling `onDismiss`.
 *     `role="status"` + `aria-live="polite"` — announced without
 *     interrupting (unlike `role="alert"`'s assertive announcement).
 *
 * History: this used to be a re-authored copy of another remote's component
 * (a remote cannot import another remote's source, ADR 20260709-suite-frontend-module-federation). It now renders
 * @operai/ui's `Banner (compact)` (ADR 20261031-shared-ui-library-consumed-as-source) and only binds refund-ui's copy and test ids.
 *
 * Copy sourced from `strings.ts` (T14/T15 convention: no hardcoded UI
 * strings) — only the dismiss button's `aria-label` is static; `message`
 * itself is always caller-supplied.
 *
 * Scope: `RequestDetailPage` renders at most one of these at a time, driven
 * by `ExpenseLineRow`'s `onSaveOutcome` callback for line edits and by the
 * composer's add / a row's delete (INC-19: every create, save and delete
 * confirms where the person acted). Lifecycle actions (Submit/Withdraw) stay
 * on this project's existing `aria-live="polite"` inline-confirmation
 * convention (design.md "Notification / toast a11y") — their status change is
 * itself visible.
 */

import { Banner } from '@operai/ui'
import { strings } from '../strings'

export type ToastBannerProps = {
  message: string
  onDismiss: () => void
  /** 'error' (default) — persistent, role="alert". 'success' — auto-dismisses, role="status". */
  tone?: 'error' | 'success'
}

// A thin adapter over @operai/ui's compact `Banner` (ADR 20261031-shared-ui-library-consumed-as-source): the library
// owns the roles, the auto-dismiss timer and the look; this binds the copy.
// A failed save (or a failed resend) is an action that failed next to the form
// or button the person used, so it takes the `danger` tone (red, INC-20) —
// orange is reserved for a failed load the same control retries.
export default function ToastBanner({ message, onDismiss, tone = 'error' }: ToastBannerProps) {
  const isSuccess = tone === 'success'
  return (
    <Banner
      compact
      tone={isSuccess ? 'success' : 'danger'}
      autoDismiss={isSuccess}
      onDismiss={onDismiss}
      dismissLabel={strings.components.toastBanner.dismissLabel}
      dismissTestId="toast-banner-dismiss"
      data-testid="toast-banner"
    >
      {message}
    </Banner>
  )
}
