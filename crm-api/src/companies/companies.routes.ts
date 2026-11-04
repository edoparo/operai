/**
 * Companies (specs/017-crm US-1; plan.md § Companies). Every route needs
 * `crm:access` only (D-3): the relationship record is shared by the team.
 * Writes to an existing company carry `If-Match` (D-7).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authorized } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { OPEN_STAGES } from "../deals/stages";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import {
  IdParams,
  PersonRefSchema,
  definedOnly,
  withSource,
  type HeaderSource,
  archivedWhere,
  assertVersion,
  commonErrors,
  etag,
  isRecordNotFound,
  requireIfMatch,
  skipTake,
  versionConflict,
} from "../lib/http";
import { requireCrmUsers } from "../lib/identities";
import { loadPeople } from "../lib/people";
import { ProblemError, notFound, validationHook } from "../lib/problem";
import { effectiveStatus, isLapsed, lastWon, statusWhere } from "./status";
import {
  COMPANY_SORTS,
  CompanyPageSchema,
  CompanySchema,
  CreateCompanySchema,
  ListCompaniesQuery,
  UpdateCompanySchema,
} from "./companies.schemas";

const withCounts = {
  _count: {
    select: {
      contacts: { where: { archivedAt: null } },
      deals: { where: { stage: { in: [...OPEN_STAGES] } } },
    },
  },
  ...lastWon,
} satisfies Prisma.CompanyInclude;

type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof withCounts }>;

async function toViews(c: HeaderSource, rows: readonly CompanyRow[]) {
  const { person } = await loadPeople(c, rows.map((row) => row.ownerUserId));
  const now = new Date();
  return rows.map((row) => {
    const facts = { status: row.status, openDealCount: row._count.deals, lastWonAt: row.deals[0]?.closedAt ?? null };
    return {
      id: row.id,
      name: row.name,
      status: effectiveStatus(facts, now),
      // True when `status` reads `former` because the relationship lapsed (specs/017 AC-1.9).
      statusLapsed: isLapsed(facts, now),
      entity: row.entity,
      industry: row.industry,
      city: row.city,
      country: row.country,
      owner: person(row.ownerUserId),
      archived: row.archivedAt !== null,
      contactCount: row._count.contacts,
      openDealCount: row._count.deals,
      source: row.source,
      sourceDetail: row.sourceDetail,
      updatedAt: row.updatedAt.toISOString(),
      website: row.website,
      legalName: row.legalName,
      street: row.street,
      postalCode: row.postalCode,
      notes: row.notes,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function toView(c: HeaderSource, row: CompanyRow) {
  const [view] = await toViews(c, [row]);
  return view!;
}

/** 409 `company_name_taken` naming the existing company (D-11), or nothing. */
async function assertNameFree(name: string, exceptId?: string): Promise<void> {
  const existing = await db.company.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true, archivedAt: true },
  });
  if (existing) throw nameTaken(existing);
}

const nameTaken = (existing: { id: string; name: string; archivedAt: Date | null }) =>
  new ProblemError({
    status: 409,
    code: "company_name_taken",
    detail: `A company named "${existing.name}" already exists`,
    extras: { companyId: existing.id, archived: existing.archivedAt !== null },
  });

/** The unique index won a race the pre-check lost: answer the same 409. */
async function rethrowNameRace(error: unknown, name: string): Promise<never> {
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
    const existing = await db.company.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true, name: true, archivedAt: true },
    });
    if (existing) throw nameTaken(existing);
  }
  throw error;
}

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

// ─── Routes ──────────────────────────────────────────────────────────────────

const listRoute = createRoute({
  method: "get",
  path: "/companies",
  tags: ["Companies"],
  summary: "List companies, by name",
  middleware: authorized,
  request: { query: ListCompaniesQuery },
  responses: { 200: { description: "A page of companies", ...json(CompanyPageSchema) }, ...commonErrors },
});

const createCompanyRoute = createRoute({
  method: "post",
  path: "/companies",
  tags: ["Companies"],
  summary: "Create a company",
  middleware: authorized,
  request: { body: { content: { "application/json": { schema: CreateCompanySchema } }, required: true } },
  responses: {
    201: { description: "Created", ...json(CompanySchema) },
    409: { description: "company_name_taken" },
    ...commonErrors,
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/companies/{id}",
  tags: ["Companies"],
  summary: "Get a company",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: { description: "The company", ...json(CompanySchema) }, 404: { description: "Not found" }, ...commonErrors },
});

const updateRoute = createRoute({
  method: "patch",
  path: "/companies/{id}",
  tags: ["Companies"],
  summary: "Edit a company (If-Match required)",
  middleware: authorized,
  request: {
    params: IdParams,
    body: { content: { "application/json": { schema: UpdateCompanySchema } }, required: true },
  },
  responses: {
    200: { description: "Updated", ...json(CompanySchema) },
    404: { description: "Not found" },
    409: { description: "version_conflict or company_name_taken" },
    428: { description: "precondition_required" },
    ...commonErrors,
  },
});

const archiveRoute = (action: "archive" | "unarchive") =>
  createRoute({
    method: "post",
    path: `/companies/{id}/${action}`,
    tags: ["Companies"],
    summary: action === "archive" ? "Archive a company (If-Match required)" : "Unarchive a company (If-Match required)",
    middleware: authorized,
    request: { params: IdParams },
    responses: {
      200: { description: "The company", ...json(CompanySchema) },
      404: { description: "Not found" },
      409: { description: "version_conflict" },
      428: { description: "precondition_required" },
      ...commonErrors,
    },
  });

export const companiesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

