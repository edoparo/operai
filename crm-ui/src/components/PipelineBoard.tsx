import { Link, useNavigate } from '@tanstack/react-router'
import { StatusBadge, formatDate } from '@operai/ui'
import { Board } from '@operai/ui/board'
import type { BoardLane } from '@operai/ui/board'
import { dealAmount, formatTotals, percent } from '../lib/money'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { personName } from '../lib/people'
import { DEAL_STAGES, isOpenStage, kindOf } from '../lib/types'
import type { DealStage, DealSummary, Pipeline, PipelineStage } from '../lib/types'
import { ESTIMATE_STATE_MEANING } from '../lib/statusMeanings'
import { strings } from '../strings'
import { TenderBadge } from './Badges'

/**
 * PipelineBoard — the pipeline as a board in the Jira/GitLab shape (AC-3.3,
 * AC-3.4, D-25): one lane per stage, Won and Lost included (this year's closed
 * deals, the same set `GET /pipeline` totals), each deal a compact card. Drawn by
 * the library's `Board` (`@operai/ui/board`), which owns the drag and drop:
 * - Pointer: press and move 8 px to drag; a click without moving opens the deal.
 * - Keyboard: a card is one tab stop. Space picks it up, left/right arrows jump
 *   a whole lane, Space drops, Escape cancels, Enter opens the deal. Every step
 *   is announced.
 * - A deal outside the caller's `deal:manage` scope is a plain link card; the
 *   server's 403 stays the gate (ADR 20260716-refund-api-authorization-enforcing-resource-server).
 *
 * The board only reports the drop (`onMove`); the page performs the write.
 */
export default function PipelineBoard({
  pipeline,
  deals,
  currentUserId,
  canMove,
  onMove,
}: {
  pipeline: Pipeline
  deals: DealSummary[]
  currentUserId: string | null
  canMove: (deal: DealSummary) => boolean
  onMove: (deal: DealSummary, stage: DealStage) => void
}) {
  const t = strings.deals.pipeline
  const navigate = useNavigate()
  const { financials } = useCrmCapabilities()

  const byStage = (stage: DealStage): PipelineStage =>
    pipeline.stages.find((entry) => entry.stage === stage) ?? { stage, count: 0 }

  const lanes: BoardLane<DealStage>[] = DEAL_STAGES.map((stage) => {
    const entry = byStage(stage)
    const label = strings.badges.dealStage[stage]
    return {
      id: stage,
      title: label,
      count: entry.count,
      header: (
        <LaneHeader
          entry={entry}
          year={pipeline.year}
          probability={pipeline.probabilities[stage]}
          financials={financials}
        />
      ),
      empty: t.noDeals,
      label: t.dealsLabel(label),
    }
  })

  return (
    // Six lanes fit the wide layout; a narrow screen scrolls the board, not the page.
    <Board<DealSummary, DealStage>
      lanes={lanes}
      items={deals}
      idOf={(deal) => deal.id}
      laneOf={(deal) => deal.stage}
      titleOf={(deal) => deal.title}
      renderCard={(deal) => <CardContent deal={deal} currentUserId={currentUserId} />}
      cardLabel={(deal) => t.cardLabel(deal.title, deal.estimateState === 'requested', kindOf(deal) === 'tender')}
      canDrag={canMove}
      onMove={onMove}
      onOpen={(deal) => void navigate({ to: '/deals/$id', params: { id: deal.id } })}
      staticCard={(deal, { className, children, testId }) => (
        <Link to="/deals/$id" params={{ id: deal.id }} className={className} data-testid={testId}>
          {children}
        </Link>
      )}
      copy={{
        label: t.boardLabel,
        dragInstructions: t.dragInstructions,
        picked: t.announce.picked,
        over: t.announce.over,
        dropped: t.announce.dropped,
        cancelled: t.announce.cancelled,
      }}
      minLaneWidth="9.375rem"
      testId="crm-pipeline-board"
      laneTestId={(stage) => `crm-pipeline-stage-${stage}`}
      cardTestId={(deal) => `crm-pipeline-deal-${deal.id}`}
    />
  )
}

/** Under the lane's title: what the stage means, its probability (or the year), and the totals for `financials`. */
function LaneHeader({
  entry,
  year,
  probability,
  financials,
}: {
  entry: PipelineStage
  year: number
  probability: number
  financials: boolean
}) {
  const t = strings.deals.pipeline
  const open = isOpenStage(entry.stage)
  // No money for a caller without deal:financials: the lane shows its count only.
  const totals = financials ? formatTotals(entry.totals ?? [], 'amountCents') : []
  const weighted = financials ? formatTotals(entry.totals ?? [], 'weightedCents') : []

  return (
    <>
      <p className="text-xs text-soft">{strings.deals.stageMeaning[entry.stage]}</p>
      <p className="text-xs text-soft">{open ? t.probability(percent(probability)) : t.closedIn(year)}</p>
      {totals.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
          <dt className="text-soft">{t.total}</dt>
          {/* One currency per line: never summed (AC-3.4), and side by side they overflow a narrow lane. */}
          <dd className="flex flex-col items-end font-mono text-text" data-testid={`crm-pipeline-total-${entry.stage}`}>
            {totals.map((amount) => (
              <span key={amount} className="whitespace-nowrap">
                {amount}
              </span>
            ))}
          </dd>
          {open && (
            <>
              <dt className="text-soft">{t.weighted}</dt>
              <dd
                className="flex flex-col items-end font-mono text-text"
                data-testid={`crm-pipeline-weighted-${entry.stage}`}
              >
                {weighted.map((amount) => (
                  <span key={amount} className="whitespace-nowrap">
                    {amount}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>
      )}
    </>
  )
}

function CardContent({ deal, currentUserId }: { deal: DealSummary; currentUserId: string | null }) {
  const { financials } = useCrmCapabilities()
  return (
    <>
      {/* The client first, the deal under it, each in its own style (owner, 2026-11-07). */}
      <span className="text-xs text-soft">{deal.company.name}</span>
      <span className="text-sm font-medium text-text">{deal.title}</span>
      {kindOf(deal) === 'tender' && (
        <span>
          <TenderBadge testId={`crm-pipeline-tender-${deal.id}`} />
        </span>
      )}
      {deal.estimateState === 'requested' && (
        <span data-testid={`crm-pipeline-awaiting-estimate-${deal.id}`}>
          <StatusBadge status={ESTIMATE_STATE_MEANING.requested}>{strings.deals.pipeline.awaitingEstimate}</StatusBadge>
        </span>
      )}
      {financials && deal.amountCents != null && deal.currency !== undefined && (
        <span className="whitespace-nowrap font-mono text-sm text-text">
          {dealAmount(deal.amountCents, deal.currency)}
        </span>
      )}
      <span className="flex items-baseline justify-between gap-2 text-xs text-soft">
        <span className="truncate">{personName(deal.owner, currentUserId)}</span>
        {deal.expectedCloseDate && <span className="shrink-0">{formatDate(deal.expectedCloseDate)}</span>}
      </span>
    </>
  )
}
