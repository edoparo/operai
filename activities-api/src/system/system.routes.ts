/**
 * The system routes of activities-api (specs/028 T10; AC-1.2, AC-1.3, AC-1.4, AC-8.4; ADR-0082,
 * plan § API contracts). What crm-api used to do inside its own transactions, it now asks for as
 * itself: a scoped service JWT (scope `activities.write`, `sub` `system:crm-api`, `aud` =
 * SERVICE_AUDIENCE). No user JWT is a credential here, and every credential failure is the same
 * 401 (systemAuth). The maintenance switch answers 503 before this file is reached.
 *
 *   PUT    /system/v1/activities/{id}              create if absent, NEVER overwrite (201 | 200)
 *   DELETE /system/v1/activities/{id}              204; `onlyIfOpen=true` keeps a completed one
 *   POST   /system/v1/activities/{id}/completion   applies only a newer `seq` → {applied}; an optional
 *                                                  `context` {companyName, dealId, dealTitle} labels the
 *                                                  "You can go ahead" notices it triggers
 *   POST   /system/v1/meeting-mirror               the meeting activity of a deal → {applied}
 *   POST   /system/v1/contacts/{contactId}/erase   tombstones the contact and nulls every `contactId` → {unlinked}
 *
 * These routes own CRM records only (`hostApp = crm`): a project activity is never touched by
 * them, whatever the id. crm-api has already decided who may do what, as the user, before it
 * calls; nothing here asks a host. The identity of every write is chosen by the caller, so each
 * call is idempotent and compensable (ADR-0082).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createSystemAuthMiddleware, type SystemAuthVariables } from "../auth/systemAuth.middleware";
import { announceUnblocked, type FreedTask } from "../activities/blockers";
import { db } from "../lib/db";
import { eraseContactLinks } from "../lib/erasedContacts";
import { DateOnlySchema, NUL_MESSAGE, fromDateOnly, idText, noNul, optionalText, requiredText } from "../lib/http";
import type { NotifyTarget } from "../lib/notificationCopy";
import { validationHook } from "../lib/problem";
import { reconcileMeeting } from "./meetingMirror";
import { textToDoc } from "../files/description";
import { deleteActivitiesWithFiles } from "../files/files";
import type { Prisma } from "../lib/generated/prisma/client";

export const SYSTEM_SCOPE = "activities.write";
export const SYSTEM_CALLERS = ["system:crm-api"] as const;

/** Postgres INTEGER ceiling: `completionSeq` and `meeting_mirror_state.lastSeq` are Ints. */
const MAX_SEQ = 2_147_483_647;

const guard: MiddlewareHandler[] = [createSystemAuthMiddleware({ scope: SYSTEM_SCOPE, allowedSubs: SYSTEM_CALLERS })];

const unauthorized = { description: "Not a valid crm-api service credential (always the same body)" };
const invalid = { description: "Validation failed" };

const Id = idText();
const IdParams = z.object({ id: Id });

// ─── PUT /system/v1/activities/{id} ──────────────────────────────────────────

/**
 * `meeting` is not creatable here: a meeting activity exists only through the meeting mirror,
 * which owns its `meetingId`. Task-only fields on anything else are refused with the field
 * named, before the database CHECK would turn them into a 500.
 */
const CREATABLE_TYPES = ["note", "call", "email", "task"] as const;

