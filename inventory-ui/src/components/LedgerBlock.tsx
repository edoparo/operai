import { useId, useState } from 'react'
import { Button, Card, FactList } from '@operai/ui'
import DisposeDialog from './DisposeDialog'
import GuardrailDialog from './GuardrailDialog'
import ScheduleTable from './ScheduleTable'
import type { InventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { AssetView, Identity } from '../lib/types'
import { strings } from '../strings'

/**
 * LedgerBlock — the accountant's region of the asset detail page (T34, specs/
 * 015-hardware-inventory; design.md § T2 ledger region, F9, F10, § Accessibility
 * "T2 detail"; AC-5.8, AC-7.1, AC-7.3, AC-7.4, AC-7.5). Its props are fixed by
 * T32; the page renders it only for `ledger:manage`, and it renders NOTHING
 * (not an empty block) when the server sent no `ledger`.
 *
 * Shows the book value today, the rule in force with its effective date, the
 * schedule per year (`ScheduleTable`), the disposal once there is one — with the
 * sale price, which is shown nowhere else — and "Dispose..." inside the block,
 * so accounting controls are reached only under this heading. Dispose is absent
 * for a disposed asset and `aria-disabled` (focusable, reason in
 * `aria-describedby`, activation a no-op) while an assignment is pending
 * (AC-7.5). Every figure is the server's; this component formats, never computes.
 *
 * Disposal success hands the disposed asset to the page, announces it and moves
 * focus to the page heading (the button is gone). `asset_disposed` is explained
 * in a guardrail and reloads once acknowledged; a 404 reloads at once.
 */

export type LedgerBlockProps = {
  asset: AssetView
  capabilities: InventoryCapabilities
  onChanged: (updated: AssetView | null) => void
  announce: (message: string) => void
  focusHeading: () => void
}

const identityLabel = (identity: Identity): string => {
  if (identity.status === 'system') return strings.assets.holderSystem
  if (identity.status === 'deleted') return strings.assets.holderDeleted
  return identity.name ?? strings.assets.holderUnknown
}

export default function LedgerBlock({ asset, capabilities, onChanged, announce, focusHeading }: LedgerBlockProps) {
  const t = strings.ledger
  const baseId = useId()
  const [disposing, setDisposing] = useState(false)
  const [guardrail, setGuardrail] = useState(false)

  const { ledger } = asset
  if (!capabilities.canManageLedger || ledger === undefined) return null

  const reasonId = `${baseId}-dispose-reason`
  const pending = asset.pendingAssignment
  const blocked = pending !== null
  const money = (cents: number) => formatMoney(cents, asset.currency)
  const { rule } = ledger

  const ruleText = t.ruleApplied(
    rule.usefulLifeYears,
    t.firstYearShare[rule.firstYearShare],
    rule.lowValueThresholdCents === null ? t.noThreshold : t.threshold(money(rule.lowValueThresholdCents)),
    money(rule.residualCents),
  )

  const conflict = (kind: 'asset_disposed' | 'not_found' | 'assignment_pending') => {
    if (kind === 'assignment_pending') return onChanged(null)
    setDisposing(false)
    if (kind === 'asset_disposed') setGuardrail(true)
    else onChanged(null)
  }

  return (
    <Card title={t.heading} data-testid="ledger-block">
      <p data-testid="ledger-book-value" className="flex flex-col text-sm">
        <span className="text-xs text-soft">{t.bookValue}</span>
        <span className="text-lg font-semibold font-mono text-text">{money(ledger.bookValueCents)}</span>
      </p>

      <div data-testid="ledger-rule" className="flex flex-col gap-0.5 text-sm text-text">
        <p>{ruleText}</p>
        <p className="text-xs text-soft">{t.ruleEffective(formatDate(rule.effectiveFrom))}</p>
      </div>

      <ScheduleTable ledger={ledger} currency={asset.currency} disposal={asset.disposal} />

      {asset.disposal !== null && (
        <FactList
          testId="ledger-disposal"
          items={[
            { id: 'date', term: t.disposal.date, value: formatDate(asset.disposal.disposedOn) },
            { id: 'reason', term: t.disposal.reason, value: strings.disposalReasons[asset.disposal.reason] },
            ...(asset.disposal.salePriceCents !== null
              ? [{ id: 'salePrice', term: t.disposal.salePrice, value: money(asset.disposal.salePriceCents) }]
              : []),
          ]}
        />
      )}

      {asset.status !== 'disposed' && (
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            onClick={() => {
              if (!blocked) setDisposing(true)
            }}
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? reasonId : undefined}
            variant="danger"
          >
            {t.dispose.action}
          </Button>
          {blocked && (
            <p id={reasonId} className="text-xs text-soft">
              {t.dispose.pendingReason(identityLabel(pending.assignee))}
            </p>
          )}
        </div>
      )}

      {disposing && (
        <DisposeDialog
          asset={asset}
          onDisposed={(updated) => {
            setDisposing(false)
            onChanged(updated)
            announce(t.dispose.done)
            focusHeading()
          }}
          onCancel={() => setDisposing(false)}
          onConflict={conflict}
        />
      )}

      {guardrail && (
        <GuardrailDialog
          title={t.dispose.conflictTitle}
          message={strings.errors.asset_disposed}
          onAcknowledge={() => {
            setGuardrail(false)
            onChanged(null)
          }}
        />
      )}
    </Card>
  )
}
