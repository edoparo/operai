import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { ApiError, isStaleWrite } from '../lib/api'
import { createCompany, updateCompany } from '../lib/crmApi'
import type { CompanyInput } from '../lib/crmApi'
import { errorMessage, fieldErrorOf } from '../lib/errors'
import { personName } from '../lib/people'
import { COMPANY_STATUSES, ENTITIES } from '../lib/types'
import type { Company, CompanyStatus, Entity, LeadSource } from '../lib/types'
import { country, first, hasErrors, maxLength, optional, required, url } from '../lib/validate'
import type { Errors } from '../lib/validate'
import { strings } from '../strings'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'
import SourceFields from './SourceFields'
import { MAX_SOURCE_DETAIL, sourceInput } from '../lib/source'

type FieldName =
  | 'name'
  | 'status'
  | 'entity'
  | 'website'
  | 'industry'
  | 'city'
  | 'country'
  | 'notes'
  | 'owner'
  | 'legalName'
  | 'street'
  | 'postalCode'
  | 'sourceDetail'

type Draft = {
  name: string
  status: CompanyStatus | ''
  entity: Entity | ''
  website: string
  industry: string
  city: string
  country: string
  notes: string
  legalName: string
  street: string
  postalCode: string
  source: LeadSource | ''
  sourceDetail: string
}

const fromCompany = (company: Company | undefined): Draft => ({
  name: company?.name ?? '',
  status: company?.status ?? '',
  entity: company?.entity ?? '',
  website: company?.website ?? '',
  industry: company?.industry ?? '',
  city: company?.city ?? '',
  country: company?.country ?? '',
  notes: company?.notes ?? '',
  legalName: company?.legalName ?? '',
  street: company?.street ?? '',
  postalCode: company?.postalCode ?? '',
  source: company?.source ?? '',
  sourceDetail: company?.sourceDetail ?? '',
})

const validate = (draft: Draft): Errors<FieldName> => ({
  name: first(required(draft.name), maxLength(draft.name, 200)) ?? undefined,
  status: (draft.status === '' ? strings.common.validation.required : null) ?? undefined,
  entity: (draft.entity === '' ? strings.common.validation.required : null) ?? undefined,
  website: first(url(draft.website), maxLength(draft.website, 2048)) ?? undefined,
  industry: maxLength(draft.industry, 100) ?? undefined,
  city: maxLength(draft.city, 100) ?? undefined,
  country: country(draft.country) ?? undefined,
  notes: maxLength(draft.notes, 10_000) ?? undefined,
  legalName: maxLength(draft.legalName, 200) ?? undefined,
  street: maxLength(draft.street, 200) ?? undefined,
  postalCode: maxLength(draft.postalCode, 20) ?? undefined,
  sourceDetail: maxLength(draft.sourceDetail, MAX_SOURCE_DETAIL) ?? undefined,
})

/**
 * CompanyFormDialog — create a company, or edit one (`company` given). A
 * `FormDialog size="lg"` (plan.md § UI). The owner picker is offered to
 * directory holders only (PersonPicker); otherwise the owner stays as is (the
 * creator, for a new company).
 *
 * Errors: a 422 naming a field lands on that field; 409 `company_name_taken`
 * on the name, with a link to the existing company (AC-1.4); a stale write
 * (409 `version_conflict` / 428) is handed to the page (`onStale`), which
 * closes the dialog and shows the reload banner; anything else is the dialog's
 * inline alert with every value kept.
 */
