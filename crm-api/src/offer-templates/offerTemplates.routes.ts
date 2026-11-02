/**
 * Offer templates (specs/020 US-2; plan.md § API): the named starting points of
 * an offer, owned by one entity and written in one language.
 *
 *   GET    /offer-templates?entity=&includeArchived=   deal:financials; seeds the fourteen defaults on first read
 *   GET    /offer-templates/{id}                       deal:financials
 *   POST   /offer-templates                           deal:manage over the entity (+ deal:financials)
 *   POST   /offer-templates/{id}/duplicate            as create
 *   PUT    /offer-templates/{id}                      as create; If-Match required (428 / 409)
 *   POST   /offer-templates/{id}/archive | /restore   as create; If-Match required
 *
 * Reads are open to every `deal:financials` holder of either entity (a template
 * carries prices; ADR-0052's "reads are team knowledge" posture). Writes outside
 * the caller's entity are 403 `out_of_scope`, not 404: the caller can read the
 * template (ADR-0052's branch). Seeding is lazy and idempotent (ADR-0013 posture:
 * no migration data, no cron): an entity with NO template row at all - archived
 * ones count - gets the defaults, under an advisory lock so concurrent first
 * reads insert them once.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  DEAL_FINANCIALS,
  DEAL_MANAGE,
  authorized,
  dealScope,
  requireCapability,
} from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import type { Entity } from "../authz/conditions";
import { assertInScope } from "../deals/deals.routes";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import {
  EntitySchema,
  IdParams,
  PersonRefSchema,
  assertVersion,
  commonErrors,
  etag,
  isRecordNotFound,
  requireIfMatch,
  versionConflict,
  type HeaderSource,
} from "../lib/http";
import { loadPeople } from "../lib/people";
import { ProblemError, notFound, validationHook } from "../lib/problem";
import type { OfferTemplateContent } from "../offers/contract";
import { DEFAULT_TEMPLATES_EN } from "../offers/defaultTemplates.en";
import { DEFAULT_TEMPLATES_IT } from "../offers/defaultTemplates";
import {
  CostColumnsSchema,
  CreateTemplateSchema,
  SectionSchema,
  TemplateContentSchema,
  TemplateCostLineSchema,
  type TemplateContentInput,
} from "../offers/offerSchemas";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const reading = [...authorized, requireCapability(DEAL_FINANCIALS)];
const writing = [...authorized, requireCapability(DEAL_FINANCIALS), requireCapability(DEAL_MANAGE)];

/** The author recorded on the seeded defaults. */
const SEED_AUTHOR = "system:crm-api";

const TemplateSchema = z.object({
  id: z.string(),
  entity: EntitySchema,
  name: z.string(),
  language: z.enum(["en", "it"]),
  salutation: z.string(),
  opening: z.string(),
  sections: z.array(SectionSchema),
  costLines: z.array(TemplateCostLineSchema),
  costColumns: CostColumnsSchema,
  showTotal: z.boolean(),
  acceptanceLabel: z.string().nullable(),
  annex: z.boolean(),
  version: z.number().int(),
  archived: z.boolean(),
  updatedBy: PersonRefSchema,
  updatedAt: z.string(),
  createdAt: z.string(),
});

type TemplateRow = Awaited<ReturnType<typeof db.offerTemplate.findMany>>[number];

