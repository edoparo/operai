import { useCallback, useRef, useState } from 'react'
import { Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { ApiError } from '../lib/api'
import { CLIENT_TYPES } from '../lib/domain'
import { errorMessage, fieldErrorOf, takeRefusalOf } from '../lib/errors'
import { listOpsManagers, takeDealAsProject } from '../lib/projectsApi'
import type { TakeDealAsProjectInput } from '../lib/projectsApi'
import { emptyTermsForm } from '../lib/terms'
import type { TermsErrors, TermsForm } from '../lib/terms'
import { termsFieldKey, termsRequestOf } from '../lib/termsRequest'
import type { DealProjectType, Project, QueueItem } from '../lib/types'
import { first, maxLength, required } from '../lib/validate'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import TermsFields, { TermsDateFields } from './TermsFields'

/** The form input a server refusal names, by the member name projects-api puts in `field`. */
const formFieldOf = (field: string): string | null => {
  if (field === 'name') return 'name'
  if (field === 'type') return 'type'
  if (field === 'opsManagerId') return 'opsManager'
  const key = termsFieldKey(field)
  return key === 'startDate' || key === 'endDate' || key === 'terms' || key.startsWith('terms.') ? key : null
}

/** Refusals after which the deal can no longer be taken: the page reloads the queue behind the dialog. */
const GONE = ['deal_not_found', 'deal_not_won', 'deal_taken'] as const

/**
 * TakeDealDialog — "New project" from a queued deal (specs/022 AC-1.2, AC-1.3, AC-4.1): the name
 * (prefilled from the deal's title, editable), a client type (time and material, fixed price,
 * maintenance or SaaS — `internal` has no company and no PO, so never comes from a deal), the
 * ops-manager that receives the purchase order and, in the same step, the PO's start and end date and
 * the terms of the type, because a project taken from a deal is born with its PO and its terms. There
 * is no project manager to choose: the ops-manager picks one afterwards (D42). The company and the
 * entity are the deal's and are only shown.
 *
 * The ops-manager is chosen among the candidates `GET /queue/{dealId}/ops-managers` lists — the role's
 * holders for the entity, then the admins, marked "All entities" — and the only holder is prefilled
 * (AC-4.1). T31 turns this select into its own picker and adds the referent.
 *
 * Fixed-price terms from a deal with an estimate take their man-days from the estimate: the field is
 * read-only and the request does not carry the member (AC-3.1). Each refusal of the take has its own
 * message (AC-1.11, AC-4.2); one after which the deal cannot be taken any more also tells the page,
 * which reloads the queue while the dialog keeps the message on screen. A take creates, so it has no
 * `If-Match` and cannot be stale.
 */
export default function TakeDealDialog({
  deal,
  onTaken,
  onCancel,
  onGone,
}: {
  deal: QueueItem
  onTaken: (project: Project) => void
  onCancel: () => void
  /** The deal can no longer be taken (reopened, already taken, deleted): reload the queue. */
  onGone: () => void
}) {
  const t = strings.queue.take
  const estimateBacked = deal.estimate !== null
  const loadOpsManagers = useCallback((signal: AbortSignal) => listOpsManagers(deal.dealId, { signal }), [deal.dealId])
  const opsManagers = useResource(loadOpsManagers)

  const [name, setName] = useState(deal.title)
  const [type, setType] = useState<DealProjectType | ''>('')
  // `undefined` = untouched: the prefill (the only role holder), if any.
  const [pickedOps, setPickedOps] = useState<string | undefined>(undefined)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [terms, setTerms] = useState<TermsForm>(() => emptyTermsForm('internal'))
  const [errors, setErrors] = useState<TermsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const opsManagerId = pickedOps ?? opsManagers.data?.prefillId ?? ''

  const submit = () => {
    const found: TermsErrors = {}
    const nameError = first(required(name), maxLength(name, 200))
    if (nameError) found['name'] = nameError
    if (type === '') found['type'] = strings.common.validation.required
    if (opsManagerId === '') found['opsManager'] = t.opsManager.required
    // Until a type is chosen there are no terms to check: the dates still are.
    const request = termsRequestOf(type === '' ? 'internal' : type, { startDate, endDate, terms }, { estimateBacked })
    const all = { ...found, ...request.errors }
    setErrors(all)
    if (Object.keys(all).length > 0 || type === '') {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: TakeDealAsProjectInput = { name: name.trim(), type, terms: request.input, opsManagerId }
    setBusy(true)
    setError(null)
    takeDealAsProject(deal.dealId, input).then(onTaken, (failure: unknown) => {
      setBusy(false)
      // Words of our own for every known refusal; never the server's detail (a referent refusal says one thing whatever the reason).
      const refusal = takeRefusalOf(failure)
      if (refusal) {
        if ((GONE as readonly string[]).includes(refusal)) onGone()
        return setError(t.errors[refusal])
      }
      if (failure instanceof ApiError && failure.status === 503) {
        return setError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
      }
      const named = fieldErrorOf(failure)
      const field = named ? formFieldOf(named.field) : null
      if (named && field) return setErrors({ [field]: named.message })
      setError(errorMessage(failure))
    })
  }

  const opsManagersFailure = opsManagers.status === 'error' ? opsManagers.error : null
  const opsManagersRefusal = opsManagersFailure ? takeRefusalOf(opsManagersFailure) : null

  return (
    <FormDialog
      title={t.project.title}
      description={t.project.description(
        deal.company.name ?? strings.queue.companyUnavailable,
        strings.badges.entity[deal.entity],
      )}
      submitLabel={t.project.submit}
      busyLabel={t.project.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="take-deal"
    >
      <div ref={fieldsRef} className="contents">
        <Field label={strings.projects.form.name} required error={errors['name']} testId="take-deal-name">
          {(control) => <input {...control} value={name} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field
          label={strings.projects.form.type}
          hint={t.project.typeHint}
          required
          error={errors['type']}
          testId="take-deal-type"
        >
          {(control) => (
            <select
              {...control}
              value={type}
              onChange={(event) => {
                const next = event.target.value as DealProjectType | ''
                setType(next)
                setTerms(emptyTermsForm(next === '' ? 'internal' : next))
              }}
            >
              <option value="">{strings.common.choose}</option>
              {CLIENT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {strings.badges.projectType[option]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t.opsManager.label}
          hint={t.opsManager.hint}
          required
          error={errors['opsManager']}
          testId="take-deal-opsmanager"
        >
          {(control) => (
            <select {...control} value={opsManagerId} onChange={(event) => setPickedOps(event.target.value)}>
              <option value="">
                {opsManagers.status === 'loading' ? t.opsManager.loading : strings.common.choose}
              </option>
              {(opsManagers.data?.items ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name ?? strings.people.picker.noName}
                  {candidate.admin ? ` — ${t.opsManager.allEntities}` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        {opsManagersFailure !== null && (
          <p className="text-sm text-danger" role="alert" data-testid="take-deal-opsmanagers-error">
            {opsManagersRefusal ? t.errors[opsManagersRefusal] : errorMessage(opsManagersFailure)}
          </p>
        )}
        <fieldset className="flex flex-col gap-3" data-testid="take-deal-terms">
          <legend className="field-label mb-1">{t.terms.legend}</legend>
          <TermsDateFields
            startDate={startDate}
            endDate={endDate}
            errors={errors}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            testIdPrefix="take-deal"
          />
          {type !== '' && (
            <TermsFields
              type={type}
              terms={terms}
              errors={errors}
              onChange={(patch) => setTerms((current) => ({ ...current, ...patch }))}
              estimatedManDaysReadOnly={estimateBacked ? t.terms.estimatedManDaysFromEstimate : undefined}
              testIdPrefix="take-deal"
            />
          )}
        </fieldset>
      </div>
    </FormDialog>
  )
}
