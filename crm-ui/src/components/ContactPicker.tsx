import { useEffect, useId, useState } from 'react'
import { Combobox, Field } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import { listContacts } from '../lib/crmApi'
import { contactName } from '../lib/people'
import type { ContactSummary } from '../lib/types'
import { strings } from '../strings'

type Results = { q: string; ok: true; items: ContactSummary[] } | { q: string; ok: false }

const SEARCH_DELAY_MS = 250

/**
 * ContactPicker — type to find an existing contact (`GET /contacts?q=`, active
 * ones, first 10 by name), each shown with its company. Same search rules as
 * CompanyPicker: debounced, older answers ignored, typing after a choice clears
 * it. Contacts of `excludeCompanyId` are left out: they are already there.
 */
export default function ContactPicker({
  label,
  hint,
  value,
  onChange,
  excludeCompanyId,
  error,
  testId,
}: {
  label: string
  hint?: string
  value: ContactSummary | null
  onChange: (value: ContactSummary | null) => void
  excludeCompanyId?: string
  error?: string | null
  testId: string
}) {
  const id = useId()
  const [text, setText] = useState(value ? contactName(value) : '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results | null>(null)

  useEffect(() => {
    if (!open) return
    const q = text.trim()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      listContacts({ q, pageSize: 10 }, { signal: controller.signal }).then(
        (page) => {
          if (!controller.signal.aborted) setResults({ q, ok: true, items: page.items })
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
  const items = (current?.ok ? current.items : []).filter((contact) => contact.company?.id !== excludeCompanyId)
  const options: ComboboxOption[] = items.map((contact) => ({
    id: contact.id,
    label: contactName(contact),
    secondaryLabel: [contact.company?.name ?? strings.contacts.picker.noCompany, contact.email]
      .filter(Boolean)
      .join(' · '),
  }))
  const emptyState =
    current === null
      ? strings.activities.form.optionsLoading
      : current.ok
        ? strings.contacts.picker.noMatch
        : strings.common.networkError

  return (
    <Field label={label} hint={hint} error={error} required id={id} testId={testId}>
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
            if (value !== null && next !== contactName(value)) onChange(null)
          }}
          options={options}
          onSelect={(option) => {
            setText(option.label)
            setOpen(false)
            onChange(items.find((item) => item.id === option.id) ?? null)
          }}
          isOpen={open}
          onOpenChange={setOpen}
          onFocus={() => setOpen(true)}
          emptyState={emptyState}
          liveRegionText={current?.ok ? strings.contacts.picker.results(options.length) : ''}
          testId={`${testId}-input`}
        />
      )}
    </Field>
  )
}
