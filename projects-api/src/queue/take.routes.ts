/**
 * Taking a deal from the to-start queue (specs/022-projects-handoff T7; AC-1.2 – AC-1.6, AC-3.1,
 * AC-3.2): `POST /queue/{dealId}/project` makes a new project and its first contract from a won
 * deal, `POST /queue/{dealId}/attach` adds a contract made from it to an existing project.
 *
 * Who may take a deal is `project:manage` for the DEAL's entity (A20, D36): the route refuses a
 * caller who manages no entity (`forbidden`) before anything is looked up, the handler refuses the
 * other entity (`out_of_scope`) once the CRM has said which entity the deal is. Attaching does not
 * ask for manage on the target project's entity too (a deal of one entity may join a project of the
 * other, A9).
 *
 * The deal is read live from crm-api, never trusted from the client: it must exist, be `won` NOW
 * and have no contract yet. Project and contract are written in ONE statement (a nested create),
 * so a refusal — including the unique `dealId` index losing a race between two takes of the
 * same deal (the database half of AC-1.6) — leaves no project and no contract behind.
 *
 * Man-days are server-owned for a deal with an estimate (AC-3.1): the client omits
 * `terms.estimatedManDays` (sending it, even `null`, is a 422), and on a `fixed_price` contract the
 * server copies EstimAI's figure once, before the write (A6) — EstimAI down is a 503 with nothing
 * written, an estimate EstimAI does not know leaves the figure `null`. The estimate id is copied on
 * every deal contract: it is the AC-3.2 link.
 *
 * A body error names the field by its full path in the body (`contract.startDate`,
 * `contract.terms.deadline`).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PROJECT_MANAGE, assertCanManage, authorized, requireCapability, type AuthzSource } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { assertDealCompanyFits, assertTakesContracts, contractCreateData } from "../contracts/create";
import { ContractSchema } from "../contracts/contracts.schemas";
import { contractInclude, toContractView } from "../contracts/contracts.routes";
import { parseTerms, type Terms } from "../contracts/terms";
import { dealsById, orCrmUnavailable, type CrmDeal } from "../lib/crm";
import { db } from "../lib/db";
import { estimateManDays } from "../lib/estimai";
import { DateOnlySchema, IdParams, IdSchema, commonErrors, etag, requiredText } from "../lib/http";
import { requireProjectUsers } from "../lib/identities";
import { ProblemError, conflict, unprocessable, validationHook } from "../lib/problem";
import { projectCreateData } from "../projects/create";
import { projectInclude, toProjectView } from "../projects/projects.routes";
import { ProjectSchema, type ProjectType } from "../projects/projects.schemas";

// ─── Request shapes ──────────────────────────────────────────────────────────

/** The client types (AC-1.2): `saas` and `internal` are born without a company, so never from a deal. */
const DEAL_PROJECT_TYPES = ["t_and_m", "fixed_price", "maintenance"] as const;

const termsDescription =
  "By the project's type — fixed_price: { deadline, maxEffortManDays, estimatedManDays? } (omit " +
  "estimatedManDays for a deal with an estimate: it is copied from the estimate); maintenance: { sla?, " +
  "hourPackage? } (one required); t_and_m: { positions: [{ profile, plannedManDays }] } (at least one).";

/** The contract's own dates and terms, collected in the same step as the take (tasks.md § Decided here). */
const DealContractSchema = z
  .object({
    startDate: DateOnlySchema,
    endDate: DateOnlySchema.nullable().optional(),
    terms: z.record(z.unknown()).optional().openapi({ description: termsDescription }),
  })
  .strict()
  .superRefine((contract, ctx) => {
    if (contract.endDate != null && contract.endDate < contract.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "Must not be before the start date" });
    }
  });

const DealParams = z.object({ dealId: IdSchema });

const TakeAsProjectSchema = z
  .object({
    name: requiredText(200),
    type: z.enum(DEAL_PROJECT_TYPES),
    /** The caller by default; must hold projects:access. */
    projectManagerId: IdSchema.optional(),
    contract: DealContractSchema,
  })
  .strict();

const AttachSchema = z.object({ projectId: IdSchema, contract: DealContractSchema }).strict();

// ─── Rules ───────────────────────────────────────────────────────────────────

/**
 * The deal to take: it must exist, be manageable by the caller, have no contract and be won now.
 * A taken deal says `deal_taken` even if it was reopened since — that is the truer answer.
 */
async function loadTakeableDeal(c: AuthzSource, dealId: string): Promise<CrmDeal> {
  const deal = (await orCrmUnavailable(dealsById([dealId]))).get(dealId);
  if (!deal) {
    throw new ProblemError({ status: 404, code: "deal_not_found", detail: "The CRM does not know this deal" });
  }
  assertCanManage(c, deal.entity);
  if (await db.contract.findUnique({ where: { dealId }, select: { id: true } })) {
    throw dealTaken();
  }
  if (deal.stage !== "won") {
    throw conflict("deal_not_won", "This deal is no longer won in the CRM, so it cannot be taken", { stage: deal.stage });
  }
  return deal;
}

