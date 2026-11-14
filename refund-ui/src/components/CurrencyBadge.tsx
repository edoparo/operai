/**
 * CurrencyBadge — an expense line's or subtotal's currency (specs/20260716-refund-service),
 * separate from `EntityBadge`. Neutral for every currency: the ISO code is
 * what tells them apart, and colour on a row is left to the decision.
 */

import { Badge } from '@operai/ui'
import { strings } from '../strings'
import type { Currency } from '../lib/money'

export type CurrencyBadgeProps = {
  currency: Currency
}

/**
 * Neutral metadata: the ISO code alone (INC-23). A symbol glyph beside the
 * code (€ EUR) said the same thing twice, and CHF has no symbol at all.
 */
export default function CurrencyBadge({ currency }: CurrencyBadgeProps) {
  return <Badge data-testid="currency-badge">{strings.badges.currency[currency]}</Badge>
}
