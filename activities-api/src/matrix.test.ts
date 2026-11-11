/**
 * Authorization matrix over the ASSEMBLED app (specs/028-activities T11; AC-8.1, AC-8.2, AC-8.3,
 * AC-3.2, AC-3.3, AC-3.8; plan § Access and § Test strategy "Host route guard matrices").
 *
 * activities-api holds no permission of its own (ADR-0081): every user route asks the host that
 * owns the entity, as the caller, and the host's ANSWER is the whole authorization. So the matrix
 * is host x route x caller, and what each caller is allowed is written out below as LITERALS taken
 * from the spec, never computed from the rules under test (src/activities/rules.ts):
 *
 *   crm       reader (no relation) · author · assignee · participant · non-reader · host down
 *   projects  manager in scope · out of scope · assignee without manage · participant only ·
 *             closed project (as manager, as assignee) · non-reader · host down
 *
 * The route list is read from the app's own table: a route mounted without a classification here
 * (user, system or public) fails the inventory test, and every classified user route is driven by
 * every caller. A refused write must also change nothing (the activity tables are compared before
 * and after), and every question the host received must carry the CALLER's own token.
 *
 * `/system/v1/*` is not a user surface: crm-api calls it as itself (scoped service JWT). Here they
 * are asserted to refuse every user JWT, and every other wrong credential, with the identical 401;
 * what they do with a valid credential is system.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { __setDefaultJwksForTests } from "./auth/systemAuth.middleware";
import { setupTestAuth, TEST_AUDIENCE, TEST_ISSUER } from "./test-support/testAuth";
import { PERSONAS, app, bearerOf, call, db, env, hosts, makeCompany, makeProject, resetWorld, type PersonaName } from "./test-support/world";

beforeEach(resetWorld);

// ─── Route classification ────────────────────────────────────────────────────

/** Answer without a token: liveness and the API docs. Nothing else may. */
const PUBLIC = new Set(["GET /health", "GET /openapi.json", "GET /docs"]);

/** Called by crm-api as itself (scope `activities.write`), never with a user JWT. */
const SYSTEM = [
  "PUT /system/v1/activities/:id",
  "DELETE /system/v1/activities/:id",
  "POST /system/v1/activities/:id/completion",
  "POST /system/v1/meeting-mirror",
  "POST /system/v1/contacts/:contactId/erase",
] as const;

/** Every route the user surface serves. Each needs at least one case below. */
const USER = [
  "GET /activities",
  "POST /activities",
  "PATCH /activities/:id",
  "DELETE /activities/:id",
  "POST /activities/:id/complete",
  "POST /activities/:id/reopen",
  "GET /tasks",
  "GET /tasks/assignees",
] as const;

