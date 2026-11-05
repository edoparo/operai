/**
 * Projects: list, create, read, rename / change project manager (specs/021 T5; AC-1.1,
 * AC-1.4 – AC-1.7, AC-4.3, AC-4.4).
 *
 * Reading needs `projects:access` only (every holder reads every project, D13). Writing needs
 * `project:manage` for the PROJECT'S entity: the route refuses a caller who holds it for no
 * entity (`forbidden`) before validation, the handler refuses the other entity (`out_of_scope`)
 * once the entity is known. A project's entity, company and type are fixed at creation.
 *
 * Names are live: people come from `auth` (fail soft, ADR-0039), company names from crm-api
 * with the service credential (fail soft, ADR-0059), and so is the deal behind the purchase order of
 * a project made from one (specs/022: title and whether it is still won, fail soft).
 *
 * `toProjectView`, `projectInclude` and `findProjectRow` are exported for the routes that
 * answer with a `Project` after their own write (transitions, team — T6, T7).
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PROJECT_MANAGE, assertCanManage, authorized, requireCapability } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { companyRefs } from "../lib/crm";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import {
  DEFAULT_PAGE_SIZE,
  IdParams,
  assertVersion,
  commonErrors,
  etag,
  isRecordNotFound,
  requireIfMatch,
  skipTake,
  toDateOnly,
  versionConflict,
  type HeaderSource,
} from "../lib/http";
import { requireProjectUsers } from "../lib/identities";
import { loadPeople } from "../lib/people";
import { notFound, validationHook } from "../lib/problem";
import { dealRefs, purchaseOrderView } from "../purchase-orders/view";
import { toTermsView } from "../terms/terms";
import { assertCompanyFits, projectCreateData } from "./create";
import {
  CreateProjectSchema,
  ListProjectsQuery,
  ProjectManagersSchema,
  ProjectPageSchema,
  ProjectSchema,
  UpdateProjectSchema,
} from "./projects.schemas";

// ─── The Project view ────────────────────────────────────────────────────────

export const projectInclude = {
  members: { orderBy: [{ addedAt: "asc" }, { userId: "asc" }] },
  terms: { include: { positions: { orderBy: { position: "asc" } } } },
  purchaseOrder: true,
} satisfies Prisma.ProjectInclude;

export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

export const findProjectRow = (id: string): Promise<ProjectRow | null> =>
  db.project.findUnique({ where: { id }, include: projectInclude });

/**
 * The `Project` of tasks.md § API contracts: details, live names, team, purchase order, terms and
 * the dates of the terms. A project awaits its project manager when it has a purchase order and no
 * project manager yet (specs/022 D42).
 */
export async function toProjectView(c: HeaderSource, row: ProjectRow) {
  const order = row.purchaseOrder;
  const [people, company, deal] = await Promise.all([
    loadPeople(c, [row.projectManagerId, order?.opsManagerId, ...row.members.map((member) => member.userId)]),
    companyRefs([row.companyId]),
    // The deal behind the purchase order, live: `won: false` is the AC-2.3 notice.
    dealRefs([order?.dealId]),
  ]);
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    stateBeforeHold: row.stateBeforeHold,
    entity: row.entity,
    company: row.companyId === null ? null : company(row.companyId),
    projectManager: people.maybe(row.projectManagerId),
    awaitingProjectManager: order !== null && row.projectManagerId === null,
    team: row.members.map((member) => people.person(member.userId)),
    purchaseOrder: order === null ? null : purchaseOrderView(order, deal, people.person),
    terms: row.terms === null ? null : toTermsView(row.terms),
    startDate: toDateOnly(row.terms?.startDate ?? null),
    endDate: toDateOnly(row.terms?.endDate ?? null),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const createProjectRoute = createRoute({
  method: "post",
  path: "/projects",
  tags: ["Projects"],
  summary: "Create a project (project:manage for its entity)",
  middleware: [...authorized, requireCapability(PROJECT_MANAGE)],
  request: { body: { content: { "application/json": { schema: CreateProjectSchema } }, required: true } },
  responses: {
    201: { description: "Created, state planned", ...json(ProjectSchema) },
    // 403: forbidden, or out_of_scope for the other entity (commonErrors).
    422: { description: "company_required, company_not_allowed, company_not_found or not_project_user" },
    ...commonErrors,
  },
});

const listProjectsRoute = createRoute({
  method: "get",
  path: "/projects",
  tags: ["Projects"],
  summary: "List projects, by name, 25 per page",
  middleware: authorized,
  request: { query: ListProjectsQuery },
  responses: { 200: { description: "A page of projects", ...json(ProjectPageSchema) }, ...commonErrors },
});

const getProjectRoute = createRoute({
  method: "get",
  path: "/projects/{id}",
  tags: ["Projects"],
  summary: "A project with its team, purchase order and terms",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: { description: "The project", ...json(ProjectSchema) }, 404: { description: "Not found" }, ...commonErrors },
});

const listProjectManagersRoute = createRoute({
  method: "get",
  path: "/project-managers",
  tags: ["Projects"],
  summary: "The distinct project managers of all projects, by name (projects:access only)",
  middleware: authorized,
  responses: { 200: { description: "The project managers", ...json(ProjectManagersSchema) }, ...commonErrors },
});

