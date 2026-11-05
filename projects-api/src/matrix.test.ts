/**
 * Authorization matrix over the ASSEMBLED app (specs/021-projects T10; AC-4.2 – AC-4.6, ADR-0014;
 * specs/022 T9, T23: the to-start queue, terms and purchase order routes, AC-1.1, AC-1.2, AC-1.4).
 * T29 widens it to the gates T24 – T28 add.
 *
 * The route list is read from the app's own table, so a route added without a row here fails the
 * inventory test, and one added without a guard fails the matrix. Every route is then driven by
 * every persona against a record of each entity:
 *
 *   outsider    no grant of the module (an `employee`, AC-4.6)         -> 403 `forbidden` everywhere
 *   viewer      `projects:access` only                                   -> reads, manages nothing (AC-4.3)
 *   pmCh        `project-manager` in welld_ch: manage, entity-scoped     -> own entity only (AC-4.4)
 *   salesIt     `sales` in welld_it: manage, entity-scoped               -> own entity only (AC-4.4)
 *   accounting  `projects:access` + `purchase-order:bexio`                     -> reads, writes the Bexio id (AC-4.5)
 *   admin       everything, unscoped                                     -> both entities (AC-4.6)
 *
 * What each persona holds is written out below as literals (the spec's grants), NOT computed from
 * the test-support personas or from the guards under test. A refused write must also change
 * nothing: the database is compared before and after.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { setupTestAuth } from "./test-support/testAuth";
import { PERSONAS, app, call, crm, db, makeDeal, resetWorld, seedDealProject, type PersonaName } from "./test-support/world";

beforeEach(async () => {
  await resetWorld();
  crm.companies = [{ id: "co-acme", name: "Acme SA", entity: "welld_ch", archived: false }];
});

type Entity = "welld_ch" | "welld_it";
const ENTITIES: readonly Entity[] = ["welld_ch", "welld_it"];

// ─── The routes, and what each one needs ─────────────────────────────────────

/**
 *   access       `projects:access` and nothing more (every holder reads every record, D13)
 *   manage-any   `project:manage` for at least one entity (a lookup, no record involved)
 *   manage       `project:manage` for the RECORD's entity (`out_of_scope` for the other one); for a take
 *                from the to-start queue the record is the CRM DEAL, whose entity the CRM says
 *   bexio        `purchase-order:bexio`, not entity-scoped
 */
type Need = "access" | "manage-any" | "manage" | "bexio";

interface Req {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly ifMatch?: number;
}

interface RouteSpec {
  readonly need: Need;
  /** The status an authorized caller gets on a well-formed request. */
  readonly ok: number;
  /** Seeds what the request needs, for a record of `entity`, and returns a request that succeeds. */
  readonly prepare: (entity: Entity) => Promise<Req>;
}

const seedProject = (entity: Entity, over: Record<string, unknown> = {}) =>
  db.project.create({
    data: {
      name: `Project ${entity}`,
      type: "fixed_price",
      entity,
      companyId: "co-acme",
      projectManagerId: "user-pm-ch",
      createdById: "user-pm-ch",
      ...over,
    },
  });

const withProject = async (entity: Entity, over: Record<string, unknown> = {}) => (await seedProject(entity, over)).id;

/** A project made from a deal (terms and purchase order, no project manager) of `entity`; the deal id is unique per entity. */
const withPurchaseOrder = (entity: Entity) =>
  seedDealProject({ project: { entity, name: `PO project ${entity}` }, order: { dealId: `po-deal-${entity}` } });

/** A hand-made project of `entity` with terms. */
const withTerms = async (entity: Entity) => {
  const project = await seedProject(entity);
  await db.projectTerms.create({
    data: {
      projectId: project.id,
      type: "fixed_price",
      startDate: new Date("2026-12-01T00:00:00Z"),
      deadline: new Date("2027-03-31T00:00:00Z"),
      maxEffortManDays: 55.5,
    },
  });
  return project;
};

