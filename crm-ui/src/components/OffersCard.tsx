import { useCallback, useState } from 'react'
import { Banner, Button, Card, ConfirmDialog, DataTable, StatusBadge, formatDate, formatMoney, formatNumber } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { deleteOffer, getOfferDownload, listOffers, moveDealStage } from '../lib/crmApi'
import { isStaleWrite } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { offerFailure } from '../lib/offerErrors'
import { personName } from '../lib/people'
import type { Deal, DealStage, Offer } from '../lib/types'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import GenerateOfferDialog from './GenerateOfferDialog'
import { LoadFailure, Loading } from './LoadState'

type Dialog = 'generate' | 'proposal' | { delete: Offer } | { sent: Offer } | null

/**
 * OffersCard — the deal's offer versions, newest first (specs/018 US-4). Only
 * rendered for a caller with `deal:financials`: an offer prints the price.
 * Generating needs `deal:manage` over the deal and a ready estimate; on a
 * `qualified` deal the person is then asked whether to move it to proposal
 * (AC-4.5). "Mark as sent" on the newest offer moves an open deal before
 * `negotiation` there (AC-4.6). Download opens the short-lived link in a new tab.
 */
export default function OffersCard({
  deal,
  canManage,
  onDealChanged,
  onStale,
}: {
  deal: Deal
  canManage: boolean
  onDealChanged: (deal: Deal, message: string) => void
  onStale: () => void
}) {
  const t = strings.offers
  const currentUserId = useCurrentUserId()
  const { managesAll } = useCrmCapabilities()
  const dealId = deal.id
  const load = useCallback((signal: AbortSignal) => listOffers(dealId, { signal }), [dealId])
  const offers = useResource(load)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const ready = deal.estimate?.state === 'ready'
  const close = () => {
    setDialog(null)
    setError(null)
  }

  const download = (offer: Offer) => {
    setNotice(null)
    getOfferDownload(dealId, offer.id).then(
      ({ url }) => window.open(url, '_blank', 'noopener'),
      (failure: unknown) => setNotice(offerFailure(failure)),
    )
  }

  const remove = (offer: Offer) => {
    setBusy(true)
    setError(null)
    deleteOffer(dealId, offer.id).then(
      () => {
        setBusy(false)
        close()
        offers.retry()
      },
      (failure: unknown) => {
        setBusy(false)
        setError(errorMessage(failure))
      },
    )
  }

  const moveTo = (stage: 'proposal' | 'negotiation') => {
    setBusy(true)
    setError(null)
    moveDealStage(dealId, deal.version, stage).then(
      (next) => {
        setBusy(false)
        close()
        onDealChanged(next, strings.deals.detail.moved(strings.badges.dealStage[next.stage]))
      },
      (failure: unknown) => {
        setBusy(false)
        if (isStaleWrite(failure)) {
          close()
          return onStale()
        }
        setError(errorMessage(failure))
      },
    )
  }

  const items = offers.status === 'ready' ? offers.data!.items : []
  // The newest offer still listed; only it can be marked as sent.
  const latest = items.find((offer) => !offer.deleted)
  const canMarkSent = canManage && SENDABLE_FROM.includes(deal.stage)

  const columns: DataTableColumn<Offer>[] = [
    {
      id: 'reference',
      header: t.columns.reference,
      rowHeader: true,
      render: (offer) => (
        <span className={offer.deleted ? 'text-soft line-through' : 'font-mono'}>
          {offer.reference}
          {offer.templateName && (
            <span className="block text-xs text-soft font-body" data-testid={`crm-offer-template-${offer.id}`}>
              {t.templateOf(offer.templateName)}
            </span>
          )}
          {offer.deleted && (
            <>
              {' '}
              <StatusBadge status="voided">{t.deleted}</StatusBadge>
            </>
          )}
        </span>
      ),
    },
    { id: 'version', header: t.columns.version, render: (offer) => dim(offer, t.versionLabel(offer.number)) },
    { id: 'date', header: t.columns.date, render: (offer) => dim(offer, formatDate(offer.createdAt)) },
    {
      id: 'price',
      header: t.columns.price,
      numeric: true,
      render: (offer) => (
        <span className={offer.deleted ? 'text-soft' : undefined}>
          {formatMoney(offer.priceCents, offer.currency)}
          {(offer.yearlyCents ?? 0) > 0 && (
            <span className="block text-xs text-soft" data-testid={`crm-offer-yearly-${offer.id}`}>
              {t.perYear(formatMoney(offer.yearlyCents ?? 0, offer.currency))}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'manDays',
      header: t.columns.manDays,
      numeric: true,
      render: (offer) =>
        dim(offer, formatNumber(offer.manDaysTenths / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 })),
    },
    {
      id: 'language',
      header: t.columns.language,
      render: (offer) => (
        <span className={offer.deleted ? 'text-soft' : undefined}>
          {t.languageName[offer.language]}
          {offer.aiAssisted && (
            <>
              {' · '}
              {t.aiAssisted}
            </>
          )}
        </span>
      ),
    },
    { id: 'author', header: t.columns.author, render: (offer) => dim(offer, personName(offer.createdBy, currentUserId)) },
    {
      id: 'actions',
      header: t.columns.actions,
      render: (offer) =>
        offer.deleted ? null : (
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={t.downloadOf(offer.reference)}
              onClick={() => download(offer)}
              data-testid={`crm-offer-download-${offer.id}`}
            >
              {t.download}
            </Button>
            {canMarkSent && offer.id === latest?.id && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t.markSentOf(offer.reference)}
                aria-haspopup="dialog"
                onClick={() => setDialog({ sent: offer })}
                data-testid={`crm-offer-sent-${offer.id}`}
              >
                {t.markSent}
              </Button>
            )}
            {(offer.createdBy.id === currentUserId || managesAll) && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t.deleteOf(offer.reference)}
                aria-haspopup="dialog"
                onClick={() => setDialog({ delete: offer })}
                data-testid={`crm-offer-delete-${offer.id}`}
              >
                {strings.common.delete}
              </Button>
            )}
          </span>
        ),
    },
  ]

  return (
    <Card
      title={t.title}
      data-testid="crm-offers-card"
      action={
        canManage && (
          <Button
            size="sm"
            variant="primary"
            disabled={!ready}
            title={ready ? undefined : t.needsReady}
            onClick={() => setDialog('generate')}
            aria-haspopup="dialog"
            data-testid="crm-offer-generate"
          >
            {t.generate}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {notice && (
          <Banner tone="danger" onDismiss={() => setNotice(null)} dismissLabel={strings.common.dismiss} data-testid="crm-offers-notice">
            {notice}
          </Banner>
        )}
        {canManage && !ready && <p className="text-xs text-soft">{t.needsReady}</p>}
        {offers.status === 'loading' && <Loading label={t.loading} rows={2} />}
        {offers.status === 'error' && <LoadFailure error={offers.error} onRetry={offers.retry} />}
        {offers.status === 'ready' &&
          (offers.data!.items.length === 0 ? (
            <p className="text-sm text-soft" data-testid="crm-offers-empty">
              {t.empty}
            </p>
          ) : (
            <DataTable
              caption={t.caption}
              columns={columns}
              rows={offers.data!.items}
              getRowKey={(offer) => offer.id}
              testId="crm-offers-table"
            />
          ))}
      </div>
      {dialog === 'generate' && (
        <GenerateOfferDialog
          deal={deal}
          onCancel={close}
          onGenerated={(offer) => {
            offers.retry()
            setNotice(null)
            onDealChanged(deal, t.generated(offer.reference))
            if (deal.stage === 'qualified') setDialog('proposal')
            else close()
          }}
        />
      )}
      {dialog === 'proposal' && (
        <ConfirmDialog
          title={t.proposalDialog.title}
          tone="primary"
          confirmLabel={t.proposalDialog.confirm}
          busyLabel={t.proposalDialog.busy}
          cancelLabel={t.proposalDialog.later}
          closeLabel={strings.common.close}
          busy={busy}
          error={error}
          onConfirm={() => moveTo('proposal')}
          onCancel={close}
          testIdPrefix="crm-offer-proposal"
        >
          {t.proposalDialog.body}
        </ConfirmDialog>
      )}
      {typeof dialog === 'object' && dialog !== null && 'sent' in dialog && (
        <ConfirmDialog
          title={t.sentDialog.title}
          tone="primary"
          confirmLabel={t.sentDialog.confirm}
          busyLabel={t.sentDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={error}
          onConfirm={() => moveTo('negotiation')}
          onCancel={close}
          testIdPrefix="crm-offer-sent-dialog"
        >
          {t.sentDialog.body(dialog.sent.reference)}
        </ConfirmDialog>
      )}
      {typeof dialog === 'object' && dialog !== null && 'delete' in dialog && (
        <ConfirmDialog
          title={t.deleteDialog.title}
          confirmLabel={t.deleteDialog.confirm}
          busyLabel={t.deleteDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={busy}
          error={error}
          onConfirm={() => remove(dialog.delete)}
          onCancel={close}
          testIdPrefix="crm-offer-delete-dialog"
        >
          {t.deleteDialog.body(dialog.delete.reference)}
        </ConfirmDialog>
      )}
    </Card>
  )
}

/** The stages "Mark as sent" moves on from: open, and not yet past an offer. */
const SENDABLE_FROM: readonly DealStage[] = ['lead', 'qualified', 'proposal']

/** A deleted version stays visible but greyed. */
const dim = (offer: Offer, text: string) => <span className={offer.deleted ? 'text-soft' : undefined}>{text}</span>
