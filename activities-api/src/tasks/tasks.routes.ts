/**
 * The task lists (specs/028-activities US-3 AC-3.4/3.5, US-7; plan § API contracts):
 *
 *   GET /tasks            the CRM Tasks page, one project's Tasks card, and "My tasks" across
 *                         both tools — one route, one order, one view (`ActivityView`)
 *   GET /tasks/assignees  the people tasks of one kind were given to (the Tasks page filter)
 *
 * No permission is held here (ADR-0081). Every list asks the host(s) that own the tasks, as the
 * caller: a single-kind list needs a host that lets the caller read (404 otherwise, the same
 * answer as for anything that does not exist, AC-8.3) and that can answer (503
 * `host_unavailable`, fail closed, AC-8.2). The one list that mixes hosts, `kind=all`, is the
 * exception by design: a host that does not let the caller read contributes nothing (AC-7.4),
 * and one that cannot answer is left out and NAMED in `unavailable` so the page can say so
 * (AC-7.5) — the caller's other tasks must not vanish because the CRM is down.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { JwtVariables } from "../auth/jwt.middleware";
import { jwtMiddleware } from "../auth/jwt.middleware";
import { HostSession } from "../activities/access";
import { ACTIVITY_KINDS, ActivitySchema, toViews, withRefs } from "../activities/view";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { PersonRefSchema, commonErrors, idText, pageOf, pageQuery, skipTake } from "../lib/http";
import { loadPeople } from "../lib/people";
import { ProblemError, unprocessable, validationHook } from "../lib/problem";
import type { ActivityHost, ActivityKind, HostApp } from "../hosts/registry";

/** The most assignees the filter offers (crm-api's bound). */
const MAX_ASSIGNEES = 500;

const IdParam = idText();

const ListTasksQuery = z.object({
  /** Absent means `pre_sales`, which is what crm-api's `GET /tasks` always meant. */
  kind: z.enum([...ACTIVITY_KINDS, "all"]).optional(),
  /** One project's tasks (the project card). Implies `operational`, and `assignee=any` unless one is given. */
  projectId: IdParam.optional(),
  status: z.enum(["open", "done"]).default("open"),
  /** `me` (default; a person's tasks are those assigned to them and those they take part in, 017 US-8), `any`, or a user id. */
  assignee: IdParam.optional(),
  ...pageQuery(),
});

const AssigneesQuery = z.object({ kind: z.enum(ACTIVITY_KINDS).default("pre_sales") });

const TaskPageSchema = pageOf(ActivitySchema).extend({
  /** Hosts whose tasks are left out because they could not answer (`kind=all` only, AC-7.5). */
  unavailable: z.array(z.enum(["crm", "projects"])).optional(),
});

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const tasksRoute = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["Tasks"],
  summary: "Tasks — open ones earliest due first (no date last), done ones newest completion first",
  middleware: [jwtMiddleware],
  request: { query: ListTasksQuery },
  responses: { 200: { description: "A page of tasks", ...json(TaskPageSchema) }, ...commonErrors },
});

const assigneesRoute = createRoute({
  method: "get",
  path: "/tasks/assignees",
  tags: ["Tasks"],
  summary: "The people tasks of one kind have been assigned to, by name",
  middleware: [jwtMiddleware],
  request: { query: AssigneesQuery },
  responses: {
    200: { description: "Task assignees", ...json(z.object({ items: z.array(PersonRefSchema) })) },
    ...commonErrors,
  },
});

export const tasksRouter = new OpenAPIHono<{ Variables: JwtVariables }>({ defaultHook: validationHook });

type Caller = { req: { header(name: string): string | undefined } };
const authorizationOf = (c: Caller) => c.req.header("Authorization") ?? "";

/**
 * Whether `host` lets the caller read its activities, asked without naming an entity: `ok`, or
 * one of the two ways it can fail. Whatever else happens is a fault and is not swallowed.
 */
async function readerState(session: HostSession, host: ActivityHost): Promise<"ok" | "not_reader" | "unavailable"> {
  try {
    await session.load(host, []);
    return "ok";
  } catch (error) {
    if (error instanceof ProblemError && error.status === 404) return "not_reader";
    if (error instanceof ProblemError && error.status === 503 && error.code === "host_unavailable") return "unavailable";
    throw error;
  }
}

/** A person's tasks: assigned to them, or one they take part in (017 US-8). */
const personsTasks = (userId: string): Prisma.ActivityWhereInput => ({
  OR: [{ assigneeUserId: userId }, { participants: { some: { userId } } }],
});

/** Open: earliest due first, no date last, then oldest, then id (AC-3.4). Done: latest completion first (crm-api's order). */
const orderOf = (status: "open" | "done"): Prisma.ActivityOrderByWithRelationInput[] =>
  status === "open"
    ? [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }]
    : [{ completedAt: "desc" }, { id: "desc" }];

