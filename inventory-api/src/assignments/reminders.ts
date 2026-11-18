/**
 * Reminders to confirm a pending assignment (specs/20261006-hardware-inventory US-15,
 * ADR 20261118-assignment-reminders-in-process-scheduler-claimed-by-cas).
 *
 * WHEN. An assignment still `pending` 24 hours after the offer gets its first reminder, then one every 7 days until
 * the employee confirms or declines (or the manager cancels). The clock is `lastReminderAt`: a reminder an inventory
 * manager forces from the UI counts as one and restarts the week. Being due is DERIVED from the row on every tick,
 * never stored.
 *
 * HOW. In-process: `startReminderScheduler` ticks every 15 minutes and sends what is due. Each reminder is CLAIMED
 * first with a compare-and-set on `lastReminderAt` (the value it was read with), so two ticks, two replicas or a tick
 * and a forced send can never send the same reminder twice. Then the push (in-app + email, through notify-api). If the
 * push fails the claim is given back (the same CAS, reversed) and the next tick tries again; if it succeeds the history
 * records `assignment_reminded`. A lost process between claim and push loses at most that one reminder, never sends two.
 *
 * Forced: `remindNow` (the route) refuses an assignment that is not pending (409 `assignment_not_pending`) or was
 * reminded less than an hour ago (409 `reminder_too_soon`, with `retryAfterSeconds`), and answers 502
 * `reminder_not_sent` when notify-api did not take it (nothing changed).
 */

import { db } from "../lib/db";
import { env } from "../lib/env";
import { ProblemError, conflict, notFound } from "../lib/problem";
import { notifier } from "../lib/notify";
import { recordEvent } from "../history/record";
import { FIRST_REMINDER_AFTER_MS, FORCED_REMINDER_COOLDOWN_MS, REMINDER_EVERY_MS, isDue, type ReminderFacts } from "./reminderClock";

export { FIRST_REMINDER_AFTER_MS, FORCED_REMINDER_COOLDOWN_MS, REMINDER_EVERY_MS, isDue, nextReminderAt } from "./reminderClock";
export const REMINDER_TICK_MS = 15 * 60_000;
/** At most this many reminders per tick; the rest are due on the next one. */
const TICK_BATCH = 200;

/** The actor recorded for an automatic reminder. */
export const REMINDER_ACTOR = { userId: "system:reminders", email: "system:reminders" } as const;

type Actor = { readonly userId: string; readonly email: string };

/** The seams a test replaces. */
export const reminderDeps = {
  send: (event: Parameters<typeof notifier.notifyReminder>[0]) => notifier.notifyReminder(event),
};

type Outcome = "sent" | "not_due" | "lost_race" | "not_sent";

/**
 * Claims, sends and records one reminder. `check` decides whether it may go now (due for the automatic one, outside
 * the cooldown for a forced one); it sees the row as read, and the claim holds only if the row is still that.
 */
async function remind(assignmentId: string, now: Date, actor: Actor, check: (a: ReminderFacts) => boolean): Promise<Outcome> {
  const row = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, assetId: true, assigneeUserId: true, status: true, createdAt: true, lastReminderAt: true, reminderCount: true },
  });
  if (!row || row.status !== "pending") return "not_due";
  if (!check(row)) return "not_due";

  const claimed = await db.assignment.updateMany({
    where: { id: row.id, status: "pending", lastReminderAt: row.lastReminderAt },
    data: { lastReminderAt: now, reminderCount: { increment: 1 } },
  });
  if (claimed.count !== 1) return "lost_race";

  const asset = await db.asset.findUnique({ where: { id: row.assetId }, select: { description: true, entity: true } });
  const sent =
    asset !== null &&
    (await reminderDeps.send({ assignmentId: row.id, assetDescription: asset.description, assigneeUserId: row.assigneeUserId, offeredAt: row.createdAt }));

  // Give the claim back: only if it is still ours, so a later claim is never undone.
  const giveBack = () =>
    db.assignment.updateMany({
      where: { id: row.id, lastReminderAt: now },
      data: { lastReminderAt: row.lastReminderAt, reminderCount: { decrement: 1 } },
    });

  if (!sent) {
    await giveBack();
    return "not_sent";
  }

  try {
    await db.$transaction((tx) =>
      recordEvent(tx, {
        assetId: row.assetId,
        entity: asset.entity,
        action: "assignment_reminded",
        actor,
        changes: [{ field: "reminder", from: row.reminderCount, to: row.reminderCount + 1 }],
      }),
    );
  } catch (error) {
    // No history entry, no claim: a reminder the history does not show must not move the clock either. The push has
    // gone already, so the next one may repeat it: a duplicate reminder over a silent gap in the record.
    await giveBack();
    throw error;
  }
  return "sent";
}

