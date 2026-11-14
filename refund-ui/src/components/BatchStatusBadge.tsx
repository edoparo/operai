/**
 * BatchStatusBadge — a compilation batch's lifecycle status (specs/20260719-refund-monthly-processing):
 * compiled (awaiting payment), paid (settled — the same meaning, hence the
 * same icon, as a paid request), discarded (voided). Tone and icon come from
 * the library's status dictionary through `BATCH_STATUS_MEANING`.
 */

import { StatusBadge } from '@operai/ui'
import { strings } from '../strings'
import { BATCH_STATUS_MEANING } from '../lib/statusMeaning'
import type { BatchStatus } from '../lib/batchesApi'

export type BatchStatusBadgeProps = {
  status: BatchStatus
}

export default function BatchStatusBadge({ status }: BatchStatusBadgeProps) {
  return (
    <StatusBadge status={BATCH_STATUS_MEANING[status]} data-testid="batch-status-badge">
      {strings.badges.batchStatus[status]}
    </StatusBadge>
  )
}
