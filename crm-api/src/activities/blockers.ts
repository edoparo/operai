/**
 * "Blocked by" between tasks (specs/017 US-6, 2026-11-04). A task may wait on
 * other tasks of the SAME company (any of its deals or none). While one of them
 * is open the task cannot be completed (409 `task_blocked`); when the last one
 * closes, the blocked task's assignee is told, in-app and by email.
 */

import { db } from "../lib/db";
import type { HeaderSource } from "../lib/http";
import { MAX_NAME, announce, clip } from "../lib/notify";
import { ProblemError, unprocessable } from "../lib/problem";

export const MAX_BLOCKERS = 10;

/**
 * The blockers a task may have: distinct tasks of `companyId`, not the task
 * itself, and no cycle (a blocker that, directly or not, waits on this task).
 */
export async function assertBlockers(taskId: string | null, companyId: string, ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const field = { field: "blockedByIds" };
  if (taskId !== null && unique.includes(taskId)) {
    throw unprocessable("A task cannot block itself", field, "blocker_is_self");
  }
  if (unique.length === 0) return unique;
  const found = await db.activity.findMany({
    where: { id: { in: unique } },
    select: { id: true, type: true, companyId: true },
  });
  if (found.length !== unique.length || found.some((row) => row.type !== "task" || row.companyId !== companyId)) {
    throw unprocessable("Every blocker must be a task of the same company", field, "blocker_not_in_company");
  }
  if (taskId !== null && (await reaches(unique, taskId, companyId))) {
    throw unprocessable("These blockers would make the tasks wait on each other", field, "blocker_cycle");
  }
  return unique;
}

/** True when `target` is among `from` or what they wait on, transitively. */
async function reaches(from: readonly string[], target: string, companyId: string): Promise<boolean> {
  const edges = await db.taskBlocker.findMany({
    where: { blocked: { companyId } },
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

export async function replaceBlockers(taskId: string, blockerIds: readonly string[], userId: string): Promise<void> {
  await db.$transaction([
    db.taskBlocker.deleteMany({ where: { blockedId: taskId } }),
    db.taskBlocker.createMany({ data: blockerIds.map((blockerId) => ({ blockedId: taskId, blockerId, createdBy: userId })) }),
  ]);
}

/** 409 `task_blocked` naming the open blockers, or nothing. */
export async function assertUnblocked(taskId: string): Promise<void> {
  const open = await db.taskBlocker.findMany({
    where: { blockedId: taskId, blocker: { completedAt: null } },
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

/**
 * After `completedIds` closed: every open task that waited on one of them and
 * now waits on nothing open is announced to its assignee (in-app + email).
 */
export async function announceUnblocked(
  c: HeaderSource & { get(key: "userId"): string },
  completedIds: readonly string[],
): Promise<void> {
  if (completedIds.length === 0) return;
  const freed = await db.activity.findMany({
    where: {
      completedAt: null,
      blockedBy: { some: { blockerId: { in: [...completedIds] } }, none: { blocker: { completedAt: null } } },
    },
    select: {
      id: true,
      subject: true,
      assigneeUserId: true,
      company: { select: { name: true } },
      deal: { select: { id: true, title: true } },
    },
  });
  for (const task of freed) {
    const context = task.deal ? `Deal: ${clip(task.deal.title, MAX_NAME)}` : `Company: ${clip(task.company.name, MAX_NAME)}`;
    await announce(c, {
      kind: "task_unblocked",
      dealId: task.deal?.id ?? null,
      recipientIds: [task.assigneeUserId],
      severity: "info",
      email: true,
      href: "/crm/tasks",
      copy: (actor) => ({
        title: `You can go ahead: ${clip(task.subject, MAX_NAME)}`,
        body: `${actor} completed the last task this one was waiting on. ${context}.`,
      }),
    });
  }
}
