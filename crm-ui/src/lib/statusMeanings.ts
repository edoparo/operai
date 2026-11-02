/**
 * statusMeanings — the ONE place crm-ui maps its domain states to the suite's
 * status dictionary (`STATUS` in @operai/ui, INC-23; plan.md § UI). The meaning
 * picks the badge's tone and icon; the label is this app's (`strings.badges`).
 */
import type { StatusMeaning } from '@operai/ui'
import type { CompanyStatus, DealStage, EstimateState } from './types'

export const COMPANY_STATUS_MEANING: Record<CompanyStatus, StatusMeaning> = {
  prospect: 'pending',
  customer: 'active',
  former: 'voided',
}

export const DEAL_STAGE_MEANING: Record<DealStage, StatusMeaning> = {
  lead: 'draft',
  qualified: 'pending',
  proposal: 'pending',
  negotiation: 'pending',
  won: 'settled',
  lost: 'failed',
}

export type TaskState = 'open' | 'overdue' | 'done'

export const TASK_STATE_MEANING: Record<TaskState, StatusMeaning> = {
  open: 'pending',
  overdue: 'attention',
  done: 'settled',
}

/** A record hidden from the default lists but kept (spec § archived). */
export const ARCHIVED_MEANING: StatusMeaning = 'voided'

/** The estimate gate: waiting for the technical contact, or open to proposal. */
export const ESTIMATE_STATE_MEANING: Record<EstimateState, StatusMeaning> = {
  requested: 'pending',
  ready: 'active',
}
