import { StatusBadge } from '@operai/ui'
import { RATE_IN_EFFECT_MEANING } from '../lib/statusMeaning'
import { strings } from '../strings'

/** Marks the mileage-rate row in effect today (Settings tab). */
export default function RateInEffectBadge() {
  return (
    <StatusBadge status={RATE_IN_EFFECT_MEANING} data-testid="rate-in-effect-badge">
      {strings.settings.inEffect}
    </StatusBadge>
  )
}
