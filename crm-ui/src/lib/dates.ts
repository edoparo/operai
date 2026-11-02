/** Today's calendar date in the person's time zone, as `YYYY-MM-DD` (the API's date format). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `YYYY-MM-DDTHH:mm` for a `datetime-local` input, in local time. */
export function toLocalDateTimeInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${todayIso(value)}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}

/** A `datetime-local` value back to an ISO 8601 instant; null when it does not parse. */
export function fromLocalDateTimeInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A task is overdue when it is open and its due date is before today. */
export function isOverdue(task: { dueDate: string | null; completedAt: string | null }, today = todayIso()): boolean {
  return task.completedAt === null && task.dueDate !== null && task.dueDate < today
}
