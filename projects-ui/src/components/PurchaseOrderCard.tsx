import { Banner, Card, FactList } from '@operai/ui'
import { crmDealHref, estimaiEstimateHref } from '../lib/links'
import type { Project } from '../lib/types'
import { strings } from '../strings'
import BexioOrderField from './BexioOrderField'
import TermsBlock from './TermsBlock'

/**
 * PurchaseOrderCard — the purchase order of a project made from a won deal (specs/022; ledger D38). It
 * shows the deal (a link to the CRM), the estimate the offer rested on (a link into EstimAI; a person
 * without access to it sees EstimAI's own unavailable state, AC-3.2), the Bexio order id, and — when the
 * deal was reopened in the CRM — the notice "the deal is no longer won": read live on every load, gone once
 * the deal is won again, and the purchase order is never changed by it (AC-2.3, AC-2.4, AC-3.3). Its
 * terms are those of the project (`project.terms`) and change the way a hand-made project's do
 * (`TermsBlock`). Only a holder of the Bexio-order capability edits the order id (specs/021 AC-3.1).
 *
 * There is no control that detaches a purchase order from its deal, moves it to another project or
 * deletes it (AC-1.10, D38, D39). The referent, the ops-manager and the project-manager pick are T32's.
 * A write tells the page (`onChanged`), which reads the project again; a stale write is the page's (`onStale`).
 */
export default function PurchaseOrderCard({
  project,
  canManage,
  onChanged,
  onStale,
}: {
  project: Project
  canManage: boolean
  onChanged: (message: string) => void
  onStale: () => void
}) {
  const po = project.purchaseOrder
  if (po === null) return null
  const t = strings.purchaseOrder

  return (
    <Card title={t.title} data-testid="project-purchase-order">
      <div className="flex flex-col gap-3">
        {po.deal.won === false && (
          <Banner tone="warning" title={t.card.dealNotWon.title} data-testid="purchase-order-deal-not-won">
            {t.card.dealNotWon.body}
          </Banner>
        )}
        <FactList
          items={[
            {
              id: 'deal',
              term: t.card.deal,
              value: (
                <a href={crmDealHref(po.deal.id)} className="link">
                  {po.deal.title ?? t.card.dealUnavailable}
                </a>
              ),
            },
            // A person without access to the estimate in EstimAI sees EstimAI's own unavailable state (AC-3.2).
            ...(po.estimate
              ? [
                  {
                    id: 'estimate',
                    term: t.card.estimate,
                    value: (
                      <a href={estimaiEstimateHref(po.estimate.id)} className="link">
                        {t.card.openEstimate}
                      </a>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {project.terms && (
          <TermsBlock
            project={project}
            terms={project.terms}
            title={strings.terms.title}
            canManage={canManage}
            onChanged={onChanged}
            onStale={onStale}
          />
        )}
        <BexioOrderField
          projectId={project.id}
          purchaseOrder={po}
          onSaved={() => onChanged(t.saved.bexio)}
          onStale={onStale}
        />
      </div>
    </Card>
  )
}
