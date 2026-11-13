/**
 * A deal's technical estimate (specs/018 US-3; plan.md § Estimates).
 *
 *   POST   /deals/{id}/estimate           request one: create it in EstimAI, share it
 *                                         with the technical contact, link it, task them
 *   POST   /deals/{id}/estimate/override  whoever manages the deal lets it past the gate anyway
 *   DELETE /deals/{id}/estimate           unlink (the estimate stays in EstimAI; its open task goes)
 *
 * The estimate becomes `ready` (and back to `requested`) only when it is closed
 * (or reopened) in EstimAI: estimai-api tells the CRM through
 * `POST /system/estimate-notices` (estimateNotices.routes.ts, AC-3.3, ADR-0073).
 *
 * Every route here, the override included, is `deal:manage` in the deal's entity (403 `out_of_scope`
 * otherwise): the owner of the sales flow decides, with a reason kept on the timeline (amended
 * 2026-11-13: the override used to need `deal:manage` over every entity, i.e. an admin). Every EstimAI
 * call carries the caller's own JWT (lib/estimai.ts), so no new trust between
 * services exists. Each route answers with the updated deal.
 *
 * The request task and the override note live in activities-api (specs/028, ADR-0082), so they
 * can no longer share this service's transaction. The caller chooses their ids:
 *   request / override  PUT the activity under a fresh id BEFORE the transaction that records it;
 *                       a failed put changes nothing here (and deletes the EstimAI estimate), a
 *                       failed commit DELETEs the activity again (logged if that fails too);
 *   unlink              DELETE the open task BEFORE the transaction: unavailable is a 503 and
 *                       nothing changed, so the link and its task are never out of step.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  DEAL_MANAGE,
  authorized,
  dealScope,
  requireCapability,
} from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { activities } from "../lib/activities";
import { sendDealLinkNotice } from "../lib/estimaiNotices";
import { createEstimate, deleteEstimateQuietly, directoryEmail, shareAsEditor } from "../lib/estimai";
import { IdParams, commonErrors, requiredText } from "../lib/http";
import { requireCrmUsers } from "../lib/identities";
import { MAX_NAME, MAX_REASON, announce, clip, formatDueDate } from "../lib/notify";
import { ProblemError, notFound, validationHook } from "../lib/problem";
import { assertInScope, toDealView, withCompany } from "../deals/deals.routes";
import { addWorkingDays } from "./workingDays";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const DealResponse = { description: "The deal, with its estimate", ...json(z.object({}).passthrough()) };
const managing = [...authorized, requireCapability(DEAL_MANAGE)];

/** A task due this many working days after the request (AC-3.5). */
const TASK_DUE_WORKING_DAYS = 5;

/** The wording the nine notification events share (specs/019): never money. */
const dealRef = (deal: { title: string }) => clip(deal.title, MAX_NAME);
const dealHref = (id: string) => `/crm/deals/${id}`;

const requestRoute = createRoute({
  method: "post",
  path: "/deals/{id}/estimate",
  tags: ["Estimates"],
  summary: "Request a technical estimate in EstimAI (deal:manage, entity-scoped)",
  middleware: managing,
  request: {
    params: IdParams,
    body: { content: { "application/json": { schema: z.object({ technicalUserId: z.string().min(1).max(64) }).strict() } }, required: true },
  },
  responses: { 201: DealResponse, 404: { description: "Not found" }, 409: { description: "estimate_exists / deal_not_open_for_estimate" }, ...commonErrors },
});

const overrideRoute = createRoute({
  method: "post",
  path: "/deals/{id}/estimate/override",
  tags: ["Estimates"],
  summary: "Let the deal past the estimate gate without a ready estimate (deal:manage, entity-scoped)",
  middleware: managing,
  request: {
    params: IdParams,
    body: { content: { "application/json": { schema: z.object({ reason: requiredText(500) }).strict() } }, required: true },
  },
  responses: { 200: DealResponse, 404: { description: "Not found" }, ...commonErrors },
});

const unlinkRoute = createRoute({
  method: "delete",
  path: "/deals/{id}/estimate",
  tags: ["Estimates"],
  summary: "Unlink the estimate (it stays in EstimAI)",
  middleware: managing,
  request: { params: IdParams },
  responses: { 200: DealResponse, 404: { description: "Not found" }, ...commonErrors },
});

