import { useEffect, useId, useState } from 'react'
import { Combobox, Field } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import { listCompanies } from '../lib/crmApi'
import type { CompanySummary, Entity, LeadSource } from '../lib/types'
import { strings } from '../strings'

/** `source`: the company's own (specs/20261101-crm US-7), which a new deal starts from. */
export type CompanyChoice = {
  id: string
  name: string
  entity?: Entity
  source?: LeadSource | null
  sourceDetail?: string | null
}

type Results = { q: string; ok: true; items: CompanySummary[] } | { q: string; ok: false }

const SEARCH_DELAY_MS = 250

/**
 * CompanyPicker — type to find a company (`GET /companies?q=`, active ones,
 * first 10 by name). Searches as the person types, debounced; the answer for
 * an older query is ignored, so "loading" is simply "no answer for this text
 * yet". Typing after a choice clears it: a company is always picked from the
 * list, never free text.
 */
export default function CompanyPicker({
  label,
  hint,
  value,
  onChange,
  error,
  required = false,
  testId,
}: {
  label: string
  hint?: string
  value: CompanyChoice | null
  onChange: (value: CompanyChoice | null) => void
  error?: string | null
  required?: boolean
  testId: string
}) {
  const id = useId()
  const [text, setText] = useState(value?.name ?? '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results | null>(null)

  useEffect(() => {
    if (!open) return
    const q = text.trim()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      listCompanies({ q, pageSize: 10 }, { signal: controller.signal }).then(
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
  const items = current?.ok ? current.items : []
  const options: ComboboxOption[] = items.map((company) => ({
    id: company.id,
    label: company.name,
    secondaryLabel: [company.city, strings.badges.entity[company.entity]].filter(Boolean).join(' · '),
  }))
  const emptyState =
    current === null
      ? strings.activities.form.optionsLoading
      : current.ok
        ? strings.companies.list.noMatchTitle
        : strings.common.networkError

  return (
    <Field label={label} hint={hint} error={error} required={required} id={id} testId={testId}>
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
            const company = items.find((item) => item.id === option.id)
            setText(option.label)
            setOpen(false)
            onChange({
              id: option.id,
              name: option.label,
              ...(company
                ? { entity: company.entity, source: company.source ?? null, sourceDetail: company.sourceDetail ?? null }
                : {}),
            })
          }}
          isOpen={open}
          onOpenChange={setOpen}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          emptyState={emptyState}
          liveRegionText={current?.ok ? strings.companies.list.results(options.length) : ''}
          testId={`${testId}-input`}
        />
      )}
    </Field>
  )
}
