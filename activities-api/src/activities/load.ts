/**
 * Loading one activity for a request: the row and the host's answer about its entity, for
 * this caller (specs/20261110-activities AC-8.2, AC-8.3). Shared by the activity routes and the task file
 * routes (ADR 20261113-task-description-files-in-activities-api-bucket), so both refuse exactly alike.
 */

import { db } from "../lib/db";
import type { ActivityHost } from "../hosts/registry";
import { HostSession, notFoundProblem } from "./access";
import { relatedIdsOf, withRefs, type ActivityRow } from "./view";

export type Caller = {
  get(key: "userId"): string;
  req: { header(name: string): string | undefined };
};

export const authorizationOf = (c: Caller) => c.req.header("Authorization") ?? "";

/**
 * Prisma's "record to update not found" (P2025): the activity was deleted between the host's
 * answer and the write. To the caller it is simply gone: the same 404 as any other.
 */
export async function ifStillThere<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025") throw notFoundProblem();
    throw error;
  }
}

export function hostOf(session: HostSession, row: Pick<ActivityRow, "hostApp" | "hostType">): ActivityHost {
  const host = session.registry.get(row.hostApp, row.hostType);
  if (!host) throw notFoundProblem();
  return host;
}

/**
 * An existing activity and the host's answer about its entity, for this caller. Every route
 * that touches one starts here: a missing activity, an unreadable one and a missing entity are
 * the same 404 (AC-8.3), a host that cannot answer is the 503 (AC-8.2), and nothing past this
 * point runs for a caller the host did not confirm.
 */
export async function loadFor(
  c: Caller,
  id: string,
  extraRelated: { contact?: readonly (string | null | undefined)[]; deal?: readonly (string | null | undefined)[] } = {},
) {
  const row = await db.activity.findUnique({ where: { id }, include: withRefs });
  if (!row) throw notFoundProblem();
  const session = new HostSession(authorizationOf(c));
  const host = hostOf(session, row);
  const own = relatedIdsOf([row]);
  const present = (list: readonly (string | null | undefined)[] | undefined) => (list ?? []).filter((v): v is string => !!v);
  await session.load(host, [row.hostId], {
    contact: [...own.contact, ...present(extraRelated.contact)],
    deal: [...own.deal, ...present(extraRelated.deal)],
  });
  const entity = session.open(host, row.hostId);
  return { row, session, host, entity };
}

