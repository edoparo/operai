import { StatePanel } from '@operai/ui'
import { strings } from '../strings'

/**
 * NotFoundPage — notify-ui's inner-router-wide not-found fallback (T14,
 * specs/20260713-notification-center/tasks.md), wired as `defaultNotFoundComponent`
 * in `createAppRouter` (../router.tsx). Mirrors
 * `admin-ui/src/pages/NotFoundPage.tsx` exactly (same technique, same
 * rationale): any unmatched path under notify-ui's basepath (e.g. a stale
 * bookmark or typo'd `/notify/whatever`) renders this instead of a blank
 * screen.
 *
 * A11y: the heading takes programmatic focus on mount (StatePanel's
 * `focusOnMount`), the same technique design.md's
 * Accessibility section prescribes for entry-point pages reached by
 * navigation rather than in-page state change.
 */
export default function NotFoundPage() {
  return (
    <section aria-labelledby="notify-not-found-heading" data-testid="notify-not-found-page">
      <StatePanel title={strings.notFound.title} titleId="notify-not-found-heading" headingLevel={2} focusOnMount>
        {strings.notFound.body}
      </StatePanel>
    </section>
  )
}
