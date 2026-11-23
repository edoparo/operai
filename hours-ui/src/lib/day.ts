/**
 * The one reading of a calendar day written `YYYY-MM-DD` in hours-ui: the week and month arithmetic, the table's date
 * field, the period helpers and the entry dialog all ask here, so they never disagree about whether a day is real.
 *
 * A day is real when it round-trips through UTC: `2026-02-30` is not (it would read as 2 March), and neither is a year
 * below 100, which `Date.UTC` reads as 1900 + year. Four-digit years only, as the format writes them.
 */
const DAY_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/

/** Midnight UTC of `text`, or `null` when it is not a real day. */
export const dayMs = (text: string): number | null => {
  const parts = DAY_TEXT.exec(text)
  if (!parts) return null
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  return new Date(ms).toISOString().slice(0, 10) === text ? ms : null
}

/** Whether `text` is a real day on the calendar. */
export const isCalendarDay = (text: string): boolean => dayMs(text) !== null
