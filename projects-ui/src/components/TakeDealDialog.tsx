import { useCallback, useRef, useState } from 'react'
import { Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { ApiError } from '../lib/api'
import { CLIENT_TYPES } from '../lib/domain'
import { codeOf, errorMessage, fieldErrorOf, takeRefusalOf } from '../lib/errors'
import { termsErrorKeysChanged, withoutErrors } from '../lib/fieldErrors'
import { listOpsManagers, listQueueContacts, takeDealAsProject } from '../lib/projectsApi'
import type { TakeDealAsProjectInput } from '../lib/projectsApi'
import { emptyTermsForm } from '../lib/terms'
import type { TermsErrors, TermsForm } from '../lib/terms'
import { termsFieldKey, termsRequestOf } from '../lib/termsRequest'
import { isTender } from '../lib/types'
import type { DealProjectType, OpsManagerList, Project, QueueItem } from '../lib/types'
import { first, maxLength, required } from '../lib/validate'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import OpsManagerPicker from './OpsManagerPicker'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'
import ReferentPicker from './ReferentPicker'
import TermsFields, { TermsDateFields } from './TermsFields'

/** The form input a server refusal names, by the member name projects-api puts in `field`. */
const formFieldOf = (field: string): string | null => {
  if (field === 'name') return 'name'
  if (field === 'type') return 'type'
  if (field === 'opsManagerId') return 'opsManager'
  if (field === 'referentContactId') return 'referent'
  if (field === 'projectManagerId') return 'projectManager'
  // A take wraps the terms input under `terms` (`terms.startDate`, `terms.terms.deadline`).
  return termsFieldKey(field, 'nested')
}

/** Refusals after which the deal can no longer be taken: the page reloads the queue behind the dialog. */
const GONE = ['deal_not_found', 'deal_not_won', 'deal_taken'] as const

/**
 * Refusals saying the deal changed kind since the queue was read (a deal became a tender, or stopped being one,
 * US-10): this dialog asked for the other kind's fields, so the page reloads the queue and the person takes it
 * again from the fresh row.
 */
const KIND_CHANGED = ['not_for_tenders', 'only_for_tenders'] as const

/** A tender has no ops-manager: its dialog asks for none, so it reads none. */
const NO_OPS_MANAGERS: OpsManagerList = { items: [], prefillId: null }
const noOpsManagers = () => Promise.resolve(NO_OPS_MANAGERS)

/**
 * TakeDealDialog — "New project" from a queued deal (specs/20261103-projects-handoff AC-1.2, AC-1.3, AC-4.1): the name
 * (prefilled from the deal's title, editable), a client type (time and material, fixed price,
 * maintenance or SaaS — `internal` has no company and no PO, so never comes from a deal), the
 * ops-manager that receives the purchase order and, in the same step, the PO's start and end date and
 * the terms of the type, because a project taken from a deal is born with its PO and its terms. There
 * is no project manager to choose: the ops-manager picks one afterwards (D42). The company and the
 * entity are the deal's and are only shown.
 *
 * The ops-manager is chosen among the candidates `GET /queue/{dealId}/ops-managers` lists — the role's
 * holders for the entity, then the admins, marked "All entities" — and the only holder is prefilled
 * (AC-4.1): `OpsManagerPicker`. The referent is optional, among the non-archived CRM contacts of the
 * deal's company (AC-3.6): `ReferentPicker`, which reads them on open and keeps them in memory only.
 *
 * Fixed-price terms from a deal with an estimate take their man-days from the estimate: the field is
 * read-only and the request does not carry the member (AC-3.1); without an estimate it is an optional
 * input (AC-3.5). Each refusal of the take has its own message (AC-1.11, AC-4.2): the ones that name an
 * input — the ops-manager, the referent, a field of the terms — land on it (the referent's in one fixed
 * message, never the server's detail: T18), the others sit above the form. One after which the deal
 * cannot be taken any more also tells the page, which reloads the queue while the dialog keeps the
 * message on screen. A take creates, so it has no `If-Match` and cannot be stale.
 *
 * A won public tender (`kind: 'tender'`, US-10) becomes a project WITHOUT a purchase order: no ops-manager,
 * no referent, no billing. Its dialog hides both pickers (and reads neither list) and asks instead for the
 * project manager, required, among the people who can use Projects (`PersonPicker`, as the project create
 * form); the request carries `projectManagerId` and never `opsManagerId` or `referentContactId`. The
 * standard take is unchanged.
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
  const tender = isTender(deal)
  const estimateBacked = deal.estimate !== null
  const loadOpsManagers = useCallback(
    (signal: AbortSignal) => (tender ? noOpsManagers() : listOpsManagers(deal.dealId, { signal })),
    [deal.dealId, tender],
  )
  const opsManagers = useResource(loadOpsManagers)
  const loadContacts = useCallback((signal: AbortSignal) => listQueueContacts(deal.dealId, { signal }), [deal.dealId])

  const [name, setName] = useState(deal.title)
  const [type, setType] = useState<DealProjectType | ''>('')
  // `undefined` = untouched: the prefill (the only role holder), if any.
  const [pickedOps, setPickedOps] = useState<string | undefined>(undefined)
  const [referentId, setReferentId] = useState<string | null>(null)
  // A tender's project manager: no default, the person chooses (US-10).
  const [projectManager, setProjectManager] = useState<PersonChoice | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [terms, setTerms] = useState<TermsForm>(() => emptyTermsForm('internal'))
  const [errors, setErrors] = useState<TermsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const opsManagerId = pickedOps ?? opsManagers.data?.prefillId ?? ''

  // An error is about the value it was raised on: when that value changes, the message goes (AC-7.1). The
  // next submit checks everything again.
  const clearErrors = (...fields: string[]) => setErrors((current) => withoutErrors(current, ...fields))
  const patchTerms = (patch: Partial<TermsForm>) => {
    const next = { ...terms, ...patch }
    setTerms(next)
    clearErrors(...termsErrorKeysChanged(terms, next))
  }

  const submit = () => {
    const found: TermsErrors = {}
    const nameError = first(required(name), maxLength(name, 200))
    if (nameError) found['name'] = nameError
    if (type === '') found['type'] = strings.common.validation.required
    if (tender) {
      if (projectManager === null) found['projectManager'] = t.errors.project_manager_required
    } else if (opsManagerId === '') found['opsManager'] = t.opsManager.required
    // Until a type is chosen there are no terms to check: the dates still are.
    const request = termsRequestOf(type === '' ? 'internal' : type, { startDate, endDate, terms }, { estimateBacked })
    const all = { ...found, ...request.errors }
    setErrors(all)
    if (Object.keys(all).length > 0 || type === '') {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const common = { name: name.trim(), type, terms: request.input }
    const input: TakeDealAsProjectInput =
      tender && projectManager !== null
        ? // A tender names its project manager, and never an ops-manager or a referent (US-10).
          { ...common, projectManagerId: projectManager.id }
        : {
            ...common,
            opsManagerId,
            // No referent is no member at all: the PO is born without one (AC-3.6).
            ...(referentId !== null ? { referentContactId: referentId } : {}),
          }
    setBusy(true)
    setError(null)
    // A refusal that names an input lands on it, and the first invalid input takes the focus.
    const refuseField = (field: string, message: string) => {
      setErrors({ [field]: message })
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
    }
    takeDealAsProject(deal.dealId, input).then(onTaken, (failure: unknown) => {
      setBusy(false)
      // Words of our own for every known refusal; never the server's detail (a referent refusal says one thing whatever the reason).
      const refusal = takeRefusalOf(failure)
      if (refusal === 'ops_manager_invalid') {
        // The role may have changed since the list was read: choose again, among the candidates read again.
        setPickedOps(undefined)
        opsManagers.retry()
        return refuseField('opsManager', t.errors[refusal])
      }
      if (refusal === 'referent_invalid') return refuseField('referent', t.errors[refusal])
      if (refusal === 'ops_manager_required') return refuseField('opsManager', t.errors[refusal])
      if (refusal === 'project_manager_required' || refusal === 'not_project_user') {
        return refuseField('projectManager', t.errors[refusal])
      }
      if (refusal === 'identity_unavailable' && tender) return setError(t.tender.identityUnavailable)
      if (refusal) {
        if ((KIND_CHANGED as readonly string[]).includes(refusal)) onGone()
        if ((GONE as readonly string[]).includes(refusal)) onGone()
        return setError(t.errors[refusal])
      }
      if (failure instanceof ApiError && failure.status === 503) {
        return setError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
      }
      if (codeOf(failure) === 'maintenance_needs_sla_or_hours') {
        return refuseField('terms', strings.terms.refusals.maintenance_needs_sla_or_hours)
      }
      const named = fieldErrorOf(failure)
      const field = named ? formFieldOf(named.field) : null
      // The referent's own words, never the server's detail, whatever refused its id (T18).
      if (named && field === 'referent') return refuseField(field, t.errors.referent_invalid)
      if (named && field) return refuseField(field, named.message)
      setError(errorMessage(failure))
    })
  }

  return (
    <FormDialog
      title={tender ? t.tender.title : t.project.title}
      description={(tender ? t.tender.description : t.project.description)(
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
          {(control) => (
            <input
              {...control}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                clearErrors('name')
              }}
            />
          )}
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
                // The members are the new type's, empty: what was said of another type's members goes with them.
                clearErrors('type', 'terms', 'terms.*')
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
        {tender ? (
          <>
            <p className="text-sm text-soft" data-testid="take-deal-tender-note">
              {t.tender.note}
            </p>
            <PersonPicker
              label={strings.projects.form.projectManager}
              hint={t.tender.projectManagerHint}
              value={projectManager}
              onChange={(next) => {
                setProjectManager(next)
                clearErrors('projectManager')
              }}
              error={errors['projectManager']}
              required
              testId="take-deal-projectmanager"
              forbiddenHint={t.tender.projectManagerReadOnlyHint}
            />
          </>
        ) : (
          <>
            <OpsManagerPicker
              candidates={opsManagers}
              value={opsManagerId}
              onChange={(id) => {
                setPickedOps(id)
                clearErrors('opsManager')
              }}
              error={errors['opsManager']}
              testId="take-deal-opsmanager"
            />
            <ReferentPicker
              load={loadContacts}
              value={referentId}
              onChange={(id) => {
                setReferentId(id)
                clearErrors('referent')
              }}
              error={errors['referent']}
              testId="take-deal-referent"
            />
          </>
        )}
        <fieldset className="flex flex-col gap-3" data-testid="take-deal-terms">
          <legend className="field-label mb-1">{tender ? t.tender.termsLegend : t.terms.legend}</legend>
          <TermsDateFields
            startDate={startDate}
            endDate={endDate}
            errors={errors}
            onStartDateChange={(value) => {
              setStartDate(value)
              // An end before the start is raised on the end date, and a new start may settle it.
              clearErrors('startDate', 'endDate')
            }}
            onEndDateChange={(value) => {
              setEndDate(value)
              clearErrors('endDate')
            }}
            testIdPrefix="take-deal"
          />
          {type !== '' && (
            <TermsFields
              type={type}
              terms={terms}
              errors={errors}
              onChange={patchTerms}
              estimatedManDaysReadOnly={estimateBacked ? t.terms.estimatedManDaysFromEstimate : undefined}
              testIdPrefix="take-deal"
            />
          )}
        </fieldset>
      </div>
    </FormDialog>
  )
}
