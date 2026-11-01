import { StatusBadge } from '@operai/ui'
import { RATE_IN_EFFECT_MEANING } from '../lib/statusMeaning'
import { strings } from '../strings'

/**
 * RateInEffectBadge — marks the mileage-rate history row that is currently
 * "in effect" (T11, specs/009-mileage-rate, design.md Screen ADM-1). A library
 * `StatusBadge` (INC-23, meaning `active`).
 */
export default function RateInEffectBadge() {
  return (
    <StatusBadge status={RATE_IN_EFFECT_MEANING} data-testid="rate-in-effect-badge">
      {strings.badges.rateInEffect}
    </StatusBadge>
  )
}
