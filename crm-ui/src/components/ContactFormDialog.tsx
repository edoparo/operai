import { useRef, useState } from 'react'
import { Field, FormDialog, focusFirstInvalid } from '@operai/ui'
import { ApiError, isStaleWrite } from '../lib/api'
import { createContact, updateContact } from '../lib/crmApi'
import type { ContactInput } from '../lib/crmApi'
import { errorMessage, fieldErrorOf } from '../lib/errors'
import type { CompanyRef, Contact } from '../lib/types'
import { email, first, hasErrors, maxLength, optional, required } from '../lib/validate'
import type { Errors } from '../lib/validate'
import { strings } from '../strings'
import CompanyPicker from './CompanyPicker'
import type { CompanyChoice } from './CompanyPicker'

type FieldName = 'firstName' | 'lastName' | 'email' | 'phone' | 'jobTitle' | 'notes' | 'companyId'
type Draft = Record<Exclude<FieldName, 'companyId'>, string>

const fromContact = (contact: Contact | undefined): Draft => ({
  firstName: contact?.firstName ?? '',
  lastName: contact?.lastName ?? '',
  email: contact?.email ?? '',
  phone: contact?.phone ?? '',
  jobTitle: contact?.jobTitle ?? '',
  notes: contact?.notes ?? '',
})

const validate = (draft: Draft): Errors<FieldName> => ({
  firstName: first(required(draft.firstName), maxLength(draft.firstName, 100)) ?? undefined,
  lastName: first(required(draft.lastName), maxLength(draft.lastName, 100)) ?? undefined,
  email: first(email(draft.email), maxLength(draft.email, 254)) ?? undefined,
  phone: maxLength(draft.phone, 50) ?? undefined,
  jobTitle: maxLength(draft.jobTitle, 100) ?? undefined,
  notes: maxLength(draft.notes, 10_000) ?? undefined,
})

/**
 * ContactFormDialog — add a contact (optionally at a fixed company, from the
 * company page) or edit one. Same error handling as CompanyFormDialog: field
 * 422s on the field, stale writes to the page, the rest inline.
 */
export default function ContactFormDialog({
  contact,
  company,
  onSaved,
  onCancel,
  onStale,
}: {
  contact?: Contact
  /** A fixed company (adding from a company page): the picker is not shown. */
  company?: CompanyRef
  onSaved: (contact: Contact) => void
  onCancel: () => void
  onStale: () => void
}) {
  const t = strings.contacts.form
  const [draft, setDraft] = useState<Draft>(() => fromContact(contact))
  const initialCompany = company ?? contact?.company ?? null
  const [chosen, setChosen] = useState<CompanyChoice | null>(initialCompany)
  const [errors, setErrors] = useState<Errors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const submit = () => {
    const found = validate(draft)
    setErrors(found)
    if (hasErrors(found)) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const input: ContactInput = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      email: optional(draft.email),
      phone: optional(draft.phone),
      jobTitle: optional(draft.jobTitle),
      notes: optional(draft.notes),
      companyId: chosen?.id ?? null,
    }
    setBusy(true)
    setError(null)
    const request = contact ? updateContact(contact.id, contact.version, input) : createContact(input)
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      if (isStaleWrite(failure)) return onStale()
      if (failure instanceof ApiError && failure.code === 'company_not_found') {
        setErrors({ companyId: failure.detail ?? strings.deals.form.companyRequired })
        return
      }
      const field = fieldErrorOf(failure)
      if (field && (field.field in draft || field.field === 'companyId')) {
        setErrors({ [field.field]: field.message } as Errors<FieldName>)
        return
      }
      setError(errorMessage(failure))
    })
  }

  const text = (key: keyof Draft, label: string, isRequired = false, type = 'text') => (
    <Field label={label} required={isRequired} error={errors[key]} testId={`crm-contact-form-${key}`}>
      {(control) => (
        <input {...control} type={type} value={draft[key]} onChange={(event) => set(key, event.target.value)} />
      )}
    </Field>
  )

  return (
    <FormDialog
      title={contact ? t.editTitle : t.createTitle}
      submitLabel={contact ? strings.common.save : t.create}
      busyLabel={contact ? strings.common.saving : t.creating}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="crm-contact-form"
    >
      <div ref={fieldsRef} className="contents">
        {text('firstName', t.firstName, true)}
        {text('lastName', t.lastName, true)}
        {text('email', t.email, false, 'email')}
        {text('phone', t.phone, false, 'tel')}
        {text('jobTitle', t.jobTitle)}
        {!company && (
          <CompanyPicker
            label={t.company}
            hint={t.companyHint}
            value={chosen}
            onChange={setChosen}
            error={errors.companyId}
            testId="crm-contact-form-company"
          />
        )}
        <Field label={t.notes} error={errors.notes} testId="crm-contact-form-notes">
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
