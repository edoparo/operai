import { useEffect, useId, useRef, useState } from 'react'
import { Button, Combobox, Field, RadioGroupField } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import FormModal from './FormModal'
import { ApiError } from '../lib/api'
import { assignToOffice, createAssignment } from '../lib/assignmentsApi'
import { listDirectory } from '../lib/directoryApi'
import { listOffices } from '../lib/officesApi'
import { toInventoryError } from '../lib/types'
import type { AssetView, DirectoryUser, Entity, Office } from '../lib/types'
import { strings } from '../strings'
import { fillTemplate } from '../strings/errors'

/**
 * AssignDialog — "Assign..." (T33, specs/20261006-hardware-inventory; design.md F3,
 * § Dialogs, § Accessibility "Holder picker"; AC-2.1, AC-2.2, AC-2.10): a
 * `dialog` with one field, the holder picker, a `Combobox` over `auth`'s active
 * user directory (`directoryApi`). The directory is fetched once when the dialog
 * opens and filtered client-side by name or email.
 *
 * The picker's states render INSIDE the listbox and are announced through the
 * combobox's live region: loading, "No active users match", and a failed lookup
 * (the 429 with its `Retry-After` wait, or any other failure) — each failure
 * with a Retry button under the field.
 *
 * Errors of the assignment itself: `unknown_user` stays in the dialog so another
 * person can be picked; a stale asset (`invalid_transition`, `assignment_pending`,
 * `asset_disposed`, or a 404) is handed to the page with `onConflict` — it owns
 * the guardrail and the refetch; anything else (503, network) is an inline alert
 * that keeps the choice.
 */

export type AssignDialogProps = {
  asset: AssetView
  /** The updated asset, carrying the new `pendingAssignment`. The caller closes the dialog. */
  onAssigned: (updated: AssetView) => void
  onCancel: () => void
  /** The assignment met a stale asset; `error` is the thrown `ApiError`. */
  onConflict: (error: unknown) => void
}

type DirectoryOutcome =
  { attempt: number; ok: true; users: DirectoryUser[] } | { attempt: number; ok: false; error: unknown }

type OfficesOutcome = { attempt: number; ok: true; offices: Office[] } | { attempt: number; ok: false; error: unknown }

type Target = 'employee' | 'office'

const lookupMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 429) {
    return error.retryAfterSeconds !== null
      ? fillTemplate(strings.errors.tooManyLookups, { n: error.retryAfterSeconds })
      : strings.errors.tooManyLookupsNoDelay
  }
  return error instanceof ApiError ? (error.detail ?? strings.errors.unknown) : strings.errors.network
}

const entityLabel = (entity: string | null): string | null =>
  entity === null ? null : (strings.common.entity[entity as Entity] ?? entity)

const toOption = (user: DirectoryUser): ComboboxOption => ({
  id: user.id,
  label: user.name ?? strings.actions.assignDialog.optionNoName,
  secondaryLabel: strings.actions.assignDialog.optionDetail(user.email, entityLabel(user.entity)),
})

