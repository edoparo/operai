/**
 * dates — refund-ui's date display (T16, specs/20260716-refund-service). API values stay ISO 8601;
 * INC-26: the formatting is the suite's `formatDate`/`formatDateTime` from
 * `@operai/ui` — numeric `DD.MM.YYYY` (24-hour `HH:mm` for a timestamp) for
 * every viewer, the civil format in both CH and IT, so an employee in Italy and
 * an accountant in Switzerland read the same characters on a shared financial
 * record. A date-only value (`2026-08-11`, a line's date) is the calendar day,
 * never shifted by the viewer's time zone; a timestamp is shown in the viewer's
 * zone. This module only adds refund's guard for an unparseable value ("—").
 */

import { formatDate as formatDateIntl, formatDateTime as formatDateTimeIntl } from '@operai/ui'

const UNPARSEABLE = '—'

const parseable = (iso: string): boolean => !Number.isNaN(Date.parse(iso))

/** `DD.MM.YYYY` for an ISO date or timestamp; "—" when unparseable. */
export const formatDate = (iso: string): string => (parseable(iso) ? formatDateIntl(iso) : UNPARSEABLE)

/**
 * `DD.MM.YYYY HH:mm` for a timestamp — where a bare date is ambiguous (a batch
 * cutoff, a generated/paid/discarded stamp). "—" when unparseable.
 */
export const formatDateTime = (iso: string): string => (parseable(iso) ? formatDateTimeIntl(iso) : UNPARSEABLE)

/**
 * Today's date as a `yyyy-mm-dd` string — the default value for a new expense
 * line's Date field.
 *
 * Stays ISO deliberately: this feeds an `<input type="date">`, whose `value`
 * is defined by HTML to be `yyyy-mm-dd` regardless of what the browser shows
 * the user. It is a wire format, not a display one.
 */
export const todayIsoDate = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
