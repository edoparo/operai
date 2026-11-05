/**
 * The to-start queue (specs/022-projects-handoff T6; AC-1.1, AC-1.6, AC-2.1, AC-2.2, A20, A26):
 * the won deals no project has taken yet.
 *
 * Nothing is stored or synced. Every read asks crm-api for its won deals (`wonDeals()`, as the
 * service principal, live) and subtracts the deals that already have a purchase order here, so a deal
 * leaves the queue the moment it is taken or reopened in the CRM and is back when it is won again
 * — by construction, with no event to miss. Reading needs `projects:access` only (every holder
 * sees the queue); taking a deal is `take.routes.ts`. A summary carries no amount, currency, owner
 * or notes: crm-api's `DealSummary` has none and this route copies only named members (D14).
 *
 * crm-api down is a 503 `crm_unavailable`: unlike a project page, the queue has nothing to show
 * without the CRM. `truncated` is crm-api's: it returns the newest 500 won deals (A26, deferred
 * pagination), so `q` and `entity` filter within those.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authorized } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { orCrmUnavailable, wonDeals } from "../lib/crm";
import { db } from "../lib/db";
import { EntitySchema, commonErrors } from "../lib/http";
import { validationHook } from "../lib/problem";
import { CompanyRefSchema } from "../projects/projects.schemas";

const QueueQuery = z.object({
  /** Case-insensitive substring of the deal's title or its company's name. */
  q: z.string().max(200).optional(),
  entity: EntitySchema.optional(),
});

const QueueItemSchema = z.object({
  dealId: z.string(),
  title: z.string(),
  entity: EntitySchema,
  company: CompanyRefSchema,
  wonAt: z.string().nullable(),
  estimate: z.object({ id: z.string(), name: z.string() }).nullable(),
});

const QueueSchema = z.object({ items: z.array(QueueItemSchema), truncated: z.boolean() });

const getQueueRoute = createRoute({
  method: "get",
  path: "/queue",
  tags: ["Queue"],
  summary: "The to-start queue: won deals without a purchase order, newest win first (projects:access)",
  middleware: authorized,
  request: { query: QueueQuery },
  responses: {
    200: { description: "The queue", content: { "application/json": { schema: QueueSchema } } },
    ...commonErrors,
    503: { description: "crm_unavailable (the queue is read live from the CRM) or authz_unavailable" },
  },
});

export const queueRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

queueRouter.openapi(getQueueRoute, async (c) => {
  const { q, entity } = c.req.valid("query");
  const { items: won, truncated } = await orCrmUnavailable(wonDeals());

  const taken = new Set(
    (
      await db.purchaseOrder.findMany({
        where: { dealId: { in: won.map((deal) => deal.id) } },
        select: { dealId: true },
      })
    ).map((order) => order.dealId),
  );

  const needle = q?.trim().toLowerCase();
  const items = won
    .filter((deal) => !taken.has(deal.id))
    .filter((deal) => entity === undefined || deal.entity === entity)
    .filter(
      (deal) =>
        !needle || deal.title.toLowerCase().includes(needle) || deal.company.name.toLowerCase().includes(needle),
    )
    .map((deal) => ({
      dealId: deal.id,
      title: deal.title,
      entity: deal.entity,
      company: { id: deal.company.id, name: deal.company.name },
      wonAt: deal.wonAt,
      estimate: deal.estimate === null ? null : { id: deal.estimate.id, name: deal.estimate.name },
    }));

  return c.json({ items, truncated }, 200);
});
