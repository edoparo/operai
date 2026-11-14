import { useRef, useState } from 'react'
import { DateInput, Field, FormDialog, MoneyInput, focusFirstInvalid, parseDecimal } from '@operai/ui'
import { ApiError, isStaleWrite } from '../lib/api'
import { createDeal, updateDeal } from '../lib/crmApi'
import type { DealUpdate } from '../lib/crmApi'
import { errorMessage, fieldErrorOf } from '../lib/errors'
import { centsToInput } from '../lib/money'
import { personName } from '../lib/people'
import { CURRENCIES, NEW_DEAL_STAGES } from '../lib/types'
import type { CompanyRef, Currency, Deal, DealStage, Entity, LeadSource } from '../lib/types'
import { first, hasErrors, maxLength, optional, required } from '../lib/validate'
import type { Errors } from '../lib/validate'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { strings } from '../strings'
import CompanyPicker from './CompanyPicker'
import type { CompanyChoice } from './CompanyPicker'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'
import SourceFields from './SourceFields'
import { MAX_SOURCE_DETAIL, sourceInput } from '../lib/source'

type FieldName =
  | 'companyId'
  | 'title'
  | 'amount'
  | 'currency'
  | 'stage'
  | 'entity'
  | 'expected'
  | 'owner'
  | 'notes'
  | 'sourceDetail'

type Draft = {
  title: string
  amount: string
  currency: Currency | ''
  stage: DealStage
  entity: Entity | ''
  expected: string
  notes: string
  source: LeadSource | ''
  sourceDetail: string
}

const SERVER_FIELDS: Record<string, FieldName> = {
  companyId: 'companyId',
  title: 'title',
  amountCents: 'amount',
  currency: 'currency',
  stage: 'stage',
  entity: 'entity',
  expectedCloseDate: 'expected',
  ownerUserId: 'owner',
  notes: 'notes',
  sourceDetail: 'sourceDetail',
}

const CODE_FIELDS: Record<string, FieldName> = {
  company_not_found: 'companyId',
  company_archived: 'companyId',
  stage_not_open: 'stage',
  owner_not_active: 'owner',
  owner_not_crm_user: 'owner',
  stage_requires_estimate: 'stage',
  out_of_scope: 'entity',
}

/**
 * DealFormDialog — create a deal (optionally at a fixed company) or edit one.
 * The stage is chosen at creation only, among lead and qualified (specs/20261101-crm-sales-flow AC-3.4: later stages need a ready estimate); later
 * moves go through MoveStageDialog. The entity is limited to the entities the
 * caller manages deals for (`GET /scope`); it defaults to the company's when
 * that is in scope. The owner picker appears when editing.
 */