/** A won deal of `entity` in the fake CRM, with the company the seeded projects have; returns its id. */
const wonDeal = (entity: Entity, over: Partial<Parameters<typeof makeDeal>[0]> = {}): string => {
  const deal = makeDeal({ id: `deal-${entity}`, entity, company: { id: "co-acme", name: "Acme SA" }, ...over });
  crm.deals = [...crm.deals, deal];
  return deal.id;
};

/** The terms of a take or of a terms write, specs/021's contract shape: the dates and the `fixed_price` terms (the deal has no estimate). */
const takeTerms = { startDate: "2027-01-01", terms: { deadline: "2027-06-30", maxEffortManDays: 10 } };
const takeBody = (over: Record<string, unknown> = {}) => ({
  name: "Koordy 2027",
  type: "fixed_price",
  terms: takeTerms,
  opsManagerId: "user-ops",
  ...over,
});

const SPECS: Record<string, RouteSpec> = {
  "GET /scope": { need: "access", ok: 200, prepare: async () => ({ method: "GET", path: "/scope" }) },
  "GET /companies": { need: "manage-any", ok: 200, prepare: async () => ({ method: "GET", path: "/companies?q=acme" }) },
  // The to-start queue (specs/022): read by every access holder (A20); a take needs manage for the
  // DEAL's entity — the CRM, not the request, says which (AC-1.2, AC-1.4, D36).
  "GET /queue": {
    need: "access",
    ok: 200,
    prepare: async (entity) => (wonDeal(entity), { method: "GET", path: "/queue" }),
  },
  "POST /queue/:dealId/project": {
    need: "manage",
    ok: 201,
    prepare: async (entity) => ({
      method: "POST",
      path: `/queue/${wonDeal(entity)}/project`,
      body: takeBody(),
    }),
  },
  "GET /project-managers": {
    need: "access",
    ok: 200,
    prepare: async (entity) => (await seedProject(entity), { method: "GET", path: "/project-managers" }),
  },
  "GET /projects": { need: "access", ok: 200, prepare: async (entity) => (await seedProject(entity), { method: "GET", path: "/projects" }) },
  "POST /projects": {
    need: "manage",
    ok: 201,
    prepare: async (entity) => ({ method: "POST", path: "/projects", body: { name: "Koordy", type: "internal", entity } }),
  },
  "GET /projects/:id": {
    need: "access",
    ok: 200,
    prepare: async (entity) => ({ method: "GET", path: `/projects/${await withProject(entity)}` }),
  },
  "PATCH /projects/:id": {
    need: "manage",
    ok: 200,
    prepare: async (entity) => ({ method: "PATCH", path: `/projects/${await withProject(entity)}`, body: { name: "Renamed" }, ifMatch: 1 }),
  },
  "POST /projects/:id/transitions": {
    need: "manage",
    ok: 200,
    prepare: async (entity) => ({
      method: "POST",
      path: `/projects/${await withProject(entity)}/transitions`,
      body: { to: "active" },
      ifMatch: 1,
    }),
  },
  "PUT /projects/:id/team": {
    need: "manage",
    ok: 200,
    prepare: async (entity) => ({
      method: "PUT",
      path: `/projects/${await withProject(entity)}/team`,
      body: { memberIds: ["user-viewer"] },
      ifMatch: 1,
    }),
  },
  "POST /projects/:id/terms": {
    need: "manage",
    ok: 201,
    prepare: async (entity) => ({
      method: "POST",
      path: `/projects/${await withProject(entity)}/terms`,
      body: takeTerms,
    }),
  },
  "PATCH /projects/:id/terms": {
    need: "manage",
    ok: 200,
    prepare: async (entity) => ({
      method: "PATCH",
      path: `/projects/${(await withTerms(entity)).id}/terms`,
      body: { endDate: "2027-06-30" },
      ifMatch: 1,
    }),
  },
  // A hand-made project's terms may be removed; one made from a deal keeps them (`terms_required`).
  "DELETE /projects/:id/terms": {
    need: "manage",
    ok: 204,
    prepare: async (entity) => ({ method: "DELETE", path: `/projects/${(await withTerms(entity)).id}/terms`, ifMatch: 1 }),
  },
  "PUT /projects/:id/purchase-order/bexio-order": {
    need: "bexio",
    ok: 200,
    prepare: async (entity) => {
      const { project } = await withPurchaseOrder(entity);
      return {
        method: "PUT",
        path: `/projects/${project.id}/purchase-order/bexio-order`,
        body: { bexioOrderId: "AB-2026-0042" },
        ifMatch: 1,
      };
    },
  },
};