export default function CompanyFormDialog({
  company,
  onSaved,
  onCancel,
  onStale,
}: {
  company?: Company
  onSaved: (company: Company) => void
  onCancel: () => void
  onStale: () => void
}) {
  const t = strings.companies.form
  const [draft, setDraft] = useState<Draft>(() => fromCompany(company))
  const [owner, setOwner] = useState<PersonChoice | null>(
    company ? { id: company.owner.id, label: personName(company.owner) } : null,
  )
  const [errors, setErrors] = useState<Errors<FieldName>>({})
  const [takenId, setTakenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  const submit = () => {
    const found = validate(draft)
    setErrors(found)
    setTakenId(null)
    if (hasErrors(found)) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: CompanyInput = {
      name: draft.name.trim(),
      status: draft.status as CompanyStatus,
      entity: draft.entity as Entity,
      website: optional(draft.website),
      industry: optional(draft.industry),
      city: optional(draft.city),
      country: optional(draft.country)?.toUpperCase() ?? null,
      notes: optional(draft.notes),
      legalName: optional(draft.legalName),
      street: optional(draft.street),
      postalCode: optional(draft.postalCode),
      ...sourceInput(draft.source, draft.sourceDetail),
      ...(owner !== null && owner.id !== company?.owner.id ? { ownerUserId: owner.id } : {}),
    }
    setBusy(true)
    setError(null)
    const request = company ? updateCompany(company.id, company.version, input) : createCompany(input)
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      if (isStaleWrite(failure)) return onStale()
      if (failure instanceof ApiError && failure.code === 'company_name_taken') {
        const existing = failure.extras['companyId']
        setTakenId(typeof existing === 'string' ? existing : null)
        setErrors({ name: t.nameTaken })
        return
      }
      if (failure instanceof ApiError && failure.code === 'owner_not_active') {
        setErrors({ owner: failure.detail ?? strings.people.picker.pickRequired })
        return
      }
      const field = fieldErrorOf(failure)
      if (field && field.field in draft) {
        setErrors({ [field.field]: field.message } as Errors<FieldName>)
        return
      }
      setError(errorMessage(failure))
    })
  }

  const text = (
    key: 'website' | 'industry' | 'city' | 'country' | 'legalName' | 'street' | 'postalCode',
    label: string,
    hint?: string,
  ) => (
    <Field label={label} hint={hint} error={errors[key]} testId={`crm-company-form-${key}`}>
      {(control) => <input {...control} value={draft[key]} onChange={(event) => set(key, event.target.value)} />}
    </Field>
  )

  return (
    <FormDialog
      title={company ? t.editTitle : t.createTitle}
      submitLabel={company ? strings.common.save : t.create}
      busyLabel={company ? strings.common.saving : t.creating}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="crm-company-form"
    >
      <div ref={fieldsRef} className="contents">
        <Field
          label={t.name}
          required
          error={
            errors.name && (
              <>
                {errors.name}{' '}
                {takenId && (
                  <Link to="/companies/$id" params={{ id: takenId }} className="link">
                    {t.nameTakenLink}
                  </Link>
                )}
              </>
            )
          }
          testId="crm-company-form-name"
        >
          {(control) => <input {...control} value={draft.name} onChange={(event) => set('name', event.target.value)} />}
        </Field>
        <Field label={t.status} hint={t.statusHint} required error={errors.status} testId="crm-company-form-status">
          {(control) => (
            <select
              {...control}
              value={draft.status}
              onChange={(event) => set('status', event.target.value as CompanyStatus | '')}
            >
              <option value="">{strings.common.choose}</option>
              {COMPANY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {strings.badges.companyStatus[status]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t.entity} hint={t.entityHint} required error={errors.entity} testId="crm-company-form-entity">
          {(control) => (
            <select
              {...control}
              value={draft.entity}
              onChange={(event) => set('entity', event.target.value as Entity | '')}
            >
              <option value="">{strings.common.choose}</option>
              {ENTITIES.map((entity) => (
                <option key={entity} value={entity}>
                  {strings.badges.entity[entity]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <SourceFields
          source={draft.source}
          detail={draft.sourceDetail}
          onSource={(next) => set('source', next)}
          onDetail={(next) => set('sourceDetail', next)}
          detailError={errors.sourceDetail}
          testIdPrefix="crm-company-form"
        />
        {text('website', t.website, t.websiteHint)}
        {text('industry', t.industry)}
        {text('legalName', t.legalName, t.legalNameHint)}
        {text('street', t.street)}
        {text('postalCode', t.postalCode)}
        {text('city', t.city)}
        {text('country', t.country, t.countryHint)}
        {company && (
          <PersonPicker
            appId="crm"
            label={t.owner}
            value={owner}
            onChange={setOwner}
            error={errors.owner}
            testId="crm-company-form-owner"
          />
        )}
        <Field label={t.notes} error={errors.notes} testId="crm-company-form-notes">
          {(control) => (
            <textarea
              {...control}
              rows={4}
              value={draft.notes}
              onChange={(event) => set('notes', event.target.value)}
            />
          )}
        </Field>
      </div>
    </FormDialog>
  )
}
