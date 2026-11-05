/**
 * A deal's technical estimate (specs/018 US-3; plan.md § Estimates).
 *
 *   POST   /deals/{id}/estimate           request one: create it in EstimAI, share it
 *                                         with the technical contact, link it, task them
 *   POST   /deals/{id}/estimate/ready     the technical contact (or an admin) says it is done
 *   POST   /deals/{id}/estimate/reopen    back to `requested`
 *   POST   /deals/{id}/estimate/override  an admin lets the deal past the gate anyway
 *   DELETE /deals/{id}/estimate           unlink (the estimate stays in EstimAI; its open task goes)
 *
 * "Admin" is `deal:manage` over every entity (`managesAllDeals`). Every EstimAI
 * call carries the caller's own JWT (lib/estimai.ts), so no new trust between
 * services exists. Each route answers with the updated deal.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  DEAL_MANAGE,
  authorized,
  dealScope,
  managesAllDeals,
  requireCapability,
} from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { createEstimate, deleteEstimateQuietly, directoryEmail, shareAsEditor } from "../lib/estimai";
import { IdParams, commonErrors, requiredText } from "../lib/http";
import { requireCrmUsers } from "../lib/identities";
import { MAX_NAME, MAX_REASON, announce, clip, formatDueDate } from "../lib/notify";
import { ProblemError, forbidden, notFound, validationHook } from "../lib/problem";
import { assertInScope, toDealView, withCompany } from "../deals/deals.routes";
import { addWorkingDays } from "./workingDays";
import { announceUnblocked } from "../activities/blockers";

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

const readyRoute = createRoute({
  method: "post",
  path: "/deals/{id}/estimate/ready",
  tags: ["Estimates"],
  summary: "Mark the estimate ready (technical contact or admin)",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: DealResponse, 404: { description: "Not found" }, ...commonErrors },
});

const reopenRoute = createRoute({
  method: "post",
  path: "/deals/{id}/estimate/reopen",
  tags: ["Estimates"],
  summary: "Set the estimate back to requested (requester, technical contact or admin)",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: DealResponse, 404: { description: "Not found" }, ...commonErrors },
});

const overrideRoute = createRoute({
  method: "post",
  path: "/deals/{id}/estimate/override",
  tags: ["Estimates"],
  summary: "Let the deal past the estimate gate without a ready estimate (admin)",
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
  await db.$transaction(async (tx) => {
    const task = await tx.activity.create({
      data: {
        type: "task",
        subject: `Estimate: ${deal.title}`.slice(0, 200),
        body: null,
        occurredAt: now,
        companyId: deal.companyId,
        dealId: deal.id,
        authorUserId: userId,
        assigneeUserId: technicalUserId,
        dueDate,
      },
      select: { id: true },
    });
    const link = {
      estimateId: estimate.id,
      estimateName: estimate.name,
      technicalUserId,
      state: "requested" as const,
      requestedBy: userId,
      requestedAt: now,
      taskId: task.id,
    };
    await tx.dealEstimate.upsert({ where: { dealId: deal.id }, create: { dealId: deal.id, ...link }, update: link });
  });
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

estimateRouter.openapi(readyRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const deal = await dealOr404(id);
  const estimate = deal.estimate?.estimateId ? deal.estimate : null;
  if (!estimate) throw notFound("This deal has no estimate");
  if (estimate.technicalUserId !== userId && !managesAllDeals(c)) {
    throw forbidden("Only the technical contact marks the estimate ready", "technical_contact_only");
  }
  if (estimate.state !== "ready") {
    const now = new Date();
    const [, closedTask] = await db.$transaction([
      db.dealEstimate.update({ where: { dealId: id }, data: { state: "ready", readyAt: now, readyBy: userId } }),
      ...(estimate.taskId
        ? [db.activity.updateMany({ where: { id: estimate.taskId, completedAt: null }, data: { completedAt: now, completedByUserId: userId } })]
        : []),
    ]);
    // specs/017 US-6: tasks that waited on the estimate task may now go ahead.
    if (estimate.taskId && closedTask && "count" in closedTask && closedTask.count > 0) {
      await announceUnblocked(c, [estimate.taskId]);
    }
    // E2 — whoever asked for it and whoever owns the deal.
    await announce(c, {
      kind: "estimate_ready",
      dealId: id,
      recipientIds: [estimate.requestedBy, deal.ownerUserId],
      severity: "success",
      email: true,
      href: dealHref(id),
      copy: (actor) => ({
        title: `Estimate ready: ${dealRef(deal)}`,
        body: `${actor} marked the estimate for ${dealRef(deal)} ready. An offer can now be prepared.`,
      }),
    });
  }
  return respond(c, id, 200);
});

estimateRouter.openapi(reopenRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const deal = await dealOr404(id);
  const estimate = deal.estimate?.estimateId ? deal.estimate : null;
  if (!estimate) throw notFound("This deal has no estimate");
  const allowed = [estimate.technicalUserId, estimate.requestedBy].includes(userId) || managesAllDeals(c);
  if (!allowed) throw forbidden("Only the requester, the technical contact or an admin reopens the estimate", "estimate_participant_only");
  if (estimate.state !== "requested") {
    await db.$transaction([
      db.dealEstimate.update({ where: { dealId: id }, data: { state: "requested", readyAt: null, readyBy: null } }),
      ...(estimate.taskId
        ? [db.activity.updateMany({ where: { id: estimate.taskId }, data: { completedAt: null, completedByUserId: null } })]
        : []),
    ]);
    // E3 — the technical contact has work to do again.
    await announce(c, {
      kind: "estimate_reopened",
      dealId: id,
      recipientIds: [estimate.technicalUserId],
      severity: "warning",
      email: true,
      href: dealHref(id),
      copy: (actor) => ({
        title: `Estimate reopened: ${dealRef(deal)}`,
        body: `${actor} reopened the estimate for ${dealRef(deal)}.`,
      }),
    });
  }
  return respond(c, id, 200);
});

estimateRouter.openapi(overrideRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { reason } = c.req.valid("json");
  const userId = c.get("userId");
  if (!managesAllDeals(c)) throw forbidden("Only an admin overrides the estimate gate", "admin_only");
  const deal = await dealOr404(id);
  const now = new Date();
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
    // The timeline keeps who let the deal through, and why (AC-3.7).
    await tx.activity.create({
      data: {
        type: "note",
        subject: "Estimate gate overridden",
        body: reason,
        occurredAt: now,
        companyId: deal.companyId,
        dealId: deal.id,
        authorUserId: userId,
      },
    });
  });
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
  const { taskId } = deal.estimate;
  await db.$transaction(async (tx) => {
    if (deal.estimate!.overrideAt) {
      // Keep the admin's override: only the link goes.
      await tx.dealEstimate.update({
        where: { dealId: id },
        data: { estimateId: "", estimateName: "", state: "requested", readyAt: null, readyBy: null, taskId: null },
      });
    } else {
      await tx.dealEstimate.delete({ where: { dealId: id } });
    }
    // The task the request created goes with the link while it is still open;
    // a completed one stays on the timeline as work that was done.
    if (taskId) await tx.activity.deleteMany({ where: { id: taskId, completedAt: null } });
  });
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
