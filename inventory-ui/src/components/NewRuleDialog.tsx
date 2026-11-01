import { DateInput, Field, MoneyInput, RadioGroupField } from '@operai/ui'
import { useId, useRef, useState } from 'react'
import IrreversibleActionDialog from './IrreversibleActionDialog'
import { useFocusFirstInvalid } from '../hooks/useFocusFirstInvalid'
import { ApiError } from '../lib/api'
import { formatDate } from '../lib/dates'
import { amountToCents, formatMoney } from '../lib/money'
import { createRule } from '../lib/rulesApi'
import { toInventoryError, validationField } from '../lib/types'
import type { Currency, Entity, FirstYearShare, Rule, RuleInput } from '../lib/types'
import { strings } from '../strings'
import { fillTemplate } from '../strings/errors'

/**
 * NewRuleDialog — "New rule for {entity}" (T37, specs/015-hardware-inventory;
 * design.md F11, § Irreversible actions "New rule", § Error and conflict
 * catalogue; AC-6.2, AC-6.3, AC-6.4, AC-6.5): an `IrreversibleActionDialog` whose
 * form holds the effective date, the useful life (whole years, at least 1), the
 * first-year share (Full / Half), the optional low-value threshold and the
 * residual value, with the rule now in force shown beside it for comparison.
 *
 * The consequence states what the server will do: from the date, every asset of
 * the entity purchased on or after it — including assets already registered — is
 * rescheduled by this rule; earlier ones keep their schedule; a saved rule can
 * never be edited or deleted. Saving needs the acknowledgement (Confirm is
 * disabled until it is ticked).
 *
 * The shared dialog cannot disable Confirm for an invalid form, so the form is
 * validated on Confirm, with a message naming the field and nothing sent
 * (AC-6.4). Money is parsed to integer cents by `amountToCents` (a negative or
 * three-decimal value is invalid); this component never computes with it. A 422
 * carrying a `field` is shown under that field, `fiscal_year_closed` under the
 * date (AC-6.3); 503 and network failures keep the dialog open with every typed
 * value. On success the saved rule goes to the page, which closes the dialog.
 */

export type NewRuleDialogProps = {
  entity: Entity
  /** The rule currently in force, shown beside the form; null when the entity has none. */
  inForceRule: Rule | null
  onSaved: (rule: Rule) => void
  onCancel: () => void
}

type FieldKey = 'date' | 'life' | 'share' | 'threshold' | 'residual'
type FieldErrors = Partial<Record<FieldKey, string>>

/** Server field names (plan.md `RuleInput`) -> form fields. */
const SERVER_FIELDS: Record<string, FieldKey> = {
  effectiveFrom: 'date',
  usefulLifeYears: 'life',
  firstYearShare: 'share',
  lowValueThresholdCents: 'threshold',
  residualCents: 'residual',
}

/** AC-1.2: CHF for `welld_ch`, EUR for `welld_it`. Display only. */
const CURRENCY_OF: Record<Entity, Currency> = { welld_ch: 'CHF', welld_it: 'EUR' }
const SHARES: readonly FirstYearShare[] = ['full', 'half']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const unavailable = `${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`

