/**
 * The form's bound controls (task T21): each one is a labelled `Field` for the value at one JSON Pointer of
 * the configuration. It shows the value it is given, dispatches `set` for that pointer on a change, marks
 * itself with `data-pointer` (the way a refused value finds its control, and the way the tests check that
 * every configuration field has a labelled control) and shows the refusal of the service for that pointer.
 * The page, the variant cards and the zone editor are built from them.
 */
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Field, MoneyInput, RadioGroupField } from '@operai/ui'
import { numberText, parseNumber } from '../lib/formState'
import { useFieldError, useForm } from '../lib/formStateContext'
import type { NumberValue } from '../lib/formStateTypes'
import { CheckboxField } from './CheckboxField'
import { ColourInput } from './ColourInput'

interface BoundProps {
  label: ReactNode
  /** The JSON Pointer of the value, into the configuration. */
  pointer: string
  hint?: ReactNode
  className?: string
}

/** Whether the text shown still is what the value says (a number typed as `8.0` is still the number 8). */
const inSync = (text: string, value: NumberValue): boolean =>
  typeof value === 'number' ? parseNumber(text) === value : text === value

/**
 * A number: a text input with the decimal keypad (`MoneyInput`; `type="number"` rejects the comma the suite
 * uses). It keeps the text as typed while that is still the value, so `25.` and `8.0` are not rewritten under
 * the cursor, and shows the value again whenever something else changed it (a line removed, a reload).
 * Nothing is clamped: an out-of-range or non-numeric value is sent as typed and the service refuses it.
 */
export function NumberField({ label, pointer, value, hint, className }: BoundProps & { value: NumberValue }) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  const [text, setText] = useState(() => numberText(value))
  const shown = inSync(text, value) ? text : numberText(value)
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <MoneyInput
          {...control}
          data-pointer={pointer}
          value={shown}
          onChange={(event) => {
            setText(event.target.value)
            dispatch({ type: 'set', pointer, value: parseNumber(event.target.value) })
          }}
        />
      )}
    </Field>
  )
}

export function TextField({ label, pointer, value, hint, className }: BoundProps & { value: string }) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <input
          {...control}
          type="text"
          data-pointer={pointer}
          value={value}
          autoComplete="off"
          onChange={(event) => dispatch({ type: 'set', pointer, value: event.target.value })}
        />
      )}
    </Field>
  )
}

export function SelectField({
  label,
  pointer,
  value,
  options,
  hint,
  className,
}: BoundProps & { value: string; options: readonly { value: string; label: string }[] }) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  // A value the list does not offer (a font the catalog dropped) stays visible and selected, never silently replaced.
  const offered = options.some((option) => option.value === value) ? options : [...options, { value, label: value }]
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <select
          {...control}
          data-pointer={pointer}
          value={value}
          onChange={(event) => dispatch({ type: 'set', pointer, value: event.target.value })}
        >
          {offered.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function BoolField({ label, pointer, checked, hint, className }: BoundProps & { checked: boolean }) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  return (
    <CheckboxField
      label={label}
      hint={hint}
      error={error}
      className={className}
      checked={checked}
      data-pointer={pointer}
      onChange={(next) => dispatch({ type: 'set', pointer, value: next })}
    />
  )
}

export function ColourField({ label, pointer, value, hint, className }: BoundProps & { value: string }) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  return (
    <ColourInput
      label={label}
      hint={hint}
      error={error}
      className={className}
      value={value}
      data-pointer={pointer}
      onChange={(next) => dispatch({ type: 'set', pointer, value: next })}
    />
  )
}

/** A choice of a few, as a radio group (the first radio takes `describedBy`, e.g. a refusal of the whole frame). */
export function RadioField<T extends string>({
  label,
  pointer,
  value,
  options,
  hint,
  className,
  describedBy,
}: BoundProps & {
  value: T
  options: readonly { value: T; label: string }[]
  describedBy?: string
}) {
  const { dispatch } = useForm()
  const error = useFieldError(pointer)
  const name = useId()
  return (
    <RadioGroupField label={label} hint={hint} error={error} className={className}>
      {options.map((option, index) => (
        <label key={option.value}>
          <input
            type="radio"
            name={name}
            data-pointer={pointer}
            aria-describedby={index === 0 ? describedBy : undefined}
            checked={option.value === value}
            onChange={() => dispatch({ type: 'set', pointer, value: option.value })}
          />
          {option.label}
        </label>
      ))}
    </RadioGroupField>
  )
}
