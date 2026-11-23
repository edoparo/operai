/**
 * statusMeanings — the ONE place crm-ui maps its domain states to the suite's
 * status dictionary (`STATUS` in @operai/ui, INC-23; plan.md § UI). The meaning
 * picks the badge's tone and icon; the label is this app's (`strings.badges`).
 */
import { STATUS } from '@operai/ui'
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

/**
 * "In progress" (specs/20261110-activities US-10) is the library's `progress` meaning. A remote runs on the LIVE
 * shell's library (ADR 20261114): until that shell has `progress`, the badge falls back to `active`, which every
 * shell has, instead of breaking.
 */
const IN_PROGRESS_MEANING: StatusMeaning = 'progress' in STATUS ? 'progress' : 'active'

export type TaskState = 'open' | 'in_progress' | 'overdue' | 'blocked' | 'done'

export const TASK_STATE_MEANING: Record<TaskState, StatusMeaning> = {
  open: 'pending',
  in_progress: IN_PROGRESS_MEANING,
  overdue: 'attention',
  // Waiting on another task (specs/20261101-crm US-6): someone else has to act first.
  blocked: 'pending',
  done: 'settled',
}

/** A record hidden from the default lists but kept (spec § archived). */
export const ARCHIVED_MEANING: StatusMeaning = 'voided'

/** The estimate gate: waiting for the technical contact, or open to proposal. */
export const ESTIMATE_STATE_MEANING: Record<EstimateState, StatusMeaning> = {
  requested: 'pending',
  ready: 'active',
}
