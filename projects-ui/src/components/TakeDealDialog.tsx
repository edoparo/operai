import { useRef, useState } from 'react'
import { Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { useSession } from 'shell/session'
import { ApiError } from '../lib/api'
import { emptyTermsForm } from '../lib/contractTerms'
import type { TermsErrors, TermsForm } from '../lib/contractTerms'
import { dealContractOf } from '../lib/dealContract'
import { CLIENT_TYPES } from '../lib/domain'
import { errorMessage, fieldErrorOf, takeRefusalOf } from '../lib/errors'
import { takeDealAsProject } from '../lib/projectsApi'
import type { TakeDealAsProjectInput } from '../lib/projectsApi'
import type { DealProjectType, Project, QueueItem } from '../lib/types'
import { first, maxLength, required } from '../lib/validate'
import { strings } from '../strings'
import { ContractDateFields } from './ContractTermsFields'
import ContractTermsFields from './ContractTermsFields'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'

/** The input a server refusal names, by the member name projects-api puts in `field` (the contract's are `contract.…`). */
const topLevelField = (field: string): string | null => {
  if (field === 'name') return 'name'
  if (field === 'type') return 'type'
  if (field === 'projectManagerId') return 'projectManager'
  const contractField = field.startsWith('contract.') ? field.slice('contract.'.length) : null
  return contractField === 'startDate' || contractField === 'endDate' || contractField?.startsWith('terms')
    ? contractField
    : null
}

/** Refusals after which the deal can no longer be taken: the page reloads the queue behind the dialog. */
const GONE = ['deal_not_found', 'deal_not_won', 'deal_taken'] as const

/**
 * TakeDealDialog — "New project" from a queued deal (AC-1.2, AC-1.3): the name
 * (prefilled from the deal's title, editable), a client type (time and material,
 * fixed price or maintenance — `saas` and `internal` have no company, so never
 * come from a deal), the project manager (the caller by default) and, in the same
 * step, the contract's start and end date and the terms of the type, because a
 * project taken from a deal is born with its one contract. The company and the
 * entity are the deal's and are only shown.
 *
 * A fixed-price contract from a deal with an estimate takes its man-days from the
 * estimate: the field is read-only and the request does not carry the member
 * (AC-3.1). Each refusal of the take has its own message (AC-1.5); one after which
 * the deal cannot be taken any more also tells the page, which reloads the queue
 * while the dialog keeps the message on screen. A take creates, so it has no
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
  const session = useSession()
  const currentUser = session.data?.user
  const estimateBacked = deal.estimate !== null

  const [name, setName] = useState(deal.title)
  const [type, setType] = useState<DealProjectType | ''>('')
  // `undefined` = untouched: the project manager is the caller.
  const [pickedManager, setPickedManager] = useState<PersonChoice | null | undefined>(undefined)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [terms, setTerms] = useState<TermsForm>(() => emptyTermsForm('internal'))
  const [errors, setErrors] = useState<TermsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const callerChoice: PersonChoice | null = currentUser?.id
    ? { id: currentUser.id, label: currentUser.name ?? currentUser.email ?? strings.people.you }
    : null
  const manager = pickedManager === undefined ? callerChoice : pickedManager

  const submit = () => {
    const found: TermsErrors = {}
    const nameError = first(required(name), maxLength(name, 200))
    if (nameError) found['name'] = nameError
    if (type === '') found['type'] = strings.common.validation.required
    if (manager === null) found['projectManager'] = strings.people.picker.pickRequired
    // Until a type is chosen there are no terms to check: the dates still are.
    const contract = dealContractOf(type === '' ? 'internal' : type, { startDate, endDate, terms }, { estimateBacked })
    const all = { ...found, ...contract.errors }
    setErrors(all)
    if (Object.keys(all).length > 0 || type === '' || manager === null) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: TakeDealAsProjectInput = {
      name: name.trim(),
      type,
      ...(manager.id !== currentUser?.id ? { projectManagerId: manager.id } : {}),
      contract: contract.input,
    }
    setBusy(true)
    setError(null)
    takeDealAsProject(deal.dealId, input).then(onTaken, (failure: unknown) => {
      setBusy(false)
      const refusal = takeRefusalOf(failure)
      if (refusal === 'not_project_user') return setErrors({ projectManager: t.errors.not_project_user })
      if (refusal) {
        if ((GONE as readonly string[]).includes(refusal)) onGone()
        return setError(t.errors[refusal])
      }
      if (failure instanceof ApiError && failure.status === 503) {
        return setError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
      }
      const named = fieldErrorOf(failure)
      const field = named ? topLevelField(named.field) : null
      if (named && field) return setErrors({ [field]: named.message })
      setError(errorMessage(failure))
    })
  }

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
        <PersonPicker
          label={strings.projects.form.projectManager}
          hint={strings.projects.form.projectManagerHint}
          value={manager}
          onChange={setPickedManager}
          error={errors['projectManager']}
          required
          forbiddenHint={strings.projects.form.projectManagerReadOnlyHint}
          testId="take-deal-manager"
        />
        <fieldset className="flex flex-col gap-3" data-testid="take-deal-contract">
          <legend className="field-label mb-1">{t.contract.legend}</legend>
          <ContractDateFields
            startDate={startDate}
            endDate={endDate}
            errors={errors}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            testIdPrefix="take-deal"
          />
          {type !== '' && (
            <ContractTermsFields
              type={type}
              terms={terms}
              errors={errors}
              onChange={(patch) => setTerms((current) => ({ ...current, ...patch }))}
              estimatedManDaysReadOnly={estimateBacked ? t.contract.estimatedManDaysFromEstimate : undefined}
              testIdPrefix="take-deal"
            />
          )}
        </fieldset>
      </div>
    </FormDialog>
  )
}