const updateProjectRoute = createRoute({
  method: "patch",
  path: "/projects/{id}",
  tags: ["Projects"],
  summary: "Rename a project or change its project manager (If-Match required)",
  middleware: [...authorized, requireCapability(PROJECT_MANAGE)],
  request: {
    params: IdParams,
    body: { content: { "application/json": { schema: UpdateProjectSchema } }, required: true },
  },
  responses: {
    200: { description: "Updated", ...json(ProjectSchema) },
    404: { description: "Not found" },
    409: { description: "version_conflict" },
    422: { description: "not_project_user" },
    428: { description: "precondition_required" },
    ...commonErrors,
  },
});

export const projectsRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

projectsRouter.openapi(createProjectRoute, async (c) => {
  const body = c.req.valid("json");
  assertCanManage(c, body.entity);
  await assertCompanyFits(body.type, body.companyId);
  const userId = c.get("userId");
  const projectManagerId = body.projectManagerId ?? userId;
  // The caller needs no check (they are in the module right now); anyone else must hold access (AC-1.6).
  await requireProjectUsers(c, [projectManagerId]);
  const row = await db.project.create({
    data: projectCreateData({
      name: body.name,
      type: body.type,
      entity: body.entity,
      companyId: body.companyId ?? null,
      projectManagerId,
      createdById: userId,
    }),
    include: projectInclude,
  });
  c.header("ETag", etag(row.version));
  return c.json(await toProjectView(c, row), 201);
});

projectsRouter.openapi(getProjectRoute, async (c) => {
  const { id } = c.req.valid("param");
  const row = await findProjectRow(id);
  if (!row) throw notFound("Project not found");
  c.header("ETag", etag(row.version));
  return c.json(await toProjectView(c, row), 200);
});

projectsRouter.openapi(listProjectsRoute, async (c) => {
  const { page, q, type, state, projectManagerId } = c.req.valid("query");
  const where: Prisma.ProjectWhereInput = {
    ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}),
    ...(type ? { type } : {}),
    ...(state ? { state } : {}),
    ...(projectManagerId ? { projectManagerId } : {}),
  };
  const [total, rows] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({
      where,
      include: { purchaseOrder: { select: { id: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...skipTake(page, DEFAULT_PAGE_SIZE),
    }),
  ]);
  const [people, company] = await Promise.all([
    loadPeople(c, rows.map((row) => row.projectManagerId)),
    companyRefs(rows.map((row) => row.companyId)),
  ]);
  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    entity: row.entity,
    company: row.companyId === null ? null : company(row.companyId),
    projectManager: people.maybe(row.projectManagerId),
    awaitingProjectManager: row.purchaseOrder !== null && row.projectManagerId === null,
  }));
  return c.json({ items, page, pageSize: DEFAULT_PAGE_SIZE, total }, 200);
});

/**
 * Feeds the list's project-manager filter for every reader (AC-1.4): the user directory is open
 * to managers only, so a reader could not otherwise name the people to filter by. Names are live
 * and fail soft; they are sorted after resolving, a person without a name last, ties by id.
 */
projectsRouter.openapi(listProjectManagersRoute, async (c) => {
  // A project awaiting its project manager has none yet (specs/022 D42): nobody to list for it.
  const rows = await db.project.findMany({
    where: { projectManagerId: { not: null } },
    distinct: ["projectManagerId"],
    select: { projectManagerId: true },
  });
  const ids = rows.flatMap((row) => (row.projectManagerId === null ? [] : [row.projectManagerId]));
  const people = await loadPeople(c, ids);
  const items = ids
    .map((id) => people.person(id))
    .sort(
      (a, b) =>
        Number(a.name === null) - Number(b.name === null) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        a.id.localeCompare(b.id),
    );
  return c.json({ items }, 200);
});

projectsRouter.openapi(updateProjectRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const expected = requireIfMatch(c);
  const current = await findProjectRow(id);
  if (!current) throw notFound("Project not found");
  assertCanManage(c, current.entity);
  assertVersion(current.version, expected);
  // A project manager who is not being changed is not re-checked: a rename must not fail
  // because they have since lost access to the module (AC-1.6 guards who is GIVEN a project).
  if (body.projectManagerId !== undefined && body.projectManagerId !== current.projectManagerId) {
    await requireProjectUsers(c, [body.projectManagerId]);
  }
  // Compare-and-set on the version: of two saves of the same version only one matches.
  const row = await db.project
    .update({
      where: { id, version: expected },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.projectManagerId !== undefined ? { projectManagerId: body.projectManagerId } : {}),
        version: { increment: 1 },
      },
      include: projectInclude,
    })
    .catch(async (error: unknown) => {
      if (!isRecordNotFound(error)) throw error;
      const now = await db.project.findUnique({ where: { id }, select: { version: true } });
      if (!now) throw notFound("Project not found");
      throw versionConflict(now.version);
    });
  c.header("ETag", etag(row.version));
  return c.json(await toProjectView(c, row), 200);
});
