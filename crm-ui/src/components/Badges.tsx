import { Badge, StatusBadge } from '@operai/ui'
import {
  ARCHIVED_MEANING,
  COMPANY_STATUS_MEANING,
  DEAL_STAGE_MEANING,
  ESTIMATE_STATE_MEANING,
  TASK_STATE_MEANING,
} from '../lib/statusMeanings'
import type { TaskState } from '../lib/statusMeanings'
import type { CompanyStatus, DealStage, Entity, EstimateState } from '../lib/types'
import { strings } from '../strings'

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  return <StatusBadge status={COMPANY_STATUS_MEANING[status]}>{strings.badges.companyStatus[status]}</StatusBadge>
}

export function DealStageBadge({ stage }: { stage: DealStage }) {
  return <StatusBadge status={DEAL_STAGE_MEANING[stage]}>{strings.badges.dealStage[stage]}</StatusBadge>
}

export function TaskStateBadge({ state }: { state: TaskState }) {
  return <StatusBadge status={TASK_STATE_MEANING[state]}>{strings.badges.taskState[state]}</StatusBadge>
}

export function ArchivedBadge() {
  return <StatusBadge status={ARCHIVED_MEANING}>{strings.badges.archived}</StatusBadge>
}

/** Entity is metadata, not a status: a neutral badge (design-system § Data). */
export function EntityBadge({ entity }: { entity: Entity }) {
  return <Badge tone="neutral">{strings.badges.entity[entity]}</Badge>
}

export function EstimateStateBadge({ state }: { state: EstimateState }) {
  return <StatusBadge status={ESTIMATE_STATE_MEANING[state]}>{strings.badges.estimateState[state]}</StatusBadge>
}