const PutBody = z
  .object({
    type: z.enum(CREATABLE_TYPES),
    subject: requiredText(200),
    body: optionalText(10_000),
    occurredAt: z.string().datetime({ offset: true }),
    companyId: Id,
    dealId: Id.nullable().optional(),
    authorUserId: Id,
    assigneeUserId: Id.nullable().optional(),
    dueDate: DateOnlySchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "task") return;
    for (const field of ["assigneeUserId", "dueDate"] as const) {
      if (value[field] != null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is only for a task` });
    }
  });

const putRoute = createRoute({
  method: "put",
  path: "/system/v1/activities/{id}",
  tags: ["System"],
  summary: "Create a CRM activity under the caller's id, if absent (crm-api only)",
  middleware: guard,
  request: { params: IdParams, body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: {
    200: { description: "The id was already present; nothing was changed", content: { "application/json": { schema: z.object({ id: z.string(), created: z.literal(false) }) } } },
    201: { description: "Created", content: { "application/json": { schema: z.object({ id: z.string(), created: z.literal(true) }) } } },
    401: unauthorized,
    422: invalid,
  },
});

// ─── DELETE /system/v1/activities/{id} ───────────────────────────────────────

const deleteRoute = createRoute({
  method: "delete",
  path: "/system/v1/activities/{id}",
  tags: ["System"],
  summary: "Delete a CRM activity; with onlyIfOpen a completed one is kept (crm-api only)",
  middleware: guard,
  request: { params: IdParams, query: z.object({ onlyIfOpen: z.enum(["true", "false"]).optional() }) },
  responses: {
    204: { description: "Gone, or kept because it is completed and `onlyIfOpen=true`; absent is 204 too" },
    401: unauthorized,
    422: invalid,
  },
});

// ─── POST /system/v1/activities/{id}/completion ──────────────────────────────

/**
 * What crm-api holds when it forwards a completion and activities-api cannot ask (no user JWT, so
 * no host session): the labels the "You can go ahead" notice shows of where a freed task lives.
 * Plain bounded strings, strict, and both deal members or neither: the CRM's wording is
 * "Deal: <title>." when the task is on a deal, "Company: <name>." otherwise (specs/017 US-6).
 */
const CompletionContext = z
  .object({
    companyName: z.string().min(1).max(200).refine(noNul, NUL_MESSAGE),
    dealId: Id.nullable(),
    dealTitle: z.string().min(1).max(200).refine(noNul, NUL_MESSAGE).nullable(),
  })
  .strict()
  .refine((context) => (context.dealId === null) === (context.dealTitle === null), {
    message: "dealId and dealTitle go together",
    path: ["dealTitle"],
  });

const CompletionBody = z
  .object({
    completed: z.boolean(),
    at: z.string().datetime({ offset: true }),
    byUserId: idText(255),
    seq: z.number().int().min(0).max(MAX_SEQ),
    context: CompletionContext.optional(),
  })
  .strict();

const Applied = z.object({ applied: z.boolean() });

const completionRoute = createRoute({
  method: "post",
  path: "/system/v1/activities/{id}/completion",
  tags: ["System"],
  summary: "Complete or reopen a CRM task from an EstimAI notice, only if the seq is newer (crm-api only)",
  middleware: guard,
  request: { params: IdParams, body: { content: { "application/json": { schema: CompletionBody } }, required: true } },
  responses: {
    200: { description: "`applied: false` for a duplicate, an older notice, or a task that is not there", content: { "application/json": { schema: Applied } } },
    401: unauthorized,
    422: invalid,
  },
});

// ─── POST /system/v1/meeting-mirror ──────────────────────────────────────────

/**
 * Strict at every level: nothing but this shape (no agenda, no transcript, no summary) can reach
 * the CRM's timeline (specs/021 AC-4.6). `linked`/`changed` carry the title and the start,
 * `unlinked`/`deleted` carry neither, so nothing with a title survives a deletion in
 * meetings-api's outbox. The deal's company is needed to place a `linked` meeting only: the
 * other events find the activity by its meeting, so crm-api need not look the deal up for them.
 */
const MirrorBody = z
  .object({
    noticeId: z.string().uuid(),
    seq: z.number().int().min(0).max(MAX_SEQ),
    event: z.enum(["linked", "changed", "unlinked", "deleted"]),
    meeting: z
      .object({
        id: Id,
        title: z.string().min(1).max(200).refine(noNul, NUL_MESSAGE).nullable(),
        startsAt: z.string().datetime({ offset: true }).nullable(),
        creatorId: Id,
      })
      .strict(),
    deal: z.object({ id: Id, companyId: Id.optional() }).strict(),
  })
  .strict()
  .superRefine((notice, ctx) => {
    const carries = notice.event === "linked" || notice.event === "changed";
    for (const field of ["title", "startsAt"] as const) {
      if (carries && notice.meeting[field] === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meeting", field], message: `${field} is required for ${notice.event}` });
      }
      if (!carries && notice.meeting[field] !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meeting", field], message: `${field} must be null for ${notice.event}` });
      }
    }
    if (notice.event === "linked" && notice.deal.companyId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["deal", "companyId"], message: "companyId is required for linked" });
    }
  });

const mirrorRoute = createRoute({
  method: "post",
  path: "/system/v1/meeting-mirror",
  tags: ["System"],
  summary: "A meeting was linked, changed, unlinked or deleted (crm-api forwards meetings-api's notice)",
  middleware: guard,
  request: { body: { content: { "application/json": { schema: MirrorBody } }, required: true } },
  responses: {
    200: { description: "`applied: false` when the notice is a duplicate or older than one already applied", content: { "application/json": { schema: Applied } } },
    401: unauthorized,
    422: invalid,
  },
});

// ─── POST /system/v1/contacts/{contactId}/erase ──────────────────────────────

const eraseRoute = createRoute({
  method: "post",
  path: "/system/v1/contacts/{contactId}/erase",
  tags: ["System"],
  summary: "Unlink a contact from every activity and refuse later links, before crm-api deletes it (crm-api only)",
  middleware: guard,
  request: { params: z.object({ contactId: Id }) },
  responses: {
    200: { description: "How many activities referred to the contact (0 when repeated)", content: { "application/json": { schema: z.object({ unlinked: z.number().int() }) } } },
    401: unauthorized,
    422: invalid,
  },
});

// ─── Handlers ────────────────────────────────────────────────────────────────

export const systemRouter = new OpenAPIHono<{ Variables: SystemAuthVariables }>({ defaultHook: validationHook });

systemRouter.openapi(putRoute, async (c) => {
  const { id } = c.req.valid("param");
  const input = c.req.valid("json");
  // `ON CONFLICT DO NOTHING`: of any number of concurrent PUTs of one id exactly one inserts,
  // and a row that is already there is never touched.
  const { count } = await db.activity.createMany({
    data: [
      {
        id,
        kind: "pre_sales",
        type: input.type,
        hostApp: "crm",
        hostType: "company",
        hostId: input.companyId,
        dealId: input.dealId ?? null,
        subject: input.subject,
        // A task has one text, its description (ADR-0089): a body sent for one is kept as paragraphs.
        body: input.type === "task" ? null : (input.body ?? null),
        ...(input.type === "task" && input.body ? { description: textToDoc(input.body) as Prisma.InputJsonValue } : {}),
        occurredAt: new Date(input.occurredAt),
        authorUserId: input.authorUserId,
        assigneeUserId: input.assigneeUserId ?? null,
        dueDate: fromDateOnly(input.dueDate) ?? null,
      },
    ],
    skipDuplicates: true,
  });
  return count === 1 ? c.json({ id, created: true as const }, 201) : c.json({ id, created: false as const }, 200);
});

systemRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { onlyIfOpen } = c.req.valid("query");
  // The condition is part of the DELETE, so a task completed a moment ago is never lost to a race.
  // Files first (objects, then rows; ADR-0089), under the same condition.
  await deleteActivitiesWithFiles({ id, hostApp: "crm", ...(onlyIfOpen === "true" ? { completedAt: null } : {}) });
  return c.body(null, 204);
});

/**
 * What the notice shows of where a freed task lives. The system call has no user JWT, so no host
 * can be asked (ADR-0081 asks as the caller, and crm-api forwards no user): the labels come from
 * the `context` crm-api sent, which describes the COMPLETED task's company and deal. A freed task
 * of the same company gets the company's name; it gets the deal's title only if it is on that same
 * deal, never another deal's. Anything the context does not cover degrades to a dash, and the
 * notification still names the task and links to it.
 */
const UNKNOWN_LABEL = "—";
type CompletionContextInput = z.infer<typeof CompletionContext>;

const targetOf =
  (completedHostId: string, context: CompletionContextInput | undefined) =>
  (task: FreedTask): NotifyTarget => {
    if (task.hostApp === "projects") return { host: "projects", project: { id: task.hostId, name: UNKNOWN_LABEL } };
    if (!context || task.hostId !== completedHostId) return { host: "crm", company: { id: task.hostId, name: UNKNOWN_LABEL }, deal: null };
    const sameDeal = context.dealId !== null && task.dealId === context.dealId;
    return {
      host: "crm",
      company: { id: task.hostId, name: context.companyName },
      deal: sameDeal ? { id: context.dealId!, title: context.dealTitle! } : null,
    };
  };

systemRouter.openapi(completionRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { completed, at, byUserId, seq, context } = c.req.valid("json");

  // The row is locked while its seq is compared and written: of two notices racing, the newer one
  // decides the state, whatever the order they arrive in.
  const outcome = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "activity" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.activity.findFirst({
      where: { id, hostApp: "crm", type: "task" },
      select: { completedAt: true, completionSeq: true, hostId: true },
    });
    if (!row || (row.completionSeq !== null && row.completionSeq >= seq)) return { applied: false, newlyDone: false, hostId: "" };
    await tx.activity.update({
      where: { id },
      data: completed
        ? // A task someone already completed keeps who and when; only the seq advances.
          row.completedAt
          ? { completionSeq: seq }
          : { completedAt: new Date(at), completedByUserId: byUserId, completionSeq: seq }
        : { completedAt: null, completedByUserId: null, completionSeq: seq },
    });
    return { applied: true, newlyDone: completed && row.completedAt === null, hostId: row.hostId };
  });

  if (outcome.newlyDone) {
    // specs/017 US-6: tasks that waited on this one may now go ahead. Best effort, after the commit.
    const actor = { get: (_key: "userId") => byUserId, req: { header: (_name: string) => undefined } };
    await announceUnblocked(actor, [id], targetOf(outcome.hostId, context));
  }
  return c.json({ applied: outcome.applied }, 200);
});

systemRouter.openapi(mirrorRoute, async (c) => {
  const applied = await reconcileMeeting(c.req.valid("json"));
  return c.json({ applied }, 200);
});

systemRouter.openapi(eraseRoute, async (c) => {
  const { contactId } = c.req.valid("param");
  // One transaction under the contact's lock: the tombstone that refuses later links and the sweep
  // of the existing ones commit together (see lib/erasedContacts.ts).
  const unlinked = await db.$transaction((tx) => eraseContactLinks(tx, contactId));
  return c.json({ unlinked }, 200);
});