export default function NewRuleDialog({ entity, inForceRule, onSaved, onCancel }: NewRuleDialogProps) {
  const t = strings.rules.dialog
  const baseId = useId()
  const currency = CURRENCY_OF[entity]
  const entityName = strings.common.entity[entity]
  const [date, setDate] = useState('')
  const [life, setLife] = useState('')
  const [share, setShare] = useState<FirstYearShare | ''>('')
  const [threshold, setThreshold] = useState('')
  const [residual, setResidual] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const touched = useRef(new Set<FieldKey>())
  const { ref: fieldsRef, focusFirstInvalid } = useFocusFirstInvalid()

  const clear = (key: FieldKey) =>
    setErrors((previous) => {
      if (previous[key] === undefined) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })

  const fieldMessage = (key: FieldKey): string => {
    switch (key) {
      case 'date':
        return t.errors.dateInvalid
      case 'life':
        return t.errors.lifeInvalid
      case 'share':
        return t.errors.shareRequired
      case 'threshold':
        return t.errors.thresholdInvalid
      case 'residual':
        return t.errors.residualInvalid
    }
  }

  /** The request body, or the per-field errors; nothing is sent while any exists. */
  const parse = (): { input: RuleInput } | { errors: FieldErrors } => {
    const found: FieldErrors = {}
    if (date === '') found.date = t.errors.dateRequired
    else if (!DATE_ONLY.test(date)) found.date = t.errors.dateInvalid

    const lifeYears = /^\d+$/.test(life.trim()) ? Number(life.trim()) : null
    if (lifeYears === null || lifeYears < 1) found.life = t.errors.lifeInvalid
    if (share === '') found.share = t.errors.shareRequired

    const thresholdCents = threshold.trim() === '' ? null : amountToCents(threshold)
    if (threshold.trim() !== '' && thresholdCents === null) found.threshold = t.errors.thresholdInvalid
    const residualCents = amountToCents(residual)
    if (residualCents === null) found.residual = t.errors.residualInvalid

    if (Object.keys(found).length > 0 || lifeYears === null || share === '' || residualCents === null) {
      return { errors: found }
    }
    return {
      input: {
        entity,
        effectiveFrom: date,
        usefulLifeYears: lifeYears,
        firstYearShare: share,
        lowValueThresholdCents: thresholdCents,
        residualCents,
      },
    }
  }

  const fail = (error: unknown) => {
    const known = toInventoryError(error)
    if (known?.code === 'fiscal_year_closed') {
      const year = known.extras.year
      return setErrors({
        date:
          year === undefined
            ? t.errors.yearClosedNoYear
            : fillTemplate(strings.errors.fiscal_year_closed, { year, entity: entityName }),
      })
    }
    if (error instanceof ApiError) {
      if (error.status === 422) {
        const key = SERVER_FIELDS[validationField(error) ?? '']
        if (key !== undefined) return setErrors({ [key]: fieldMessage(key) })
        return setGeneralError(strings.errors.validation)
      }
      if (error.status === 503) return setGeneralError(unavailable)
      return setGeneralError(error.detail ?? strings.errors.unknown)
    }
    return setGeneralError(strings.errors.network)
  }

  const submit = async () => {
    setGeneralError(null)
    const parsed = parse()
    if ('errors' in parsed) {
      setErrors(parsed.errors)
      focusFirstInvalid()
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      onSaved(await createRule(parsed.input))
    } catch (error) {
      fail(error)
    } finally {
      setSubmitting(false)
    }
  }

  const money = (cents: number) => formatMoney(cents, currency)
  const inForceSummary =
    inForceRule === null
      ? null
      : strings.rules.dialog.inForce(
          t.inForceSummary(
            inForceRule.usefulLifeYears,
            t.inForceShare[inForceRule.firstYearShare],
            inForceRule.lowValueThresholdCents === null
              ? t.inForceNoThreshold
              : t.inForceThreshold(money(inForceRule.lowValueThresholdCents)),
            money(inForceRule.residualCents),
          ),
          formatDate(inForceRule.effectiveFrom),
        )

  const shareId = `${baseId}-share`

  /** Blur of a field the person changed: show its own error now (design-system.md § Forms). */
  const blurred = (key: FieldKey) => () => {
    if (!touched.current.has(key)) return
    const parsed = parse()
    const issue = 'errors' in parsed ? parsed.errors[key] : undefined
    if (issue !== undefined)
      setErrors((previous) => (previous[key] !== undefined ? previous : { ...previous, [key]: issue }))
  }

  return (
    <IrreversibleActionDialog
      title={t.title(entityName)}
      consequence={t.consequence(entityName, date === '' || !DATE_ONLY.test(date) ? t.dateUnset : formatDate(date))}
      acknowledgeLabel={t.acknowledge}
      confirmLabel={t.confirm}
      confirmingLabel={t.confirming}
      isConfirming={submitting}
      errorMessage={generalError}
      onConfirm={() => void submit()}
      onCancel={onCancel}
      testIdPrefix="new-rule"
    >
      {inForceSummary !== null && (
        <p data-testid="new-rule-in-force" className="text-xs text-soft">
          {inForceSummary}
        </p>
      )}

      <div ref={fieldsRef} className="contents">
        <Field label={t.fields.effectiveFrom} required error={errors.date}>
          {(control) => (
            <DateInput
              {...control}
              value={date}
              onChange={(event) => {
                touched.current.add('date')
                setDate(event.target.value)
                clear('date')
              }}
              onBlur={blurred('date')}
              className="w-full"
            />
          )}
        </Field>

        <Field label={t.fields.usefulLife} required error={errors.life}>
          {(control) => (
            // Whole years, not money: a plain numeric field.
            <input
              {...control}
              inputMode="numeric"
              value={life}
              onChange={(event) => {
                touched.current.add('life')
                setLife(event.target.value)
                clear('life')
              }}
              onBlur={blurred('life')}
              className="w-full input-figure"
            />
          )}
        </Field>

        <RadioGroupField label={t.fields.firstYearShare} error={errors.share} required>
          {SHARES.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name={shareId}
                value={value}
                checked={share === value}
                onChange={() => {
                  setShare(value)
                  clear('share')
                }}
              />
              {strings.rules.firstYearShare[value]}
            </label>
          ))}
        </RadioGroupField>

        <Field label={t.fields.thresholdIn(currency)} error={errors.threshold}>
          {(control) => (
            <MoneyInput
              {...control}
              value={threshold}
              onChange={(event) => {
                touched.current.add('threshold')
                setThreshold(event.target.value)
                clear('threshold')
              }}
              onBlur={blurred('threshold')}
              className="w-full"
            />
          )}
        </Field>

        <Field label={t.fields.residualIn(currency)} required error={errors.residual}>
          {(control) => (
            <MoneyInput
              {...control}
              value={residual}
              onChange={(event) => {
                touched.current.add('residual')
                setResidual(event.target.value)
                clear('residual')
              }}
              onBlur={blurred('residual')}
              className="w-full"
            />
          )}
        </Field>
      </div>
    </IrreversibleActionDialog>
  )
}