async function toViews(c: HeaderSource, rows: readonly TemplateRow[]) {
  const { person } = await loadPeople(c, rows.map((row) => row.updatedBy));
  return rows.map((row) => ({
    id: row.id,
    entity: row.entity,
    name: row.name,
    language: row.language,
    salutation: row.salutation,
    opening: row.opening,
    sections: row.sections as unknown as OfferTemplateContent["sections"],
    costLines: row.costLines as unknown as OfferTemplateContent["costLines"],
    costColumns: row.costColumns as unknown as OfferTemplateContent["costColumns"],
    showTotal: row.showTotal,
    acceptanceLabel: row.acceptanceLabel,
    annex: row.annex,
    version: row.version,
    archived: row.archivedAt !== null,
    updatedBy: person(row.updatedBy),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The JSON columns and scalars of a template's content, as Prisma wants them. */
const dataOf = (content: TemplateContentInput | OfferTemplateContent) => ({
  name: content.name,
  language: content.language,
  salutation: content.salutation,
  opening: content.opening,
  sections: content.sections as unknown as Prisma.InputJsonValue,
  costLines: content.costLines as unknown as Prisma.InputJsonValue,
  costColumns: content.costColumns as unknown as Prisma.InputJsonValue,
  showTotal: content.showTotal,
  acceptanceLabel: content.acceptanceLabel ?? null,
  annex: content.annex,
});

/** Inserts the fourteen defaults once for an entity that has no template row. */
export async function seedTemplatesIfEmpty(entity: Entity): Promise<void> {
  if ((await db.offerTemplate.count({ where: { entity } })) > 0) return;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm-offer-templates:${entity}`}))`;
    if ((await tx.offerTemplate.count({ where: { entity } })) > 0) return;
    await tx.offerTemplate.createMany({
      data: [...DEFAULT_TEMPLATES_IT, ...DEFAULT_TEMPLATES_EN].map((template) => ({
        entity,
        ...dataOf(template),
        createdBy: SEED_AUTHOR,
        updatedBy: SEED_AUTHOR,
      })),
    });
  });
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

const nameTaken = (name: string) =>
  new ProblemError({
    status: 409,
    code: "template_name_taken",
    detail: `An active template named "${name}" already exists for this entity`,
    extras: { field: "name" },
  });

async function loadTemplate(id: string) {
  const row = await db.offerTemplate.findUnique({ where: { id } });
  if (!row) throw notFound("Template not found");
  return row;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const listRoute = createRoute({
  method: "get",
  path: "/offer-templates",
  tags: ["Offer templates"],
  summary: "An entity's offer templates (deal:financials); seeds the defaults on first read",
  middleware: reading,
  request: {
    query: z.object({
      entity: EntitySchema,
      includeArchived: z.enum(["true", "false"]).default("false"),
    }),
  },
  responses: { 200: { description: "Templates, by name", ...json(z.object({ items: z.array(TemplateSchema) })) }, ...commonErrors },
});

const getRoute = createRoute({
  method: "get",
  path: "/offer-templates/{id}",
  tags: ["Offer templates"],
  summary: "One template (deal:financials); returns an ETag",
  middleware: reading,
  request: { params: IdParams },
  responses: { 200: { description: "The template", ...json(TemplateSchema) }, 404: { description: "Not found" }, ...commonErrors },
});

const createTemplateRoute = createRoute({
  method: "post",
  path: "/offer-templates",
  tags: ["Offer templates"],
  summary: "Create a template (deal:manage over the entity)",
  middleware: writing,
  request: { body: { content: { "application/json": { schema: CreateTemplateSchema } }, required: true } },
  responses: {
    ...commonErrors,
    201: { description: "Created", ...json(TemplateSchema) },
    403: { description: "out_of_scope" },
    409: { description: "template_name_taken" },
  },
});

const duplicateRoute = createRoute({
  method: "post",
  path: "/offer-templates/{id}/duplicate",
  tags: ["Offer templates"],
  summary: "Copy a template under a fresh name, e.g. \"Training (copy)\" (deal:manage over the entity)",
  middleware: writing,
  request: { params: IdParams },
  responses: {
    ...commonErrors,
    201: { description: "The copy", ...json(TemplateSchema) },
    403: { description: "out_of_scope" },
    404: { description: "Not found" },
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/offer-templates/{id}",
  tags: ["Offer templates"],
  summary: "Replace a template's content (If-Match required)",
  middleware: writing,
  request: { params: IdParams, body: { content: { "application/json": { schema: TemplateContentSchema } }, required: true } },
  responses: {
    ...commonErrors,
    200: { description: "Saved", ...json(TemplateSchema) },
    403: { description: "out_of_scope" },
    404: { description: "Not found" },
    409: { description: "version_conflict or template_name_taken" },
    428: { description: "precondition_required" },
  },
});

const archiveRoute = (action: "archive" | "restore") =>
  createRoute({
    method: "post",
    path: `/offer-templates/{id}/${action}`,
    tags: ["Offer templates"],
    summary:
      action === "archive"
        ? "Archive a template: hidden from the dialog, offers keep their snapshot (If-Match required)"
        : "Restore an archived template (If-Match required)",
    middleware: writing,
    request: { params: IdParams },
    responses: {
    ...commonErrors,
      200: { description: "The template", ...json(TemplateSchema) },
      403: { description: "out_of_scope" },
      404: { description: "Not found" },
      409: { description: "version_conflict or template_name_taken" },
      428: { description: "precondition_required" },
  },
  });

export const offerTemplatesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

offerTemplatesRouter.openapi(listRoute, async (c) => {
  const { entity, includeArchived } = c.req.valid("query");
  await seedTemplatesIfEmpty(entity);
  const rows = await db.offerTemplate.findMany({
    where: { entity, ...(includeArchived === "true" ? {} : { archivedAt: null }) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return c.json({ items: await toViews(c, rows) }, 200);
});

offerTemplatesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await loadTemplate(id);
  c.header("ETag", etag(row.version));
  return c.json((await toViews(c, [row]))[0]!, 200);
});

offerTemplatesRouter.openapi(createTemplateRoute, async (c) => {
  const { entity, ...content } = c.req.valid("json");
  assertInScope(dealScope(c), entity);
  const userId = c.get("userId");
  const row = await db.offerTemplate
    .create({ data: { entity, ...dataOf(content), createdBy: userId, updatedBy: userId } })
    .catch((error: unknown) => {
      throw isUniqueViolation(error) ? nameTaken(content.name) : error;
    });
  c.header("ETag", etag(row.version));
  return c.json((await toViews(c, [row]))[0]!, 201);
});

const COPY_SUFFIX = { en: "(copy)", it: "(copia)" } as const;

offerTemplatesRouter.openapi(duplicateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const source = await loadTemplate(id);
  assertInScope(dealScope(c), source.entity);
  const userId = c.get("userId");
  const taken = new Set(
    (await db.offerTemplate.findMany({ where: { entity: source.entity, archivedAt: null }, select: { name: true } })).map(
      (row) => row.name.toLowerCase(),
    ),
  );
  const suffix = COPY_SUFFIX[source.language];
  const make = (n: number) => {
    const tail = n === 1 ? ` ${suffix}` : ` ${suffix} ${n}`;
    return `${source.name.slice(0, 80 - tail.length).trimEnd()}${tail}`;
  };
  let n = 1;
  while (taken.has(make(n).toLowerCase())) n += 1;
  const row = await db.offerTemplate
    .create({
      data: {
        entity: source.entity,
        name: make(n),
        language: source.language,
        salutation: source.salutation,
        opening: source.opening,
        sections: source.sections as Prisma.InputJsonValue,
        costLines: source.costLines as Prisma.InputJsonValue,
        costColumns: source.costColumns as Prisma.InputJsonValue,
        showTotal: source.showTotal,
        acceptanceLabel: source.acceptanceLabel,
        annex: source.annex,
        createdBy: userId,
        updatedBy: userId,
      },
    })
    .catch((error: unknown) => {
      // A concurrent duplicate took the same name: the caller simply retries.
      throw isUniqueViolation(error) ? nameTaken(make(n)) : error;
    });
  c.header("ETag", etag(row.version));
  return c.json((await toViews(c, [row]))[0]!, 201);
});

/** Loads, checks scope and precondition, applies `data` with a version CAS. */
async function casUpdate(
  c: HeaderSource & { get(key: "userId"): string; get(key: "authz"): AuthzVariables["authz"] },
  id: string,
  data: (current: TemplateRow) => Prisma.OfferTemplateUpdateInput,
  conflictName: (current: TemplateRow) => string,
) {
  const expected = requireIfMatch(c);
  const current = await loadTemplate(id);
  assertInScope(dealScope(c), current.entity);
  assertVersion(current.version, expected);
  try {
    return await db.offerTemplate.update({
      where: { id, version: expected },
      data: { ...data(current), version: { increment: 1 }, updatedBy: c.get("userId") },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(conflictName(current));
    if (isRecordNotFound(error)) {
      const now = await db.offerTemplate.findUnique({ where: { id }, select: { version: true } });
      if (!now) throw notFound("Template not found");
      throw versionConflict(now.version);
    }
    throw error;
  }
}

offerTemplatesRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const content = c.req.valid("json");
  const row = await casUpdate(c, id, () => dataOf(content), () => content.name);
  c.header("ETag", etag(row.version));
  return c.json((await toViews(c, [row]))[0]!, 200);
});

for (const action of ["archive", "restore"] as const) {
  offerTemplatesRouter.openapi(archiveRoute(action), async (c) => {
    const { id } = c.req.valid("param");
    const row = await casUpdate(
      c,
      id,
      () => ({ archivedAt: action === "archive" ? new Date() : null }),
      (current) => current.name,
    );
    c.header("ETag", etag(row.version));
    return c.json((await toViews(c, [row]))[0]!, 200);
  });
}
