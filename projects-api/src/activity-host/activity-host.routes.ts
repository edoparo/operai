/**
 * The activity-host contract (specs/028-activities T5; AC-3.2, AC-3.5, AC-3.8, AC-8.1, plan.md
 * § Host contract, ADR-0081). activities-api holds the tasks of a project but no permission
 * catalog: on every request it asks THIS service, with the caller's own JWT, who the caller is
 * to the project.
 *
 *   reader     the caller holds `projects:access` (every holder reads every project, D13)
 *   may.manage `project:manage` covering the project's entity (the rule of `assertCanManage`);
 *              `may.write` is the same grant
 *   writable   the project is not `closed` or `cancelled` (AC-3.8): the project stays readable
 *              and its tasks can be completed or reopened, nothing else is accepted
 *   assignees  the project manager and the team: the only people a task may be given to (AC-3.1)
 *
 * Unlike every other route, a caller WITHOUT `projects:access` is not refused: the answer is
 * `reader:false` with every id `missing` (AC-7.4, AC-8.3 — a project one cannot read is
 * indistinguishable from one that does not exist). Only JWT and live authorization run; an `auth`
 * outage is the usual 503 `authz_unavailable`, which activities-api reads as `host_unavailable`.
 * The route reads nothing it is not asked about and writes nothing.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PROJECTS_ACCESS, manageScope } from "../auth/guards";
import { authzMiddleware, type AuthzVariables } from "../auth/authz.middleware";
import { jwtMiddleware } from "../auth/jwt.middleware";
import { hasCapability } from "../authz/conditions";
import { db } from "../lib/db";
import { validationHook } from "../lib/problem";

/** A host-resolve id (as `IdSchema` in lib/http.ts) without a NUL: Postgres text cannot hold one, so it is a 400 here, not a 500 from the database. */
const IdSchema = z.string().min(1).max(64).refine((value) => !value.includes("\u0000"), "Must not contain a NUL character");

/** Hosts answer in batches of 25 (plan.md): activities-api splits larger sets. */
export const MAX_RESOLVE_IDS = 25;

/** The project states in which a task can no longer be created, edited, reassigned or deleted (AC-3.8). */
const READ_ONLY_STATES: readonly string[] = ["closed", "cancelled"];

const ResolveBodySchema = z
  .object({
    entityType: z.literal("project"),
    ids: z.array(IdSchema).max(MAX_RESOLVE_IDS),
    // The CRM's contacts and deals: accepted so a caller that sends it everywhere is not refused,
    // never read, never answered.
    related: z.record(z.array(IdSchema).max(100)).optional(),
  })
  .strict();

const ItemSchema = z.union([
  z.object({ id: z.string(), state: z.literal("missing") }),
  z.object({
    id: z.string(),
    state: z.literal("open"),
    writable: z.boolean(),
    label: z.string(),
    href: z.string(),
    may: z.object({ write: z.boolean(), manage: z.boolean() }),
    assignees: z.array(z.string()),
  }),
]);

const ResolveResponseSchema = z.object({ reader: z.boolean(), items: z.array(ItemSchema) });

const resolveRoute = createRoute({
  method: "post",
  path: "/activity-host/v1/resolve",
  tags: ["Activity host"],
  summary: "What the caller may do with these projects' tasks (called by activities-api as the caller)",
  // JWT + live authorization only: a caller without projects:access gets `reader:false`, not a 403.
  middleware: [jwtMiddleware, authzMiddleware],
  request: { body: { content: { "application/json": { schema: ResolveBodySchema } }, required: true } },
  responses: {
    200: { description: "One item per distinct id, in request order", content: { "application/json": { schema: ResolveResponseSchema } } },
    401: { description: "Missing or invalid token" },
    400: { description: "Validation failed (validation_failed, as everywhere in this service)" },
    503: { description: "The authorization service is unavailable" },
  },
});

export const activityHostRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

activityHostRouter.openapi(resolveRoute, async (c) => {
  const { ids } = c.req.valid("json");
  const distinct = [...new Set(ids)];
  const { permissions } = c.get("authz");
  // Derived from the caller's live permissions on every request; the answer is never cached.
  c.header("Cache-Control", "no-store");

  const reader = hasCapability(permissions, PROJECTS_ACCESS[0], PROJECTS_ACCESS[1]);
  if (!reader || distinct.length === 0) {
    return c.json({ reader, items: distinct.map((id) => ({ id, state: "missing" as const })) }, 200);
  }

  const rows = await db.project.findMany({
    where: { id: { in: distinct } },
    select: {
      id: true,
      name: true,
      entity: true,
      state: true,
      projectManagerId: true,
      members: { select: { userId: true }, orderBy: [{ addedAt: "asc" }, { userId: "asc" }] },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const scope = manageScope(c);

  const items = distinct.map((id) => {
    const row = byId.get(id);
    if (!row) return { id, state: "missing" as const };
    const manage = scope.includes(row.entity);
    return {
      id,
      state: "open" as const,
      writable: !READ_ONLY_STATES.includes(row.state),
      label: row.name,
      href: `/projects/${row.id}`,
      may: { write: manage, manage },
      // A project from a deal has no project manager until its ops-manager picks one (specs/026 D42):
      // then only the team can be given a task.
      assignees: [
        ...new Set(
          [row.projectManagerId, ...row.members.map((member) => member.userId)].filter((id): id is string => id !== null),
        ),
      ],
    };
  });
  return c.json({ reader, items }, 200);
});
