import { Link, useParams, useRouterState } from '@tanstack/react-router'
import {
  Banner,
  Button,
  Card,
  FactList,
  Icon,
  PageHeader,
  StatusBadge,
  VisuallyHidden,
  useFocusOnMount,
} from '@operai/ui'
import { useEffect, useRef, useState } from 'react'
import AssetActions from '../components/AssetActions'
import AssetStatusBadge from '../components/AssetStatusBadge'
import CurrencyBadge from '../components/CurrencyBadge'
import EditAssetDialog from '../components/EditAssetDialog'
import EntityBadge from '../components/EntityBadge'
import ErrorBanner from '../components/ErrorBanner'
import GuardrailDialog from '../components/GuardrailDialog'
import HistoryTimeline from '../components/HistoryTimeline'
import InvoiceFilePanel from '../components/InvoiceFilePanel'
import LedgerBlock from '../components/LedgerBlock'
import PermissionDenied from '../components/PermissionDenied'
import SkeletonListRows from '../components/SkeletonListRows'
import { useInventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { ApiError } from '../lib/api'
import { getAsset, updateAsset } from '../lib/assetsApi'
import { formatDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { TO_VERIFY_MEANING } from '../lib/statusMeanings'
import { toInventoryError } from '../lib/types'
import type { AssetView, Identity } from '../lib/types'
import { strings } from '../strings'

/**
 * AssetDetailPage — T2, one asset (T32, specs/20261006-hardware-inventory; design.md
 * § T2, F6, § Accessibility "T2 detail"; AC-1.9, AC-3.6, AC-10.1).
 *
 * The page is a FRAME: it owns the load (and every load failure state), the
 * summary (header, facts, disposal banner), the one polite status line, heading
 * focus, the edit entry ("Edit details" / "Edit invoice details" and "Mark as
 * verified") and four region components — `AssetActions` (T33), `LedgerBlock`
 * (T34), `InvoiceFilePanel` (T35), `HistoryTimeline` (T36) — each in its own file
 * with its final props, so no later task edits this file. A region whose
 * capability is not held is not rendered: the ledger block needs
 * `ledger:manage`; the actions region is rendered for either capability (its
 * callouts are read-only for an accountant) and gates its controls itself.
 * A disposed asset is read-only: no edit entry, no actions region.
 *
 * Regions talk back through three seams: `onChanged(updated | null)` — a fresh
 * `AssetView` replaces the page's asset, `null` reloads it in place without a
 * skeleton; `announce(message)` — the status line; `focusHeading()`. Every
 * change also bumps `revision`, which the history timeline reloads on.
 */

type Outcome = { requestKey: string; ok: true; asset: AssetView } | { requestKey: string; ok: false; error: unknown }

const holderLabel = (holder: Identity | null): string => {
  if (holder === null) return strings.assetDetail.none
  if (holder.status === 'system') return strings.assets.holderSystem
  if (holder.status === 'deleted') return strings.assets.holderDeleted
  return holder.name ?? strings.assets.holderUnknown
}

const orDash = (value: string | null): string => (value === null || value === '' ? strings.assetDetail.none : value)

/** The guardrail copy for a conflict that came from a write. */
const conflictMessage = (kind: 'asset_disposed' | 'not_found'): string =>
  kind === 'asset_disposed' ? strings.errors.asset_disposed : strings.assetDetail.notFound.body

function NotFound() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>()
  const t = strings.assetDetail.notFound
  return (
    <section aria-labelledby="asset-not-found-heading" data-testid="asset-not-found" className="flex flex-col gap-3">
      <PageHeader
        back={
          <Link to="/assets" className="link">
            <Icon name="arrow-left" /> {t.back}
          </Link>
        }
        title={t.heading}
        titleId="asset-not-found-heading"
        headingRef={headingRef}
        focusableHeading
        description={t.body}
        className="mb-0"
      />
    </section>
  )
}

export default function AssetDetailPage() {
  const { id = '' } = useParams({ strict: false }) as { id?: string }
  const locationState = useRouterState({ select: (state) => state.location.state }) as { registeredCount?: unknown }
  const capabilities = useInventoryCapabilities()

  const [attempt, setAttempt] = useState(0)
  const requestKey = `${id}:${attempt}`
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [revision, setRevision] = useState(0)
  const [statusLine, setStatusLine] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [guardrail, setGuardrail] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState(false)

  const headingRef = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef(false)
  /** Arrived from the register page: announce and focus once, after the first load. */
  const announceRegistered = useRef(typeof locationState.registeredCount === 'number')
  /** Orders loads and writes: only the latest outcome is applied. */
  const sequence = useRef(0)
  const alive = useRef(new AbortController())

  useEffect(() => {
    const controller = new AbortController()
    alive.current = controller
    const mine = ++sequence.current
    getAsset(id, { signal: controller.signal }).then(
      (asset) => {
        if (controller.signal.aborted || mine !== sequence.current) return
        setOutcome({ requestKey, ok: true, asset })
        if (announceRegistered.current) {
          announceRegistered.current = false
          pendingFocus.current = true
          setStatusLine(strings.assetDetail.registered)
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && mine === sequence.current) setOutcome({ requestKey, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [id, requestKey])

  // Move focus once the heading exists.
  useEffect(() => {
    if (pendingFocus.current && headingRef.current) {
      pendingFocus.current = false
      headingRef.current.focus()
    }
  })

  const current = outcome?.requestKey === requestKey ? outcome : null
  const asset = current?.ok ? current.asset : null
  const loadError = current !== null && !current.ok ? current.error : null

  /** Applies a fresh asset from a write, discarding any older load still in flight. */
  const apply = (fresh: AssetView) => {
    sequence.current += 1
    setNotice(null)
    setRevision((n) => n + 1)
    setOutcome({ requestKey, ok: true, asset: fresh })
  }

  /** Reloads in place, without a skeleton. A 403/404 replaces the page; any other failure keeps the asset and says so. */
  const reload = () => {
    const mine = ++sequence.current
    setRevision((n) => n + 1)
    getAsset(id, { signal: alive.current.signal }).then(
      (fresh) => {
        if (alive.current.signal.aborted || mine !== sequence.current) return
        setNotice(null)
        setOutcome({ requestKey, ok: true, asset: fresh })
      },
      (error: unknown) => {
        if (alive.current.signal.aborted || mine !== sequence.current) return
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
          setOutcome({ requestKey, ok: false, error })
        } else {
          setNotice(strings.assetDetail.refreshFailed)
        }
      },
    )
  }

  const onChanged = (updated: AssetView | null) => (updated === null ? reload() : apply(updated))
  const announce = (message: string) => setStatusLine(message)
  const focusHeading = () => headingRef.current?.focus()

  const conflict = (kind: 'asset_disposed' | 'not_found') => {
    setEditing(false)
    setGuardrail(conflictMessage(kind))
  }

  const markVerified = async () => {
    if (asset === null || verifying) return
    setVerifying(true)
    setVerifyError(false)
    try {
      apply(await updateAsset(asset.id, { toVerify: false }))
      setStatusLine(strings.assetDetail.verified)
    } catch (error) {
      const known = toInventoryError(error)
      if (known?.code === 'asset_disposed') conflict('asset_disposed')
      else if (error instanceof ApiError && error.status === 404) conflict('not_found')
      else setVerifyError(true)
    } finally {
      setVerifying(false)
    }
  }

  const t = strings.assetDetail

  if (loadError instanceof ApiError && loadError.status === 404) return <NotFound />
  if (loadError instanceof ApiError && loadError.status === 403) return <PermissionDenied />
  if (loadError !== null) {
    const retry = () => setAttempt((n) => n + 1)
    return loadError instanceof ApiError && loadError.status === 503 ? (
      <ErrorBanner variant="authUnavailable" onRetry={retry} />
    ) : (
      <ErrorBanner
        message={loadError instanceof ApiError ? (loadError.detail ?? strings.errors.unknown) : strings.errors.network}
        onRetry={retry}
      />
    )
  }
  if (asset === null) {
    return (
      <div data-testid="inventory-asset-detail-page">
        <VisuallyHidden live role="status" data-testid="asset-loading">
          {t.loading}
        </VisuallyHidden>
        <SkeletonListRows />
      </div>
    )
  }

  const disposed = asset.status === 'disposed'
  const canEdit = !disposed && (capabilities.canManageAssets || capabilities.canManageLedger)

  return (
    <section aria-labelledby="asset-heading" data-testid="inventory-asset-detail-page" className="flex flex-col gap-5">
      <header data-testid="asset-header" className="flex flex-col gap-3">
        <PageHeader
          className="mb-0"
          back={
            <Link to="/assets" className="link">
              <Icon name="arrow-left" /> {t.backToAssets}
            </Link>
          }
          title={asset.description}
          titleId="asset-heading"
          status={<AssetStatusBadge status={asset.status} />}
          headingRef={headingRef}
          focusableHeading
          actions={
            canEdit && (
              <Button onClick={() => setEditing(true)} variant="secondary">
                {capabilities.canManageAssets ? t.editAction : t.editInvoiceAction}
              </Button>
            )
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <EntityBadge entity={asset.entity} />
          <CurrencyBadge currency={asset.currency} />
          {asset.toVerify && (
            <StatusBadge status={TO_VERIFY_MEANING} data-testid="to-verify-chip">
              {t.toVerify.chip}
            </StatusBadge>
          )}
        </div>
        {asset.toVerify && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-soft">
            <span>{t.toVerify.hint}</span>
            {capabilities.canManageAssets && !disposed && (
              <Button
                type="button"
                onClick={() => void markVerified()}
                disabled={verifying}
                aria-busy={verifying || undefined}
                variant="secondary"
                size="sm"
              >
                {verifying ? t.toVerify.acting : t.toVerify.action}
              </Button>
            )}
            {verifyError && (
              <span className="text-red-text" role="alert" data-testid="to-verify-error">
                {t.toVerify.failed}
              </span>
            )}
          </div>
        )}
      </header>

      <VisuallyHidden live role="status" data-testid="asset-status">
        {statusLine}
      </VisuallyHidden>

      {notice !== null && (
        <Banner tone="warning" data-testid="asset-notice">
          {notice}
        </Banner>
      )}

      {disposed && asset.disposal !== null && (
        <Banner
          tone="info"
          data-testid="asset-disposed-banner"
          title={t.disposed.banner(formatDate(asset.disposal.disposedOn))}
        >
          {t.disposed.reason(strings.disposalReasons[asset.disposal.reason])}
        </Banner>
      )}

      {!disposed && (
        <AssetActions
          asset={asset}
          capabilities={capabilities}
          onChanged={onChanged}
          announce={announce}
          focusHeading={focusHeading}
        />
      )}

      <Card title={t.facts.heading} data-testid="asset-facts">
        <FactList
          items={[
            { id: 'category', term: t.facts.category, value: strings.categories[asset.category] },
            { id: 'serial', term: t.facts.serial, value: orDash(asset.serialNumber) },
            { id: 'purchaseDate', term: t.facts.purchaseDate, value: formatDate(asset.purchaseDate) },
            {
              id: 'purchasePrice',
              term: t.facts.purchasePrice,
              value: formatMoney(asset.purchasePriceCents, asset.currency),
            },
            { id: 'holder', term: t.facts.holder, value: holderLabel(asset.holder) },
            { id: 'location', term: t.facts.location, value: orDash(asset.locationNote) },
            { id: 'supplier', term: t.facts.supplier, value: orDash(asset.supplier) },
          ]}
        />
      </Card>

      <InvoiceFilePanel
        asset={asset}
        capabilities={capabilities}
        onChanged={onChanged}
        announce={announce}
        focusHeading={focusHeading}
      />

      {capabilities.canManageLedger && (
        <LedgerBlock
          asset={asset}
          capabilities={capabilities}
          onChanged={onChanged}
          announce={announce}
          focusHeading={focusHeading}
        />
      )}

      <HistoryTimeline asset={asset} capabilities={capabilities} revision={revision} />

      {editing && (
        <EditAssetDialog
          asset={asset}
          capabilities={capabilities}
          onSaved={(saved) => {
            setEditing(false)
            apply(saved)
            setStatusLine(t.saved)
          }}
          onCancel={() => setEditing(false)}
          onConflict={conflict}
        />
      )}

      {guardrail !== null && (
        <GuardrailDialog
          title={t.conflictTitle}
          message={guardrail}
          onAcknowledge={() => {
            setGuardrail(null)
            reload()
          }}
        />
      )}
    </section>
  )
}
