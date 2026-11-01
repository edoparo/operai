/**
 * RequestStatusBadge — a refund request's status (specs/007, specs/008):
 * draft / submitted ("Awaiting decision", never confusable with a decision,
 * AC-3.4) / approved / rejected / paid. Tone and icon come from the library's
 * status dictionary through `REQUEST_STATUS_MEANING`; the label from strings.
 */

import { StatusBadge } from '@operai/ui'
import { strings } from '../strings'
import { REQUEST_STATUS_MEANING } from '../lib/statusMeaning'

export type RequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid'

export type RequestStatusBadgeProps = {
  status: RequestStatus
}

export default function RequestStatusBadge({ status }: RequestStatusBadgeProps) {
  return (
    <StatusBadge status={REQUEST_STATUS_MEANING[status]} data-testid="request-status-badge">
      {strings.badges.requestStatus[status]}
    </StatusBadge>
  )
}
