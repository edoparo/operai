import { useCallback, useRef, useState } from 'react'
import { DateInput, DateTimeInput, Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { ApiError } from '../lib/api'
import { createActivity, listContacts, listDeals, updateActivity } from '../lib/crmApi'
import { fromLocalDateTimeInput, toLocalDateTimeInput } from '../lib/dates'
import { errorMessage, fieldErrorOf } from '../lib/errors'
import { contactName, personName } from '../lib/people'
import { ACTIVITY_TYPES } from '../lib/types'
import type { Activity, ActivityType, CompanyRef } from '../lib/types'
import { first, hasErrors, maxLength, optional, required } from '../lib/validate'
import type { Errors } from '../lib/validate'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import CompanyPicker from './CompanyPicker'
import type { CompanyChoice } from './CompanyPicker'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'

type FieldName = 'company' | 'type' | 'subject' | 'body' | 'occurredAt' | 'dueDate' | 'assignee' | 'contactId' | 'dealId'

const CODE_FIELDS: Record<string, FieldName> = {
  contact_not_in_company: 'contactId',
  deal_not_in_company: 'dealId',
  owner_not_active: 'assignee',
  task_fields_on_non_task: 'type',
}

/**
 * ActivityFormDialog — log an activity at a company (US-4), or edit one the
 * caller wrote. A task takes a due date and an assignee instead of "when"; the
 * contact and deal choices are that company's own (AC-4.1), loaded when the
 * dialog opens. `preset` fixes the contact or deal when logging from their page.
 * The type, company, contact and deal of an existing activity are not editable
 * (the API's PATCH accepts subject, body, occurredAt, dueDate and assignee).
 * Without `company` (a new task from "Tasks") the dialog asks for one first;
 * `fixedType` hides the type choice (that entry point creates tasks only).
 */
export default function ActivityFormDialog({
  company,
  fixedType,
  activity,
  preset,
  onSaved,
  onCancel,
}: {
  company?: CompanyRef
  fixedType?: ActivityType
  activity?: Activity
  preset?: { contactId?: string; dealId?: string }
  onSaved: (activity: Activity) => void
  onCancel: () => void
}) {
  const t = strings.activities.form
  const [type, setType] = useState<ActivityType>(activity?.type ?? fixedType ?? 'note')
  const [chosenCompany, setChosenCompany] = useState<CompanyChoice | null>(null)
  const [subject, setSubject] = useState(activity?.subject ?? '')
  const [body, setBody] = useState(activity?.body ?? '')
  const [occurredAt, setOccurredAt] = useState(() =>
    toLocalDateTimeInput(activity ? new Date(activity.occurredAt) : new Date()),
  )
  const [dueDate, setDueDate] = useState(activity?.task?.dueDate ?? '')
  const [assignee, setAssignee] = useState<PersonChoice | null>(
    activity?.task?.assignee ? { id: activity.task.assignee.id, label: personName(activity.task.assignee) } : null,
  )
  const [contactId, setContactId] = useState(activity?.contact?.id ?? preset?.contactId ?? '')
  const [dealId, setDealId] = useState(activity?.deal?.id ?? preset?.dealId ?? '')
  const [errors, setErrors] = useState<Errors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const companyId = company?.id ?? chosenCompany?.id ?? null
  const loadOptions = useCallback(
    (signal: AbortSignal) =>
      companyId === null
        ? Promise.resolve(null)
        : Promise.all([
            listContacts({ companyId, pageSize: 100 }, { signal }),
            listDeals({ companyId, pageSize: 100 }, { signal }),
          ]),
    [companyId],
  )
  const options = useResource(loadOptions)
  const contacts = options.data?.[0].items ?? []
  const deals = options.data?.[1].items ?? []
  const optionsLoading = companyId !== null && options.status === 'loading'
  const isTask = type === 'task'

  const submit = () => {
    const occurredIso = fromLocalDateTimeInput(occurredAt)
    const found: Errors<FieldName> = {
      company: companyId === null ? strings.common.validation.required : undefined,
      subject: first(required(subject), maxLength(subject, 200)) ?? undefined,
      body: maxLength(body, 10_000) ?? undefined,
      occurredAt: !isTask && occurredIso === null ? strings.common.validation.date : undefined,
    }
    setErrors(found)
    if (hasErrors(found)) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const text = { subject: subject.trim(), body: optional(body) }
    const timing = isTask
      ? { dueDate: dueDate === '' ? null : dueDate, ...(assignee ? { assigneeUserId: assignee.id } : {}) }
      : { occurredAt: occurredIso! }
    setBusy(true)
    setError(null)
    const request = activity
      ? updateActivity(activity.id, { ...text, ...timing })
      : createActivity({
          type,
          companyId: companyId!,
          ...text,
          ...timing,
          ...(contactId ? { contactId } : {}),
          ...(dealId ? { dealId } : {}),
        })
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      const byCode = failure instanceof ApiError && failure.code ? CODE_FIELDS[failure.code] : undefined
      if (byCode && failure instanceof ApiError) {
        setErrors({ [byCode]: failure.detail ?? strings.common.validation.fixErrors })
        return
      }
      const field = fieldErrorOf(failure)
      if (field) {
        const name = (field.field === 'assigneeUserId' ? 'assignee' : field.field) as FieldName
        setErrors({ [name]: field.message })
        return
      }
      setError(errorMessage(failure))
    })
  }

  return (
    <FormDialog
      title={activity ? t.editTitle : fixedType === 'task' ? t.createTaskTitle : t.createTitle}
      submitLabel={activity ? strings.common.save : fixedType === 'task' ? t.submitTask : t.submit}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="crm-activity-form"
    >
      <div ref={fieldsRef} className="contents">
        {!activity && !company && (
          <CompanyPicker
            label={t.company}
            required
            value={chosenCompany}
            onChange={(next) => {
              setChosenCompany(next)
              // The contact and deal choices belong to the previous company.
              setContactId('')
              setDealId('')
            }}
            error={errors.company}
            testId="crm-activity-form-company"
          />
        )}
        {!activity && !fixedType && (
          <Field label={t.type} error={errors.type} testId="crm-activity-form-type">
            {(control) => (
              <select {...control} value={type} onChange={(event) => setType(event.target.value as ActivityType)}>
                {ACTIVITY_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {strings.badges.activityType[option]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label={t.subject} required error={errors.subject} testId="crm-activity-form-subject">
          {(control) => <input {...control} value={subject} onChange={(event) => setSubject(event.target.value)} />}
        </Field>
        <Field label={t.body} error={errors.body} testId="crm-activity-form-body">
          {(control) => (
            <textarea {...control} rows={4} value={body} onChange={(event) => setBody(event.target.value)} />
          )}
        </Field>
        {isTask ? (
          <>
            <Field label={t.dueDate} error={errors.dueDate} testId="crm-activity-form-due">
              {(control) => (
                <DateInput {...control} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              )}
            </Field>
            <PersonPicker
            appId="crm"
              label={t.assignee}
              value={assignee}
              onChange={setAssignee}
              error={errors.assignee}
              testId="crm-activity-form-assignee"
            />
          </>
        ) : (
          <Field label={t.occurredAt} error={errors.occurredAt} testId="crm-activity-form-when">
            {(control) => (
              <DateTimeInput {...control} value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
            )}
          </Field>
        )}
        {!activity && !preset?.contactId && (
          <Field label={t.contact} error={errors.contactId} testId="crm-activity-form-contact">
            {(control) => (
              <select {...control} value={contactId} onChange={(event) => setContactId(event.target.value)}>
                <option value="">{optionsLoading ? t.optionsLoading : t.noContact}</option>
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contactName(contact)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {!activity && !preset?.dealId && (
          <Field label={t.deal} error={errors.dealId} testId="crm-activity-form-deal">
            {(control) => (
              <select {...control} value={dealId} onChange={(event) => setDealId(event.target.value)}>
                <option value="">{optionsLoading ? t.optionsLoading : t.noDeal}</option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>
    </FormDialog>
  )
}
