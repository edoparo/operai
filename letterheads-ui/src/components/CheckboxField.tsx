import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx } from '@operai/ui'

export type CheckboxFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'onChange' | 'children' | 'className' | 'id'
> & {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  /** Help under the checkbox; the checkbox is described by it. */
  hint?: ReactNode
  /** The refusal of the value; marks the checkbox invalid and describes it. */
  error?: ReactNode
  className?: string
}

/**
 * CheckboxField — one labelled checkbox with the hint and error wiring of `Field` (`aria-describedby`,
 * `aria-invalid`). `CheckboxGroupField` in @operai/ui is a group of them under a legend; the configurator
 * has a dozen single ones (a bold flag, a rule on or off, a variant on or off), each a field of its own.
 * The label wraps the box, so the whole line is the click target. Extra props (`data-pointer`, `disabled`)
 * go to the input.
 */
export function CheckboxField({ label, checked, onChange, hint, error, className, ...rest }: CheckboxFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('field', className)}>
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          {...rest}
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}
