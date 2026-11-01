/**
 * CurrencyBadge — the currency chip (T25, specs/015-hardware-inventory;
 * INC-23). A neutral `Badge` from @operai/ui showing the ISO code only
 * (EUR, CHF): a symbol beside the code would say the same thing twice.
 */

import { Badge } from '@operai/ui'
import { strings } from '../strings'
import type { Currency } from '../lib/types'

export type CurrencyBadgeProps = {
  currency: Currency
}

export default function CurrencyBadge({ currency }: CurrencyBadgeProps) {
  return <Badge data-testid="currency-badge">{strings.common.currency[currency]}</Badge>
}
