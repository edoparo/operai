/**
 * Due-date reminders: an email the day BEFORE a task's due date, from 08:00 Europe/Zurich, to its assignee and its
 * participants, for every task in this service (CRM pre-sales and Projects operational). The pattern of ADR
 * 20261118-assignment-reminders-in-process-scheduler-claimed-by-cas (inventory-api's assignment reminders).
 *
 * WHEN. The rule is `dueReminderClock.ts` (pure): an open task whose due date is Zurich's tomorrow, from 08:00, not yet
 * reminded for that due date (`dueReminderSentFor`). One reminder per due date: re-dating a task gives the new date its
 * own; a task due today or earlier, or done, never gets one. Being due is DERIVED from the row on every tick.
 *
 * HOW. In-process: `startDueReminderScheduler` ticks every 15 minutes. Each reminder is CLAIMED first with a
 * conditional update (`dueReminderSentFor := dueDate` only while the task is still open, still due that day and not
 * yet claimed for it), so two ticks or two replicas never send the same reminder twice: the claim decides. The task is
 * then read again; if it was completed or re-dated after the claim, nothing is sent and the claim is given back. Then
 * the push (in-app + email, through notify-api, one request per recipient with an idempotency key per task, due date
 * and recipient). If notify-api does not take it for every recipient (an HTTP error, the network, no notifier wired)
 * the claim is given back, only if it is still ours, and the next tick tries again; the keys make that retry silent
 * for whoever already got it. A process lost between claim and push loses at most that one reminder, never sends two.
 *
 * WHAT. Only the task's subject, its due date and its tool (`renderDueReminder`): never the body or the description
 * (US-9), never a host label (there is no user JWT to ask the host with). Logs carry the kind, the activity id and a
 * status, or counts: never a subject, a name or an address.
 */

import { createHash } from "node:crypto";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { errorFacts } from "../lib/errorFacts";
import { deliver, notificationsActive, type Delivery } from "../lib/notify";
import { DUE_REMINDER_KIND, renderDueReminder } from "../lib/notificationCopy";
import { reminderDueDate } from "./dueReminderClock";

export { isDue, reminderDueDate } from "./dueReminderClock";

export const DUE_REMINDER_TICK_MS = 15 * 60_000;
/** At most this many reminders per tick; the rest go on the next one. */
const TICK_BATCH = 200;

/** The seams a test replaces. */
export const dueReminderDeps = {
  send: (delivery: Delivery): Promise<boolean> => deliver(delivery),
  active: (): boolean => notificationsActive(),
  /** Runs between the claim and the re-read (a no-op; a test changes the row there). */
  afterClaim: async (_activityId: string): Promise<void> => {},
};

/** notify-api's idempotency key rule: ≤ 200 characters of `[A-Za-z0-9._:-]`. */
const KEY_SHAPE = /^[A-Za-z0-9._:-]{1,200}$/;

/** One key per (task, due date, recipient): readable when the ids allow it, else a hash of the same three. */
export function dueReminderKey(activityId: string, dueDate: string, recipientId: string): string {
  const readable = `task-due:${activityId}:${dueDate}:${recipientId}`;
  if (KEY_SHAPE.test(readable)) return readable;
  return `task-due:${createHash("sha256").update(`${activityId}\u0000${dueDate}\u0000${recipientId}`).digest("hex")}`;
}

type Outcome = "sent" | "lost_race" | "changed" | "not_sent";

interface Claimed {
  readonly id: string;
  readonly subject: string;
  readonly hostApp: "crm" | "projects";
  readonly hostId: string;
  readonly assigneeUserId: string | null;
}