/** The routes that answer without a token: liveness and the API docs. Nothing else may. */
const PUBLIC = new Set(["GET /health", "GET /openapi.json", "GET /docs"]);

/**
 * The service-to-service routes (specs/022): behind a scoped SERVICE credential, never a user JWT, so
 * the persona matrix below does not apply to them. Their credential matrix lives in
 * src/system/*.test.ts; the one thing asserted here is that no user, whatever they hold, opens them.
 */
const SYSTEM = new Set(["GET /system/purchase-orders"]);

const routes = [
  ...new Set(app.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`)),
]
  .filter((key) => !PUBLIC.has(key) && !SYSTEM.has(key))
  .sort();

const concrete = (path: string) => path.replace(/:[a-zA-Z]+/g, "some-id");
const split = (key: string): [string, string] => key.split(" ", 2) as [string, string];
const bodyFor = (method: string) => (method === "GET" || method === "DELETE" ? undefined : {});

// ─── What each persona holds (AC-4.2 – AC-4.6), as literals ──────────────────

interface Grants {
  readonly access: boolean;
  readonly manage: readonly Entity[];
  readonly bexio: boolean;
}

const GRANTS: Record<Exclude<PersonaName, "colleague">, Grants> = {
  outsider: { access: false, manage: [], bexio: false },
  viewer: { access: true, manage: [], bexio: false },
  pmCh: { access: true, manage: ["welld_ch"], bexio: false },
  salesIt: { access: true, manage: ["welld_it"], bexio: false },
  accounting: { access: true, manage: [], bexio: true },
  admin: { access: true, manage: ["welld_ch", "welld_it"], bexio: true },
};
const PERSONA_NAMES = Object.keys(GRANTS) as (keyof typeof GRANTS)[];

type Outcome = "ok" | "forbidden" | "out_of_scope";

function expectedOutcome(need: Need, grants: Grants, entity: Entity): Outcome {
  if (!grants.access) return "forbidden";
  switch (need) {
    case "access":
      return "ok";
    case "manage-any":
      return grants.manage.length > 0 ? "ok" : "forbidden";
    case "manage":
      if (grants.manage.includes(entity)) return "ok";
      return grants.manage.length > 0 ? "out_of_scope" : "forbidden";
    case "bexio":
      return grants.bexio ? "ok" : "forbidden";
  }
}

/** Every row of the module's tables, in a stable order: a refused request must leave it untouched. */
async function snapshot(): Promise<string> {
  return JSON.stringify([
    await db.project.findMany({ orderBy: { id: "asc" } }),
    await db.projectTerms.findMany({ orderBy: { id: "asc" } }),
    await db.projectTermsPosition.findMany({ orderBy: { id: "asc" } }),
    await db.purchaseOrder.findMany({ orderBy: { id: "asc" } }),
    await db.projectMember.findMany({ orderBy: [{ projectId: "asc" }, { userId: "asc" }] }),
  ]);
}

// ─── The inventory ───────────────────────────────────────────────────────────

describe("authorization matrix: the routes", () => {
  it("has a row for every route the app serves, and no row for a route it does not", () => {
    expect(routes).toEqual(Object.keys(SPECS).sort());
  });

  it("serves the service-to-service routes it lists, and no others", () => {
    const served = [...new Set(app.routes.filter((route) => route.path.startsWith("/system/")).map((route) => `${route.method} ${route.path}`))];
    expect(served.sort()).toEqual([...SYSTEM].sort());
  });

  it("serves liveness and the API docs without a token — and only those", async () => {
    for (const key of PUBLIC) {
      const [method, path] = split(key);
      expect((await app.request(path, { method })).status).toBe(200); // /docs is HTML: no JSON parsing
    }
  });
});

// ─── No token, no access ─────────────────────────────────────────────────────

describe("authorization matrix: before any validation or lookup", () => {
  it.each(routes)("%s: 401 without a token, and with a token that does not verify", async (key) => {
    const [method, path] = split(key);
    const body = bodyFor(method);
    expect((await call(method, concrete(path), { as: null, body })).status).toBe(401);
    const garbage = await app.request(concrete(path), {
      method,
      headers: { Authorization: "Bearer not.a.token", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(garbage.status).toBe(401);
  });

  it.each(routes)("%s: 403 `forbidden` without projects:access, not a 404 / 400 / 428", async (key) => {
    const [method, path] = split(key);
    const res = await call(method, concrete(path), { as: "outsider", body: bodyFor(method) });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ status: 403, code: "forbidden" });
  });

  const writes = routes.filter((key) => SPECS[key]?.need !== "access");
  it.each(writes)("%s: a reader without the capability is refused 403 before the record is looked up", async (key) => {
    const [method, path] = split(key);
    // An unknown id and an empty body: a handler that looked first would answer 404 or 400.
    const res = await call(method, concrete(path), { as: "viewer", body: bodyFor(method) });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: "forbidden" });
  });
});

describe("authorization matrix: service-to-service routes", () => {
  it.each([...SYSTEM])("%s: 401 for every user, whatever they hold — a user JWT is not a service credential", async (key) => {
    const [method, path] = split(key);
    for (const persona of PERSONA_NAMES) {
      const res = await call(method, `${path}?dealIds=some-deal`, { as: persona });
      expect({ persona, status: res.status }).toEqual({ persona, status: 401 });
    }
  });
});

// ─── The matrix: every route × persona × the record's entity ─────────────────

describe("authorization matrix: every route × persona × entity", () => {
  for (const [key, spec] of Object.entries(SPECS)) {
    describe(key, () => {
      for (const persona of PERSONA_NAMES) {
        for (const entity of ENTITIES) {
          const outcome = expectedOutcome(spec.need, GRANTS[persona], entity);
          const label = outcome === "ok" ? `${spec.ok}` : `403 ${outcome}`;
          it(`${persona} on a ${entity} record: ${label}`, async () => {
            const req = await spec.prepare(entity);
            const before = await snapshot();
            const res = await call(req.method, req.path, {
              as: persona,
              ...(req.body !== undefined ? { body: req.body } : {}),
              ...(req.ifMatch !== undefined ? { ifMatch: req.ifMatch } : {}),
            });
            if (outcome === "ok") {
              expect(res.status).toBe(spec.ok);
            } else {
              expect(res.status).toBe(403);
              expect(res.json).toMatchObject({ status: 403, code: outcome });
              expect(await snapshot()).toBe(before);
            }
          });
        }
      }
    });
  }
});

// ─── The pieces of the matrix the table cannot say on its own ────────────────

describe("authorization matrix: what holders read (AC-4.3)", () => {
  it("lists the projects of both entities to every holder of access, scoped or not", async () => {
    await seedProject("welld_ch", { name: "Alpha" });
    await seedProject("welld_it", { name: "Beta" });
    for (const persona of PERSONA_NAMES.filter((name) => GRANTS[name].access)) {
      const res = await call("GET", "/projects", { as: persona });
      expect(res.status).toBe(200);
      expect(res.json.total).toBe(2);
      expect(res.json.items.map((item: { name: string }) => item.name)).toEqual(["Alpha", "Beta"]);
    }
  });

  it("refuses the list to a caller without access, whatever else they hold", async () => {
    await seedProject("welld_ch");
    const res = await call("GET", "/projects", { as: "outsider" });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: "forbidden" });
  });
});

describe("authorization matrix: the to-start queue (AC-1.1, AC-1.2, AC-1.4, A20)", () => {
  const queued = async (as: PersonaName): Promise<string[]> =>
    ((await call("GET", "/queue", { as })).json.items as { dealId: string }[]).map((item) => item.dealId).sort();

  it("lists the won deals of both entities to every holder of access, scoped or not — and to nobody without it", async () => {
    const ids = [wonDeal("welld_ch"), wonDeal("welld_it")].sort();
    for (const persona of PERSONA_NAMES.filter((name) => GRANTS[name].access)) {
      expect({ persona, ids: await queued(persona) }).toEqual({ persona, ids });
    }
    const refused = await call("GET", "/queue", { as: "outsider" });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "forbidden" });
  });

  it("lets only a manager of the deal's entity take it: a refused take leaves the deal queued, the entity's own manager takes it", async () => {
    const deal = wonDeal("welld_ch");
    const body = takeBody();
    for (const persona of ["viewer", "accounting", "salesIt"] as const) {
      const res = await call("POST", `/queue/${deal}/project`, { as: persona, body });
      expect({ persona, status: res.status }).toEqual({ persona, status: 403 });
    }
    expect(await queued("viewer")).toEqual([deal]);
    expect((await call("POST", `/queue/${deal}/project`, { as: "pmCh", body })).status).toBe(201);
    expect(await queued("viewer")).toEqual([]);
  });

  it("lets an admin take the deal of either entity", async () => {
    for (const entity of ENTITIES) {
      const deal = wonDeal(entity);
      const res = await call("POST", `/queue/${deal}/project`, {
        as: "admin",
        body: takeBody({ name: `Work ${entity}` }),
      });
      expect({ entity, status: res.status }).toEqual({ entity, status: 201 });
      expect(res.json.entity).toBe(entity);
    }
  });
});

describe("authorization matrix: scope (AC-4.4, AC-4.5, AC-4.6)", () => {
  it("tells each persona what it may manage, so the UI hides what the server would refuse", async () => {
    const scopes = Object.fromEntries(
      await Promise.all(PERSONA_NAMES.filter((name) => GRANTS[name].access).map(async (name) => [name, (await call("GET", "/scope", { as: name })).json])),
    );
    expect(scopes).toEqual({
      viewer: { manage: [], managesAll: false, bexio: false },
      pmCh: { manage: ["welld_ch"], managesAll: false, bexio: false },
      salesIt: { manage: ["welld_it"], managesAll: false, bexio: false },
      accounting: { manage: [], managesAll: false, bexio: true },
      admin: { manage: ["welld_ch", "welld_it"], managesAll: true, bexio: true },
    });
  });

  it("keeps the matrix honest: the test personas hold what GRANTS says they do", () => {
    // A guard against the two tables drifting apart: the permission rows behind each persona.
    const has = (name: PersonaName, resource: string, action: string) =>
      PERSONAS[name].permissions.some((permission) => permission.resource === resource && permission.action === action);
    for (const name of PERSONA_NAMES) {
      expect(has(name, "projects", "access")).toBe(GRANTS[name].access);
      expect(has(name, "project", "manage")).toBe(GRANTS[name].manage.length > 0);
      expect(has(name, "purchase-order", "bexio")).toBe(GRANTS[name].bexio);
    }
  });
});

// ─── An auth outage is a refusal, never an allow (AC-4.2, ADR-0014) ──────────

describe("authorization matrix: auth outage", () => {
  const subOf = (header: string): string =>
    (JSON.parse(Buffer.from(header.split(".")[1] ?? "", "base64url").toString("utf-8")) as { sub: string }).sub;

  it.each(routes)("%s: 503 `authz_unavailable` when /authz/resolve is down, even for an admin", async (key) => {
    const [method, path] = split(key);
    const harness = setupTestAuth();
    try {
      harness.setResolve(async () => {
        throw new Error("auth down");
      });
      const res = await call(method, concrete(path), { as: "admin", body: bodyFor(method), ifMatch: 1 });
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ status: 503, code: "authz_unavailable" });
    } finally {
      // The harness is shared by every file in the process: put the personas back.
      harness.setResolve(async (header) => {
        const sub = subOf(header);
        const persona = Object.values(PERSONAS).find((p) => p.sub === sub)!;
        return { sub, epoch: 0, permissions: persona.permissions, entity: persona.entity, jobTitle: null };
      });
    }
  });

  it("serves again once auth is back", async () => {
    expect((await call("GET", "/scope", { as: "admin" })).status).toBe(200);
  });
});