export default function AssignDialog({ asset, onAssigned, onCancel, onConflict }: AssignDialogProps) {
  const t = strings.actions.assignDialog
  const [attempt, setAttempt] = useState(0)
  const [directory, setDirectory] = useState<DirectoryOutcome | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ComboboxOption | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [holderError, setHolderError] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const targetName = useId()
  const [target, setTarget] = useState<Target>('employee')
  const [officeAttempt, setOfficeAttempt] = useState(0)
  const [officesOutcome, setOfficesOutcome] = useState<OfficesOutcome | null>(null)
  const [officeId, setOfficeId] = useState('')
  const [officeError, setOfficeError] = useState<string | null>(null)

  // The offices load the first time "Office" is chosen, so the employee flow makes no extra request.
  const officeMode = target === 'office'
  useEffect(() => {
    if (!officeMode) return
    const controller = new AbortController()
    listOffices({ signal: controller.signal }).then(
      ({ items }) => {
        if (!controller.signal.aborted) setOfficesOutcome({ attempt: officeAttempt, ok: true, offices: items })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setOfficesOutcome({ attempt: officeAttempt, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [officeMode, officeAttempt])
  const officesCurrent = officesOutcome?.attempt === officeAttempt ? officesOutcome : null
  const officesLoading = officeMode && officesCurrent === null
  const officesFailure = officesCurrent !== null && !officesCurrent.ok ? lookupMessage(officesCurrent.error) : null
  const activeOffices = officesCurrent?.ok ? officesCurrent.offices.filter((office) => !office.archived) : []

  useEffect(() => {
    const controller = new AbortController()
    listDirectory({ signal: controller.signal }).then(
      ({ users }) => {
        if (!controller.signal.aborted) setDirectory({ attempt, ok: true, users })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setDirectory({ attempt, ok: false, error })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const current = directory?.attempt === attempt ? directory : null
  const loading = current === null
  const failure = current !== null && !current.ok ? lookupMessage(current.error) : null
  const users = current?.ok ? current.users : []

  const needle = query.trim().toLowerCase()
  const options = users
    .filter((user) => needle === '' || `${user.name ?? ''} ${user.email}`.toLowerCase().includes(needle))
    .map(toOption)

  const emptyMessage = loading ? t.loading : (failure ?? t.empty)
  const liveText = loading ? t.loading : failure !== null ? failure : options.length === 0 ? t.empty : ''

  /** A stale asset goes to the page (it owns the guardrail and the refetch); anything else stays inline. */
  const handleFailure = (error: unknown) => {
    const known = toInventoryError(error)
    if (
      known?.code === 'invalid_transition' ||
      known?.code === 'assignment_pending' ||
      known?.code === 'asset_disposed' ||
      (error instanceof ApiError && error.status === 404)
    ) {
      onConflict(error)
    } else if (error instanceof ApiError && error.status === 503) {
      setGeneralError(`${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`)
    } else {
      setGeneralError(error instanceof ApiError ? (error.detail ?? strings.errors.unknown) : strings.errors.network)
    }
  }

  const submit = async () => {
    if (target === 'office') {
      if (officeId === '') {
        setOfficeError(t.officeRequired)
        return
      }
      setGeneralError(null)
      setSubmitting(true)
      try {
        onAssigned(await assignToOffice(asset.id, officeId))
      } catch (error) {
        if (toInventoryError(error)?.code === 'office_not_found') {
          // Archived or removed meanwhile: reload the choices and let the person pick another office.
          setOfficeId('')
          setOfficesOutcome(null)
          setOfficeAttempt((n) => n + 1)
          setGeneralError(strings.errors.office_not_found)
        } else {
          handleFailure(error)
        }
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (selected === null) {
      // Text typed but nobody picked: say so on the field and put the person back there (INC-16).
      setHolderError(t.holderRequired)
      pickerRef.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()
      return
    }
    setGeneralError(null)
    setSubmitting(true)
    try {
      onAssigned(await createAssignment(asset.id, selected.id))
    } catch (error) {
      if (toInventoryError(error)?.code === 'unknown_user') setGeneralError(strings.errors.unknown_user)
      else handleFailure(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FormModal
      title={t.title}
      description={officeMode ? t.descriptionOffice(asset.description) : t.description(asset.description)}
      submitLabel={t.submit}
      submittingLabel={t.submitting}
      submitting={submitting}
      canSubmit={officeMode ? officeId !== '' : selected !== null || query.trim() !== ''}
      generalError={generalError}
      onSubmit={() => void submit()}
      onCancel={onCancel}
      testIdPrefix="assign-asset"
    >
      <div className="flex flex-col gap-4">
        <RadioGroupField label={t.target} testId="assign-target">
          {(['employee', 'office'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name={targetName}
                value={value}
                checked={target === value}
                onChange={() => {
                  setTarget(value)
                  setGeneralError(null)
                }}
              />
              {value === 'employee' ? t.targetEmployee : t.targetOffice}
            </label>
          ))}
        </RadioGroupField>

        {officeMode ? (
          <div className="flex flex-col gap-2">
            <Field label={t.office} required error={officeError ?? undefined}>
              {(control) => (
                <select
                  {...control}
                  data-testid="assign-office"
                  value={officeId}
                  disabled={officesLoading || officesFailure !== null}
                  onChange={(event) => {
                    setOfficeId(event.target.value)
                    setOfficeError(null)
                  }}
                  className="w-full"
                >
                  <option value="">{officesLoading ? t.officeLoading : t.officePlaceholder}</option>
                  {activeOffices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {t.officeOption(office.name, strings.common.entity[office.entity])}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {officesLoading && <p className="text-xs text-soft">{t.officeLoading}</p>}
            {officesCurrent?.ok && activeOffices.length === 0 && <p className="text-xs text-soft">{t.officeEmpty}</p>}
            {officesFailure !== null && (
              <>
                <p role="alert" className="text-sm text-text">
                  {officesFailure}
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    setOfficesOutcome(null)
                    setOfficeAttempt((n) => n + 1)
                  }}
                  variant="secondary"
                  size="sm"
                  className="self-start"
                >
                  {t.retry}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div ref={pickerRef} className="flex flex-col gap-2">
            <Field label={t.holder} required error={holderError ?? undefined}>
              {(control) => (
                <Combobox
                  id={control.id}
                  testId="assign-holder"
                  value={query}
                  onValueChange={(value) => {
                    setQuery(value)
                    setSelected(null)
                    setHolderError(null)
                    setOpen(true)
                  }}
                  options={options}
                  onSelect={(option) => {
                    setSelected(option)
                    setQuery(option.label)
                    setHolderError(null)
                  }}
                  isOpen={open}
                  onOpenChange={setOpen}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setOpen(false)}
                  placeholder={t.holderPlaceholder}
                  emptyState={emptyMessage}
                  liveRegionText={liveText}
                  ariaInvalid={control['aria-invalid']}
                  ariaDescribedBy={control['aria-describedby']}
                  ariaRequired={control['aria-required']}
                />
              )}
            </Field>
            {failure !== null && (
              <Button
                type="button"
                onClick={() => {
                  setAttempt((n) => n + 1)
                }}
                variant="secondary"
                size="sm"
                className="self-start"
              >
                {t.retry}
              </Button>
            )}
          </div>
        )}
      </div>
    </FormModal>
  )
}
