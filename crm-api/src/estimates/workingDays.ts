/**
 * Calendar arithmetic for the estimate task's due date (specs/018 AC-3.5).
 * Pure: kept out of the routes module so tests import it without loading the
 * guard stack.
 */

/** `from` plus `days` working days (Monday–Friday, UTC dates; no holidays). */
export function addWorkingDays(from: Date, days: number): Date {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return date;
}
