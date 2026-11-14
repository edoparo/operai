/**
 * statusMeanings — the ONE place inventory-ui maps its domain states to the
 * suite's status dictionary (`STATUS` in @operai/ui, INC-23). The meaning picks
 * the badge's tone and icon, so an icon means the same thing here as in every
 * other tool; the label stays this app's (`strings.badges`).
 */
import type { StatusMeaning } from '@operai/ui'
import type { AssetStatus } from './types'

/** An asset's lifecycle status (specs/20261006-hardware-inventory § Domain language). */
export const ASSET_STATUS_MEANING: Record<AssetStatus, StatusMeaning> = {
  ordered: 'pending',
  in_stock: 'stored',
  assigned: 'active',
  in_repair: 'attention',
  lost: 'missing',
  disposed: 'voided',
}

/** An imported asset flagged "to verify": nothing failed, someone must check it. */
export const TO_VERIFY_MEANING: StatusMeaning = 'attention'

/** A depreciation rule's state on the rules page. */
export type RuleState = 'inForce' | 'scheduled' | 'superseded'

export const RULE_STATE_MEANING: Record<RuleState, StatusMeaning> = {
  inForce: 'active',
  scheduled: 'pending',
  superseded: 'voided',
}

/** A fiscal year's state: open, or closed for good. */
export const FISCAL_YEAR_STATE_MEANING: Record<'open' | 'closed', StatusMeaning> = {
  open: 'pending',
  closed: 'settled',
}
