/**
 * Taking a deal from the to-start queue (specs/022-projects-handoff T7 as reshaped by T23; AC-1.2 –
 * AC-1.6, AC-1.8, AC-1.10, AC-3.1, AC-3.2): `POST /queue/{dealId}/project` makes a new project with
 * its terms and its purchase order from a won deal. There is no attach (D39): a deal that already
 * has a purchase order is `deal_taken`, and no route adds a purchase order to an existing project.
 *
 * Who may take a deal is `project:manage` for the DEAL's entity: the route refuses a caller who
 * manages no entity (`forbidden`) before anything is looked up, the handler refuses the other entity
 * (`out_of_scope`) once the CRM has said which entity the deal is. (T24 narrows this to `handoff:take`.)
 *
 * The deal is read live from crm-api, never trusted from the client: it must exist, be `won` NOW
 * and have no purchase order yet. Project, terms and purchase order are written in ONE statement (a
 * nested create), so a refusal — including the unique `dealId` index losing a race between two takes
 * of the same deal (the database half of AC-1.6) — leaves nothing behind.
 *
 * The project is `planned`, with the deal's company and entity and NO project manager: the person who
 * takes the deal is not made one (D42), the ops-manager picks it later. `opsManagerId` and
 * `referentContactId` are stored as sent here; T24 validates them.
 *
 * Man-days are server-owned for a deal with an estimate (AC-3.1): the client omits
 * `terms.estimatedManDays` (sending it, even `null`, is a 422), and on a `fixed_price` project the
 * server copies EstimAI's figure once, before the write (A6) — EstimAI down is a 503 with nothing
 * written, an estimate EstimAI does not know leaves the figure `null`. The estimate id is copied onto
 * the purchase order: it is the AC-3.2 link.
 *
 * A body error names the field by its full path in the body (`terms.startDate`,
 * `terms.terms.deadline`): `terms` is `{ startDate, endDate?, terms }`, specs/021's contract shape.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PROJECT_MANAGE, assertCanManage, authorized, requireCapability, type AuthzSource } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { dealsById, orCrmUnavailable, type CrmDeal } from "../lib/crm";
import { db } from "../lib/db";
import { estimateManDays } from "../lib/estimai";
import { IdParams, IdSchema, commonErrors, etag, requiredText } from "../lib/http";
import { ProblemError, conflict, unprocessable, validationHook } from "../lib/problem";
import { projectCreateData } from "../projects/create";
import { projectInclude, toProjectView } from "../projects/projects.routes";
import { ProjectSchema, type ProjectType } from "../projects/projects.schemas";
import { termsCreateData } from "../terms/create";
import { parseTerms, type Terms } from "../terms/terms";
import { CreateTermsSchema } from "../terms/terms.schemas";

// ─── Request shapes ──────────────────────────────────────────────────────────

/** The client types (AC-1.2, D40): every type but `internal`, which has no company and no PO. */
const DEAL_PROJECT_TYPES = ["t_and_m", "fixed_price", "maintenance", "saas"] as const;

const DealParams = z.object({ dealId: IdParams.shape.id });

const TakeAsProjectSchema = z
  .object({
    name: requiredText(200),
    type: z.enum(DEAL_PROJECT_TYPES),
    /** The dates and the type's terms, collected in the same step as the take (AC-1.8). */
    terms: CreateTermsSchema,
    /** The `auth` user the purchase order is assigned to, who picks the project manager (D42). */
    opsManagerId: IdSchema,
    /** A CRM contact of the deal's company (D41); optional. */
    referentContactId: IdSchema.nullable().optional(),
  })
  .strict();

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * The deal to take: it must exist, be manageable by the caller, have no purchase order and be won
 * now. A taken deal says `deal_taken` even if it was reopened since — that is the truer answer.
 */
