import { useEffect, useId, useMemo, useState } from 'react'
import { Combobox, Field } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import { ApiError } from '../lib/api'
import { listDirectory } from '../lib/crmApi'
import type { DirectoryUser } from '../lib/types'
import { strings } from '../strings'

export type PersonChoice = { id: string; label: string }

type Outcome = { ok: true; users: DirectoryUser[] } | { ok: false; error: unknown }

const toOption = (user: DirectoryUser): ComboboxOption => ({
  id: user.id,
  label: user.name ?? strings.people.picker.noName,
  secondaryLabel: user.email,
})

const failureText = (error: unknown): string =>
  error instanceof ApiError && error.status === 429 && error.retryAfterSeconds !== null
    ? strings.people.picker.rateLimited(error.retryAfterSeconds)
    : strings.people.picker.failed

/**
 * PersonPicker — choose an Operai user (an owner, an assignee) from `auth`'s
 * directory (ADR-0047, widened to `deal:manage` holders by ADR-0053). The list
 * is fetched once and filtered client-side by name or email.
 *
 * A caller the directory refuses (403: they do not manage deals) cannot pick
 * someone else: the field shows the current choice read-only with a hint, and
 * the record keeps its default (the caller, for a new one — plan.md § UI).
 */
export default function PersonPicker({
  appId,
  label,
  value,
  onChange,
  error,
  required = false,
  exclude,
  clearOnSelect = false,
  testId,
}: {
  /** Only people who hold `(appId, "access")` are offered: `crm` for owners and assignees, `estimai` for a technician. */
  appId: 'crm' | 'estimai'
  label: string
  value: PersonChoice | null
  onChange: (value: PersonChoice | null) => void
  error?: string | null
  required?: boolean
  /** Ids not offered (people already chosen). */
  exclude?: readonly string[]
  /** Empties the field after a choice: the picker adds people to a list (specs/017 US-8). */
  clearOnSelect?: boolean
  testId: string
}) {
  const id = useId()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [text, setText] = useState(value?.label ?? '')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    listDirectory(appId, { signal: controller.signal }).then(
      ({ users }) => {
        if (!controller.signal.aborted) setOutcome({ ok: true, users })
      },
      (failure: unknown) => {
        if (!controller.signal.aborted) setOutcome({ ok: false, error: failure })
      },
    )
    return () => controller.abort()
  }, [appId])

  const options = useMemo(() => {
    if (outcome === null || !outcome.ok) return []
    const needle = text.trim().toLowerCase()
    return outcome.users
      .filter((user) => !exclude?.includes(user.id))
      .filter((user) => !needle || `${user.name ?? ''} ${user.email}`.toLowerCase().includes(needle))
      .slice(0, 20)
      .map(toOption)
  }, [outcome, text, exclude])

  const forbidden = outcome !== null && !outcome.ok && outcome.error instanceof ApiError && outcome.error.status === 403

  if (forbidden) {
    return (
      <Field label={label} hint={strings.people.picker.unavailableHint} testId={testId}>
        {(control) => <input {...control} value={value?.label ?? ''} readOnly data-testid={`${testId}-readonly`} />}
      </Field>
    )
  }

  const emptyState =
    outcome === null
      ? strings.people.picker.loading
      : !outcome.ok
        ? failureText(outcome.error)
        : strings.people.picker.noMatch

  return (
    <Field label={label} error={error} required={required} id={id} testId={testId}>
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
            if (value !== null && next !== value.label) onChange(null)
          }}
          options={options}
          onSelect={(option) => {
            setText(clearOnSelect ? '' : option.label)
            setOpen(false)
            onChange({ id: option.id, label: option.label })
          }}
          isOpen={open}
          onOpenChange={setOpen}
          onFocus={() => setOpen(true)}
          emptyState={emptyState}
          liveRegionText={outcome?.ok ? strings.people.picker.results(options.length) : ''}
          testId={`${testId}-input`}
        />
      )}
    </Field>
  )
}