export const estimateRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

async function dealOr404(id: string) {
  const deal = await db.deal.findUnique({ where: { id }, include: withCompany });
  if (!deal) throw notFound("Deal not found");
  return deal;
}

async function respond(c: Parameters<typeof toDealView>[0] & { json: (body: unknown, status: 200 | 201) => Response }, id: string, status: 200 | 201) {
  const row = await db.deal.findUniqueOrThrow({ where: { id }, include: withCompany });
  return c.json(await toDealView(c, row), status);
}

estimateRouter.openapi(requestRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { technicalUserId } = c.req.valid("json");
  const userId = c.get("userId");
  const deal = await dealOr404(id);
  assertInScope(dealScope(c), deal.entity);
  if (deal.stage !== "lead" && deal.stage !== "qualified") {
    throw new ProblemError({
      status: 409,
      code: "deal_not_open_for_estimate",
      detail: "An estimate is requested while the deal is a lead or qualified",
    });
  }
  // A row with no link only records an earlier admin override: a request completes it.
  if (deal.estimate && deal.estimate.estimateId !== "") {
    throw new ProblemError({ status: 409, code: "estimate_exists", detail: "This deal already has an estimate; unlink it first" });
  }
  await requireCrmUsers(c, [{ id: technicalUserId, field: "technicalUserId" }]);
  const email = technicalUserId === userId ? null : await directoryEmail(c, technicalUserId, "estimai");
  if (technicalUserId !== userId && email === null) {
    throw new ProblemError({
      status: 422,
      code: "technician_not_estimai_user",
      detail: "The technical contact cannot use EstimAI; ask an admin to grant it",
      extras: { field: "technicalUserId" },
    });
  }

  const estimate = await createEstimate(c, `${deal.company.name} — ${deal.title}`);
  try {
    if (email !== null) await shareAsEditor(c, estimate.id, email);
  } catch (error) {
    // Never leave an estimate nobody was asked to fill in.
    await deleteEstimateQuietly(c, estimate.id);
    throw error;
  }

  const now = new Date();
  const dueDate = addWorkingDays(now, TASK_DUE_WORKING_DAYS);
  // The task is created first, under an id chosen here (ADR-0082), so the link can record it.
  const taskId = crypto.randomUUID();
  try {
    await activities.put(taskId, {
      type: "task",
      subject: `Estimate: ${deal.title}`.slice(0, 200),
      occurredAt: now.toISOString(),
      companyId: deal.companyId,
      dealId: deal.id,
      authorUserId: userId,
      assigneeUserId: technicalUserId,
      dueDate: dueDate.toISOString().slice(0, 10),
    });
  } catch (error) {
    // Never leave an estimate nobody was asked to fill in. The put may have landed with its answer
    // lost (a timeout), so the task is taken back too: deleting an id that is not there is a no-op.
    await activities.removeQuietly(taskId);
    await deleteEstimateQuietly(c, estimate.id);
    throw error;
  }
  try {
    await db.$transaction(async (tx) => {
      const link = {
        estimateId: estimate.id,
        estimateName: estimate.name,
        technicalUserId,
        state: "requested" as const,
        requestedBy: userId,
        requestedAt: now,
        readyAt: null,
        readyBy: null,
        taskId,
        // A new estimate starts its own EstimAI version count (AC-3.3).
        estimaiVersion: null,
      };
      await tx.dealEstimate.upsert({ where: { dealId: deal.id }, create: { dealId: deal.id, ...link }, update: link });
    });
  } catch (error) {
    // The link was not recorded: the task must not outlive it.
    await activities.removeQuietly(taskId);
    throw error;
  }
  // After the commit, never inside it and never failing the response (specs/024 AC-3.4).
  await sendDealLinkNotice({ estimateId: estimate.id, dealId: id, event: "linked", at: now.toISOString() });
  // E1 — the technical contact (the creating task does not notify on its own).
  await announce(c, {
    kind: "estimate_requested",
    dealId: id,
    recipientIds: [technicalUserId],
    severity: "info",
    email: true,
    href: dealHref(id),
    copy: (actor) => ({
      title: `Estimate requested: ${dealRef(deal)}`,
      body: `${actor} asked you to estimate ${dealRef(deal)} for ${clip(deal.company.name, MAX_NAME)}. Due ${formatDueDate(dueDate)}.`,
    }),
  });
  return respond(c, id, 201);
});

