import { useEffect, useState } from 'react'
import { Button, Card, PageHeader, StatePanel, StatusBadge, VisuallyHidden } from '@operai/ui'
import DataTable from '../components/DataTable'
import EntityBadge from '../components/EntityBadge'
import ErrorBanner from '../components/ErrorBanner'
import NewRuleDialog from '../components/NewRuleDialog'
import PermissionDenied from '../components/PermissionDenied'
import SkeletonListRows from '../components/SkeletonListRows'
import { useInventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { useScope } from '../hooks/useScope'
import { ApiError } from '../lib/api'
import { formatDate, todayIsoDate } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { listRules } from '../lib/rulesApi'
import { RULE_STATE_MEANING } from '../lib/statusMeanings'
import type { RuleState } from '../lib/statusMeanings'
import type { Currency, Entity, Identity, Rule, RulesList } from '../lib/types'
import { strings } from '../strings'

/**
 * RulesPage — T4, `/rules` (T37, specs/015-hardware-inventory; design.md T4, F11,
 * § Accessibility "T4 rules"; AC-6.1, AC-6.2, AC-6.5), modelled on admin-ui's
 * MileageRatesPage: one section per entity of `GET /scope`'s `ledger` list, each a
 * table of EVERY rule (past, in force, scheduled) with who added it and when, and
 * its own "New rule for {entity}" button. A rule is append-only (AC-6.5): there is
 * no edit and no delete control anywhere — a correction is a new rule.
 *
 * `ledger:manage` only (a UX gate; the server's 403 is the real one). Each section
 * loads its own rules, so one entity's failure never hides the other: loading
 * skeleton, `ErrorBanner` + Retry (the 503 variant for an `auth` outage),
 * `PermissionDenied` for a 403, and an empty note. The Status column says "In
 * force" (from `inForceId`, never computed here), "Scheduled" (effective date after
 * today) or "Superseded" — a StatusBadge (label + icon), never colour alone. After a save the
 * section reloads (keeping the old rows on screen meanwhile), the page announces
 * "Rule added. It applies to purchases from {date}." and focus moves to the new
 * row's header cell.
 */

/** AC-1.2: CHF for `welld_ch`, EUR for `welld_it`. Display only. */
const CURRENCY_OF: Record<Entity, Currency> = { welld_ch: 'CHF', welld_it: 'EUR' }

const PAGE_TEST_ID = 'inventory-rules-page'

const identityLabel = (identity: Identity): string => {
  if (identity.status === 'system') return strings.assets.holderSystem
  if (identity.status === 'deleted') return strings.assets.holderDeleted
  return identity.name ?? strings.assets.holderUnknown
}

/** Newest effective date first, so a scheduled rule sits on top; ties by creation time. */
const newestFirst = (a: Rule, b: Rule): number =>
  b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)

type Outcome =
  | { key: string; entity: Entity; ok: true; list: RulesList }
  | { key: string; entity: Entity; ok: false; error: unknown }

function StatusCell({ rule, inForceId, today }: { rule: Rule; inForceId: string; today: string }) {
  const state: RuleState = rule.id === inForceId ? 'inForce' : rule.effectiveFrom > today ? 'scheduled' : 'superseded'
  return <StatusBadge status={RULE_STATE_MEANING[state]}>{strings.rules.status[state]}</StatusBadge>
}

