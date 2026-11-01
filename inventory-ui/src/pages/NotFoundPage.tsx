import { PageHeader, useFocusOnMount } from '@operai/ui'
import { strings } from '../strings'

/**
 * NotFoundPage — inventory-ui's router-level not-found fallback (T24), wired as
 * `defaultNotFoundComponent` in `createAppRouter` (../router.tsx). Distinct
 * from a record-level "not found" (an asset or fiscal year the API 404s on,
 * design.md error catalogue): this is a path that matches no route at all.
 * Focus moves to the heading on mount (INC-30, `useFocusOnMount`).
 */
export default function NotFoundPage() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>()

  return (
    <section aria-labelledby="inventory-not-found-heading" data-testid="inventory-not-found-page">
      <PageHeader
        title={strings.notFound.heading}
        titleId="inventory-not-found-heading"
        headingRef={headingRef}
        focusableHeading
        description={strings.notFound.body}
      />
    </section>
  )
}
