/**
 * POST /system/estimate-notices — estimai-api tells the CRM that an estimate was
 * closed or reopened (specs/20261101-crm-sales-flow AC-3.3, ADR 20261105-estimai-closes-the-estimate-crm-follows). Closed in EstimAI is the only
 * way an estimate becomes ready: the deal's estimate turns `ready`, its task is
 * completed and the requester and the deal owner are told; reopened turns it back
 * to `requested` and reopens the task.
 *
 * Service-to-service only: a service JWT of `system:estimai-api` with scope
 * `estimate-notices.send` (systemAuth). The body is ids and a version, nothing
 * from the estimate's content. Notices may arrive late or out of order: one whose
 * EstimAI version is not newer than the last applied is ignored. An estimate the
 * CRM does not link answers 204 like any other, so nothing is learnt from it.
 *
 * The request task lives in activities-api (specs/20261110-activities, AC-1.3, ADR 20261110-caller-chosen-ids-replace-cross-service-transactions): under the same
 * `deal_estimate` lock and version guard, the task is completed or reopened by
 * `POST /system/v1/activities/{id}/completion` with `seq` = the EstimAI version being recorded,
 * so activities-api applies only a newer one and a repeated or reordered call is a no-op. That
 * call is INSIDE the transaction: if activities-api cannot answer, the transaction rolls back
 * (version, state and task all unchanged), this answers 503, and the same notice can be sent
 * again. The tasks the completion frees are announced by activities-api, not here.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "../lib/db";
import { MAX_NAME, announce, clip } from "../lib/notify";
import { validationHook } from "../lib/problem";
import { activities, LOCKED_CALL } from "../lib/activities";
import { createSystemAuthMiddleware, type SystemAuthVariables } from "../auth/systemAuth.middleware";

export const ESTIMATE_NOTICES_SCOPE = "estimate-notices.send";
const ESTIMAI_CALLER = "system:estimai-api";

const NoticeSchema = z
  .object({
    estimateId: z.string().min(1).max(64),
    event: z.enum(["closed", "reopened"]),
    version: z.number().int().min(1),
    at: z.string().datetime({ offset: true }),
    byUserId: z.string().min(1).max(255),
  })
  .strict();

const noticeRoute = createRoute({
  method: "post",
  path: "/system/estimate-notices",
  tags: ["System"],
  summary: "An EstimAI estimate was closed or reopened (estimai-api only)",
  middleware: [createSystemAuthMiddleware({ scope: ESTIMATE_NOTICES_SCOPE, allowedSubs: [ESTIMAI_CALLER] })] as const,
  request: { body: { content: { "application/json": { schema: NoticeSchema } }, required: true } },
  responses: {
    204: { description: "Applied, ignored as stale, or about an estimate the CRM does not link" },
    401: { description: "Not a valid estimai-api service credential" },
    422: { description: "Validation failed" },
  },
});

export const estimateNoticesRouter = new OpenAPIHono<{ Variables: SystemAuthVariables }>({
  defaultHook: validationHook,
});

type Notice = z.infer<typeof NoticeSchema>;

const dealRef = (deal: { title: string }) => clip(deal.title, MAX_NAME);
const dealHref = (id: string) => `/crm/deals/${id}`;

estimateNoticesRouter.openapi(noticeRoute, async (c) => {
  const notice = c.req.valid("json");
  const links = await db.dealEstimate.findMany({
    where: { estimateId: notice.estimateId },
    include: { deal: { select: { id: true, title: true, ownerUserId: true, company: { select: { name: true } } } } },
  });
  for (const link of links) await apply(link, notice);
  return c.body(null, 204);
});

/**
 * The transaction also waits for activities-api, bounded by LOCKED_CALL (2 s per attempt, 4 s in
 * all, the 401 retry included): over Prisma's 5 s default, well under this.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

async function apply(
  link: Awaited<ReturnType<typeof db.dealEstimate.findMany>>[number] & {
    deal: { id: string; title: string; ownerUserId: string; company: { name: string } };
  },
  notice: Notice,
): Promise<void> {
  const at = new Date(notice.at);
  const ready = notice.event === "closed";
  // The row is locked while the version is compared and written: of two notices
  // racing, the newer one decides the state and the task, whatever the order.
  const changed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "deal_estimate" WHERE "dealId" = ${link.dealId} FOR UPDATE`;
    const row = await tx.dealEstimate.findUnique({ where: { dealId: link.dealId } });
    if (!row || row.estimateId !== notice.estimateId) return false;
    if (row.estimaiVersion !== null && row.estimaiVersion >= notice.version) return false;
    await tx.dealEstimate.update({
      where: { dealId: link.dealId },
      data: ready
        ? { estimaiVersion: notice.version, state: "ready", readyAt: at, readyBy: notice.byUserId }
        : { estimaiVersion: notice.version, state: "requested", readyAt: null, readyBy: null },
    });
    const flips = (row.state === "ready") !== ready;
    if (flips && row.taskId) {
      // `applied: false` (a repeat, an older seq, a task deleted by hand) is not a reason to hold
      // the CRM's own state back; only an answer that never came is.
      await activities.complete(row.taskId, {
        completed: ready,
        at: notice.at,
        byUserId: notice.byUserId,
        seq: notice.version,
        // Where the task lives, for the "You can go ahead" notice of the tasks it frees.
        ...(ready
          ? { context: { companyName: clip(link.deal.company.name, MAX_NAME), dealId: link.deal.id, dealTitle: clip(link.deal.title, MAX_NAME) } }
          : {}),
      }, LOCKED_CALL);
    }
    return flips;
  }, TRANSACTION_OPTIONS);
  if (!changed) return;

  // Who closed or reopened it is known by id only: the copy does not name them.
  const actor = { get: (_key: "userId") => notice.byUserId, req: { header: (_name: string) => undefined } };
  const deal = link.deal;
  if (ready) {
    // E2 — whoever asked for it and whoever owns the deal.
    await announce(actor, {
      kind: "estimate_ready",
      dealId: deal.id,
      recipientIds: [link.requestedBy, deal.ownerUserId],
      severity: "success",
      email: true,
      href: dealHref(deal.id),
      copy: () => ({
        title: `Estimate ready: ${dealRef(deal)}`,
        body: `The estimate for ${dealRef(deal)} was closed in EstimAI. An offer can now be prepared.`,
      }),
    });
  } else {
    // E3 — the technical contact has work to do again, and the requester knows the deal waits.
    await announce(actor, {
      kind: "estimate_reopened",
      dealId: deal.id,
      recipientIds: [link.technicalUserId, link.requestedBy],
      severity: "warning",
      email: true,
      href: dealHref(deal.id),
      copy: () => ({
        title: `Estimate reopened: ${dealRef(deal)}`,
        body: `The estimate for ${dealRef(deal)} was reopened in EstimAI. The deal waits for it to be closed again.`,
      }),
    });
  }
}