/** Claims, re-checks and sends one reminder for `dueDate`. */
async function remind(id: string, dueDate: string): Promise<Outcome> {
  const claimed = await db.$queryRaw<Claimed[]>`
    UPDATE "activity" SET "dueReminderSentFor" = "dueDate"
    WHERE "id" = ${id} AND "type" = 'task' AND "completedAt" IS NULL AND "dueDate" = ${dueDate}::date
      AND "dueReminderSentFor" IS DISTINCT FROM "dueDate"
    RETURNING "id", "subject", "hostApp"::text AS "hostApp", "hostId", "assigneeUserId"`;
  const row = claimed[0];
  if (!row) return "lost_race";

  // Give the claim back: only if it is still ours (still this due date), so a later claim is never undone. Back to
  // null rather than the earlier value: an earlier date is in the past and can never be due again, so nothing is lost.
  const giveBack = () => db.$executeRaw`
    UPDATE "activity" SET "dueReminderSentFor" = NULL WHERE "id" = ${id} AND "dueReminderSentFor" = ${dueDate}::date`;

  try {
    await dueReminderDeps.afterClaim(id);
    // Read again AFTER the claim: a task completed or re-dated in between is not reminded.
    const task = await db.activity.findFirst({
      where: { id, type: "task", completedAt: null, dueDate: new Date(`${dueDate}T00:00:00Z`) },
      select: { participants: { select: { userId: true } } },
    });
    if (!task) {
      await giveBack();
      return "changed";
    }
    const delivery: Delivery = {
      kind: DUE_REMINDER_KIND,
      activityId: row.id,
      recipientIds: [row.assigneeUserId, ...task.participants.map((p) => p.userId)],
      notification: renderDueReminder(
        { subject: row.subject, dueDate },
        row.hostApp === "projects" ? { host: "projects", projectId: row.hostId } : { host: "crm" },
      ),
      idempotencyKeyFor: (recipientId) => dueReminderKey(row.id, dueDate, recipientId),
    };
    if (await dueReminderDeps.send(delivery)) return "sent";
    await giveBack();
    return "not_sent";
  } catch (error) {
    await giveBack();
    throw error;
  }
}

/** One tick: every open task due tomorrow (Zurich) gets its reminder, from 08:00. Never throws. */
export async function runDueTaskReminders(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const dueDate = reminderDueDate(now);
    // Nothing before 08:00 Zurich, nothing without a notifier, and nothing in maintenance (AC-2.5: no write while the
    // CRM's activities are copied in; the reminders go on the first tick after it).
    if (dueDate === null || !dueReminderDeps.active() || env.ACTIVITIES_MAINTENANCE) return { sent, failed };
    const due = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "activity"
      WHERE "type" = 'task' AND "completedAt" IS NULL AND "dueDate" = ${dueDate}::date
        AND "dueReminderSentFor" IS DISTINCT FROM "dueDate"
      ORDER BY "createdAt", "id"
      LIMIT ${TICK_BATCH}`;
    for (const { id } of due) {
      // One task's failure never stops the others.
      const outcome = await remind(id, dueDate).catch((error: unknown) => {
        console.error(`[due-reminders] ${DUE_REMINDER_KIND} activity=${id} failed:`, errorFacts(error));
        return "not_sent" as const;
      });
      if (outcome === "sent") sent++;
      if (outcome === "not_sent") {
        failed++;
        console.error(`[due-reminders] ${DUE_REMINDER_KIND} activity=${id} not sent — claim given back, retried next tick`);
      }
    }
  } catch (error) {
    console.error("[due-reminders] tick failed:", errorFacts(error));
  }
  // Counts only.
  if (sent > 0 || failed > 0) console.log(`[due-reminders] sent=${sent} failed=${failed}`);
  return { sent, failed };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Starts the tick (the server entry calls it). Off under `NODE_ENV=test` and when `TASK_DUE_REMINDERS=off`. One tick
 * at a time per process; the conditional claim makes concurrent processes safe.
 */
export function startDueReminderScheduler(intervalMs: number = DUE_REMINDER_TICK_MS): void {
  if (timer !== null || env.NODE_ENV === "test" || env.TASK_DUE_REMINDERS === "off") return;
  if (!notificationsActive()) console.log("[due-reminders] notifications are disabled — no due-date reminder will be sent");
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueTaskReminders();
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
}
