/**
 * dates — display formatting for inventory-ui, on the suite's formatters
 * (INC-26). `formatDate` / `formatDateTime` are @operai/ui's (`dd.mm.yyyy`,
 * `dd.mm.yyyy HH:mm`, the same in every tool), wrapped only to keep this
 * app's "—" for a value that is not a date. A date-only value is the calendar
 * day, never shifted by the viewer's time zone (the library builds it from its
 * own digits); a timestamp is shown in the viewer's time zone.
 *
 * inventory-api carries every date as ISO 8601 (AGENTS.md); display formatting
 * is a UI concern and never feeds back into an API value.
 */
import { formatDate as formatDateUi, formatDateTime as formatDateTimeUi } from '@operai/ui'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const isDate = (iso: string): boolean => DATE_ONLY.test(iso) || !Number.isNaN(new Date(iso).getTime())

/** `DD.MM.YYYY`; "—" for an unparseable input. */
export const formatDate = (iso: string): string => (isDate(iso) ? formatDateUi(iso) : '—')

/** `DD.MM.YYYY HH:mm` (24-hour); "—" for an unparseable input. */
export const formatDateTime = (iso: string): string => (isDate(iso) ? formatDateTimeUi(iso) : '—')

/**
 * Today's date as a `yyyy-mm-dd` string — the default value of a date field.
 * A wire format (an `<input type="date">` value), not a display one.
 */
export const todayIsoDate = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
