/**
 * The meeting-host contract (specs/20261104-meetings US-11 and A18, ADR 20261104-meeting-host-contract-resolve-and-notices):
 * meetings-api asks THIS service, with the caller's own JWT, what the caller may know about the projects a
 * meeting is (or would be) linked to.
 *
 *   missing     no such project
 *   closed      the caller does not hold `projects:access` (a project they cannot open)
 *   open        the caller reads it: its name, its page and whether they are a HOST READER —
 *               `hostVisible` is true for the project's team (its project manager and members), the
 *               people a creator may let read a meeting linked to the project (A18)
 *
 * Only JWT and live authorization run (no capability guard: a caller without access is answered,
 * not refused); an `auth` outage is the usual 503, which meetings-api reads as `host_unavailable`.
 * Projects takes no host notices (the registry says `notices: false`): nothing about a meeting is
 * stored here. Reads only what it is asked about, writes nothing, never cached.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { PROJECTS_ACCESS } from "../auth/guards";
import { authzMiddleware, type AuthzVariables } from "../auth/authz.middleware";
import { jwtMiddleware } from "../auth/jwt.middleware";
import { hasCapability } from "../authz/conditions";
import { db } from "../lib/db";
import { validationHook } from "../lib/problem";

const IdSchema = z.string().min(1).max(64).refine((value) => !value.includes("\u0000"), "Must not contain a NUL character");

/** meetings-api asks in batches of at most 25. */
export const MAX_MEETING_RESOLVE_IDS = 25;

const ResolveBodySchema = z
  .object({
    entityType: z.literal("project"),
    ids: z.array(IdSchema).min(1).max(MAX_MEETING_RESOLVE_IDS),
  })
  .strict();

const ItemSchema = z.union([
  z.object({ id: z.string(), state: z.enum(["missing", "closed"]) }),
  z.object({
    id: z.string(),
    state: z.literal("open"),
    title: z.string(),
    href: z.string(),
    hostVisible: z.boolean(),
  }),
]);

const resolveRoute = createRoute({
  method: "post",
  path: "/meeting-host/v1/resolve",
  tags: ["Meeting host"],
  summary: "What the caller may know about these projects (called by meetings-api as the caller)",
  middleware: [jwtMiddleware, authzMiddleware],
  request: { body: { content: { "application/json": { schema: ResolveBodySchema } }, required: true } },
  responses: {
    200: {
      description: "One item per distinct id, in request order",
      content: { "application/json": { schema: z.object({ items: z.array(ItemSchema) }) } },
    },
    400: { description: "Validation failed" },
    401: { description: "Missing or invalid token" },
    503: { description: "The authorization service is unavailable" },
  },
});

export const meetingHostRouter = new OpenAPIHono<{ Variables: AuthzVariables & { userId: string } }>({
  defaultHook: validationHook,
});

meetingHostRouter.openapi(resolveRoute, async (c) => {
  const distinct = [...new Set(c.req.valid("json").ids)];
  c.header("Cache-Control", "no-store");
  const { permissions } = c.get("authz");
  const userId = c.get("userId");

  const rows = await db.project.findMany({
    where: { id: { in: distinct } },
    select: { id: true, name: true, projectManagerId: true, members: { where: { userId }, select: { userId: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const reader = hasCapability(permissions, PROJECTS_ACCESS[0], PROJECTS_ACCESS[1]);

  const items = distinct.map((id) => {
    const row = byId.get(id);
    if (!row) return { id, state: "missing" as const };
    if (!reader) return { id, state: "closed" as const };
    return {
      id,
      state: "open" as const,
      title: row.name,
      href: `/projects/${row.id}`,
      hostVisible: row.projectManagerId === userId || row.members.length > 0,
    };
  });
  return c.json({ items }, 200);
});
