import type { InputHTMLAttributes, ReactNode } from 'react'
import { cx, Field } from '@operai/ui'

export type ColourInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'className' | 'id' | 'inputMode'
> & {
  label: ReactNode
  /** Six hexadecimal digits, no `#` (the stored form); anything else the person typed is shown as typed. */
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  error?: ReactNode
  className?: string
}

const HEX6 = /^[0-9a-fA-F]{6}$/

/**
 * ColourInput — a colour as six hex digits (design S1 "Colour"): a text input with a `#` adornment and a
 * swatch of the current value. The hex is the value; the swatch and the `#` are decoration
 * (`aria-hidden`), so the colour is never conveyed by the swatch alone. A leading `#` that is typed or
 * pasted is dropped, and surrounding spaces on blur. Nothing else is checked here: a value that is not six
 * hex digits is sent as typed and refused by the service (`bad_colour`), which is shown through `error`.
 * The library has no colour input, and a native `type="color"` hides the value and cannot show a refusal.
 */
export function ColourInput({ label, value, onChange, hint, error, className, onBlur, ...rest }: ColourInputProps) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(control) => (
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="font-mono text-soft">
            #
          </span>
          <input
            {...rest}
            {...control}
            type="text"
            className="input-figure w-28"
            value={value}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(event) => {
              const typed = event.target.value
              onChange(typed.startsWith('#') ? typed.slice(1) : typed)
            }}
            onBlur={(event) => {
              const trimmed = value.trim()
              if (trimmed !== value) onChange(trimmed)
              onBlur?.(event)
            }}
          />
          {/* The swatch is the one place a colour is drawn from data: the person's own value, only when it is a valid hex. */}
          <span
            aria-hidden="true"
            data-swatch={HEX6.test(value) ? value.toLowerCase() : 'none'}
            className={cx('h-5 w-5 shrink-0 rounded border border-muted', !HEX6.test(value) && 'bg-ink-mid')}
            style={HEX6.test(value) ? { backgroundColor: `#${value}` } : undefined}
          />
        </div>
      )}
    </Field>
  )
}
