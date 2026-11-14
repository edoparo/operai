import { Banner } from '@operai/ui'
import { activitiesUnavailableOf } from '../lib/errors'
import { strings } from '../strings'
import { LoadFailure } from './LoadState'

/**
 * ActivityLoadFailure — the failed-load state of the activity timeline and of "Tasks" (specs/20261110-activities AC-1.5).
 * When activities-api answers `host_unavailable` or `maintenance` the list area says so, in words of its
 * own and distinct from the authorization outage (ADR 20260716-refund-api-authorization-enforcing-resource-server), with Retry; the page frame, the other cards
 * and the Tasks filters and tabs stay. Every other failure is the usual `LoadFailure`.
 */
export default function ActivityLoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const unavailable = activitiesUnavailableOf(error)
  if (unavailable === null) return <LoadFailure error={error} onRetry={onRetry} />
  const t = strings.activities.unavailable[unavailable]
  return (
    <Banner
      tone="warning"
      data-testid="crm-activities-unavailable"
      title={t.title}
      onRetry={onRetry}
      retryLabel={strings.common.retry}
      retryTestId="crm-activities-unavailable-retry"
    >
      {t.body}
    </Banner>
  )
}
