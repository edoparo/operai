import { useCallback, useState } from 'react'
import { Banner, Button, Card, ConfirmDialog, DataTable, StatusBadge, formatDate, formatMoney, formatNumber } from '@operai/ui'
import type { DataTableColumn } from '@operai/ui'
import { deleteOffer, getDeal, getOfferDownload, listOffers, markOfferSent, moveDealStage } from '../lib/crmApi'
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
import type { OfferSource } from './GenerateOfferDialog'
import { LoadFailure, Loading } from './LoadState'

type Dialog = 'generate' | 'proposal' | { delete: Offer } | { sent: Offer } | { source: OfferSource } | null

/**
 * OffersCard — the deal's offer versions, newest first (specs/018 US-4). Only
 * rendered for a caller with `deal:financials`: an offer prints the price.
 * Generating needs `deal:manage` over the deal and a ready estimate; on a
 * `qualified` deal the person is then asked whether to move it to proposal
 * (AC-4.5). Download opens the short-lived link in a new tab.
 *
 * specs/020 US-7: the newest offer is edited in place until it is marked sent;
 * marking it sent freezes it and moves an open deal before `negotiation` there.
 * After that the header offers "New revision", which starts from the sent one.
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

  const markSent = (offer: Offer) => {
    setBusy(true)
    setError(null)
    markOfferSent(dealId, offer.id)
      .then(() => getDeal(dealId))
      .then(
        (next) => {
          setBusy(false)
          close()
          offers.retry()
          onDealChanged(
            next,
            next.stage !== deal.stage
              ? strings.deals.detail.moved(strings.badges.dealStage[next.stage])
              : t.markedSent(offer.reference),
          )
        },
        (failure: unknown) => {
          setBusy(false)
          setError(offerFailure(failure))
        },
      )
  }

  const moveTo = (stage: 'proposal') => {
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
  // The newest offer still listed: the only one edited or marked sent.
  const latest = items.find((offer) => !offer.deleted)
  // An offer from a template (specs/020); older ones are neither edited nor revised from.
  const latestIsDocument = latest !== undefined && (latest.templateName ?? null) !== null
  const latestSent = latest?.sent != null
  const editable = (offer: Offer) => canManage && offer.id === latest?.id && latestIsDocument && !latestSent
  // Decided once the list is in: until then nobody knows whether there is an offer to edit.
  const header: 'generate' | 'revise' | null =
    offers.status !== 'ready' ? null : !latestIsDocument ? 'generate' : latestSent ? 'revise' : null

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
          {offer.sent && !offer.deleted && (
            <span className="block font-body" title={t.sentBy(personName(offer.sent.by, currentUserId), formatDate(offer.sent.at))}>
              <StatusBadge status="settled" data-testid={`crm-offer-sent-badge-${offer.id}`}>
                {t.sentOn(formatDate(offer.sent.at))}
              </StatusBadge>
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
            {editable(offer) && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t.editOf(offer.reference)}
                aria-haspopup="dialog"
                onClick={() => setDialog({ source: { offer, mode: 'edit' } })}
                data-testid={`crm-offer-edit-${offer.id}`}
              >
                {t.edit}
              </Button>
            )}
            {canManage && offer.id === latest?.id && !latestSent && (
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
        canManage &&
        header !== null && (
          <Button
            size="sm"
            variant="primary"
            disabled={!ready}
            title={ready ? undefined : t.needsReady}
            onClick={() => setDialog(header === 'revise' && latest ? { source: { offer: latest, mode: 'revise' } } : 'generate')}
            aria-haspopup="dialog"
            data-testid="crm-offer-generate"
          >
            {header === 'revise' ? t.revise : t.generate}
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
      {(dialog === 'generate' || (typeof dialog === 'object' && dialog !== null && 'source' in dialog)) && (
        <GenerateOfferDialog
          deal={deal}
          {...(typeof dialog === 'object' && dialog !== null && 'source' in dialog ? { source: dialog.source } : {})}
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
          onConfirm={() => markSent(dialog.sent)}
          onCancel={close}
          testIdPrefix="crm-offer-sent-dialog"
        >
          {SENDABLE_FROM.includes(deal.stage)
            ? t.sentDialog.body(dialog.sent.reference)
            : t.sentDialog.bodyNoMove(dialog.sent.reference)}
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