/** US-9: the asked column first (empty values last), then the name, then the id: a stable order across pages. */
function companyOrder(
  sort: (typeof COMPANY_SORTS)[number] | undefined,
  order: "asc" | "desc",
): Prisma.CompanyOrderByWithRelationInput[] {
  const tail: Prisma.CompanyOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];
  switch (sort) {
    case undefined:
      return tail;
    case "name":
      return [{ name: order }, { id: order }];
    case "industry":
    case "city":
      return [{ [sort]: { sort: order, nulls: "last" } }, ...tail];
    default:
      return [{ [sort]: order }, ...tail];
  }
}

const ownersRoute = createRoute({
  method: "get",
  path: "/companies/owners",
  tags: ["Companies"],
  summary: "The people who own a company, by name (the owner filter)",
  middleware: authorized,
  responses: {
    200: { description: "Company owners", ...json(z.object({ items: z.array(PersonRefSchema) })) },
    ...commonErrors,
  },
});

// US-9: every crm:access holder already reads each company's owner, so this projection
// gives them nothing new (ADR-0042's reconstructibility test) and needs no directory permission.
companiesRouter.openapi(ownersRoute, async (c) => {
  const rows = await db.company.findMany({ distinct: ["ownerUserId"], select: { ownerUserId: true }, take: 500 });
  const ids = rows.map((row) => row.ownerUserId);
  const { person } = await loadPeople(c, ids);
  const items = ids
    .map(person)
    .sort((a, b) => (a.name ?? "\uffff").localeCompare(b.name ?? "\uffff") || a.id.localeCompare(b.id));
  return c.json({ items }, 200);
});

companiesRouter.openapi(listRoute, async (c) => {
  const { q, status, archived, ownerId, sort, order, page, pageSize } = c.req.valid("query");
  const where: Prisma.CompanyWhereInput = {
    ...archivedWhere(archived),
    // The filter matches the EFFECTIVE status, so a lapsed customer lists as former.
    AND: status ? [statusWhere(status, new Date())] : [],
    ...(ownerId ? { ownerUserId: ownerId } : {}),
    ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      include: withCounts,
      orderBy: companyOrder(sort, order),
      ...skipTake(page, pageSize),
    }),
  ]);
  const views = await toViews(c, rows);
  // The list carries the summary shape only.
  const items = views.map(
    ({ website: _w, legalName: _l, street: _s, postalCode: _p, notes: _n, version: _v, createdAt: _c, ...summary }) => summary,
  );
  return c.json({ items, total, page, pageSize }, 200);
});

companiesRouter.openapi(createCompanyRoute, async (c) => {
  const body = c.req.valid("json");
  const userId = c.get("userId");
  const ownerUserId = body.ownerUserId ?? userId;
  if (ownerUserId !== userId) {
    await requireCrmUsers(c, [{ id: ownerUserId, field: "ownerUserId" }]);
  }
  await assertNameFree(body.name);
  const row = await db.company
    .create({
      data: {
        name: body.name,
        status: body.status,
        entity: body.entity,
        website: body.website ?? null,
        industry: body.industry ?? null,
        city: body.city ?? null,
        country: body.country ?? null,
        legalName: body.legalName ?? null,
        street: body.street ?? null,
        postalCode: body.postalCode ?? null,
        notes: body.notes ?? null,
        source: body.source ?? null,
        sourceDetail: body.source ? (body.sourceDetail ?? null) : null,
        ownerUserId,
        createdBy: userId,
        updatedBy: userId,
      },
      include: withCounts,
    })
    .catch((error: unknown) => rethrowNameRace(error, body.name));
  c.header("ETag", etag(row.version));
  return c.json(await toView(c, row), 201);
});

companiesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await db.company.findUnique({ where: { id }, include: withCounts });
  if (!row) throw notFound("Company not found");
  c.header("ETag", etag(row.version));
  return c.json(await toView(c, row), 200);
});

/** Loads, checks the precondition, applies `data` with a version CAS. */
async function casUpdate(
  c: HeaderSource & { get(key: "userId"): string },
  id: string,
  data: Prisma.CompanyUpdateInput,
) {
  const expected = requireIfMatch(c);
  const current = await db.company.findUnique({ where: { id }, select: { version: true } });
  if (!current) throw notFound("Company not found");
  assertVersion(current.version, expected);
  try {
    return await db.company.update({
      where: { id, version: expected },
      data: { ...data, version: { increment: 1 }, updatedBy: c.get("userId") },
      include: withCounts,
    });
  } catch (error) {
    if (isRecordNotFound(error)) {
      const now = await db.company.findUnique({ where: { id }, select: { version: true } });
      if (!now) throw notFound("Company not found");
      throw versionConflict(now.version);
    }
    throw error;
  }
}

companiesRouter.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  requireIfMatch(c);
  if (body.ownerUserId !== undefined && body.ownerUserId !== c.get("userId")) {
    await requireCrmUsers(c, [{ id: body.ownerUserId, field: "ownerUserId" }]);
  }
  if (body.name !== undefined) await assertNameFree(body.name, id);
  const row = await casUpdate(c, id, definedOnly(withSource(body))).catch((error: unknown) =>
    body.name !== undefined ? rethrowNameRace(error, body.name) : Promise.reject(error),
  );
  c.header("ETag", etag(row.version));
  return c.json(await toView(c, row), 200);
});

for (const action of ["archive", "unarchive"] as const) {
  companiesRouter.openapi(archiveRoute(action), async (c) => {
    const { id } = c.req.valid("param");
    const row = await casUpdate(c, id, { archivedAt: action === "archive" ? new Date() : null });
    c.header("ETag", etag(row.version));
    return c.json(await toView(c, row), 200);
  });
}
