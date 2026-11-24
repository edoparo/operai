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

/** A public tender (2026-11-24) is a kind of deal, not a status: metadata, emphasised (design-system § Data). */
export function TenderBadge({ testId }: { testId?: string }) {
  return (
    <Badge tone="accent" data-testid={testId}>
      {strings.badges.tender}
    </Badge>
  )
}

/**
 * A funding body (2026-11-24) is a kind of company, not a status: neutral metadata (design-system § Data). A client is
 * the default and carries no badge.
 */
export function FundingBodyBadge({ testId }: { testId?: string }) {
  return (
    <Badge tone="neutral" data-testid={testId}>
      {strings.badges.companyKind.funding_body}
    </Badge>
  )
}

export function EstimateStateBadge({ state }: { state: EstimateState }) {
  return <StatusBadge status={ESTIMATE_STATE_MEANING[state]}>{strings.badges.estimateState[state]}</StatusBadge>
}
