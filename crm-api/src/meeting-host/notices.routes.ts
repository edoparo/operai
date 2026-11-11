/**
 * `POST /system/meeting-host/v1/notices` (specs/021 T8, US-14; plan.md § Host
 * integration contract; ADR-0059): the host half of "a meeting was linked / changed / unlinked /
 * deleted". meetings-api sends it as itself (scoped service JWT, scope `host-notices.send`, sub
 * allowlist `system:meetings-api`); no user JWT is a credential here.
 *
 * Since specs/028 (T12, AC-1.4) the meeting activity lives in activities-api, and so does the
 * ordering guard: crm-api no longer writes `activity` or `meeting_host_state`. It keeps what only
 * it can answer, the deal, and FORWARDS the notice to activities-api's
 * `POST /system/v1/meeting-mirror` as itself, relaying `{ applied }` unchanged:
 *
 *   linked    -> the deal must exist here (422 entity_not_found, permanent); its company travels
 *                with the notice, so a relink MOVES the activity to the new deal and company;
 *   changed / unlinked / deleted -> forwarded as they are: activities-api finds the activity by
 *                its meeting.
 *
 * The `seq <= lastSeq` guard moved with the data (activities-api `meeting_mirror_state`), so the
 * guard and the write commit together and a failed forward can never advance it. activities-api
 * unavailable (down, in maintenance, anything but a 200) is a 503 `activities_unavailable`:
 * meetings-api's outbox keeps the notice and retries it (ADR-0059).
 *
 * The author is the meeting's `creatorId`. crm-api trusts it because meetings-api resolved the deal
 * AS that creator in the same request before emitting `linked`; the author-only edit rule of
 * specs/017 AC-4.2 then applies unchanged (AC-14.3). The body is strict: any other key is a 422,
 * so nothing but this shape (no agenda, no transcript, no summary) can ever reach the CRM.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { createSystemAuthMiddleware, type SystemAuthVariables } from "../auth/systemAuth.middleware";
import { activities } from "../lib/activities";
import { db } from "../lib/db";
import { commonErrors } from "../lib/http";
import { unprocessable, validationHook } from "../lib/problem";

export const HOST_NOTICES_SCOPE = "host-notices.send";
export const HOST_NOTICES_CALLERS = ["system:meetings-api"] as const;

/** Postgres INTEGER ceiling: activities-api's `meeting_mirror_state.lastSeq` is an Int. */
const MAX_SEQ = 2_147_483_647;

const NoticeBody = z
  .object({
    noticeId: z.string().uuid(),
    seq: z.number().int().min(0).max(MAX_SEQ),
    event: z.enum(["linked", "changed", "unlinked", "deleted"]),
    meeting: z
      .object({
        id: z.string().min(1).max(64),
        title: z.string().min(1).max(200).nullable(),
        startsAt: z.string().datetime({ offset: true }).nullable(),
        creatorId: z.string().min(1).max(64),
      })
      .strict(),
    entity: z.object({ type: z.literal("deal"), id: z.string().min(1).max(64) }).strict(),
  })
  .strict()
  .superRefine((notice, ctx) => {
    // `linked`/`changed` carry the title and the start; `unlinked`/`deleted` carry neither, so
    // nothing with a title survives a deletion in meetings-api's outbox (AC-4.6, amendment A3).
    const carries = notice.event === "linked" || notice.event === "changed";
    for (const field of ["title", "startsAt"] as const) {
      if (carries && notice.meeting[field] === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meeting", field], message: `${field} is required for ${notice.event}` });
      }
      if (!carries && notice.meeting[field] !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meeting", field], message: `${field} must be null for ${notice.event}` });
      }
    }
  });
type Notice = z.infer<typeof NoticeBody>;

const callerOnly: MiddlewareHandler[] = [
  createSystemAuthMiddleware({ scope: HOST_NOTICES_SCOPE, allowedSubs: HOST_NOTICES_CALLERS }),
];

const noticeRoute = createRoute({
  method: "post",
  path: "/system/meeting-host/v1/notices",
  tags: ["Meeting host"],
  summary: "A meeting was linked, changed, unlinked or deleted (host contract v1, service JWT)",
  middleware: callerOnly,
  request: { body: { content: { "application/json": { schema: NoticeBody } }, required: true } },
  responses: {
    200: {
      description: "`applied: false` when the notice is a duplicate or older than one already applied",
      content: { "application/json": { schema: z.object({ applied: z.boolean() }) } },
    },
    401: commonErrors[401],
    422: commonErrors[422],
    503: { description: "activities-api could not be reached or is in maintenance; meetings-api retries" },
  },
});

export const meetingHostNoticesRouter = new OpenAPIHono<{ Variables: SystemAuthVariables }>({
  defaultHook: validationHook,
});

async function forward(notice: Notice): Promise<boolean> {
  const { noticeId, seq, event, meeting, entity } = notice;
  let companyId: string | undefined;
  if (event === "linked") {
    const deal = await db.deal.findUnique({ where: { id: entity.id }, select: { companyId: true } });
    if (!deal) throw unprocessable("The deal does not exist", { field: "entity.id" }, "entity_not_found");
    companyId = deal.companyId;
  }
  const { applied } = await activities.mirrorMeeting({
    noticeId,
    seq,
    event,
    meeting,
    deal: { id: entity.id, ...(companyId !== undefined ? { companyId } : {}) },
  });
  return applied;
}

meetingHostNoticesRouter.openapi(noticeRoute, async (c) => {
  const applied = await forward(c.req.valid("json"));
  return c.json({ applied }, 200);
});