/** One tick: every pending assignment that is due gets its reminder. Never throws. */
export async function runDueReminders(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const firstDue = new Date(now.getTime() - FIRST_REMINDER_AFTER_MS);
    const weekAgo = new Date(now.getTime() - REMINDER_EVERY_MS);
    const due = await db.assignment.findMany({
      where: {
        status: "pending",
        createdAt: { lte: firstDue },
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: weekAgo } }],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: TICK_BATCH,
    });
    for (const { id } of due) {
      // One assignment's failure never stops the others.
      const outcome = await remind(id, now, REMINDER_ACTOR, (a) => isDue(a, now)).catch((error: unknown) => {
        console.error("[reminders] one reminder failed:", error instanceof Error ? error.name : "unknown error");
        return "not_sent" as const;
      });
      if (outcome === "sent") sent++;
      if (outcome === "not_sent") failed++;
    }
  } catch (error) {
    console.error("[reminders] tick failed:", error instanceof Error ? error.name : "unknown error");
  }
  // Counts only: never an id, a person or a description.
  if (sent > 0 || failed > 0) console.log(`[reminders] sent=${sent} failed=${failed}`);
  return { sent, failed };
}

/** A reminder forced by an inventory manager (the route has checked capability and scope). */
export async function remindNow(assignmentId: string, actor: Actor, now: Date = new Date()): Promise<void> {
  const row = await db.assignment.findUnique({ where: { id: assignmentId }, select: { status: true, lastReminderAt: true } });
  if (!row) throw notFound("Assignment not found");
  if (row.status !== "pending") throw conflict("assignment_not_pending", "This assignment is no longer pending");
  const cooldownEnds = row.lastReminderAt ? row.lastReminderAt.getTime() + FORCED_REMINDER_COOLDOWN_MS : 0;
  if (now.getTime() < cooldownEnds) {
    throw conflict("reminder_too_soon", "A reminder was sent less than an hour ago", {
      retryAfterSeconds: Math.ceil((cooldownEnds - now.getTime()) / 1000),
    });
  }
  const outcome = await remind(assignmentId, now, actor, (a) => a.lastReminderAt === null || now.getTime() >= a.lastReminderAt.getTime() + FORCED_REMINDER_COOLDOWN_MS);
  if (outcome === "sent") return;
  if (outcome === "not_sent") {
    throw new ProblemError({ status: 502, code: "reminder_not_sent", detail: "The reminder could not be sent. Nothing was changed; try again later." });
  }
  // The row changed between the checks and the claim (answered, cancelled, or reminded by someone else).
  throw conflict("reminder_too_soon", "Someone else just sent a reminder or the assignment changed", { retryAfterSeconds: 0 });
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Starts the tick (the server entry calls it). Off under `NODE_ENV=test` and when `ASSIGNMENT_REMINDERS=off`. One tick
 * at a time per process; the CAS claim makes concurrent processes safe.
 */
export function startReminderScheduler(intervalMs: number = REMINDER_TICK_MS): void {
  if (timer !== null || env.NODE_ENV === "test" || process.env["ASSIGNMENT_REMINDERS"] === "off") return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueReminders();
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
}
