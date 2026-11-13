import { useState } from 'react'
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  Field,
  FactList,
  FormDialog,
  Icon,
  Tooltip,
  buttonClassName,
  formatDate,
  formatDateTime,
} from '@operai/ui'
import { overrideEstimateGate, unlinkEstimate } from '../lib/crmApi'
import { errorMessage } from '../lib/errors'
import { estimaiEstimateHref } from '../lib/links'
import { personName } from '../lib/people'
import type { Deal } from '../lib/types'
import { maxLength, required } from '../lib/validate'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { strings } from '../strings'
import { EstimateStateBadge } from './Badges'
import RequestEstimateDialog from './RequestEstimateDialog'

const GATED_STAGES = ['lead', 'qualified']

type Dialog = 'request' | 'unlink' | 'override' | null

/**
 * EstimateCard — the deal's technical estimate (specs/018 US-3): none (request
 * it), or linked (state, who, when, the link into EstimAI) with the actions the
 * caller may take. Every action answers with the updated deal, which the page
 * adopts (`onChanged`). Visibility of each button mirrors the server's rule;
 * the server stays the gate.
 */
export default function EstimateCard({
  deal,
  canManage,
  onChanged,
}: {
  deal: Deal
  canManage: boolean
  onChanged: (deal: Deal, message: string) => void
}) {
  const t = strings.estimate
  const currentUserId = useCurrentUserId()
  const { estimate, estimateOverride } = deal
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const canRequest = estimate === null && canManage && GATED_STAGES.includes(deal.stage)
  // Whoever manages this deal (its entity) may let it through, with a reason (amended 2026-11-13: was admins only).
  const canOverride = canManage && estimateOverride === null && estimate?.state !== 'ready'

  const close = () => {
    setDialog(null)
    setError(null)
    setReasonError(null)
  }

  const run = (call: () => Promise<Deal>, message: string, closeDialog = false) => {
    setBusy(true)
    setError(null)
    call().then(
      (next) => {
        setBusy(false)
        if (closeDialog) close()
        onChanged(next, message)
      },
      (failure: unknown) => {
        setBusy(false)
        setError(errorMessage(failure))
      },
    )
  }

  const submitOverride = () => {
    const invalid = required(reason) ?? maxLength(reason, 500)
    setReasonError(invalid)
    if (invalid) return
    run(() => overrideEstimateGate(deal.id, reason.trim()), t.done.overridden, true)
  }

  const canUnlink = estimate !== null && canManage
  const hasActions = canUnlink || canOverride

  return (
    <Card
      title={t.title}
      data-testid="crm-estimate-card"
      action={
        canRequest ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setDialog('request')}
            aria-haspopup="dialog"
            data-testid="crm-estimate-request"
          >
            {t.request}
          </Button>
        ) : (
          estimate !== null && (
            <a
              href={estimaiEstimateHref(estimate.estimateId)}
              className={buttonClassName({ size: 'sm' })}
              data-testid="crm-estimate-open"
            >
              {t.open}
              <Icon name="arrow-right" />
            </a>
          )
        )
      }
    >
      <div className="flex flex-col gap-3">
        {error && dialog === null && (
          <Banner tone="danger" data-testid="crm-estimate-error">
            {error}
          </Banner>
        )}
        {estimate === null ? (
          <div data-testid="crm-estimate-none">
            <p className="text-sm text-text">{t.none}</p>
            <p className="text-xs text-soft">{GATED_STAGES.includes(deal.stage) ? t.noneHint : t.noneLate}</p>
          </div>
        ) : (
          <>
            <FactList
              testId="crm-estimate-facts"
              items={[
                { id: 'name', term: t.facts.name, value: estimate.name },
                { id: 'technical', term: t.facts.technical, value: personName(estimate.technical, currentUserId) },
                { id: 'state', term: t.facts.state, value: <EstimateStateBadge state={estimate.state} /> },
                {
                  id: 'requested',
                  term: t.facts.requested,
                  value: t.facts.requestedBy(
                    personName(estimate.requestedBy, currentUserId),
                    formatDate(estimate.requestedAt),
                  ),
                },
                ...(estimate.readyAt
                  ? [{ id: 'ready', term: t.facts.ready, value: formatDateTime(estimate.readyAt) }]
                  : []),
              ]}
            />
            <p className="text-xs text-soft">{t.stateHint[estimate.state]}</p>
          </>
        )}
        {estimateOverride && (
          <Banner tone="warning" data-testid="crm-estimate-override">
            {t.overrideShown(personName(estimateOverride.by, currentUserId), formatDateTime(estimateOverride.at))}{' '}
            {t.overrideReason}: {estimateOverride.reason}
          </Banner>
        )}
        {hasActions && (
          <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
            <span className="ml-auto flex flex-wrap items-center gap-1">
              {canUnlink && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDialog('unlink')}
                  aria-haspopup="dialog"
                  data-testid="crm-estimate-unlink"
                >
                  {t.unlink}
                </Button>
              )}
              {canOverride && (
                <Tooltip content={t.overrideTooltip} align="end">
                  {(describedBy) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog('override')}
                      aria-haspopup="dialog"
                      data-testid="crm-estimate-override-open"
                      {...describedBy}
                    >
                      {t.override}
                    </Button>
                  )}
                </Tooltip>
              )}
            </span>
          </div>
        )}
      </div>
      {dialog === 'request' && (
        <RequestEstimateDialog
          dealId={deal.id}
          onCancel={close}
          onRequested={(next) => {
            close()
            onChanged(next, t.done.requested)
          }}
        />
      )}
      {dialog === 'unlink' && (
        <ConfirmDialog
          title={t.unlinkDialog.title}
          confirmLabel={t.unlinkDialog.confirm}
          busyLabel={t.unlinkDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={error}
          onConfirm={() => run(() => unlinkEstimate(deal.id), t.done.unlinked, true)}
          onCancel={close}
          testIdPrefix="crm-estimate-unlink-dialog"
        >
          {t.unlinkDialog.body}
        </ConfirmDialog>
      )}
      {dialog === 'override' && (
        <FormDialog
          title={t.overrideDialog.title}
          description={t.overrideDialog.description}
          submitLabel={t.overrideDialog.submit}
          busyLabel={t.overrideDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={error}
          onSubmit={submitOverride}
          onCancel={close}
          testIdPrefix="crm-estimate-override-dialog"
        >
          <Field
            label={t.overrideDialog.reason}
            hint={t.overrideDialog.reasonHint}
            required
            error={reasonError}
            testId="crm-estimate-override-reason"
          >
            {(control) => (
              <textarea {...control} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
            )}
          </Field>
        </FormDialog>
      )}
    </Card>
  )
}
