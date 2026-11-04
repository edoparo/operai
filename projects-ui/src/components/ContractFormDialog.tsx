import { useRef, useState } from 'react'
import { DateInput, Field, FormDialog, focusFirstInvalid, formatNumber } from '@operai/ui'
import { ApiError, isStaleWrite } from '../lib/api'
import { emptyTermsForm, termsFormOf, termsInputOf } from '../lib/contractTerms'
import type { TermsErrors, TermsForm } from '../lib/contractTerms'
import { withoutEstimatedManDays } from '../lib/dealContract'
import { codeOf, errorMessage, fieldErrorOf } from '../lib/errors'
import { createContract, updateContract } from '../lib/projectsApi'
import type { CompanyChoice, CompanyRef, Contract, Project } from '../lib/types'
import { strings } from '../strings'
import CompanyPicker from './CompanyPicker'
import ContractTermsFields from './ContractTermsFields'

type ProjectRef = Pick<Project, 'id' | 'type' | 'company'>

/** Server `code`s that belong to one input, by the input's error key. */
const REFUSAL_FIELD: Record<string, string> = {
  company_mismatch: 'companyId',
  company_required: 'companyId',
  company_not_found: 'companyId',
  maintenance_needs_sla_or_hours: 'terms',
}
/** Server `code`s that are about the dialog as a whole. */
const DIALOG_REFUSALS = [
  'contracts_not_allowed',
  'project_not_open',
  'crm_unavailable',
  'out_of_scope',
  'estimated_man_days_from_estimate',
] as const

const isFieldKey = (field: string): boolean =>
  field === 'startDate' ||
  field === 'endDate' ||
  field === 'companyId' ||
  field === 'terms' ||
  field.startsWith('terms.')

/**
 * ContractFormDialog — add a contract to a project, or edit one (AC-2.1 – AC-2.8).
 * The contract's type is the project's (never chosen), and the fields are that
 * type's: fixed price (deadline, estimated man-days, max effort), maintenance and
 * SaaS (an optional SLA, prefilled 1 / 3, and an optional hour package; a
 * maintenance contract needs one of the two), time and material (1 to 50
 * positions). A client project's company is its own; a SaaS takes any CRM company
 * when the contract is created. No amount, price or rate exists in the form
 * (AC-2.9).
 *
 * Errors are keyed by the server's dotted field names (lib/contractTerms.ts), so
 * a check made here and a 400/422 from the server land on the same input.
 * Editing sends the dates and the whole `terms` with the contract's `version` as
 * If-Match; a stale save closes the dialog and is the page's (`onStale`).
 */
