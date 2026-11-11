/**
 * "Blocked by" between tasks (specs/028 US-4, AC-4.1..4.3, AC-6.3; carried over from crm-api's
 * specs/017 US-6). A task may wait on other tasks of the SAME host entity: the company of a
 * CRM task, the project of a project task. While one of them is open the task cannot be
 * completed (409 `task_blocked`); when the last one closes, the blocked task's assignee is
 * told, in-app and by email (`task_unblocked`).
 *
 * "The same host entity" is the whole host rule: a pre-sales task never blocks an operational
 * one and the reverse, and two entities of one host never block each other, so there is no
 * `if (app === ...)` here, only `(hostApp, hostType, hostId)` equality.
 *
 * The routes own the transaction and the notification text; this file owns the rules:
 *
 *   assertBlockers      the set is acceptable: not the task itself (`blocker_is_self`), every id
 *                       a task of the same host entity (`blocker_not_in_host`), no cycle
 *                       (`blocker_cycle`). At most {@link MAX_BLOCKERS} is the request
 *                       schema's bound.
 *   replaceBlockers     writes the whole set inside the caller's transaction, in the order given.
 *   assertUnblocked     409 `task_blocked` naming the open blockers.
 *   announceUnblocked   `task_unblocked` to the assignee of each task the completion frees.
 */

import type { Prisma } from "../lib/generated/prisma/client";
import { db } from "../lib/db";
import type { HeaderSource } from "../lib/http";
import { announce } from "../lib/notify";
import { errorFacts } from "../lib/errorFacts";
import type { NotifyActivity, NotifyTarget } from "../lib/notificationCopy";
import { ProblemError, unprocessable } from "../lib/problem";
import type { HostApp } from "../hosts/registry";
import { staggered } from "./stagger";

export const MAX_BLOCKERS = 10;

/** Where a task lives: the host entity its blockers must share. */
export interface TaskHostRef {
  readonly hostApp: HostApp;
  readonly hostType: string;
  readonly hostId: string;
}

/**
 * The blockers a task may have: distinct tasks of `host`, not the task itself, and no cycle (a
 * blocker that, directly or not, waits on this task). `taskId` is null for a task not created yet,
 * which nothing can wait on, so it can neither be its own blocker nor close a cycle.
 */
export async function assertBlockers(host: TaskHostRef, taskId: string | null, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const field = { field: "blockedByIds" };
  if (taskId !== null && unique.includes(taskId)) {
    throw unprocessable("A task cannot block itself", field, "blocker_is_self");
  }
  if (unique.length === 0) return unique;
  const found = await db.activity.findMany({
    where: { id: { in: unique } },
    select: { id: true, type: true, hostApp: true, hostType: true, hostId: true },
  });
  const sameHost = (row: TaskHostRef) => row.hostApp === host.hostApp && row.hostType === host.hostType && row.hostId === host.hostId;
  if (found.length !== unique.length || found.some((row) => row.type !== "task" || !sameHost(row))) {
    throw unprocessable("Every blocker must be a task of the same company or project", field, "blocker_not_in_host");
  }
  if (taskId !== null && (await reaches(unique, taskId, host))) {
    throw unprocessable("These blockers would make the tasks wait on each other", field, "blocker_cycle");
  }
  return unique;
}

/** True when `target` is among `from` or what they wait on, transitively (every edge stays inside one host entity). */
async function reaches(from: readonly string[], target: string, host: TaskHostRef): Promise<boolean> {
  const edges = await db.taskBlocker.findMany({
    where: { blocked: { hostApp: host.hostApp, hostType: host.hostType, hostId: host.hostId } },
    select: { blockedId: true, blockerId: true },
  });
  const waitsOn = new Map<string, string[]>();
  for (const edge of edges) waitsOn.set(edge.blockedId, [...(waitsOn.get(edge.blockedId) ?? []), edge.blockerId]);
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(waitsOn.get(id) ?? []));
  }
  return false;
}

/** The nested-create rows of a new task's blockers, in the order given. */
export function newBlockerRows(blockerIds: readonly string[], userId: string) {
  return staggered(blockerIds).map(({ id: blockerId, createdAt }) => ({ blockerId, createdBy: userId, createdAt }));
}

/** Replaces the task's whole set of blockers; call inside the write's transaction. */
export async function replaceBlockers(
  tx: Prisma.TransactionClient,
  taskId: string,
  blockerIds: readonly string[],
  userId: string,
): Promise<void> {
  await tx.taskBlocker.deleteMany({ where: { blockedId: taskId } });
  if (blockerIds.length === 0) return;
  await tx.taskBlocker.createMany({ data: newBlockerRows(blockerIds, userId).map((row) => ({ blockedId: taskId, ...row })) });
}

/** 409 `task_blocked` naming the open blockers, or nothing. */
export async function assertUnblocked(taskId: string): Promise<void> {
  const open = await db.taskBlocker.findMany({
    where: { blockedId: taskId, blocker: { completedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { blocker: { select: { id: true, subject: true } } },
  });
  if (open.length > 0) {
    throw new ProblemError({
      status: 409,
      code: "task_blocked",
      detail: `This task waits on ${open.length === 1 ? "an open task" : `${open.length} open tasks`}`,
      extras: { blockers: open.map((row) => row.blocker) },
    });
  }
}

/** A task the completion of `completedIds` has freed: open, and waiting on nothing open any more. */
export interface FreedTask extends NotifyActivity, TaskHostRef {
  readonly assigneeUserId: string | null;
  readonly dealId: string | null;
}

/** Open tasks that waited on one of `completedIds` and now wait on no open task. */
export async function freedBy(completedIds: readonly string[]): Promise<FreedTask[]> {
  if (completedIds.length === 0) return [];
  return db.activity.findMany({
    where: {
      type: "task",
      completedAt: null,
      blockedBy: { some: { blockerId: { in: [...completedIds] } }, none: { blocker: { completedAt: null } } },
    },
    select: { id: true, type: true, subject: true, dueDate: true, assigneeUserId: true, dealId: true, hostApp: true, hostType: true, hostId: true },
  });
}

/**
 * After `completedIds` closed: every open task that waited on one of them and now waits on
 * nothing open is announced to its assignee (in-app + email); the actor is never told
 * (`announce` drops them). `targetOf` is what the notification copy shows of where the task
 * lives, which only the caller (who holds the host's answers) knows. Best effort: `announce`
 * never throws, and a failure to LOOK the freed tasks up is logged, never raised, so the
 * completion that was already committed is not reported as failed.
 */
export async function announceUnblocked(
  c: HeaderSource & { get(key: "userId"): string },
  completedIds: readonly string[],
  targetOf: (task: FreedTask) => NotifyTarget | Promise<NotifyTarget>,
): Promise<void> {
  let freed: FreedTask[];
  try {
    freed = await freedBy(completedIds);
  } catch (error) {
    console.error("[blockers] could not look up the tasks a completion freed:", errorFacts(error));
    return;
  }
  for (const task of freed) {
    try {
      await announce(c, {
        kind: "task_unblocked",
        activityId: task.id,
        recipientIds: [task.assigneeUserId],
        activity: task,
        target: await targetOf(task),
      });
    } catch (error) {
      console.error(`[blockers] could not announce task_unblocked for ${task.id}:`, errorFacts(error));
    }
  }
}
