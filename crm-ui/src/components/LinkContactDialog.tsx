import { useState } from 'react'
import { Banner, FormDialog } from '@operai/ui'
import { isStaleWrite } from '../lib/api'
import { getContact, updateContact } from '../lib/crmApi'
import { errorMessage } from '../lib/errors'
import { contactName } from '../lib/people'
import type { CompanyRef, Contact, ContactSummary } from '../lib/types'
import { strings } from '../strings'
import ContactPicker from './ContactPicker'

/**
 * LinkContactDialog — add an existing contact to a company from the company
 * page (specs/20261101-crm AC-2.5). A contact has one company: one already at another
 * company is moved, and the dialog says so before it happens. The contact is
 * read first for its version, then saved with If-Match like any edit.
 */
export default function LinkContactDialog({
  company,
  onLinked,
  onCancel,
}: {
  company: CompanyRef
  onLinked: (contact: Contact) => void
  onCancel: () => void
}) {
  const t = strings.companies.linkContact
  const [chosen, setChosen] = useState<ContactSummary | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (chosen === null) {
      setFieldError(t.required)
      return
    }
    setBusy(true)
    setError(null)
    getContact(chosen.id)
      .then((contact) => updateContact(contact.id, contact.version, { companyId: company.id }))
      .then(onLinked, (failure: unknown) => {
        setBusy(false)
        setError(isStaleWrite(failure) ? t.stale : errorMessage(failure))
      })
  }

  return (
    <FormDialog
      title={t.title(company.name)}
      submitLabel={t.submit}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      testIdPrefix="crm-link-contact"
    >
      <ContactPicker
        label={t.contact}
        hint={t.hint}
        value={chosen}
        onChange={(next) => {
          setChosen(next)
          setFieldError(null)
        }}
        excludeCompanyId={company.id}
        error={fieldError}
        testId="crm-link-contact-picker"
      />
      {chosen?.company && (
        <Banner tone="warning" data-testid="crm-link-contact-moves">
          {t.moves(contactName(chosen), chosen.company.name, company.name)}
        </Banner>
      )}
    </FormDialog>
  )
}