export default function DealFormDialog({
  deal,
  company,
  onSaved,
  onCancel,
  onStale,
}: {
  deal?: Deal
  company?: CompanyRef & { entity?: Entity; source?: LeadSource | null; sourceDetail?: string | null }
  onSaved: (deal: Deal) => void
  onCancel: () => void
  onStale: () => void
}) {
  const t = strings.deals.form
  const { dealEntities, financials } = useCrmCapabilities()
  /** Editing a deal without deal:financials: the money fields are not there and are never sent. */
  const hideMoney = deal !== undefined && !financials
  const defaultEntity = (entity: Entity | undefined): Entity | '' =>
    entity && dealEntities.includes(entity) ? entity : dealEntities.length === 1 ? dealEntities[0]! : ''
  const [chosen, setChosen] = useState<CompanyChoice | null>(company ?? null)
  const [draft, setDraft] = useState<Draft>(() => ({
    title: deal?.title ?? '',
    amount: deal?.amountCents != null ? centsToInput(deal.amountCents) : '',
    currency: deal?.currency ?? (company?.entity === 'welld_it' ? 'EUR' : company?.entity === 'welld_ch' ? 'CHF' : ''),
    stage: 'lead',
    entity: deal?.entity ?? defaultEntity(company?.entity),
    expected: deal?.expectedCloseDate ?? '',
    notes: deal?.notes ?? '',
    // A new lead starts from the company's source (specs/20261101-crm US-7); it can differ.
    source: deal ? (deal.source ?? '') : (company?.source ?? ''),
    sourceDetail: deal ? (deal.sourceDetail ?? '') : (company?.sourceDetail ?? ''),
  }))
  const [owner, setOwner] = useState<PersonChoice | null>(
    deal ? { id: deal.owner.id, label: personName(deal.owner) } : null,
  )
  const [errors, setErrors] = useState<Errors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const chooseCompany = (next: CompanyChoice | null) => {
    setChosen(next)
    if (next?.entity && draft.entity === '') set('entity', defaultEntity(next.entity))
    if (next?.source && draft.source === '') {
      setDraft((current) => ({ ...current, source: next.source ?? '', sourceDetail: next.sourceDetail ?? '' }))
    }
  }

  const submit = () => {
    // Optional (specs/20261101-crm AC-3.2): empty is "not known yet"; anything typed must parse.
    const amountEmpty = draft.amount.trim() === ''
    const amountCents = amountEmpty ? null : parseDecimal(draft.amount)
    const amountInvalid = !hideMoney && !amountEmpty && amountCents === null
    const found: Errors<FieldName> = {
      companyId: !deal && chosen === null ? t.companyRequired : undefined,
      title: first(required(draft.title), maxLength(draft.title, 200)) ?? undefined,
      amount: amountInvalid ? strings.common.validation.amount : undefined,
      currency: hideMoney || draft.currency !== '' ? undefined : strings.common.validation.required,
      entity: draft.entity === '' ? strings.common.validation.required : undefined,
      notes: maxLength(draft.notes, 10_000) ?? undefined,
      sourceDetail: maxLength(draft.sourceDetail, MAX_SOURCE_DETAIL) ?? undefined,
    }
    setErrors(found)
    if (hasErrors(found)) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const common: DealUpdate = {
      title: draft.title.trim(),
      ...(hideMoney ? {} : { amountCents, currency: draft.currency as Currency, notes: optional(draft.notes) }),
      entity: draft.entity as Entity,
      ...sourceInput(draft.source, draft.sourceDetail),
      expectedCloseDate: draft.expected === '' ? null : draft.expected,
      ...(owner !== null && owner.id !== deal?.owner.id ? { ownerUserId: owner.id } : {}),
    }
    setBusy(true)
    setError(null)
    const request = deal
      ? updateDeal(deal.id, deal.version, common)
      : createDeal({
          ...common,
          companyId: chosen!.id,
          title: common.title!,
          amountCents,
          currency: common.currency!,
          stage: draft.stage,
        })
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      if (isStaleWrite(failure)) return onStale()
      const byCode = failure instanceof ApiError && failure.code ? CODE_FIELDS[failure.code] : undefined
      if (byCode && failure instanceof ApiError) {
        setErrors({ [byCode]: failure.detail ?? strings.common.validation.fixErrors })
        return
      }
      const field = fieldErrorOf(failure)
      const mapped = field ? SERVER_FIELDS[field.field] : undefined
      if (field && mapped) {
        setErrors({ [mapped]: field.message })
        return
      }
      setError(errorMessage(failure))
    })
  }

  return (
    <FormDialog
      title={deal ? t.editTitle : t.createTitle}
      submitLabel={deal ? strings.common.save : t.create}
      busyLabel={deal ? strings.common.saving : t.creating}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="crm-deal-form"
    >
      <div ref={fieldsRef} className="contents">
        {!deal && !company && (
          <CompanyPicker
            label={t.company}
            hint={t.companyHint}
            value={chosen}
            onChange={chooseCompany}
            error={errors.companyId}
            required
            testId="crm-deal-form-company"
          />
        )}
        {!deal && company && errors.companyId && (
          <p role="alert" className="form-error">
            {errors.companyId}
          </p>
        )}
        <Field label={t.title} required error={errors.title} testId="crm-deal-form-title">
          {(control) => (
            <input {...control} value={draft.title} onChange={(event) => set('title', event.target.value)} />
          )}
        </Field>
        {!hideMoney && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t.amount} hint={t.amountHint} error={errors.amount} testId="crm-deal-form-amount">
            {(control) => (
              <MoneyInput {...control} value={draft.amount} onChange={(event) => set('amount', event.target.value)} />
            )}
          </Field>
          <Field label={t.currency} required error={errors.currency} testId="crm-deal-form-currency">
            {(control) => (
              <select
                {...control}
                value={draft.currency}
                onChange={(event) => set('currency', event.target.value as Currency | '')}
              >
                <option value="">{strings.common.choose}</option>
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        )}
        {!deal && (
          <Field label={t.stage} error={errors.stage} testId="crm-deal-form-stage">
            {(control) => (
              <select
                {...control}
                value={draft.stage}
                onChange={(event) => set('stage', event.target.value as DealStage)}
              >
                {NEW_DEAL_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {strings.badges.dealStage[stage]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field
          label={t.entity}
          hint={t.entityHint}
          required
          error={errors.entity ?? (dealEntities.length === 0 ? t.noScope : undefined)}
          testId="crm-deal-form-entity"
        >
          {(control) => (
            <select
              {...control}
              value={draft.entity}
              onChange={(event) => set('entity', event.target.value as Entity | '')}
            >
              <option value="">{strings.common.choose}</option>
              {dealEntities.map((entity) => (
                <option key={entity} value={entity}>
                  {strings.badges.entity[entity]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t.expected} error={errors.expected} testId="crm-deal-form-expected">
          {(control) => (
            <DateInput {...control} value={draft.expected} onChange={(event) => set('expected', event.target.value)} />
          )}
        </Field>
        {deal && (
          <PersonPicker
            appId="crm"
            label={t.owner}
            value={owner}
            onChange={setOwner}
            error={errors.owner}
            testId="crm-deal-form-owner"
          />
        )}
        <SourceFields
          source={draft.source}
          detail={draft.sourceDetail}
          onSource={(next) => set('source', next)}
          onDetail={(next) => set('sourceDetail', next)}
          detailError={errors.sourceDetail}
          testIdPrefix="crm-deal-form"
        />
        {!hideMoney && (
          <Field label={t.notes} error={errors.notes} testId="crm-deal-form-notes">
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={draft.notes}
                onChange={(event) => set('notes', event.target.value)}
              />
            )}
          </Field>
        )}
      </div>
    </FormDialog>
  )
}
