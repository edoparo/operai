import { Link } from '@tanstack/react-router'
import { StatePanel } from '@operai/ui'
import { strings } from '../strings'

/** The router fallback: an unknown path under `/crm`. */
export default function NotFoundPage() {
  return (
    <StatePanel
      role="alert"
      focusOnMount
      headingLevel={2}
      title={strings.nav.notFound.heading}
      testId="crm-not-found"
      action={
        <Link to="/companies" className="link">
          {strings.nav.notFound.back}
        </Link>
      }
    >
      {strings.nav.notFound.body}
    </StatePanel>
  )
}
