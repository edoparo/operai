import { parseDecimal } from '@operai/ui'

export type Parsed<V> = { ok: true; value: V | null } | { ok: false }

/** Integer cents → the text a person edits (`1200.5` is shown `1200.50`). */
export const centsText = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`

/** Basis points → a percentage as typed (`750` → `7.5`). */
export const percentText = (bp: number): string => String(Number((bp / 100).toFixed(2)))

export const parseCents = (text: string): Parsed<number> => {
  if (text.trim() === '') return { ok: true, value: null }
  const cents = parseDecimal(text, 2)
  return cents === null ? { ok: false } : { ok: true, value: cents }
}

export const parseCount = (text: string): Parsed<number> => {
  const typed = text.trim()
  if (typed === '') return { ok: true, value: null }
  return /^\d{1,9}$/.test(typed) ? { ok: true, value: Number(typed) } : { ok: false }
}
