import { useState, type ReactNode } from 'react'
import { Field, MoneyInput } from '@operai/ui'
import { strings } from '../../strings'

const t = strings.offerWizard

import { type Parsed } from './costValues'

interface DraftInputProps {
  label: ReactNode
  value: number | null
  parse: (text: string) => Parsed<number>
  format: (value: number) => string
  /** The reason shown when what is typed cannot be read. */
  unreadable: string
  onChange: (value: number | null) => void
  /** A reason from the engine (an invalid answer). */
  error?: string | null
  /** The resolver would print it and it is empty. Shown as "Required" once the person has left the field. */
  missing?: boolean
  required?: boolean
  /** What the answer holds while the text is empty (a field that cannot be null), so the draft still matches it. */
  emptyValue?: number
  money?: boolean
  readOnly?: boolean
  controlName?: string
  /** The `data-wizard-field` an issue's jump focuses. */
  wizardField?: string
  id?: string
}

/**
 * A number the answers hold as an integer (cents, basis points, a count), edited as text: what is typed stays
 * while it is being typed (`1.` is not turned into `1.00` under the cursor), an unreadable text clears the answer
 * and says so after the person leaves the field, and an answer changed from elsewhere replaces the text.
 */
export default function DraftInput({
  label,
  value,
  parse,
  format,
  unreadable,
  onChange,
  error,
  missing = false,
  required = false,
  emptyValue,
  money = false,
  readOnly = false,
  controlName,
  wizardField,
  id,
}: DraftInputProps) {
  const [draft, setDraft] = useState<{ text: string; pushed: number | null; invalid: boolean } | null>(null)
  const [touched, setTouched] = useState(false)
  const shownDraft = draft !== null && draft.pushed === value ? draft : null
  const text = shownDraft ? shownDraft.text : value === null ? '' : format(value)
  const message =
    shownDraft?.invalid && touched ? unreadable : (error ?? (missing && touched ? t.invalid.required : null))
  return (
    <Field label={label} id={id} error={message} required={required}>
      {(control) => {
        const props = {
          ...control,
          value: text,
          readOnly,
          'data-control': controlName,
          'data-wizard-field': wizardField,
          onBlur: () => {
            setTouched(true)
            if (draft !== null && !draft.invalid) setDraft(null)
          },
          onChange: (event: { target: { value: string } }) => {
            const typed = event.target.value
            const parsed = parse(typed)
            const pushed = parsed.ok ? parsed.value : null
            setDraft({ text: typed, pushed: pushed ?? emptyValue ?? null, invalid: !parsed.ok })
            onChange(pushed)
          },
        }
        return money ? (
          <MoneyInput {...props} />
        ) : (
          <input {...props} type="text" inputMode="numeric" autoComplete="off" className="input-figure" />
        )
      }}
    </Field>
  )
}
