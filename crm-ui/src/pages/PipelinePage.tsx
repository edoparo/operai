import { useCallback, useId, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Banner, Button, Field, PageHeader, StatePanel } from '@operai/ui'
import DealFormDialog from '../components/DealFormDialog'
import { LoadFailure, Loading, Saved, StaleWriteBanner } from '../components/LoadState'
import MoveStageDialog from '../components/MoveStageDialog'
import PipelineBoard from '../components/PipelineBoard'
import { isStaleWrite } from '../lib/api'
import { getPipeline, listDeals, moveDealStage } from '../lib/crmApi'
import { codeOf, errorMessage } from '../lib/errors'
import { ENTITIES } from '../lib/types'
import type { DealStage, DealSummary, Entity } from '../lib/types'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

/** The board asks for every deal it shows in one page (plan.md: pageSize ≤ 200 for the board, D-16). */
const BOARD_PAGE_SIZE = 200

/**
 * PipelinePage — the pipeline (AC-3.3, AC-3.4, D-25): the figures per stage
 * from `GET /pipeline` (never re-summed here) and the deals they count, open
 * ones and this year's won and lost, on a drag-and-drop board. Dropping a
 * deal moves it with the deal's version as If-Match; dropping on Lost first
 * asks for the optional reason. The deal shows in its new column at once and
 * the board reloads with the server's figures; a stale move shows the reload
 * banner. The entity filter narrows both the figures and the board, server-side.
 */
export default function PipelinePage() {
  const t = strings.deals.pipeline
  const titleId = useId()
  const navigate = useNavigate()
  const currentUserId = useCurrentUserId()
  const { canManageDeals, canManageDealsOf } = useCrmCapabilities()
  const [entity, setEntity] = useState<Entity | ''>('')
  /** The calendar year whose won and lost deals show (AC-3.6); null = this year, the server's. */
  const [year, setYear] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  /** A move in flight: the deal is drawn in its target column until the board reloads. */
  const [moving, setMoving] = useState<{ id: string; stage: DealStage } | null>(null)
  /** A drop on Lost waiting for the reason dialog. */
  const [losing, setLosing] = useState<DealSummary | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  /** A move the estimate gate refused: the deal and the server's explanation (specs/018 AC-3.4). */
  const [gate, setGate] = useState<{ deal: DealSummary; detail: string } | null>(null)
  const [stale, setStale] = useState(false)

  const load = useCallback(
    (signal: AbortSignal) =>
      Promise.all([
        getPipeline(entity, { signal }, year ?? undefined),
        listDeals({ board: true, entity, ...(year !== null ? { year } : {}), pageSize: BOARD_PAGE_SIZE }, { signal }),
      ]),
    [entity, year],
  )
  const board = useResource(load)
  const shownYear = board.data?.[0].year ?? year ?? new Date().getFullYear()
  const years = board.data?.[0].years ?? [shownYear]

  const moved = (stage: DealStage) => {
    setMoving(null)
    setNotice(strings.deals.detail.moved(strings.badges.dealStage[stage]))
    board.retry()
  }

  const move = (deal: DealSummary, stage: DealStage) => {
    setNotice(null)
    setFailure(null)
    setGate(null)
    setStale(false)
    if (stage === 'lost') {
      setLosing(deal)
      return
    }
    setMoving({ id: deal.id, stage })
    moveDealStage(deal.id, deal.version, stage).then(
      () => moved(stage),
      (error: unknown) => {
        setMoving(null)
        if (isStaleWrite(error)) setStale(true)
        else if (codeOf(error) === 'estimate_not_ready') setGate({ deal, detail: errorMessage(error) })
        else setFailure(errorMessage(error))
      },
    )
  }

  let content
  if (board.status === 'loading') content = <Loading label={t.loading} rows={4} />
  else if (board.status === 'error') content = <LoadFailure error={board.error} onRetry={board.retry} />
  else {
    const [pipeline, deals] = board.data!
    const shown = moving
      ? deals.items.map((deal) => (deal.id === moving.id ? { ...deal, stage: moving.stage } : deal))
      : deals.items
    content = (
      <div className="flex flex-col gap-4">
        {deals.total > deals.items.length && (
          <Banner tone="info">{t.truncated(deals.items.length, deals.total)}</Banner>
        )}
        {stale && (
          <StaleWriteBanner
            onReload={() => {
              setStale(false)
              board.retry()
            }}
          />
        )}
        {gate && (
          <Banner
            tone="danger"
            title={strings.estimate.gate.title(gate.deal.title)}
            onDismiss={() => setGate(null)}
            dismissLabel={strings.common.dismiss}
            data-testid="crm-pipeline-gate"
          >
            {gate.detail}{' '}
            <Link to="/deals/$id" params={{ id: gate.deal.id }} className="link" data-testid="crm-pipeline-gate-link">
              {strings.estimate.gate.openDeal}
            </Link>
          </Banner>
        )}
        {failure && (
          <Banner tone="danger" data-testid="crm-pipeline-move-failed">
            {failure}
          </Banner>
        )}
        {notice && <Saved message={notice} onDismiss={() => setNotice(null)} />}
        {deals.total === 0 ? (
          <StatePanel title={t.emptyTitle}>{t.emptyBody}</StatePanel>
        ) : (
          <PipelineBoard
            pipeline={pipeline}
            deals={shown}
            currentUserId={currentUserId}
            canMove={(deal) => moving === null && canManageDealsOf(deal.entity)}
            onMove={move}
          />
        )}
      </div>
    )
  }

  return (
    <section aria-labelledby={titleId} data-testid="crm-pipeline-page">
      <PageHeader
        title={t.heading}
        titleId={titleId}
        description={t.description}
        actions={
          canManageDeals && (
            <Button
              variant="primary"
              onClick={() => setCreating(true)}
              aria-haspopup="dialog"
              data-testid="crm-pipeline-new"
            >
              {t.newDeal}
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <div className="grid max-w-xl grid-cols-1 items-start gap-3 sm:grid-cols-2">
          <Field label={t.entityFilter} testId="crm-pipeline-entity">
            {(control) => (
              <select {...control} value={entity} onChange={(event) => setEntity(event.target.value as Entity | '')}>
                <option value="">{t.allEntities}</option>
                {ENTITIES.map((option) => (
                  <option key={option} value={option}>
                    {strings.badges.entity[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t.yearFilter} hint={t.yearHint} testId="crm-pipeline-year">
            {(control) => (
              <select
                {...control}
                value={shownYear}
                onChange={(event) => setYear(Number(event.target.value))}
              >
                {(years.includes(shownYear) ? years : [shownYear, ...years]).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {content}
      </div>
      {losing && (
        <MoveStageDialog
          deal={losing}
          initialStage="lost"
          probabilities={board.data?.[0].probabilities ?? null}
          onCancel={() => setLosing(null)}
          onStale={() => {
            setLosing(null)
            setStale(true)
          }}
          onMoved={() => {
            setLosing(null)
            moved('lost')
          }}
        />
      )}
      {creating && (
        <DealFormDialog
          onCancel={() => setCreating(false)}
          // A create has no precondition, so it cannot be stale.
          onStale={() => setCreating(false)}
          onSaved={(deal) => {
            setCreating(false)
            void navigate({ to: '/deals/$id', params: { id: deal.id } })
          }}
        />
      )}
    </section>
  )
}
