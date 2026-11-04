import { useEffect, useId, useRef, useState } from 'react'
import { Combobox, Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import { ApiError } from '../lib/api'
import { emptyTermsForm } from '../lib/contractTerms'
import type { TermsErrors, TermsForm } from '../lib/contractTerms'
import { dealContractOf } from '../lib/dealContract'
import { errorMessage, fieldErrorOf, statusOf, takeRefusalOf } from '../lib/errors'
import { attachDeal, listProjects } from '../lib/projectsApi'
import type { Contract, ProjectSummary, QueueItem } from '../lib/types'
import { strings } from '../strings'
import ContractTermsFields, { ContractDateFields } from './ContractTermsFields'

/** Refusals about the chosen project: they land on the project field (AC-1.5). */
const ON_THE_PROJECT = ['contracts_not_allowed', 'project_not_open', 'company_mismatch'] as const
/** Refusals after which the deal can no longer be taken: the page reloads the queue behind the dialog. */
const GONE = ['deal_not_found', 'deal_not_won', 'deal_taken'] as const

const isIn = (list: readonly string[], value: string): boolean => list.includes(value)

/** The member of the contract a server refusal names (`contract.startDate`, `contract.terms.deadline`, …). */
const contractField = (field: string): string | null => {
  const name = field.startsWith('contract.') ? field.slice('contract.'.length) : null
  return name === 'startDate' || name === 'endDate' || name?.startsWith('terms') ? name : null
}

type Results = { q: string; ok: true; items: ProjectSummary[] } | { q: string; ok: false }

const SEARCH_DELAY_MS = 250

/**
 * ProjectPicker — type to find an existing project by name (`GET /projects?q=`,
 * the first page: a name search narrows it). Every project is offered, with its
 * type and state: which ones can take the deal's contract is the server's call
 * and its refusal says why (AC-1.5), so nothing is hidden here. Typing after a
 * choice clears it.
 */
function ProjectPicker({
  value,
  onChange,
  error,
}: {
  value: ProjectSummary | null
  onChange: (value: ProjectSummary | null) => void
  error?: string | null
}) {
  const t = strings.queue.take.attach
  const id = useId()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results | null>(null)

  useEffect(() => {
    if (!open) return
    const q = text.trim()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      listProjects({ q }, { signal: controller.signal }).then(
        ({ items }) => {
          if (!controller.signal.aborted) setResults({ q, ok: true, items })
        },
        () => {
          if (!controller.signal.aborted) setResults({ q, ok: false })
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [text, open])

  const current = results !== null && results.q === text.trim() ? results : null
  const items = current?.ok ? current.items : []
  const options: ComboboxOption[] = items.map((project) => ({
    id: project.id,
    label: project.name,
    secondaryLabel: `${strings.badges.projectType[project.type]} · ${strings.badges.projectState[project.state]}`,
  }))
  const emptyState = current === null ? t.searching : current.ok ? t.noMatch : strings.common.networkError

  return (
    <Field label={t.project} hint={t.projectHint} error={error} required id={id} testId="attach-deal-project">
      {(control) => (
        <Combobox
          id={control.id}
          ariaInvalid={control['aria-invalid']}
          ariaDescribedBy={control['aria-describedby']}
          ariaRequired={control['aria-required']}
          value={text}
          onValueChange={(next) => {
            setText(next)
            setOpen(true)
            if (value !== null && next !== value.name) onChange(null)
          }}
          options={options}
          onSelect={(option) => {
            const project = items.find((item) => item.id === option.id)
            setText(option.label)
            setOpen(false)
            if (project) onChange(project)
          }}
          isOpen={open}
          onOpenChange={setOpen}
          onFocus={() => setOpen(true)}
          emptyState={emptyState}
          liveRegionText={current?.ok ? t.results(options.length) : ''}
          testId="attach-deal-project-input"
        />
      )}
    </Field>
  )
}

/**
 * AttachDealDialog — "Attach to project" from a queued deal (AC-1.4): the
 * project (found by name) and, in the same step, the contract's start and end
 * date and the terms of that project's type, because a contract cannot exist
 * without them. The contract is of the project's type and its company is the
 * deal's.
 *
 * What the project cannot take — `internal`, `closed`, `cancelled`, a client
 * project of another company — is refused by the server and said on the project
 * field in its own words (AC-1.5); a refusal about the deal is the dialog's, and
 * one after which the deal cannot be taken any more also tells the page, which
 * reloads the queue while the dialog keeps the message on screen. A fixed-price
 * contract from a deal with an estimate takes its man-days from it: read-only,
 * and not part of the request (AC-3.1). An attach creates, so it has no
 * `If-Match`.
 */
export default function AttachDealDialog({
  deal,
  onAttached,
  onCancel,
  onGone,
}: {
  deal: QueueItem
  onAttached: (contract: Contract) => void
  onCancel: () => void
  /** The deal can no longer be taken (reopened, already taken, deleted): reload the queue. */
  onGone: () => void
}) {
  const t = strings.queue.take
  const estimateBacked = deal.estimate !== null

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [terms, setTerms] = useState<TermsForm>(() => emptyTermsForm('internal'))
  const [errors, setErrors] = useState<TermsErrors>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const chooseProject = (next: ProjectSummary | null) => {
    setProject(next)
    // The terms are the project type's: another project, another form.
    if (next?.type !== project?.type) setTerms(emptyTermsForm(next?.type ?? 'internal'))
    setErrors((current) => ({ ...current, project: '' }))
  }

  const submit = () => {
    const found: TermsErrors = {}
    if (project === null) found['project'] = t.attach.projectRequired
    // Until a project is chosen there are no terms to check: the dates still are.
    const contract = dealContractOf(project?.type ?? 'internal', { startDate, endDate, terms }, { estimateBacked })
    const all = { ...found, ...contract.errors }
    setErrors(all)
    if (Object.keys(all).length > 0 || project === null) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    setBusy(true)
    setError(null)
    attachDeal(deal.dealId, { projectId: project.id, contract: contract.input }).then(
      onAttached,
      (failure: unknown) => {
        setBusy(false)
        const refusal = takeRefusalOf(failure)
        if (refusal && isIn(ON_THE_PROJECT, refusal)) return setErrors({ project: t.errors[refusal] })
        if (refusal) {
          if (isIn(GONE, refusal)) onGone()
          return setError(t.errors[refusal])
        }
        // An unknown project is a 404 that is not `deal_not_found`: say it on the project field.
        if (statusOf(failure) === 404) return setErrors({ project: errorMessage(failure) })
        if (failure instanceof ApiError && failure.status === 503) {
          return setError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
        }
        const named = fieldErrorOf(failure)
        const field = named ? contractField(named.field) : null
        if (named && field) return setErrors({ [field]: named.message })
        setError(errorMessage(failure))
      },
    )
  }

  return (
    <FormDialog
      title={t.attach.title}
      description={t.attach.description(deal.title, deal.company.name ?? strings.queue.companyUnavailable)}
      submitLabel={t.attach.submit}
      busyLabel={t.attach.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="attach-deal"
    >
      <div ref={fieldsRef} className="contents">
        <ProjectPicker value={project} onChange={chooseProject} error={errors['project']} />
        <fieldset className="flex flex-col gap-3" data-testid="attach-deal-contract">
          <legend className="field-label mb-1">{t.contract.legend}</legend>
          {project === null ? (
            <p className="field-hint">{t.attach.chooseProject}</p>
          ) : (
            <>
              <ContractDateFields
                startDate={startDate}
                endDate={endDate}
                errors={errors}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                testIdPrefix="attach-deal"
              />
              <ContractTermsFields
                type={project.type}
                terms={terms}
                errors={errors}
                onChange={(patch) => setTerms((current) => ({ ...current, ...patch }))}
                estimatedManDaysReadOnly={estimateBacked ? t.contract.estimatedManDaysFromEstimate : undefined}
                testIdPrefix="attach-deal"
              />
            </>
          )}
        </fieldset>
      </div>
    </FormDialog>
  )
}
