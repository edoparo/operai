import { PageHeader, useFocusOnMount } from '@operai/ui'
import { strings } from '../strings'

/**
 * NotFoundPage — admin-ui's inner-router-wide not-found fallback (T14,
 * specs/20260713-auth-roles-permissions/tasks.md's "not-found route"). Wired as
 * `defaultNotFoundComponent` in `createAppRouter` (../router.tsx), so any
 * unmatched path under admin-ui's basepath (e.g. a stale bookmark or
 * typo'd `/admin/whatever`) renders this instead of a blank screen — no
 * separate catch-all route needed, TanStack Router falls back to this
 * component automatically for any path none of the four section routes (or
 * the index redirect) match.
 *
 * A11y: the heading takes programmatic focus on mount (the library's
 * `useFocusOnMount` + `PageHeader focusableHeading`, INC-30), as design.md's
 * Accessibility section prescribes for Screens E1/S1 ("the heading
 * receives programmatic focus on mount … so assistive tech announces the
 * state immediately") — applied here too since a not-found admin route is
 * the same class of "nothing else on this screen to explore" state, even
 * though it isn't one of those two named screens itself. The chrome around
 * it (AdminShell's heading + SectionNav) stays mounted, so the four real
 * sections remain one click away.
 */
export default function NotFoundPage() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>()

  return (
    <section aria-labelledby="admin-not-found-heading" data-testid="admin-not-found-page">
      <PageHeader
        title={strings.common.notFound.title}
        titleId="admin-not-found-heading"
        headingRef={headingRef}
        focusableHeading
        description={strings.common.notFound.body}
      />
    </section>
  )
}
