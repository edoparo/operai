import { StatusBadge } from '@operai/ui'
import type { EffectiveInvitationStatus } from '../lib/adminApi'
import { INVITATION_STATUS_MEANING } from '../lib/statusMeaning'
import { strings } from '../strings'

/**
 * InvitationStatusBadge — an invitation's effective status (T12,
 * specs/20260713-user-invitations): pending / accepted / expired / revoked, as the
 * library `StatusBadge` (INC-23) with the meaning from `lib/statusMeaning.ts`
 * and the label from `strings.badges.invitationStatus`.
 */
export type InvitationStatusBadgeProps = {
  status: EffectiveInvitationStatus
}

export default function InvitationStatusBadge({ status }: InvitationStatusBadgeProps) {
  return (
    <StatusBadge status={INVITATION_STATUS_MEANING[status]} data-testid="invitation-status-badge">
      {strings.badges.invitationStatus[status]}
    </StatusBadge>
  )
}
