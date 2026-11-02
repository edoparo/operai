import { useState } from 'react'
import { Field, FormDialog } from '@operai/ui'
import { isStaleWrite } from '../lib/api'
import { moveDealStage } from '../lib/crmApi'
import { errorMessage } from '../lib/errors'
import { percent } from '../lib/money'
import { DEAL_STAGES, isOpenStage } from '../lib/types'
import type { Deal, DealStage, Pipeline } from '../lib/types'
import { maxLength } from '../lib/validate'
import { strings } from '../strings'

/**
 * MoveStageDialog — "Move to stage" (AC-3.3, D-20: the keyboard-accessible
 * replacement for dragging a card). Any stage may be chosen; `lost` offers an
 * optional reason; a closed deal moved to an open stage is reopened (the hint
 * says so). The stage field's hint says what the chosen stage means and, when
 * the page has them from `GET /pipeline`, its win probability. A stale write is
 * the page's to handle. The pipeline board opens it with `initialStage` when a
 * deal is dropped on Lost, so the reason can be given before the move.
 */
export default function MoveStageDialog({
  deal,
  initialStage,
  probabilities,
  onMoved,
  onCancel,
  onStale,
}: {
  deal: Pick<Deal, 'id' | 'version' | 'stage'> & { lostReason?: string | null }
  initialStage?: DealStage
  probabilities?: Pipeline['probabilities'] | null
  onMoved: (deal: Deal) => void
  onCancel: () => void
  onStale: () => void
}) {
  const t = strings.deals.stageDialog
  const [stage, setStage] = useState<DealStage>(initialStage ?? deal.stage)
  const [reason, setReason] = useState(deal.lostReason ?? '')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const tooLong = stage === 'lost' ? maxLength(reason, 500) : null
    setReasonError(tooLong)
    if (tooLong) return
    setBusy(true)
    setError(null)
    moveDealStage(deal.id, deal.version, stage, stage === 'lost' ? reason.trim() : undefined).then(
      onMoved,
      (failure) => {
        setBusy(false)
        if (isStaleWrite(failure)) return onStale()
        setError(errorMessage(failure))
      },
    )
  }

  return (
    <FormDialog
      title={t.title}
      description={!isOpenStage(deal.stage) ? t.reopenHint : undefined}
      submitLabel={t.submit}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      canSubmit={stage !== deal.stage || (stage === 'lost' && reason.trim() !== (deal.lostReason ?? ''))}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      testIdPrefix="crm-stage-dialog"
    >
      <Field
        label={t.stage}
        hint={t.stageHint(
          strings.deals.stageMeaning[stage],
          probabilities ? percent(probabilities[stage]) : null,
        )}
        testId="crm-stage-dialog-stage"
      >
        {(control) => (
          <select {...control} value={stage} onChange={(event) => setStage(event.target.value as DealStage)}>
            {DEAL_STAGES.map((option) => (
              <option key={option} value={option}>
                {strings.badges.dealStage[option]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {stage === 'lost' && (
        <Field label={t.lostReason} hint={t.lostReasonHint} error={reasonError} testId="crm-stage-dialog-reason">
          {(control) => (
            <textarea {...control} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </Field>
      )}
    </FormDialog>
  )
}
