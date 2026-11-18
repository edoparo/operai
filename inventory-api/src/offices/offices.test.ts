/**
 * Offices that hold assets (specs/20261006-hardware-inventory US-14). Real router + middleware over the harness, real
 * Postgres: the three seeded offices, managing them, putting an asset in one (immediate, any entity), and the
 * transitions that clear an office like a person.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, spyOn } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { setupTestAuth } from "../test-support/testAuth";
import type { ResolvedPermission } from "../authz/resolveClient";
import { SEEDED_OFFICES, truncateInventoryTables } from "../test-support/dbCleanup";

const harness = setupTestAuth();
await harness.init();

const { db } = await import("../lib/db");
const { handleProblemError } = await import("../lib/problem");
const { officesRouter } = await import("./offices.routes");
const { assetTransitionsRouter } = await import("../assets/transitions.routes");
const { assetReadRouter } = await import("../assets/read.routes");
const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");
const { __resetIdentityCacheForTests } = await import("../lib/identities");
const { eventChanges } = await import("../history/record");

const app = new OpenAPIHono();
app.route("/", officesRouter);
app.route("/", assetTransitionsRouter);
app.route("/", assetReadRouter);
app.onError((err, c) => handleProblemError(err, c.req.path) ?? c.json({ error: String(err) }, 500));

const ENTITY: ResolvedPermission["conditions"] = { attributes: [{ key: "entity", match: "user" }] };
const grant = (resource: string, action: string, conditions: ResolvedPermission["conditions"] = null): ResolvedPermission => ({
  resource,
  action,
  conditions,
});
const MANAGER_CH = [grant("asset", "manage", ENTITY)];
const ACCOUNTANT = [grant("ledger", "manage", ENTITY)];

let token: string;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
function as(permissions: ResolvedPermission[], entity: string | null) {
  __resetAuthzCacheForTests();
  harness.setResolve(async () => ({ sub: "u", epoch: 1, permissions, entity, jobTitle: null }));
}

beforeAll(async () => {
  token = await harness.signToken({ sub: "mgr-1", email: "mgr1@welld.ch", permEpoch: 1 });
});
beforeEach(async () => {
  await truncateInventoryTables();
  __resetAuthzCacheForTests();
  __resetIdentityCacheForTests();
  as(MANAGER_CH, "welld_ch");
  fetchSpy = spyOn(globalThis, "fetch");
  fetchSpy.mockImplementation((async (_url: unknown, init?: RequestInit) => {
    const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
    return Response.json({ users: ids.map((id) => ({ id, status: "active", name: `Name of ${id}` })) });
  }) as unknown as typeof fetch);
});
afterAll(async () => {
  fetchSpy?.mockRestore();
  await truncateInventoryTables();
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

let seq = 0;
async function seed(status: string, over: Record<string, unknown> = {}) {
  seq++;
  return db.asset.create({
    data: {
      entity: "welld_ch",
      currency: "CHF",
      category: "monitor",
      description: `Monitor ${seq}`,
      purchaseDate: new Date("2026-03-01"),
      purchasePriceCents: 30000,
      status,
      createdByUserId: "seed",
      ...over,
    } as never,
  });
}
const AGNO = SEEDED_OFFICES[0].id;
const MILANO = SEEDED_OFFICES[2].id;

describe("the office list", () => {
  it("starts with the three seeded offices; an accountant reads it too", async () => {
    as(ACCOUNTANT, "welld_it");
    const res = await call("GET", "/offices");
    expect(res.status).toBe(200);
    expect((await json(res))["items"].map((o: any) => [o.name, o.entity, o.archived, o.assetCount])).toEqual([
      ["CH - Agno", "welld_ch", false, 0],
      ["CH - Lugano", "welld_ch", false, 0],
      ["YoRoom - Milano", "welld_it", false, 0],
    ]);
  });

  it("adds, renames and archives an office in the manager's entity; a name is unique ignoring case", async () => {
    const created = await call("POST", "/offices", { name: "CH - Chiasso", entity: "welld_ch" });
    expect(created.status).toBe(201);
    const office = await json(created);
    expect((await json(await call("POST", "/offices", { name: "ch - chiasso", entity: "welld_ch" })))["code"]).toBe("office_name_taken");

    const renamed = await json(await call("PATCH", `/offices/${office.id}`, { name: "CH - Mendrisio" }));
    expect(renamed["name"]).toBe("CH - Mendrisio");
    expect((await json(await call("PATCH", `/offices/${office.id}`, { name: "CH - Agno" })))["code"]).toBe("office_name_taken");
    expect((await json(await call("PATCH", `/offices/${office.id}`, { archived: true })))["archived"]).toBe(true);
    expect((await json(await call("PATCH", `/offices/${office.id}`, { archived: false })))["archived"]).toBe(false);
  });

  it("another entity's office is out of the manager's scope: 403 to create, 404 to change", async () => {
    expect((await call("POST", "/offices", { name: "IT - Roma", entity: "welld_it" })).status).toBe(403);
    expect((await call("PATCH", `/offices/${MILANO}`, { name: "x" })).status).toBe(404);
    expect((await call("PATCH", `/offices/${AGNO}`, { entity: "welld_it" })).status).toBe(403);
  });
});

describe("putting an asset in an office", () => {
  it("is immediate: assigned, held by the office and by no person, recorded with the office's name", async () => {
    const a = await seed("in_stock");
    const res = await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    expect(res.status).toBe(200);
    const view = await json(res);
    expect(view).toMatchObject({ status: "assigned", holder: null, office: { id: AGNO, name: "CH - Agno" }, pendingAssignment: null });

    const [event] = await db.assetEvent.findMany({ where: { assetId: a.id } });
    expect(event!.action).toBe("assigned_to_office");
    // Fields come back sorted by name.
    expect(eventChanges(event!.oldValue, event!.newValue)).toEqual([
      { field: "office", from: null, to: "CH - Agno" },
      { field: "status", from: "in_stock", to: "assigned" },
    ]);
    expect((await json(await call("GET", "/offices")))["items"][0]["assetCount"]).toBe(1);
  });

  it("works with an office of the other entity (the office's entity is information only)", async () => {
    const a = await seed("in_stock");
    expect((await json(await call("POST", `/assets/${a.id}/office-assignment`, { officeId: MILANO })))["office"]["name"]).toBe("YoRoom - Milano");
  });

  it("refuses an asset that is not in stock, one with a pending offer, and an unknown or archived office", async () => {
    const assigned = await seed("assigned", { holderUserId: "emp-1" });
    expect((await json(await call("POST", `/assets/${assigned.id}/office-assignment`, { officeId: AGNO })))["code"]).toBe("invalid_transition");

    const offered = await seed("in_stock");
    await db.assignment.create({ data: { assetId: offered.id, assigneeUserId: "emp-1", createdByUserId: "mgr-1" } });
    expect((await json(await call("POST", `/assets/${offered.id}/office-assignment`, { officeId: AGNO })))["code"]).toBe("assignment_pending");

    const free = await seed("in_stock");
    expect((await json(await call("POST", `/assets/${free.id}/office-assignment`, { officeId: "nope" })))["code"]).toBe("office_not_found");
    await db.office.update({ where: { id: AGNO }, data: { archivedAt: new Date() } });
    expect((await json(await call("POST", `/assets/${free.id}/office-assignment`, { officeId: AGNO })))["code"]).toBe("office_not_found");
  });

  it("an asset of another entity is the 404 of a missing one", async () => {
    const it_ = await seed("in_stock", { entity: "welld_it", currency: "EUR" });
    expect((await call("POST", `/assets/${it_.id}/office-assignment`, { officeId: AGNO })).status).toBe(404);
  });

  it("an office holding assets cannot be archived", async () => {
    const a = await seed("in_stock");
    await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    const res = await call("PATCH", `/offices/${AGNO}`, { archived: true });
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("office_in_use");
  });

  it("the list filters by office", async () => {
    const a = await seed("in_stock");
    await seed("in_stock");
    await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    const listed = await json(await call("GET", `/assets?officeId=${AGNO}`));
    expect(listed["items"].map((x: any) => x.id)).toEqual([a.id]);
  });
});

describe("transitions treat an office like a holder", () => {
  it("return clears the office, recording its name", async () => {
    const a = await seed("in_stock");
    await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    expect((await call("POST", `/assets/${a.id}/return`)).status).toBe(200);
    const row = await db.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.status, row.holderOfficeId]).toEqual(["in_stock", null]);
    const last = (await db.assetEvent.findMany({ where: { assetId: a.id }, orderBy: { createdAt: "asc" } })).at(-1)!;
    expect(eventChanges(last.oldValue, last.newValue)).toContainEqual({ field: "office", from: "CH - Agno", to: null });
  });

  it("repair keeps the office and repair-done brings it back to assigned", async () => {
    const a = await seed("in_stock");
    await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    await call("POST", `/assets/${a.id}/repair`);
    await call("POST", `/assets/${a.id}/repair-done`);
    const row = await db.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.status, row.holderOfficeId]).toEqual(["assigned", AGNO]);
  });

  it("lost clears the office", async () => {
    const a = await seed("in_stock");
    await call("POST", `/assets/${a.id}/office-assignment`, { officeId: AGNO });
    await call("POST", `/assets/${a.id}/lost`);
    expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).holderOfficeId).toBeNull();
  });
});

describe("the database", () => {
  it("never lets an asset have a person and an office", async () => {
    await expect(seed("assigned", { holderUserId: "emp-1", holderOfficeId: AGNO })).rejects.toThrow();
  });
});
