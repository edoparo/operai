/**
 * AddRateEntryModal — add one entry to an entity's mileage-rate series (the
 * Settings tab; moved from admin-ui, specs/20260720-mileage-rate design.md ADM-M1). The entity
 * is fixed in the title, and the description says the entry is irreversible
 * (AC-4.7).
 *
 * Presentational: `SettingsPage` owns the field state and the `POST /rates`
 * call and maps a 422 onto `rateError` / `validFromError`. Built on
 * @operai/ui's `FormDialog` (focus trap, Escape = Cancel, focus return). The
 * rate is a `MoneyInput` parsed exactly to micros (ADR 20260720-mileage-rate-money-precision-integer-micros); a touched field
 * is validated on blur, and a reported error moves focus to the first invalid
 * field.
 */

import { useEffect, useRef, useState } from 'react'
import { DateInput, Field, FormDialog, MoneyInput } from '@operai/ui'
import type { Entity } from './EntityBadge'
import { validateRate, validateValidFrom } from '../lib/rateValidation'
import { strings } from '../strings'

export type AddRateEntryModalProps = {
  entity: Entity
  /** Display label for the (read-only) entity header, e.g. "WellD CH". */
  entityLabel: string
  rate: string
  validFrom: string
  onRateChange: (value: string) => void
  onValidFromChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  /** Whether the `POST /rates` request is currently in-flight. */
  submitting: boolean
  /** Field-level error under the Rate field (failed submit or 422); null = none. */
  rateError: string | null
  /** Field-level error under the Valid-from field; null = none. */
  validFromError: string | null
  /** Non-field error banner (network/500); null = none. */
  generalError: string | null
}

export default function AddRateEntryModal({
  entity,
  entityLabel,
  rate,
  validFrom,
  onRateChange,
  onValidFromChange,
  onSubmit,
  onCancel,
  submitting,
  rateError,
  validFromError,
  generalError,
}: AddRateEntryModalProps) {
  const canSubmit = rate.trim().length > 0 && validFrom.trim().length > 0 && !submitting

  const rateRef = useRef<HTMLInputElement>(null)
  const validFromRef = useRef<HTMLInputElement>(null)

  // Blur validation of a touched field; cleared as soon as the value changes.
  const [rateBlurError, setRateBlurError] = useState<string | null>(null)
  const [validFromBlurError, setValidFromBlurError] = useState<string | null>(null)

  const shownRateError = rateError ?? rateBlurError
  const shownValidFromError = validFromError ?? validFromBlurError

  // A failed submit (or a 422) moves focus to the first invalid field.
  useEffect(() => {
    if (rateError) rateRef.current?.focus()
    else if (validFromError) validFromRef.current?.focus()
  }, [rateError, validFromError])

  return (
    <FormDialog
      // Entity is shown read-only in the title, never editable (design.md F5 step 3).
      title={strings.settings.addDialog.title(entityLabel)}
      // Irreversibility notice — AC-4.7: a rate entry can never be edited or deleted.
      description={strings.settings.addDialog.description}
      size="sm"
      submitLabel={strings.settings.addRateEntry}
      busyLabel={strings.settings.addDialog.busy}
      cancelLabel={strings.settings.addDialog.cancel}
      closeLabel={strings.settings.addDialog.cancel}
      busy={submitting}
      canSubmit={canSubmit}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      testIdPrefix="add-rate"
      backdropTestId={`add-rate-modal-${entity}`}
    >
      <Field
        label={strings.settings.addDialog.rate}
        required
        error={
          shownRateError && (
            <span role="alert" data-testid="add-rate-value-error">
              {shownRateError}
            </span>
          )
        }
      >
        {(control) => (
          <MoneyInput
            {...control}
            ref={rateRef}
            value={rate}
            onChange={(e) => {
              setRateBlurError(null)
              onRateChange(e.target.value)
            }}
            onBlur={() => {
              if (rate.trim() !== '') setRateBlurError(validateRate(rate))
            }}
            disabled={submitting}
            data-testid="add-rate-value"
          />
        )}
      </Field>

      <Field
        label={strings.settings.addDialog.validFrom}
        required
        hint={strings.settings.addDialog.validFromHint}
        error={
          shownValidFromError && (
            <span role="alert" data-testid="add-rate-valid-from-error">
              {shownValidFromError}
            </span>
          )
        }
      >
        {(control) => (
          <DateInput
            {...control}
            ref={validFromRef}
            value={validFrom}
            onChange={(e) => {
              setValidFromBlurError(null)
              onValidFromChange(e.target.value)
            }}
            onBlur={() => {
              if (validFrom.trim() !== '') setValidFromBlurError(validateValidFrom(validFrom))
            }}
            disabled={submitting}
            data-testid="add-rate-valid-from"
          />
        )}
      </Field>

      {generalError && (
        <p role="alert" data-testid="add-rate-general-error" className="form-error">
          {generalError}
        </p>
      )}
    </FormDialog>
  )
}