tasksRouter.openapi(tasksRoute, async (c) => {
  const query = c.req.valid("query");
  const { projectId, status, page, pageSize } = query;
  const session = new HostSession(authorizationOf(c));

  if (projectId !== undefined && query.kind !== undefined && query.kind !== "operational") {
    throw unprocessable("A project's tasks are operational ones", { field: "kind" }, "kind_conflicts_with_project");
  }
  const kind = projectId !== undefined ? "operational" : (query.kind ?? "pre_sales");
  const assignee = query.assignee ?? (projectId !== undefined ? "any" : "me");
  if (kind === "all" && assignee !== "me") {
    throw unprocessable("Tasks of every kind are listed only for yourself", { field: "assignee" }, "all_kinds_only_for_me");
  }

  // Which hosts' tasks are listed. A single kind asks its own host and fails with it; `all` asks
  // both and keeps the ones that answer and let the caller read.
  const unavailable: HostApp[] = [];
  const kinds: ActivityKind[] = [];
  let projectHost: ActivityHost | undefined;
  if (kind === "all") {
    for (const host of session.registry.all()) {
      const state = await readerState(session, host);
      if (state === "ok") kinds.push(host.kind);
      else if (state === "unavailable") unavailable.push(host.app);
    }
  } else {
    const host = session.registry.forKind(kind)!;
    if (projectId !== undefined) {
      // The card of one project: the host must know it and let the caller read it (404 either way).
      await session.load(host, [projectId]);
      session.open(host, projectId);
      projectHost = host;
    } else {
      await session.load(host, []);
    }
    kinds.push(kind);
  }

  if (kinds.length === 0) {
    return c.json({ items: [], total: 0, page, pageSize, ...(unavailable.length > 0 ? { unavailable } : {}) }, 200);
  }

  const listFor = async (hostKinds: readonly ActivityKind[]) => {
    const where: Prisma.ActivityWhereInput = {
      type: "task",
      kind: { in: [...hostKinds] },
      completedAt: status === "open" ? null : { not: null },
      ...(projectHost ? { hostApp: projectHost.app, hostType: projectHost.entityType, hostId: projectId! } : {}),
      ...(assignee === "any" ? {} : personsTasks(assignee === "me" ? c.get("userId") : assignee)),
    };
    const [total, rows] = await Promise.all([
      db.activity.count({ where }),
      db.activity.findMany({ where, include: withRefs, orderBy: orderOf(status), ...skipTake(page, pageSize) }),
    ]);
    return { total, items: await toViews(c, rows, session) };
  };

  // A single kind fails with its host. `all` asks the hosts for labels only for the rows of this
  // page, so a host that answered the probe can still fail here (AC-7.5): it is left out exactly
  // as one that failed the probe — named, its items dropped, never shown without a confirmed
  // label (AC-8.2/8.3) — and the page is listed again from the hosts that remain. A host that
  // stopped being a reader contributes nothing and is not named (AC-7.4). At most one retry per host.
  let listed: Awaited<ReturnType<typeof listFor>>;
  for (;;) {
    try {
      listed = await listFor(kinds);
      break;
    } catch (error) {
      const failure = session.lastFailure;
      const failed = failure ? session.registry.all().find((host) => host.app === failure.app) : undefined;
      const isHostError = error instanceof ProblemError && (error.status === 404 || (error.status === 503 && error.code === "host_unavailable"));
      if (kind !== "all" || !isHostError || !failed || !kinds.includes(failed.kind)) throw error;
      kinds.splice(kinds.indexOf(failed.kind), 1);
      if (failure!.state === "unavailable") unavailable.push(failed.app);
      session.lastFailure = undefined;
      if (kinds.length === 0) {
        return c.json({ items: [], total: 0, page, pageSize, ...(unavailable.length > 0 ? { unavailable } : {}) }, 200);
      }
    }
  }
  return c.json({ ...listed, page, pageSize, ...(unavailable.length > 0 ? { unavailable } : {}) }, 200);
});

// Everyone who has been given a task of this kind, for the Tasks page filter. A reader of the
// kind's host can already read every task of it with its assignee (`assignee=any`), so this
// projection gives them nothing new (ADR-0042's reconstructibility test) and needs no directory
// permission: the host's answer is the whole gate.
tasksRouter.openapi(assigneesRoute, async (c) => {
  const { kind } = c.req.valid("query");
  const session = new HostSession(authorizationOf(c));
  await session.load(session.registry.forKind(kind)!, []);

  const rows = await db.activity.findMany({
    where: { type: "task", kind, assigneeUserId: { not: null } },
    distinct: ["assigneeUserId"],
    select: { assigneeUserId: true },
    orderBy: { assigneeUserId: "asc" },
    take: MAX_ASSIGNEES,
  });
  const ids = rows.map((row) => row.assigneeUserId!);
  const { person } = await loadPeople(c, ids);
  const items = ids
    .map(person)
    .sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.id.localeCompare(b.id));
  return c.json({ items }, 200);
});