async function loadTakeableDeal(c: AuthzSource, dealId: string): Promise<CrmDeal> {
  const deal = (await orCrmUnavailable(dealsById([dealId]))).get(dealId);
  if (!deal) {
    throw new ProblemError({ status: 404, code: "deal_not_found", detail: "The CRM does not know this deal" });
  }
  assertCanManage(c, deal.entity);
  if (await db.purchaseOrder.findUnique({ where: { dealId }, select: { id: true } })) {
    throw dealTaken();
  }
  if (deal.stage !== "won") {
    throw conflict("deal_not_won", "This deal is no longer won in the CRM, so it cannot be taken", { stage: deal.stage });
  }
  return deal;
}

const dealTaken = (): ProblemError =>
  conflict("deal_taken", "This deal already has a purchase order: a deal feeds one project only");

/** Postgres' unique index on `purchase_order.dealId` refused a second purchase order for the deal. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/**
 * The terms of the project made from `deal` on a project of `type`, validated, with the man-days
 * filled from the estimate (AC-3.1). The client never sends `estimatedManDays` for a deal with an
 * estimate; for one without, it is the client's to give, as on terms entered by hand.
 */
async function dealTerms(type: ProjectType, raw: Record<string, unknown> | undefined, deal: CrmDeal): Promise<Terms> {
  if (type === "fixed_price" && deal.estimate && raw !== undefined && "estimatedManDays" in raw) {
    throw unprocessable(
      "The estimated man-days of a deal with an estimate come from the estimate: leave them out",
      { field: "terms.terms.estimatedManDays" },
      "estimated_man_days_from_estimate",
    );
  }
  const terms = parseTerms(type, raw ?? {}, ["terms", "terms"]);
  if (terms.type === "fixed_price" && deal.estimate) {
    return { ...terms, estimatedManDays: await estimateManDays(deal.estimate.id) };
  }
  return terms;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const takeAsProjectRoute = createRoute({
  method: "post",
  path: "/queue/{dealId}/project",
  tags: ["Queue"],
  summary: "Take a won deal as a new project with its terms and purchase order (project:manage for the deal's entity)",
  middleware: [...authorized, requireCapability(PROJECT_MANAGE)],
  request: {
    params: DealParams,
    body: { content: { "application/json": { schema: TakeAsProjectSchema } }, required: true },
  },
  responses: {
    201: { description: "Created: a planned project with no project manager, its terms and a purchase order made from the deal", ...json(ProjectSchema) },
    404: { description: "deal_not_found" },
    409: { description: "deal_not_won or deal_taken" },
    422: { description: "estimated_man_days_from_estimate or maintenance_needs_sla_or_hours" },
    ...commonErrors,
    503: { description: "crm_unavailable, estimai_unavailable, estimai_unconfigured or authz_unavailable" },
  },
});

export const takeRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

takeRouter.openapi(takeAsProjectRoute, async (c) => {
  const { dealId } = c.req.valid("param");
  const body = c.req.valid("json");
  const deal = await loadTakeableDeal(c, dealId);
  const terms = await dealTerms(body.type, body.terms.terms, deal);
  const userId = c.get("userId");

  const row = await db.project
    .create({
      data: {
        // No project manager: the person who took the deal is not made one (D42).
        ...projectCreateData({
          name: body.name,
          type: body.type,
          entity: deal.entity,
          companyId: deal.company.id,
          projectManagerId: null,
          createdById: userId,
        }),
        terms: {
          create: termsCreateData({ type: body.type, startDate: body.terms.startDate, endDate: body.terms.endDate, terms }),
        },
        purchaseOrder: {
          create: {
            dealId,
            estimateId: deal.estimate?.id ?? null,
            opsManagerId: body.opsManagerId,
            referentContactId: body.referentContactId ?? null,
            createdById: userId,
          },
        },
      },
      include: projectInclude,
    })
    .catch((error: unknown) => {
      throw isUniqueViolation(error) ? dealTaken() : error;
    });
  c.header("ETag", etag(row.version));
  return c.json(await toProjectView(c, row), 201);
});
