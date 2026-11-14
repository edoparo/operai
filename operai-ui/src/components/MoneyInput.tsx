import type { InputHTMLAttributes, Ref } from 'react'
import { cx } from '../lib/cx'

/**
 * Parses what a person types into an amount field (`45.50`, `45,5`, `1299`)
 * into integer minor units — cents with `decimals = 2`, micros with 6 —
 * or `null` when it is not a valid non-negative amount with at most
 * `decimals` decimals. `null` means "not a valid amount yet", never 0.
 *
 * Parses the decimal STRING exactly (never `Math.round(n * 100)`, where
 * `1.15 * 100` is 114.99999999999999), accepts the comma the suite displays
 * as well as a dot, and refuses an extra decimal instead of rounding it
 * (ADR 20260720-mileage-rate-money-precision-integer-micros: round exactly once, at compute time). From inventory-ui's
 * `amountToCents`, generalised.
 */
export function parseDecimal(raw: string, decimals = 2): number | null {
  const match = new RegExp(`^(\\d+)(?:[.,](\\d{1,${decimals}}))?$`).exec(raw.trim())
  if (match === null) return null
  const [, whole, fraction = ''] = match
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, '0') || '0')
  return Number.isSafeInteger(minor) ? minor : null
}

export type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> & {
  ref?: Ref<HTMLInputElement>
}

/**
 * MoneyInput — an amount field (INC-17). A text input with the decimal
 * keypad, not `type="number"`: a number input rejects the comma in many
 * locales (the suite displays one) and silently rounds. The value stays the
 * typed text; parse it with `parseDecimal` (cents by default). Figures in DM
 * Mono with tabular digits. Put it in a `Field` and pass its control props.
 */
export function MoneyInput({ className, autoComplete = 'off', ...rest }: MoneyInputProps) {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete={autoComplete}
      className={cx('input-figure', className)}
      {...rest}
    />
  )
}

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  ref?: Ref<HTMLInputElement>
}

/**
 * DateInput — a calendar date (INC-17): the native date picker, whose colour
 * scheme follows the theme (tokens.css), value `YYYY-MM-DD` (ISO 8601, as the
 * APIs expect). Figures in DM Mono like every other figure. Never set
 * `colorScheme` on it.
 */
export function DateInput({ className, ...rest }: DateInputProps) {
  return <input type="date" className={cx('input-figure', className)} {...rest} />
}

export type DateTimeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  ref?: Ref<HTMLInputElement>
}

/** DateTimeInput — a date and a time (`datetime-local`, e.g. a batch cutoff). Same skin as DateInput. */
export function DateTimeInput({ className, ...rest }: DateTimeInputProps) {
  return <input type="datetime-local" className={cx('input-figure', className)} {...rest} />
}
