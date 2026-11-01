import { StatusBadge } from '@operai/ui'
import { SYSTEM_ROLE_MEANING } from '../lib/statusMeaning'
import { strings } from '../strings'

/**
 * SystemBadge — marks a seed/system role as not deletable (T15,
 * specs/004-auth-roles-permissions, design.md Screen A1). A library
 * `StatusBadge` (INC-23, meaning `info`), always paired with a disabled
 * Delete button carrying the same explanatory `title`.
 */
export default function SystemBadge() {
  return (
    <StatusBadge status={SYSTEM_ROLE_MEANING} data-testid="system-badge" title={strings.badges.systemTitle}>
      {strings.badges.system}
    </StatusBadge>
  )
}
