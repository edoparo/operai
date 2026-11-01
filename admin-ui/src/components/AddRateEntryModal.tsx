/**
 * AddRateEntryModal — Modal ADM-M1 (T11, specs/009-mileage-rate, design.md
 * Screen ADM-M1: "Add rate entry").
 *
 * NEW component — the closest precedent (`CreateRoleModal`/
 * `CreateDepartmentModal`) doesn't fit: this needs an entity-locked (not
 * editable) header, a positive-decimal rate field, a backdatable/future-dated
 * date field, and framing that this action is irreversible (AC-4.7). It
 * structurally clones `CreateRoleModal.tsx`'s shell (backdrop, `role="dialog"`,
 * header/body/footer, Escape=Cancel, Tab-trap over the field list) — same
 * shell, different fields.
 *
 * Presentational: all data/callbacks arrive via props. `MileageRatesPage.tsx`
 * owns the field state and the `POST /rates` call, and maps a `422` (AC-4.5)
 * onto `rateError`/`validFromError` (see that page's `mapAddRateError`
 * comment for the field-routing rationale — plan.md documents no
 * `fields.*` contract for this endpoint, unlike submit's
 * `fields.offendingLineIds`, so the routing is a best-effort heuristic over
 * the RFC 7807 `detail` text, flagged for the architect/backend-dev to
 * confirm a real contract).
 *
 * A11y (mirrors CreateRoleModal.tsx's contract):
 *   • role="dialog" aria-modal="true" aria-labelledby.
 *   • Focus trap: Tab cycles Rate → Valid-from → Cancel → Add, and back.
 *   • Default focus: the Rate field (this form's natural first control).
 *   • Escape = Cancel; no submit is triggered.
 *   • Every field error is role="alert" + aria-invalid + aria-describedby,
 *     identical to CreateRoleModal.tsx's Name field.
  *
 * Built on @operai/ui's `FormDialog` (ADR-0050, INC-09): the library owns
 * the frame, the focus trap (every enabled control, × included), Escape /
 * backdrop = Cancel (never while submitting), focus return and the buttons.
 *
 * Fields (INC-16/17): each a library `Field`; the rate a `MoneyInput` parsed
 * with `parseDecimal(text, 6)` — exact integer micros, the rate API's
 * precision (ADR-0025), comma or dot — and the date a `DateInput`. A touched
 * field is validated on blur; when the page reports a field error (a failed
 * submit, or a 422) focus moves to the first invalid field.
 */

import { useEffect, useRef, useState } from 'react'
import { DateInput, Field, FormDialog, MoneyInput } from '@operai/ui'
import type { MileageRateEntity } from '../lib/ratesApi'
import { validateRate, validateValidFrom } from '../lib/rateValidation'
import { strings } from '../strings'

export type AddRateEntryModalProps = {
  entity: MileageRateEntity
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
      title={strings.rates.addDialog.title(entityLabel)}
      // Irreversibility notice — AC-4.7: a rate entry can never be edited or deleted.
      description={strings.rates.addDialog.description}
      size="sm"
      submitLabel={strings.rates.addRateEntry}
      busyLabel={strings.rates.addDialog.busy}
      cancelLabel={strings.common.actions.cancel}
      closeLabel={strings.common.actions.cancel}
      busy={submitting}
      canSubmit={canSubmit}
      error={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      testIdPrefix="add-rate"
      backdropTestId={`add-rate-modal-${entity}`}
    >
      <Field
        label={strings.rates.addDialog.rate}
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
        label={strings.rates.addDialog.validFrom}
        required
        hint={strings.rates.addDialog.validFromHint}
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
