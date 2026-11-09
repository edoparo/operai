import { Link, useRouter } from '@tanstack/react-router'
import { Button, StatePanel, ToolLayout } from '@operai/ui'
import { ApiError } from '../lib/estimatesApi'
import { strings } from '../strings'

const t = strings.estimatesList.routeError

/**
 * What `/estimates/$estimateId` renders when its loader fails for any reason
 * other than 404 (which redirects to the list): the authorization service is
 * down on an oversight open (503 `authz_unavailable`), the network, a 500.
 * Retry re-runs the loader; the link goes back to the list.
 */
export default function EstimateRouteError({ error }: { error: unknown }) {
  const router = useRouter()
  const message =
    error instanceof ApiError && error.code === 'authz_unavailable' ? t.authzUnavailable : t.generic

  return (
    <ToolLayout title={strings.toolTitle}>
      <StatePanel
        title={t.title}
        role="alert"
        focusOnMount
        testId="estimate-route-error"
        action={
          <span className="flex gap-2.5 justify-center items-center">
            <Button variant="primary" onClick={() => void router.invalidate()}>
              {t.retry}
            </Button>
            <Link to="/estimates" className="link">
              {t.back}
            </Link>
          </span>
        }
      >
        <p>{message}</p>
      </StatePanel>
    </ToolLayout>
  )
}