export default function ContractFormDialog({
  project,
  contract,
  onSaved,
  onCancel,
  onStale,
}: {
  project: ProjectRef
  contract?: Contract
  onSaved: (contract: Contract) => void
  onCancel: () => void
  onStale: () => void
}) {
  const t = strings.contracts.form
  const editing = contract !== undefined
  const type = contract?.type ?? project.type
  const initialTerms = contract ? termsFormOf(contract) : emptyTermsForm(type)

  const [startDate, setStartDate] = useState(contract?.startDate ?? '')
  const [endDate, setEndDate] = useState(contract?.endDate ?? '')
  const [company, setCompany] = useState<CompanyChoice | null>(null)
  const [terms, setTerms] = useState<TermsForm>(initialTerms)
  const [errors, setErrors] = useState<TermsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)
  const [initial] = useState(() => JSON.stringify([contract?.startDate ?? '', contract?.endDate ?? '', initialTerms]))

  const dirty = JSON.stringify([startDate, endDate, terms]) !== initial
  // A contract the estimate backs takes its man-days from it: shown read-only, never sent (AC-3.1).
  const estimateBacked = contract?.estimate != null && type === 'fixed_price'
  const lockedManDays =
    contract !== undefined && 'estimatedManDays' in contract.terms && contract.terms.estimatedManDays !== null
      ? strings.contracts.form.estimatedFromEstimate(
          formatNumber(contract.terms.estimatedManDays, { maximumFractionDigits: 1 }),
        )
      : strings.contracts.form.estimatedFromEstimateNone
  const pickCompany = !editing && type === 'saas'
  const ownCompany: CompanyRef | null = contract?.company ?? project.company

  const patchTerms = (patch: Partial<TermsForm>) => setTerms((current) => ({ ...current, ...patch }))

  const validate = (): { errors: TermsErrors; input: ReturnType<typeof termsInputOf>['input'] } => {
    const found: TermsErrors = {}
    if (startDate === '') found['startDate'] = strings.common.validation.required
    if (endDate !== '' && startDate !== '' && endDate < startDate)
      found['endDate'] = strings.contracts.errors.endBeforeStart
    if (pickCompany && company === null) found['companyId'] = t.companyRequired
    const checked = termsInputOf(type, terms)
    return {
      errors: { ...found, ...checked.errors },
      input: estimateBacked ? withoutEstimatedManDays(checked.input) : checked.input,
    }
  }

  const submit = () => {
    const checked = validate()
    setErrors(checked.errors)
    if (Object.keys(checked.errors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    setBusy(true)
    setError(null)
    const request = contract
      ? updateContract(project.id, contract.id, contract.version, {
          startDate,
          endDate: endDate === '' ? null : endDate,
          terms: checked.input,
        })
      : createContract(project.id, {
          ...(pickCompany && company ? { companyId: company.id } : {}),
          startDate,
          ...(endDate !== '' ? { endDate } : {}),
          terms: checked.input,
        })
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      if (isStaleWrite(failure)) return onStale()
      const code = codeOf(failure)
      const known = strings.contracts.errors
      const refusalField = code ? REFUSAL_FIELD[code] : undefined
      if (code && refusalField) return setErrors({ [refusalField]: known[code as keyof typeof known] as string })
      if (code && (DIALOG_REFUSALS as readonly string[]).includes(code)) {
        return setError(known[code as (typeof DIALOG_REFUSALS)[number]])
      }
      if (failure instanceof ApiError && failure.status === 503) {
        return setError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
      }
      const named = fieldErrorOf(failure)
      if (named && isFieldKey(named.field)) return setErrors({ [named.field]: named.message })
      setError(errorMessage(failure))
    })
  }

  const dateField = (
    name: 'startDate' | 'endDate',
    label: string,
    value: string,
    onChange: (value: string) => void,
    hint?: string,
    required = false,
  ) => (
    <Field label={label} hint={hint} required={required} error={errors[name]} testId={`contract-form-${name}`}>
      {(control) => <DateInput {...control} value={value} onChange={(event) => onChange(event.target.value)} />}
    </Field>
  )

  return (
    <FormDialog
      title={editing ? t.editTitle : t.createTitle}
      submitLabel={editing ? t.save : t.create}
      busyLabel={editing ? t.saving : t.creating}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      canSubmit={!editing || dirty}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="contract-form"
    >
      <div ref={fieldsRef} className="contents">
        {pickCompany ? (
          <CompanyPicker
            label={t.company}
            hint={t.companyHint}
            value={company}
            onChange={setCompany}
            error={errors['companyId']}
            required
            testId="contract-form-company"
          />
        ) : (
          <Field label={t.company} hint={editing ? undefined : t.companyOwn} error={errors['companyId']}>
            {(control) => (
              <input {...control} value={ownCompany?.name ?? strings.contracts.card.companyUnavailable} readOnly />
            )}
          </Field>
        )}
        {dateField(
          'startDate',
          t.startDate,
          startDate,
          setStartDate,
          type === 'saas' ? t.saasPeriodHint : undefined,
          true,
        )}
        {dateField('endDate', t.endDate, endDate, setEndDate, t.endDateHint)}

        <ContractTermsFields
          type={type}
          terms={terms}
          errors={errors}
          onChange={patchTerms}
          estimatedManDaysReadOnly={estimateBacked ? lockedManDays : undefined}
          testIdPrefix="contract-form"
        />
      </div>
    </FormDialog>
  )
}