estimateRouter.openapi(overrideRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { reason } = c.req.valid("json");
  const userId = c.get("userId");
  const deal = await dealOr404(id);
  // Anyone who manages this deal (its entity) may let it through, with a reason (amended 2026-11-13).
  assertInScope(dealScope(c), deal.entity);
  const now = new Date();
  // The timeline keeps who let the deal through, and why (AC-3.7): written first, under an id
  // chosen here, and taken back if the override itself cannot be recorded (ADR-0082).
  const noteId = crypto.randomUUID();
  try {
    await activities.put(noteId, {
      type: "note",
      subject: "Estimate gate overridden",
      body: reason,
      occurredAt: now.toISOString(),
      companyId: deal.companyId,
      dealId: deal.id,
      authorUserId: userId,
    });
  } catch (error) {
    // The put may have landed with its answer lost: no note without an override.
    await activities.removeQuietly(noteId);
    throw error;
  }
  try {
    await db.$transaction(async (tx) => {
      if (deal.estimate) {
        await tx.dealEstimate.update({
          where: { dealId: id },
          data: { overrideBy: userId, overrideReason: reason, overrideAt: now },
        });
      } else {
        // No estimate at all: the override row records the decision on its own.
        await tx.dealEstimate.create({
          data: {
            dealId: id,
            estimateId: "",
            estimateName: "",
            technicalUserId: userId,
            requestedBy: userId,
            requestedAt: now,
            overrideBy: userId,
            overrideReason: reason,
            overrideAt: now,
          },
        });
      }
    });
  } catch (error) {
    await activities.removeQuietly(noteId);
    throw error;
  }
  // E7 — the owner and, if an estimate was requested, whoever asked for it.
  await announce(c, {
    kind: "estimate_gate_overridden",
    dealId: id,
    recipientIds: [deal.ownerUserId, deal.estimate?.estimateId ? deal.estimate.requestedBy : null],
    severity: "warning",
    email: false,
    href: dealHref(id),
    copy: (actor) => ({
      title: `Moved without estimate: ${dealRef(deal)}`,
      body: `${actor} let ${dealRef(deal)} skip the estimate. Reason: ${clip(reason, MAX_REASON)}`,
    }),
  });
  return respond(c, id, 200);
});

estimateRouter.openapi(unlinkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const deal = await dealOr404(id);
  assertInScope(dealScope(c), deal.entity);
  if (!deal.estimate?.estimateId) throw notFound("This deal has no estimate");
  const { taskId, estimateId: unlinkedEstimateId } = deal.estimate;
  // The task the request created goes with the link while it is still open; a completed one stays
  // on the timeline as work that was done (`onlyIfOpen`). Asked BEFORE anything changes here: if
  // activities-api cannot answer, this is a 503 and the link and its task are both untouched.
  if (taskId) await activities.remove(taskId, { onlyIfOpen: true });
  await db.$transaction(async (tx) => {
    if (deal.estimate!.overrideAt) {
      // Keep the admin's override: only the link goes.
      await tx.dealEstimate.update({
        where: { dealId: id },
        data: { estimateId: "", estimateName: "", state: "requested", readyAt: null, readyBy: null, taskId: null, estimaiVersion: null },
      });
    } else {
      await tx.dealEstimate.delete({ where: { dealId: id } });
    }
  });
  // After the commit (specs/024 AC-3.5): the PREVIOUS estimate, at the instant of the unlink.
  await sendDealLinkNotice({ estimateId: unlinkedEstimateId, dealId: id, event: "unlinked", at: new Date().toISOString() });
  // E6 — the technical contact is told the estimate no longer counts.
  await announce(c, {
    kind: "estimate_unlinked",
    dealId: id,
    recipientIds: [deal.estimate.technicalUserId],
    severity: "info",
    email: false,
    href: dealHref(id),
    copy: (actor) => ({
      title: `Estimate unlinked: ${dealRef(deal)}`,
      body: `${actor} unlinked the estimate from ${dealRef(deal)}. It stays in EstimAI.`,
    }),
  });
  return respond(c, id, 200);
});
