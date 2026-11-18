/**
 * The reminder clock (specs/20261006-hardware-inventory US-15): pure, so the asset view (no I/O) and the scheduler
 * share one rule. First reminder 24 h after the offer, then every 7 days after the last one; a forced reminder counts.
 */

const HOUR = 3_600_000;
export const FIRST_REMINDER_AFTER_MS = 24 * HOUR;
export const REMINDER_EVERY_MS = 7 * 24 * HOUR;
export const FORCED_REMINDER_COOLDOWN_MS = HOUR;

export interface ReminderFacts {
  readonly status: string;
  readonly createdAt: Date;
  readonly lastReminderAt: Date | null;
}

/** When the next automatic reminder is due (null when the assignment is no longer pending). */
export function nextReminderAt(a: ReminderFacts): Date | null {
  if (a.status !== "pending") return null;
  return a.lastReminderAt === null
    ? new Date(a.createdAt.getTime() + FIRST_REMINDER_AFTER_MS)
    : new Date(a.lastReminderAt.getTime() + REMINDER_EVERY_MS);
}

export const isDue = (a: ReminderFacts, now: Date): boolean => {
  const next = nextReminderAt(a);
  return next !== null && now.getTime() >= next.getTime();
};
