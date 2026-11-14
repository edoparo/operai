import { StatusBadge } from '@operai/ui'
import type { AccessRequestStatus } from '../lib/adminApi'
import { ACCESS_REQUEST_STATUS_MEANING } from '../lib/statusMeaning'
import { strings } from '../strings'

/**
 * AccessRequestStatusBadge — a waiting-list request's status (T9, specs/20261105-signup-gate):
 * the library `StatusBadge` with the meaning from `lib/statusMeaning.ts` and
 * the label from `strings.badges.accessRequestStatus`.
 */
export type AccessRequestStatusBadgeProps = {
  status: AccessRequestStatus
}

export default function AccessRequestStatusBadge({ status }: AccessRequestStatusBadgeProps) {
  return (
    <StatusBadge status={ACCESS_REQUEST_STATUS_MEANING[status]} data-testid="access-request-status-badge">
      {strings.badges.accessRequestStatus[status]}
    </StatusBadge>
  )
}
