/**
 * The due-date reminder clock: pure (no I/O, no env), so the rule is tested on its own and the scheduler only asks it.
 *
 * A task that has a due date and is not done gets ONE email reminder the day BEFORE its due date, from 08:00
 * Europe/Zurich on (the first tick at or after 08:00, or the next tick that day for a task created or re-dated later).
 * A task due today or earlier never gets one. One reminder per due date: `dueReminderSentFor` is the date it was sent
 * for, so a task re-dated to another day gets a new one.
 *
 * Dates are calendar dates (`YYYY-MM-DD`), read in Europe/Zurich with `Intl.DateTimeFormat`, so a DST change moves
 * nothing: 08:00 is wall-clock time in Zurich whatever the UTC offset.
 */

export const REMINDER_TIME_ZONE = "Europe/Zurich";
/** The wall-clock hour in Zurich from which the day's reminders go. */
export const REMINDER_HOUR = 8;

const zurichParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: REMINDER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Zurich's calendar date (`YYYY-MM-DD`) and hour (0-23) at `now`. */
export function zurichNow(now: Date): { readonly date: string; readonly hour: number } {
  const parts = Object.fromEntries(zurichParts.formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, hour: Number(parts["hour"]) };
}

/** The calendar day after `date` (`YYYY-MM-DD`), counted on the calendar, never by adding 24 hours of a clock. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The due date whose reminders may go at `now`: Zurich's tomorrow, or `null` before 08:00 Zurich (nothing goes yet).
 */
export function reminderDueDate(now: Date): string | null {
  const { date, hour } = zurichNow(now);
  return hour >= REMINDER_HOUR ? nextDay(date) : null;
}

/** A `DATE` column as Prisma returns it (UTC midnight) or a `YYYY-MM-DD` string, as `YYYY-MM-DD`. */
export const dateOnly = (value: Date | string): string => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

export interface DueReminderFacts {
  readonly type: string;
  readonly dueDate: Date | string | null;
  readonly completedAt: Date | null;
  readonly dueReminderSentFor: Date | string | null;
}

/** Whether the task's reminder is due at `now`: an open task due tomorrow (Zurich), from 08:00, not yet sent for that date. */
export function isDue(task: DueReminderFacts, now: Date): boolean {
  if (task.type !== "task" || task.completedAt !== null || task.dueDate === null) return false;
  const due = reminderDueDate(now);
  if (due === null || dateOnly(task.dueDate) !== due) return false;
  return task.dueReminderSentFor === null || dateOnly(task.dueReminderSentFor) !== due;
}
