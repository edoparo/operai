import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Announcements, DragEndEvent, DragStartEvent, KeyboardCoordinateGetter } from '@dnd-kit/core'
import { StatusBadge, formatDate } from '@operai/ui'
import { dealAmount, formatTotals, percent } from '../lib/money'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { personName } from '../lib/people'
import { DEAL_STAGES, isOpenStage } from '../lib/types'
import type { DealStage, DealSummary, Pipeline, PipelineStage } from '../lib/types'
import { ESTIMATE_STATE_MEANING } from '../lib/statusMeanings'
import { strings } from '../strings'

/**
 * PipelineBoard — the pipeline as a board in the Jira/GitLab shape (AC-3.3,
 * AC-3.4, D-25): one lane per stage, Won and Lost included (this year's closed
 * deals, the same set `GET /pipeline` totals), each deal a compact card.
 *
 * The whole card is the drag source:
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
  const [active, setActive] = useState<DealSummary | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // Enter is left to "open the deal"; Space alone picks up and drops.
    useSensor(KeyboardSensor, {
      coordinateGetter: laneCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )
  const stageLabel = (id: unknown) => strings.badges.dealStage[id as DealStage] ?? ''
  const titleOf = (id: unknown) => deals.find((deal) => deal.id === id)?.title ?? ''

  const announcements: Announcements = {
    onDragStart: ({ active: item }) => t.announce.picked(titleOf(item.id), stageLabel(item.data.current?.stage)),
    onDragOver: ({ active: item, over }) => (over ? t.announce.over(titleOf(item.id), stageLabel(over.id)) : undefined),
    onDragEnd: ({ active: item, over }) =>
      over ? t.announce.dropped(titleOf(item.id), stageLabel(over.id)) : t.announce.cancelled(titleOf(item.id)),
    onDragCancel: ({ active: item }) => t.announce.cancelled(titleOf(item.id)),
  }

  const onDragStart = (event: DragStartEvent) => setActive(deals.find((deal) => deal.id === event.active.id) ?? null)
  const onDragEnd = (event: DragEndEvent) => {
    setActive(null)
    const deal = deals.find((item) => item.id === event.active.id)
    const target = event.over?.id as DealStage | undefined
    if (deal && target && target !== deal.stage) onMove(deal, target)
  }

  const byStage = (stage: DealStage): PipelineStage =>
    pipeline.stages.find((entry) => entry.stage === stage) ?? { stage, count: 0 }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t.dragInstructions } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      {/* Six lanes fit the wide layout; a narrow screen scrolls the board, not the page. */}
      <div className="overflow-x-auto" role="region" aria-label={t.boardLabel} data-testid="crm-pipeline-board">
        <div className="grid min-w-[60rem] grid-cols-6 gap-3">
          {DEAL_STAGES.map((stage) => (
            <Lane
              key={stage}
              entry={byStage(stage)}
              year={pipeline.year}
              probability={pipeline.probabilities[stage]}
              deals={deals.filter((deal) => deal.stage === stage)}
              currentUserId={currentUserId}
              canMove={canMove}
              dragging={active !== null}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {active ? (
          <div className={`${CARD} cursor-grabbing shadow-lg`}>
            <CardContent deal={active} currentUserId={currentUserId} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/** The card surface, shared by the card, the link card and the drag overlay. */
const CARD = 'flex flex-col gap-2 rounded-md border border-rule bg-ink-mid p-3 text-left'

function Lane({
  entry,
  year,
  probability,
  deals,
  currentUserId,
  canMove,
  dragging,
}: {
  entry: PipelineStage
  year: number
  probability: number
  deals: DealSummary[]
  currentUserId: string | null
  canMove: (deal: DealSummary) => boolean
  dragging: boolean
}) {
  const t = strings.deals.pipeline
  const { setNodeRef, isOver } = useDroppable({ id: entry.stage })
  const label = strings.badges.dealStage[entry.stage]
  const open = isOpenStage(entry.stage)
  const { financials } = useCrmCapabilities()
  // No money for a caller without deal:financials: the lane shows its count only.
  const totals = financials ? formatTotals(entry.totals ?? [], 'amountCents') : []
  const weighted = financials ? formatTotals(entry.totals ?? [], 'weightedCents') : []
  const outline = isOver ? 'border-acc bg-acc-lo' : dragging ? 'border-dim' : 'border-transparent'

  return (
    <section
      ref={setNodeRef}
      aria-label={t.dealsLabel(label)}
      className={`flex min-h-[28rem] flex-col gap-3 rounded-lg border bg-ink-soft p-2 transition-colors ${outline}`}
      data-testid={`crm-pipeline-stage-${entry.stage}`}
    >
      <header className="flex flex-col gap-1 px-1 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text">{label}</h3>
          <span className="font-mono text-xs text-soft">{entry.count}</span>
        </div>
        <p className="text-xs text-soft">{strings.deals.stageMeaning[entry.stage]}</p>
        <p className="text-xs text-soft">{open ? t.probability(percent(probability)) : t.closedIn(year)}</p>
        {totals.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
            <dt className="text-soft">{t.total}</dt>
            {/* One currency per line: never summed (AC-3.4), and side by side they overflow a narrow lane. */}
            <dd
              className="flex flex-col items-end font-mono text-text"
              data-testid={`crm-pipeline-total-${entry.stage}`}
            >
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
      </header>
      <ul className="flex flex-col gap-2">
        {deals.map((deal) => (
          <li key={deal.id}>
            {canMove(deal) ? (
              <DraggableCard deal={deal} currentUserId={currentUserId} dragging={dragging} />
            ) : (
              <Link
                to="/deals/$id"
                params={{ id: deal.id }}
                className={`${CARD} hover:border-dim`}
                data-testid={`crm-pipeline-deal-${deal.id}`}
              >
                <CardContent deal={deal} currentUserId={currentUserId} />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {deals.length === 0 && <p className="px-1 text-xs text-soft">{t.noDeals}</p>}
    </section>
  )
}

function DraggableCard({
  deal,
  currentUserId,
  dragging,
}: {
  deal: DealSummary
  currentUserId: string | null
  dragging: boolean
}) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id, data: { stage: deal.stage } })
  const open = () => void navigate({ to: '/deals/$id', params: { id: deal.id } })
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter opens the deal, except while a keyboard drag is running.
    if (event.key === 'Enter' && !dragging) {
      event.preventDefault()
      open()
      return
    }
    listeners?.onKeyDown?.(event)
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={open}
      aria-label={strings.deals.pipeline.cardLabel(deal.title, deal.estimateState === 'requested')}
      className={`${CARD} cursor-grab touch-none hover:border-dim focus-visible:outline-2 focus-visible:outline-acc ${isDragging ? 'opacity-40' : ''}`}
      data-testid={`crm-pipeline-deal-${deal.id}`}
    >
      <CardContent deal={deal} currentUserId={currentUserId} />
    </div>
  )
}

function CardContent({ deal, currentUserId }: { deal: DealSummary; currentUserId: string | null }) {
  const { financials } = useCrmCapabilities()
  return (
    <>
      {/* The client first, the deal under it, each in its own style (owner, 2026-11-07). */}
      <span className="text-xs text-soft">{deal.company.name}</span>
      <span className="text-sm font-medium text-text">{deal.title}</span>
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

/**
 * Keyboard moves jump a whole lane: left/right centre the dragged card on the
 * previous/next lane, so a few presses reach any stage.
 */
const laneCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined
  event.preventDefault()
  const { collisionRect, droppableRects } = context
  if (!collisionRect) return undefined
  const lanes = [...droppableRects.values()].sort((a, b) => a.left - b.left)
  const centre = collisionRect.left + collisionRect.width / 2
  const next =
    event.code === 'ArrowRight'
      ? lanes.find((lane) => lane.left > centre)
      : [...lanes].reverse().find((lane) => lane.left + lane.width < centre)
  if (!next) return undefined
  return { x: next.left + (next.width - collisionRect.width) / 2, y: next.top + 8 }
}