function RulesSection({ entity, announce }: { entity: Entity; announce: (message: string) => void }) {
  const t = strings.rules
  const entityName = strings.common.entity[entity]
  const currency = CURRENCY_OF[entity]
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [adding, setAdding] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const key = `${entity}:${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    listRules(entity, { signal: controller.signal }).then(
      (list) => {
        if (!controller.signal.aborted) setOutcome({ key, entity, ok: true, list })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setOutcome({ key, entity, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [entity, key])

  const current = outcome?.key === key ? outcome : null
  const shown = current ?? (outcome?.entity === entity && outcome.ok ? outcome : null)
  const retry = () => setAttempt((previous) => previous + 1)

  let content
  if (current !== null && !current.ok) {
    const { error } = current
    if (error instanceof ApiError && error.status === 403) content = <PermissionDenied />
    else if (error instanceof ApiError && error.status === 503) {
      content = <ErrorBanner variant="authUnavailable" onRetry={retry} retryLabel={t.retry} />
    } else {
      content = (
        <ErrorBanner
          message={error instanceof ApiError ? (error.detail ?? strings.errors.unknown) : strings.errors.network}
          onRetry={retry}
          retryLabel={t.retry}
        />
      )
    }
  } else if (shown === null || !shown.ok) {
    content = (
      <div className="flex flex-col gap-2">
        <VisuallyHidden live role="status">
          {t.sectionLoading(entityName)}
        </VisuallyHidden>
        <SkeletonListRows />
      </div>
    )
  } else if (shown.list.rules.length === 0) {
    content = <StatePanel title={t.empty(entityName)} />
  } else {
    const { rules, inForceId } = shown.list
    const today = todayIsoDate()
    const money = (cents: number) => formatMoney(cents, currency)
    const ordered = [...rules].sort(newestFirst)
    content = (
      <DataTable
        caption={t.caption(entityName)}
        columns={[
          {
            id: 'effectiveFrom',
            header: t.columns.effectiveFrom,
            rowHeader: true,
            render: (r) => formatDate(r.effectiveFrom),
          },
          { id: 'usefulLife', header: t.columns.usefulLife, numeric: true, render: (r) => r.usefulLifeYears },
          { id: 'firstYearShare', header: t.columns.firstYearShare, render: (r) => t.firstYearShare[r.firstYearShare] },
          {
            id: 'threshold',
            header: t.columns.threshold,
            numeric: true,
            render: (r) => (r.lowValueThresholdCents === null ? t.noThreshold : money(r.lowValueThresholdCents)),
          },
          { id: 'residual', header: t.columns.residual, numeric: true, render: (r) => money(r.residualCents) },
          { id: 'addedBy', header: t.columns.addedBy, render: (r) => identityLabel(r.createdBy) },
          { id: 'addedOn', header: t.columns.addedOn, render: (r) => formatDate(r.createdAt) },
          {
            id: 'status',
            header: t.columns.status,
            render: (r) => <StatusCell rule={r} inForceId={inForceId} today={today} />,
          },
        ]}
        rows={ordered}
        getRowKey={(r) => r.id}
        focusRowKey={focusId !== null && rules.some((r) => r.id === focusId) ? focusId : null}
        testId={`rules-table-${entity}`}
      />
    )
  }

  const inForceRule =
    shown !== null && shown.ok ? (shown.list.rules.find((r) => r.id === shown.list.inForceId) ?? null) : null

  return (
    <Card
      data-testid={`rules-section-${entity}`}
      title={
        <span className="flex items-center gap-2">
          {t.sectionHeading(entityName)}
          <EntityBadge entity={entity} />
        </span>
      }
      action={
        shown !== null &&
        shown.ok && (
          <Button onClick={() => setAdding(true)} variant="secondary" size="sm">
            {t.newRule(entityName)}
          </Button>
        )
      }
    >
      {content}

      {adding && (
        <NewRuleDialog
          entity={entity}
          inForceRule={inForceRule}
          onCancel={() => setAdding(false)}
          onSaved={(saved) => {
            setAdding(false)
            setFocusId(saved.id)
            retry()
            announce(t.added(formatDate(saved.effectiveFrom)))
          }}
        />
      )}
    </Card>
  )
}

export default function RulesPage() {
  const t = strings.rules
  const { canManageLedger } = useInventoryCapabilities()
  const scope = useScope(canManageLedger)
  const [statusLine, setStatusLine] = useState('')

  if (!canManageLedger) {
    return (
      <section data-testid={PAGE_TEST_ID}>
        <PermissionDenied />
      </section>
    )
  }

  let content
  if (scope.status === 'error') {
    const { error } = scope
    content =
      error instanceof ApiError && error.status === 503 ? (
        <ErrorBanner variant="authUnavailable" onRetry={scope.retry} retryLabel={t.retry} />
      ) : (
        <ErrorBanner
          message={error instanceof ApiError ? (error.detail ?? strings.errors.unknown) : strings.errors.network}
          onRetry={scope.retry}
          retryLabel={t.retry}
        />
      )
  } else if (scope.status !== 'ready' || scope.scope === null) {
    content = (
      <div className="flex flex-col gap-2">
        <VisuallyHidden live role="status">
          {t.loading}
        </VisuallyHidden>
        <SkeletonListRows />
      </div>
    )
  } else if (scope.scope.ledger.length === 0) {
    content = <StatePanel title={t.noEntity} />
  } else {
    content = (
      <div className="flex flex-col gap-8">
        {scope.scope.ledger.map((entity) => (
          <RulesSection key={entity} entity={entity} announce={setStatusLine} />
        ))}
      </div>
    )
  }

  return (
    <section data-testid={PAGE_TEST_ID} aria-labelledby="rules-heading" className="flex flex-col gap-4">
      <PageHeader title={t.heading} titleId="rules-heading" className="mb-0" />
      <VisuallyHidden live role="status">
        {statusLine}
      </VisuallyHidden>
      {content}
    </section>
  )
}