const mounted = [...new Set(app.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`))];

describe("route inventory", () => {
  it("classifies every mounted route as public, system or user, and nothing else", () => {
    const known = new Set<string>([...PUBLIC, ...SYSTEM, ...USER]);
    expect(mounted.filter((key) => !known.has(key))).toEqual([]);
  });

  it("mounts every classified route (no stale row)", () => {
    expect([...PUBLIC, ...SYSTEM, ...USER].filter((key) => !mounted.includes(key))).toEqual([]);
  });

  it("has a case for every user route", () => {
    expect([...new Set(CASES.map((c) => c.route))].sort()).toEqual([...USER].sort());
  });

  it("answers the public routes without a token", async () => {
    expect((await call("GET", "/health", { as: null })).status).toBe(200);
    expect((await call("GET", "/openapi.json", { as: null })).status).toBe(200);
  });
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

type HostName = "crm" | "projects";

interface Scenario {
  readonly name: string;
  readonly as: PersonaName;
  /** The entity is a closed or cancelled project (AC-3.8). */
  readonly closed?: boolean;
  /** The host answers 500 to the caller's question (AC-8.2). */
  readonly down?: boolean;
}

/**
 * The CRM seeds a task authored by `consultant`, assigned to `tech`, with `admin` taking part;
 * `colleague` has no relation to it. The CRM lets every `crm:access` holder read and write.
 */
const CRM_SCENARIOS: readonly Scenario[] = [
  { name: "reader", as: "colleague" },
  { name: "author", as: "consultant" },
  { name: "assignee", as: "tech" },
  { name: "participant", as: "admin" },
  { name: "non-reader", as: "outsider" },
  { name: "host down", as: "consultant", down: true },
];

/**
 * A project seeds a task authored by `manager`, assigned to `pm`, with `member` taking part.
 * `manager` manages the project; `bob` manages ANOTHER project and only reads this one (out of
 * scope); `pm` and `member` are on the team and manage nothing.
 */
const PROJECT_SCENARIOS: readonly Scenario[] = [
  { name: "manager in scope", as: "manager" },
  { name: "out of scope", as: "bob" },
  { name: "assignee without manage", as: "pm" },
  { name: "participant only", as: "member" },
  { name: "closed project, manager", as: "manager", closed: true },
  { name: "closed project, assignee", as: "pm", closed: true },
  { name: "non-reader", as: "outsider" },
  { name: "host down", as: "manager", down: true },
];

const SCENARIOS: Record<HostName, readonly Scenario[]> = { crm: CRM_SCENARIOS, projects: PROJECT_SCENARIOS };

interface Seeded {
  readonly hostId: string;
  readonly activityId: string;
}

async function seed(host: HostName, options: { closed?: boolean | undefined; completed?: boolean | undefined } = {}): Promise<Seeded> {
  const done = options.completed ? { completedAt: new Date("2026-11-01T10:00:00Z"), completedByUserId: "user-tech" } : {};
  if (host === "crm") {
    const company = makeCompany("Acme SA");
    const row = await db.activity.create({
      data: {
        kind: "pre_sales",
        type: "task",
        subject: "Send the proposal",
        hostApp: "crm",
        hostType: "company",
        hostId: company.id,
        contactId: "ct-matrix",
        occurredAt: new Date("2026-10-01T09:00:00Z"),
        authorUserId: "user-consultant",
        assigneeUserId: "user-tech",
        ...done,
        participants: { create: [{ userId: "user-admin", createdBy: "user-consultant" }] },
      },
    });
    return { hostId: company.id, activityId: row.id };
  }
  const project = makeProject("Smart meter rollout", options.closed ? { writable: false } : {});
  // bob manages some other project: a manager elsewhere is still out of scope here.
  makeProject("Other project", { mayFor: { "user-bob": { write: true, manage: true } } });
  const row = await db.activity.create({
    data: {
      kind: "operational",
      type: "task",
      subject: "Install the gateways",
      hostApp: "projects",
      hostType: "project",
      hostId: project.id,
      occurredAt: new Date("2026-10-01T09:00:00Z"),
      authorUserId: "user-manager",
      assigneeUserId: "user-pm",
      ...done,
      participants: { create: [{ userId: "user-member", createdBy: "user-manager" }] },
    },
  });
  return { hostId: project.id, activityId: row.id };
}

/** Everything the activity tables hold, in a stable order: a refused request must leave it equal. */
async function snapshot(): Promise<string> {
  const rows = await db.activity.findMany({
    include: { participants: { orderBy: { userId: "asc" } }, blockedBy: true },
    orderBy: { id: "asc" },
  });
  return JSON.stringify(rows);
}

// ─── The cases: route x host x expected status per caller ────────────────────

type Expected = number | readonly [number, string];

interface Req {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

interface Case {
  readonly route: (typeof USER)[number];
  readonly host: HostName;
  /** What the case is about, for the test name. */
  readonly what: string;
  /** Whether the request changes data (a refused one must leave the tables as they were). */
  readonly writes: boolean;
  readonly seed?: { readonly completed?: boolean };
  readonly request: (s: Seeded) => Req;
  /** The literal expectation for every scenario of the host; a missing scenario fails. */
  readonly expect: Readonly<Record<string, Expected>>;
}

const DOWN: Expected = [503, "host_unavailable"];
const AUTHOR_ONLY: Expected = [403, "author_only"];
const FORBIDDEN: Expected = [403, "forbidden"];
const READ_ONLY: Expected = [409, "host_read_only"];

/** Every caller the CRM lets read sees the list; a non-reader gets the 404 of a missing record. */
const CRM_READ = { reader: 200, author: 200, assignee: 200, participant: 200, "non-reader": 404, "host down": DOWN };
/** A project is readable by every reader of the module, in scope or not, closed or open (AC-3.8). */
const PROJECT_READ = {
  "manager in scope": 200,
  "out of scope": 200,
  "assignee without manage": 200,
  "participant only": 200,
  "closed project, manager": 200,
  "closed project, assignee": 200,
  "non-reader": 404,
  "host down": DOWN,
};

const CASES: readonly Case[] = [
  // ── GET /activities ──
  {
    route: "GET /activities",
    host: "crm",
    what: "by company",
    writes: false,
    request: (s) => ({ method: "GET", path: `/activities?companyId=${s.hostId}` }),
    expect: CRM_READ,
  },
  {
    route: "GET /activities",
    host: "crm",
    what: "by contact",
    writes: false,
    request: () => ({ method: "GET", path: "/activities?contactId=ct-matrix" }),
    expect: CRM_READ,
  },
  {
    route: "GET /activities",
    host: "crm",
    what: "by deal",
    writes: false,
    request: () => ({ method: "GET", path: "/activities?dealId=dl-matrix" }),
    expect: CRM_READ,
  },
  {
    route: "GET /activities",
    host: "projects",
    what: "by project",
    writes: false,
    request: (s) => ({ method: "GET", path: `/activities?projectId=${s.hostId}` }),
    expect: PROJECT_READ,
  },

  // ── POST /activities: the host's `may.write` (CRM: any reader; project: a manager), and a read-only entity ──
  {
    route: "POST /activities",
    host: "crm",
    what: "a task on a company",
    writes: true,
    request: (s) => ({ method: "POST", path: "/activities", body: { type: "task", subject: "Matrix", companyId: s.hostId } }),
    expect: { reader: 201, author: 201, assignee: 201, participant: 201, "non-reader": 404, "host down": DOWN },
  },
  {
    route: "POST /activities",
    host: "projects",
    what: "a task on a project",
    writes: true,
    request: (s) => ({ method: "POST", path: "/activities", body: { type: "task", subject: "Matrix", projectId: s.hostId } }),
    expect: {
      "manager in scope": 201,
      "out of scope": FORBIDDEN,
      "assignee without manage": FORBIDDEN,
      "participant only": FORBIDDEN,
      "closed project, manager": READ_ONLY,
      "closed project, assignee": FORBIDDEN,
      "non-reader": 404,
      "host down": DOWN,
    },
  },

  // ── PATCH /activities/:id: CRM the author, project a manager (AC-3.2); nothing on a closed project (AC-3.8) ──
  {
    route: "PATCH /activities/:id",
    host: "crm",
    what: "rename",
    writes: true,
    request: (s) => ({ method: "PATCH", path: `/activities/${s.activityId}`, body: { subject: "Renamed" } }),
    expect: { reader: AUTHOR_ONLY, author: 200, assignee: AUTHOR_ONLY, participant: AUTHOR_ONLY, "non-reader": 404, "host down": DOWN },
  },
  {
    route: "PATCH /activities/:id",
    host: "projects",
    what: "rename",
    writes: true,
    request: (s) => ({ method: "PATCH", path: `/activities/${s.activityId}`, body: { subject: "Renamed" } }),
    expect: {
      "manager in scope": 200,
      "out of scope": FORBIDDEN,
      "assignee without manage": FORBIDDEN,
      "participant only": FORBIDDEN,
      "closed project, manager": READ_ONLY,
      "closed project, assignee": FORBIDDEN,
      "non-reader": 404,
      "host down": DOWN,
    },
  },
  {
    // Reassigning is an edit: the assignee of a project task cannot hand it to someone else (AC-3.2).
    route: "PATCH /activities/:id",
    host: "projects",
    what: "reassign",
    writes: true,
    request: (s) => ({ method: "PATCH", path: `/activities/${s.activityId}`, body: { assigneeUserId: "user-member" } }),
    expect: {
      "manager in scope": 200,
      "out of scope": FORBIDDEN,
      "assignee without manage": FORBIDDEN,
      "participant only": FORBIDDEN,
      "closed project, manager": READ_ONLY,
      "closed project, assignee": FORBIDDEN,
      "non-reader": 404,
      "host down": DOWN,
    },
  },

  // ── DELETE /activities/:id: the same gate as editing ──
  {
    route: "DELETE /activities/:id",
    host: "crm",
    what: "delete",
    writes: true,
    request: (s) => ({ method: "DELETE", path: `/activities/${s.activityId}` }),
    expect: { reader: AUTHOR_ONLY, author: 204, assignee: AUTHOR_ONLY, participant: AUTHOR_ONLY, "non-reader": 404, "host down": DOWN },
  },
  {
    route: "DELETE /activities/:id",
    host: "projects",
    what: "delete",
    writes: true,
    request: (s) => ({ method: "DELETE", path: `/activities/${s.activityId}` }),
    expect: {
      "manager in scope": 204,
      "out of scope": FORBIDDEN,
      "assignee without manage": FORBIDDEN,
      "participant only": FORBIDDEN,
      "closed project, manager": READ_ONLY,
      "closed project, assignee": FORBIDDEN,
      "non-reader": 404,
      "host down": DOWN,
    },
  },

  // ── complete / reopen: any CRM reader; on a project the assignee or a manager (AC-3.3), closed or not (AC-3.8) ──
  ...(["complete", "reopen"] as const).flatMap((action): Case[] => [
    {
      route: `POST /activities/:id/${action}`,
      host: "crm",
      what: action,
      writes: true,
      seed: { completed: action === "reopen" },
      request: (s) => ({ method: "POST", path: `/activities/${s.activityId}/${action}` }),
      expect: { reader: 200, author: 200, assignee: 200, participant: 200, "non-reader": 404, "host down": DOWN },
    },
    {
      route: `POST /activities/:id/${action}`,
      host: "projects",
      what: action,
      writes: true,
      seed: { completed: action === "reopen" },
      request: (s) => ({ method: "POST", path: `/activities/${s.activityId}/${action}` }),
      expect: {
        "manager in scope": 200,
        "out of scope": FORBIDDEN,
        "assignee without manage": 200,
        "participant only": FORBIDDEN,
        "closed project, manager": 200,
        "closed project, assignee": 200,
        "non-reader": 404,
        "host down": DOWN,
      },
    },
  ]),

  // ── GET /tasks ──
  {
    route: "GET /tasks",
    host: "crm",
    what: "pre-sales tasks (the default kind)",
    writes: false,
    request: () => ({ method: "GET", path: "/tasks?assignee=any" }),
    expect: CRM_READ,
  },
  {
    route: "GET /tasks",
    host: "projects",
    what: "one project's tasks",
    writes: false,
    request: (s) => ({ method: "GET", path: `/tasks?projectId=${s.hostId}` }),
    expect: PROJECT_READ,
  },
  {
    route: "GET /tasks",
    host: "projects",
    what: "operational tasks across projects",
    writes: false,
    request: () => ({ method: "GET", path: "/tasks?kind=operational&assignee=any" }),
    expect: PROJECT_READ,
  },

  // ── GET /tasks/assignees ──
  {
    route: "GET /tasks/assignees",
    host: "crm",
    what: "pre-sales assignees",
    writes: false,
    request: () => ({ method: "GET", path: "/tasks/assignees?kind=pre_sales" }),
    expect: CRM_READ,
  },
  {
    route: "GET /tasks/assignees",
    host: "projects",
    what: "operational assignees",
    writes: false,
    request: () => ({ method: "GET", path: "/tasks/assignees?kind=operational" }),
    expect: PROJECT_READ,
  },
];

const statusOf = (expected: Expected): [number, string | undefined] =>
  typeof expected === "number" ? [expected, undefined] : [expected[0], expected[1]];

/** The 404 of a record that does not exist, minus the field that names the path. */
const notFoundShape = (json: Record<string, unknown>) => ({ ...json, instance: undefined });

describe("authorization matrix: host x route x caller", () => {
  for (const c of CASES) {
    describe(`${c.route} on ${c.host}: ${c.what}`, () => {
      it("states an expectation for every caller, and none for a caller that does not exist", () => {
        expect(Object.keys(c.expect).sort()).toEqual(SCENARIOS[c.host].map((s) => s.name).sort());
      });

      for (const scenario of SCENARIOS[c.host]) {
        it(`${scenario.name}`, async () => {
          const seeded = await seed(c.host, { closed: scenario.closed, ...c.seed });
          if (scenario.down) hosts[c.host].mode = { status: 500 };
          const before = await snapshot();
          const [status, code] = statusOf(c.expect[scenario.name]!);

          const req = c.request(seeded);
          const res = await call(req.method, req.path, { as: scenario.as, ...(req.body !== undefined ? { body: req.body } : {}) });

          expect(res.status).toBe(status);
          if (code) expect(res.json.code).toBe(code);

          // A refusal changes nothing (AC-8.2: a host that cannot confirm writes nothing).
          if (c.writes && status >= 400) expect(await snapshot()).toBe(before);

          // AC-8.3: a caller the host does not let read is told what a missing record is told, nothing more.
          if (status === 404) {
            const missing = await call("DELETE", "/activities/no-such-activity", { as: "consultant" });
            expect(missing.status).toBe(404);
            expect(notFoundShape(res.json)).toEqual(notFoundShape(missing.json));
          }

          // The host is always asked AS THE CALLER, never with a credential of the service's own.
          const bearer = await bearerOf(scenario.as);
          const asked = [...hosts.crm.resolves, ...hosts.projects.resolves];
          expect(asked.every((resolve) => resolve.authorization === bearer)).toBe(true);
          if (status !== 503) expect(asked.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe("an entity the host does not know is the same 404 as one the caller may not read (AC-8.3)", () => {
  const UNKNOWN: Array<[HostName, string, Req]> = [
    ["crm", "list", { method: "GET", path: "/activities?companyId=co-unknown" }],
    ["projects", "list", { method: "GET", path: "/activities?projectId=pr-unknown" }],
    ["crm", "create", { method: "POST", path: "/activities", body: { type: "note", subject: "x", companyId: "co-unknown" } }],
    ["projects", "create", { method: "POST", path: "/activities", body: { type: "task", subject: "x", projectId: "pr-unknown" } }],
    ["projects", "a project's tasks", { method: "GET", path: "/tasks?projectId=pr-unknown" }],
  ];
  for (const [host, what, req] of UNKNOWN) {
    it(`${host}: ${what}`, async () => {
      const before = await snapshot();
      const res = await call(req.method, req.path, { as: host === "crm" ? "consultant" : "manager", ...(req.body ? { body: req.body } : {}) });
      expect(res.status).toBe(404);
      const missing = await call("DELETE", "/activities/no-such-activity", { as: "consultant" });
      expect(notFoundShape(res.json)).toEqual(notFoundShape(missing.json));
      expect(await snapshot()).toBe(before);
    });
  }
});

describe("scope is per entity, not per caller", () => {
  it("a manager of one project writes there and only reads another (AC-3.2)", async () => {
    const seeded = await seed("projects"); // bob manages a different project, seeded beside it
    const bobs = makeProject("Bob's project", { mayFor: { "user-bob": { write: true, manage: true } } });
    const own = await call("POST", "/activities", { as: "bob", body: { type: "task", subject: "Mine", projectId: bobs.id } });
    expect(own.status).toBe(201);
    const theirs = await call("POST", "/activities", { as: "bob", body: { type: "task", subject: "Theirs", projectId: seeded.hostId } });
    expect(theirs.status).toBe(403);
  });
});

// ─── The task list that mixes hosts: the documented exception to "no read, no answer" ────────

describe("GET /tasks?kind=all (AC-7.4, AC-7.5): the one list that degrades instead of refusing", () => {
  const mine = "/tasks?kind=all&assignee=me";

  it("a caller who reads neither host gets an empty page, not a 404", async () => {
    await seed("crm");
    await seed("projects");
    const res = await call("GET", mine, { as: "outsider" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ items: [], total: 0 });
    expect(res.json.unavailable).toBeUndefined();
  });

  it("a host that cannot answer is named, the other host's tasks stay (never a 503)", async () => {
    await seed("crm");
    await seed("projects");
    hosts.crm.mode = { status: 500 };
    const res = await call("GET", mine, { as: "pm" });
    expect(res.status).toBe(200);
    expect(res.json.unavailable).toEqual(["crm"]);
    expect(res.json.items.map((t: { kind: string }) => t.kind)).toEqual(["operational"]);
  });

  it("lists only the caller's own tasks: someone else's are not reachable through it", async () => {
    await seed("crm");
    await seed("projects");
    // `colleague` reads the CRM and the projects module, is neither assigned nor a participant.
    const res = await call("GET", mine, { as: "colleague" });
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(0);
    expect((await call("GET", "/tasks?kind=all&assignee=any", { as: "colleague" })).status).toBe(422);
    expect((await call("GET", "/tasks?kind=all&assignee=user-tech", { as: "colleague" })).status).toBe(422);
  });

  it("a participant sees the task they took part in, a stranger does not (participant only)", async () => {
    await seed("projects");
    const asParticipant = await call("GET", "/tasks?kind=operational&assignee=me", { as: "member" });
    expect(asParticipant.json.total).toBe(1);
    const asStranger = await call("GET", "/tasks?kind=operational&assignee=me", { as: "viewer" });
    expect(asStranger.json.total).toBe(0);
  });
});

// ─── No token ────────────────────────────────────────────────────────────────

describe("every user route refuses a missing or invalid token with 401, before the host is asked", () => {
  const concrete = (path: string) => path.replace(/:[a-zA-Z]+/g, "some-id");
  const routes = USER.map((key) => {
    const [method, path] = key.split(" ") as [string, string];
    return { key, method, path: concrete(path) };
  });

  for (const { key, method, path } of routes) {
    it(`${key}`, async () => {
      const none = await call(method, path, { as: null, ...(method === "GET" ? {} : { body: {} }) });
      expect(none.status).toBe(401);

      for (const authorization of ["Bearer garbage", "Bearer ", "Basic dXNlcjpwYXNz", await bearerOf("outsider").then((b) => `${b}x`)]) {
        const res = await app.request(path, {
          method,
          headers: { Authorization: authorization, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
          ...(method === "GET" ? {} : { body: "{}" }),
        });
        expect(res.status).toBe(401);
      }
      expect(hosts.crm.resolves).toHaveLength(0);
      expect(hosts.projects.resolves).toHaveLength(0);
    });
  }
});

// ─── /system/v1/*: a service credential, never a user JWT ────────────────────

describe("/system/v1/* refuses every user JWT, and every wrong credential, with the identical 401", () => {
  const SERVICE_AUD = "operai-system-matrix";
  const KID = "svc-matrix-kid";
  const harness = setupTestAuth();

  let serviceKey: CryptoKey;
  let strangerKey: CryptoKey;
  let previousJwks: ReturnType<typeof __setDefaultJwksForTests>;
  let previousAudience: string | undefined;

  beforeAll(async () => {
    await harness.init();
    const pair = await generateKeyPair("RS256");
    serviceKey = pair.privateKey;
    strangerKey = (await generateKeyPair("RS256")).privateKey;
    const serviceJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
    // The suite's own key set (it signs the user JWTs) plus the service key: a user JWT therefore
    // has a VALID signature and issuer here, so only the audience, subject and scope can refuse it.
    previousJwks = __setDefaultJwksForTests(createLocalJWKSet({ keys: [...harness.jwks().keys, serviceJwk] }));
    previousAudience = env.SERVICE_AUDIENCE;
    env.SERVICE_AUDIENCE = SERVICE_AUD;
  });
  afterAll(() => {
    __setDefaultJwksForTests(previousJwks);
    if (previousAudience === undefined) delete env.SERVICE_AUDIENCE;
    else env.SERVICE_AUDIENCE = previousAudience;
  });

  const service = (o: { sub?: string; scope?: string | null; aud?: string; exp?: string; key?: CryptoKey } = {}) =>
    new SignJWT(o.scope === null ? {} : { scope: o.scope ?? "activities.write" })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuedAt()
      .setIssuer(TEST_ISSUER)
      .setSubject(o.sub ?? "system:crm-api")
      .setAudience(o.aud ?? SERVICE_AUD)
      .setExpirationTime(o.exp ?? "5m")
      .sign(o.key ?? serviceKey);

  /** Each wrong credential, as the Authorization header value (null: none at all). */
  async function wrongCredentials(): Promise<Array<[string, string | null]>> {
    const bearer = (token: string) => `Bearer ${token}`;
    return [
      ["no Authorization header", null],
      ["an empty Bearer", "Bearer "],
      ["a user JWT (aud = the suite, sub = a person)", await bearerOf("alice")],
      ["a user JWT of an administrator", await bearerOf("admin")],
      [
        "a person's JWT with the SERVICE audience",
        bearer(await harness.signToken({ sub: PERSONAS.alice.sub, email: "alice@welld.test", audience: SERVICE_AUD })),
      ],
      [
        "a system sub with the SERVICE audience but no scope claim",
        bearer(await harness.signToken({ sub: "system:crm-api", email: "svc@welld.test", audience: SERVICE_AUD })),
      ],
      ["a service JWT without the scope", bearer(await service({ scope: null }))],
      ["a service JWT with another scope", bearer(await service({ scope: "emails.send notifications.push" }))],
      ["a service JWT of a service that is not crm-api", bearer(await service({ sub: "system:meetings-api" }))],
      ["a service JWT whose sub is not a system principal", bearer(await service({ sub: "user-alice" }))],
      ["a service JWT for the user audience", bearer(await service({ aud: TEST_AUDIENCE }))],
      ["an expired service JWT", bearer(await service({ exp: "-1h" }))],
      ["a service JWT signed by an unknown key", bearer(await service({ key: strangerKey }))],
      ["Basic credentials", "Basic dXNlcjpwYXNz"],
    ];
  }

  const concrete = (path: string) => path.replace(/:[a-zA-Z]+/g, "some-id");

  it("is exactly the classified system routes", () => {
    expect(mounted.filter((key) => key.split(" ")[1]!.startsWith("/system/")).sort()).toEqual([...SYSTEM].sort());
  });

  for (const key of SYSTEM) {
    it(`${key}`, async () => {
      const [method, template] = key.split(" ") as [string, string];
      const path = concrete(template);
      const bodies = new Set<string>();
      for (const [label, authorization] of await wrongCredentials()) {
        const res = await app.request(path, {
          method,
          headers: { ...(authorization ? { Authorization: authorization } : {}), "Content-Type": "application/json" },
          ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
        });
        const text = await res.text();
        expect({ credential: label, status: res.status }).toEqual({ credential: label, status: 401 });
        bodies.add(text);
      }
      // Byte-identical: nothing tells a caller which check failed.
      expect(bodies.size).toBe(1);

      // Control, so the 401s above are not vacuous: a valid crm-api credential gets past the guard.
      const ok = await app.request(path, {
        method,
        headers: { Authorization: `Bearer ${await service()}`, "Content-Type": "application/json" },
        ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
      });
      expect(ok.status).not.toBe(401);
      await ok.text();
      // A system call is the caller's own decision already: no host is asked on its behalf.
      expect(hosts.crm.resolves).toHaveLength(0);
      expect(hosts.projects.resolves).toHaveLength(0);
    });
  }

});
