import { useState, type ReactNode } from 'react'
import { Field } from '@operai/ui'
import type { WizardAnswers } from '../../lib/offerEngine/answers'
import type { StepKey } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import { readValidity, type ValidityEntry } from './validityEntry'

const t = strings.offerWizard

function reasonText(reason: ValidityEntry['reason']): string {
  if (reason === 'empty') return t.invalid.required
  return reason === 'not_integer' ? t.invalid.not_integer : t.invalid.days_out_of_range
}

export interface ValidityDaysInputProps {
  answers: WizardAnswers
  onAnswersChange: (next: WizardAnswers) => void
  /** The control's label: the Costs step's own, or the template field's when the template binds a field to it. */
  label?: ReactNode
  /** The label as plain text, for the Preview step's issue; defaults to the Costs card's own. */
  issueLabel?: string
  /** The template field's name when one is bound (`source: validityDays`): where an issue's jump lands. */
  fieldName?: string
  /** The step this control is on. */
  step?: StepKey
  /** The entry the wizard holds, and how it changes it. Absent, the control keeps its own (a standalone use). */
  entry?: ValidityEntry | null
  onEntryChange?: (entry: ValidityEntry | null) => void
  id?: string
}

/**
 * The offer's validity in days (1 to 365). It is not an ordinary field answer: the answers hold it as
 * `answers.validityDays`, so the Costs step's own input and a template field bound to `source: validityDays` are
 * the same control and write the same place. It hands the answers only a number the server accepts; anything else
 * stays what was typed, as an entry (see `ValidityEntry`).
 */
export default function ValidityDaysInput({
  answers,
  onAnswersChange,
  label,
  issueLabel,
  fieldName,
  step = 'costs',
  entry: heldEntry,
  onEntryChange,
  id,
}: ValidityDaysInputProps) {
  const [ownEntry, setOwnEntry] = useState<ValidityEntry | null>(null)
  const entry = onEntryChange ? (heldEntry ?? null) : ownEntry
  const setEntry = onEntryChange ?? setOwnEntry
  // an entry already held when the step opens is shown with its error at once; a fresh one waits for the blur
  const [touched, setTouched] = useState(entry !== null)
  // a whole number outside 1 to 365 is wrong as soon as it is typed; a blank or unreadable text waits for the blur
  const message = entry !== null && (touched || entry.reason === 'days_out_of_range') ? reasonText(entry.reason) : null

  const change = (text: string) => {
    const read = readValidity(text)
    if ('days' in read) {
      setEntry(null)
      if (read.days !== answers.validityDays) onAnswersChange({ ...answers, validityDays: read.days })
      return
    }
    setEntry({
      text,
      name: fieldName ?? 'validityDays',
      label: issueLabel ?? t.costs.validity,
      step,
      reason: read.reason,
    })
  }

  return (
    <>
      <Field label={label ?? t.costs.validity} id={id} error={message} required>
        {(control) => (
          <input
            {...control}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="input-figure"
            data-control="validity"
            data-wizard-field={fieldName ?? 'validityDays'}
            value={entry !== null ? entry.text : String(answers.validityDays)}
            onChange={(event) => change(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>
      <p className="field-hint">{t.costs.validityHint}</p>
    </>
  )
}