const dealTaken = (): ProblemError =>
  conflict("deal_taken", "This deal already has a contract: a deal feeds one project only");

/** Postgres' unique index on `contract.dealId` refused a second contract for the deal. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

/**
 * The terms of the contract made from `deal` on a project of `type`, validated, with the man-days
 * filled from the estimate (AC-3.1). The client never sends `estimatedManDays` for a deal with an
 * estimate; for one without, it is the client's to give, as on a contract entered by hand.
 */
async function dealTerms(type: ProjectType, raw: Record<string, unknown>, deal: CrmDeal): Promise<Terms> {
  if (type === "fixed_price" && deal.estimate && "estimatedManDays" in raw) {
    throw unprocessable(
      "The estimated man-days of a deal with an estimate come from the estimate: leave them out",
      { field: "contract.terms.estimatedManDays" },
      "estimated_man_days_from_estimate",
    );
  }
  const terms = parseTerms(type, raw, ["contract", "terms"]);
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
  summary: "Take a won deal as a new project with its first contract (project:manage for the deal's entity)",
  middleware: [...authorized, requireCapability(PROJECT_MANAGE)],
  request: {
    params: DealParams,
    body: { content: { "application/json": { schema: TakeAsProjectSchema } }, required: true },
  },
  responses: {
    201: { description: "Created: a planned project with one contract made from the deal", ...json(ProjectSchema) },
    404: { description: "deal_not_found" },
    409: { description: "deal_not_won or deal_taken" },
    422: { description: "not_project_user, estimated_man_days_from_estimate or maintenance_needs_sla_or_hours" },
    ...commonErrors,
    503: { description: "crm_unavailable, estimai_unavailable, estimai_unconfigured or authz_unavailable" },
  },
});

const attachRoute = createRoute({
  method: "post",
  path: "/queue/{dealId}/attach",
  tags: ["Queue"],
  summary: "Attach a won deal to an existing project as a contract (project:manage for the deal's entity)",
  middleware: [...authorized, requireCapability(PROJECT_MANAGE)],
  request: {
    params: DealParams,
    body: { content: { "application/json": { schema: AttachSchema } }, required: true },
  },
  responses: {
    201: { description: "Created: a contract of the project's type made from the deal", ...json(ContractSchema) },
    404: { description: "deal_not_found or project_not_found" },
    409: { description: "deal_not_won, deal_taken, contracts_not_allowed (internal) or project_not_open (closed / cancelled)" },
    422: { description: "company_mismatch, estimated_man_days_from_estimate or maintenance_needs_sla_or_hours" },
    ...commonErrors,
    503: { description: "crm_unavailable, estimai_unavailable, estimai_unconfigured or authz_unavailable" },
  },
});

export const takeRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

takeRouter.openapi(takeAsProjectRoute, async (c) => {
  const { dealId } = c.req.valid("param");
  const body = c.req.valid("json");
  const deal = await loadTakeableDeal(c, dealId);

  const userId = c.get("userId");
  const projectManagerId = body.projectManagerId ?? userId;
  await requireProjectUsers(c, [projectManagerId]);
  const terms = await dealTerms(body.type, body.contract.terms ?? {}, deal);

  const row = await db.project
    .create({
      data: {
        ...projectCreateData({
          name: body.name,
          type: body.type,
          entity: deal.entity,
          companyId: deal.company.id,
          projectManagerId,
          createdById: userId,
        }),
        contracts: {
          create: [
            contractCreateData({
              type: body.type,
              companyId: deal.company.id,
              startDate: body.contract.startDate,
              endDate: body.contract.endDate,
              terms,
              deal: { dealId, estimateId: deal.estimate?.id ?? null },
            }),
          ],
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

takeRouter.openapi(attachRoute, async (c) => {
  const { dealId } = c.req.valid("param");
  const body = c.req.valid("json");
  const deal = await loadTakeableDeal(c, dealId);

  const project = await db.project.findUnique({
    where: { id: body.projectId },
    select: { type: true, state: true, companyId: true },
  });
  if (!project) {
    throw new ProblemError({ status: 404, code: "project_not_found", detail: "The project does not exist" });
  }
  assertTakesContracts(project);
  assertDealCompanyFits(project, deal.company.id);
  const terms = await dealTerms(project.type, body.contract.terms ?? {}, deal);

  const row = await db.contract
    .create({
      data: {
        projectId: body.projectId,
        ...contractCreateData({
          type: project.type,
          companyId: deal.company.id,
          startDate: body.contract.startDate,
          endDate: body.contract.endDate,
          terms,
          deal: { dealId, estimateId: deal.estimate?.id ?? null },
        }),
      },
      include: contractInclude,
    })
    .catch((error: unknown) => {
      throw isUniqueViolation(error) ? dealTaken() : error;
    });
  c.header("ETag", etag(row.version));
  return c.json(await toContractView(row), 201);
});
