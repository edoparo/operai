/**
 * The activity view (specs/028 plan § API contracts): crm-api's `ActivityView` unchanged, plus
 * `kind`, `project {id, name}|null` and `may {edit, delete, complete}` computed per caller from
 * the host's answer and the registry rules (design G4: the UI never guesses). No hrefs: the
 * UIs build `/crm/...` and `/projects/...` links from ids (design G8). Labels (company, contact,
 * deal, project) come from the host's resolve answer; one the host no longer returns renders
 * `name: null` (`title: null` for a deal).
 */

import { z } from "@hono/zod-openapi";
import type { Prisma } from "../lib/generated/prisma/client";
import { PersonRefSchema, toDateOnly, type HeaderSource } from "../lib/http";
import { loadPeople } from "../lib/people";
import type { RelatedType } from "../hosts/registry";
import type { HostSession, OpenEntity } from "./access";
import { mayFlags } from "./rules";
import { FileSchema, storedFiles, toFileView } from "../files/files";

export const ACTIVITY_TYPES = ["note", "call", "meeting", "email", "task"] as const;
export const ACTIVITY_KINDS = ["pre_sales", "operational"] as const;

const MayFlagsSchema = z.object({ edit: z.boolean(), delete: z.boolean(), complete: z.boolean() });

export const ActivitySchema = z.object({
  id: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  type: z.enum(ACTIVITY_TYPES),
  subject: z.string(),
  /** Null for a meeting activity: its content is the meeting, reached through `meeting` (specs/021 AC-14.2). */
  body: z.string().nullable(),
  occurredAt: z.string(),
  /** The CRM company (a pre-sales activity), else null. */
  company: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  /** The project (an operational task), else null. */
  project: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  contact: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
  deal: z.object({ id: z.string(), title: z.string().nullable() }).nullable(),
  author: PersonRefSchema,
  /** The wellD colleagues who took part, besides the author and the assignee (US-8, specs/028 US-5). */
  participants: z.array(PersonRefSchema),
  /** The Meetings meeting this activity mirrors (specs/021 US-14), or null. */
  meeting: z.object({ id: z.string(), href: z.string() }).nullable(),
  task: z
    .object({
      dueDate: z.string().nullable(),
      assignee: PersonRefSchema.nullable(),
      completedAt: z.string().nullable(),
      completedBy: PersonRefSchema.nullable(),
      /** The tasks it waits on (US-6); `blocked` while any of them is open. */
      blockedBy: z.array(z.object({ id: z.string(), subject: z.string(), completed: z.boolean() })),
      blocked: z.boolean(),
      /** The task's rich description (ADR-0089): a TipTap document, or null. */
      description: z.record(z.string(), z.unknown()).nullable(),
      /** Its stored images and attachments, oldest first. */
      files: z.array(FileSchema),
    })
    .nullable(),
  may: MayFlagsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const withRefs = {
  blockedBy: {
    select: { blocker: { select: { id: true, subject: true, completedAt: true } } },
    orderBy: { createdAt: "asc" },
  },
  // Insertion order (the rows of one write are staggered by `staggered`); the user id breaks any remaining tie.
  participants: { select: { userId: true }, orderBy: [{ createdAt: "asc" }, { userId: "asc" }] },
  files: storedFiles,
} satisfies Prisma.ActivityInclude;
export type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof withRefs }>;

type Caller = HeaderSource & { get(key: "userId"): string };

/** The related contact/deal ids a set of rows refers to, per company, as the resolve call wants them. */
export function relatedIdsOf(rows: readonly Pick<ActivityRow, "contactId" | "dealId">[]): Record<RelatedType, string[]> {
  return {
    contact: rows.flatMap((row) => (row.contactId ? [row.contactId] : [])),
    deal: rows.flatMap((row) => (row.dealId ? [row.dealId] : [])),
  };
}

/** Asks each host once for the entities (and contacts/deals) the rows hang on. */
export async function loadHostsFor(session: HostSession, rows: readonly ActivityRow[]): Promise<void> {
  for (const host of session.registry.all()) {
    const mine = rows.filter((row) => row.hostApp === host.app && row.hostType === host.entityType);
    if (mine.length === 0) continue;
    await session.load(
      host,
      mine.map((row) => row.hostId),
      relatedIdsOf(mine),
    );
  }
}

const labelOf = (entity: ReturnType<HostSession["entity"]>): string | null => (entity?.state === "open" ? entity.label : null);

export async function toViews(c: Caller, rows: readonly ActivityRow[], session: HostSession) {
  await loadHostsFor(session, rows);
  const userId = c.get("userId");
  const { person, maybe } = await loadPeople(
    c,
    rows.flatMap((row) => [
      row.authorUserId,
      row.assigneeUserId,
      row.completedByUserId,
      ...row.participants.map((participant) => participant.userId),
      ...row.files.map((file) => file.uploadedByUserId),
    ]),
  );
  return rows.map((row) => {
    const host = session.registry.get(row.hostApp, row.hostType);
    // The init migration's CHECK allows only the two registered hosts: anything else is a fault, not a 404.
    if (!host) throw new Error(`activity ${row.id} belongs to an unregistered host ${row.hostApp}/${row.hostType}`);
    const entity = session.entity(host, row.hostId);
    const open: OpenEntity | undefined = entity?.state === "open" ? entity : undefined;
    const ref = { id: row.hostId, name: labelOf(entity) };
    const contact = row.contactId ? session.relatedOf("contact", row.contactId, row.hostId) : undefined;
    const deal = row.dealId ? session.relatedOf("deal", row.dealId, row.hostId) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      type: row.type,
      subject: row.subject,
      // AC-14.2: a meeting activity's body is the link and nothing else, whatever the row holds.
      body: row.meetingId === null ? row.body : null,
      occurredAt: row.occurredAt.toISOString(),
      company: host.entityType === "company" ? ref : null,
      project: host.entityType === "project" ? ref : null,
      contact: row.contactId ? { id: row.contactId, name: contact?.label ?? null } : null,
      deal: row.dealId ? { id: row.dealId, title: deal?.label ?? null } : null,
      author: person(row.authorUserId),
      participants: row.participants.map((participant) => person(participant.userId)),
      meeting: row.meetingId === null ? null : { id: row.meetingId, href: `/my-meetings/m/${row.meetingId}` },
      task:
        row.type === "task"
          ? {
              dueDate: toDateOnly(row.dueDate),
              assignee: maybe(row.assigneeUserId),
              completedAt: row.completedAt?.toISOString() ?? null,
              completedBy: maybe(row.completedByUserId),
              blockedBy: row.blockedBy.map(({ blocker }) => ({
                id: blocker.id,
                subject: blocker.subject,
                completed: blocker.completedAt !== null,
              })),
              blocked: row.blockedBy.some(({ blocker }) => blocker.completedAt === null),
              description: (row.description as Record<string, unknown> | null) ?? null,
              files: row.files.map((file) => toFileView(file, person)),
            }
          : null,
      may: mayFlags(host, open, row, userId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function toView(c: Caller, row: ActivityRow, session: HostSession) {
  const [view] = await toViews(c, [row], session);
  return view!;
}
