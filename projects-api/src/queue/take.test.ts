/**
 * Taking a deal from the to-start queue (specs/022 T7; AC-1.2 – AC-1.6, AC-3.1, AC-3.2):
 * `POST /queue/{dealId}/project` (a new project) and `POST /queue/{dealId}/attach` (a contract on an
 * existing project). Runs the ASSEMBLED app against the `*_test` database; the CRM and EstimAI are the
 * fakes of test-support/world.ts. Projects are seeded straight in the database.
 *
 * Every refusal asserts that NOTHING was written: no project, no contract (the take is one
 * transaction), and that the deal is still in the queue where it was.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, crm, db, estimai, makeDeal, resetWorld, type PersonaName } from "../test-support/world";
import type { Prisma } from "../lib/generated/prisma/client";

beforeEach(async () => {
  await resetWorld();
  crm.companies = [
    { id: "co-acme", name: "Acme SA", entity: "welld_ch", archived: false },
    { id: "co-zeta", name: "Zeta AG", entity: "welld_it", archived: false },
  ];
});

type Type = "t_and_m" | "fixed_price" | "maintenance" | "saas" | "internal";

const TERMS = {
  fixed_price: { deadline: "2027-03-31", maxEffortManDays: 55.5 },
  fixed_price_with_man_days: { deadline: "2027-03-31", estimatedManDays: 40, maxEffortManDays: 55.5 },
  maintenance: { sla: { highDays: 1, normalDays: 3 }, hourPackage: null },
  saas: { sla: null, hourPackage: null },
  t_and_m: { positions: [{ profile: "Senior developer", plannedManDays: 120 }] },
} as const;

const contract = (terms: unknown = TERMS.t_and_m, over: Record<string, unknown> = {}) => ({
  startDate: "2026-12-01",
  terms,
  ...over,
});

const takeAsProject = (dealId: string, body: unknown, as: PersonaName | null = "pmCh") =>
  call("POST", `/queue/${dealId}/project`, { as, body });

const attach = (dealId: string, body: unknown, as: PersonaName | null = "pmCh") =>
  call("POST", `/queue/${dealId}/attach`, { as, body });

/** A project straight in the database; a client type gets Acme, `saas` and `internal` no company. */
const seed = (type: Type, over: Partial<Prisma.ProjectUncheckedCreateInput> = {}) =>
  db.project.create({
    data: {
      name: `Project ${type}`,
      type,
      entity: "welld_ch",
      companyId: ["saas", "internal"].includes(type) ? null : "co-acme",
      projectManagerId: "user-pm-ch",
      createdById: "user-pm-ch",
      ...over,
    },
  });

const counts = async () => ({ projects: await db.project.count(), contracts: await db.contract.count() });
const inQueue = async (): Promise<string[]> =>
  (await call("GET", "/queue", { as: "viewer" })).json.items.map((item: { dealId: string }) => item.dealId);

// ─── A new project from a deal ───────────────────────────────────────────────

describe("POST /queue/:dealId/project — a new project from a won deal (AC-1.2, AC-1.3)", () => {
  it("creates a planned project with the deal's company and entity, the given name and the caller as PM, and one contract from the deal", async () => {
    crm.deals = [makeDeal({ id: "d-1", title: "Portal rebuild", estimate: { id: "est-1", name: "Portal estimate" } })];
    const res = await takeAsProject("d-1", { name: "Portal 2027", type: "t_and_m", contract: contract() });

    expect(res.status).toBe(201);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.json).toMatchObject({
      name: "Portal 2027",
      type: "t_and_m",
      state: "planned",
      entity: "welld_ch",
      company: { id: "co-acme", name: "Acme SA" },
      projectManager: { id: "user-pm-ch", name: "Name of user-pm-ch", deleted: false },
      startDate: "2026-12-01",
      version: 1,
    });
    expect(res.json.contracts).toEqual([
      {
        id: expect.any(String),
        type: "t_and_m",
        company: { id: "co-acme", name: "Acme SA" },
        origin: "deal",
        bexioOrderId: null,
        startDate: "2026-12-01",
        endDate: null,
      },
    ]);

    const stored = await db.project.findUniqueOrThrow({ where: { id: res.json.id }, include: { contracts: true } });
    expect(stored).toMatchObject({ createdById: "user-pm-ch", companyId: "co-acme", entity: "welld_ch", state: "planned" });
    expect(stored.contracts).toHaveLength(1);
    expect(stored.contracts[0]).toMatchObject({
      type: "t_and_m",
      companyId: "co-acme",
      origin: "deal",
      dealId: "d-1",
      estimateId: "est-1",
    });
  });

  it("makes the deal leave the queue (AC-1.3)", async () => {
    crm.deals = [makeDeal({ id: "d-1" }), makeDeal({ id: "d-2" })];
    expect(await inQueue()).toContain("d-1");
    expect((await takeAsProject("d-1", { name: "P", type: "t_and_m", contract: contract() })).status).toBe(201);
    expect(await inQueue()).toEqual(["d-2"]);
  });

  it("takes the deal's entity, not the caller's: a wellD IT deal makes a wellD IT project", async () => {
    crm.deals = [makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } })];
    const res = await takeAsProject("d-it", { name: "Zeta work", type: "maintenance", contract: contract(TERMS.maintenance) }, "salesIt");
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } });
    expect(res.json.projectManager.id).toBe("user-sales-it");
  });

  it("gives the project to the project manager asked for, who must hold projects:access", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", {
      name: "P",
      type: "t_and_m",
      projectManagerId: "user-colleague",
      contract: contract(),
    });
    expect(res.status).toBe(201);
    expect(res.json.projectManager).toEqual({ id: "user-colleague", name: "Name of user-colleague", deleted: false });
    expect(await db.project.findUniqueOrThrow({ where: { id: res.json.id } })).toMatchObject({
      projectManagerId: "user-colleague",
      createdById: "user-pm-ch",
    });
  });

  it("refuses a project manager outside the module with 422 not_project_user and writes nothing", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", { name: "P", type: "t_and_m", projectManagerId: "user-employee", contract: contract() });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "not_project_user", userIds: ["user-employee"] });
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it.each(["t_and_m", "fixed_price", "maintenance"] as const)("accepts the client type %s, and its contract has that type", async (type) => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const terms = type === "fixed_price" ? TERMS.fixed_price : TERMS[type];
    const res = await takeAsProject("d-1", { name: "P", type, contract: contract(terms) });
    expect(res.status).toBe(201);
    expect(res.json.type).toBe(type);
    expect(res.json.contracts[0].type).toBe(type);
  });

  it.each(["saas", "internal"])("refuses the type %s: a project from a deal is a client project", async (type) => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", { name: "P", type, contract: contract({}) });
    expect(res.status).toBe(400);
    expect(res.json.field).toBe("type");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("names a body error by its full path in the body (contract.startDate, contract.terms.deadline)", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const badDate = await takeAsProject("d-1", { name: "P", type: "t_and_m", contract: contract(TERMS.t_and_m, { startDate: "01/12/2026" }) });
    expect(badDate.status).toBe(400);
    expect(badDate.json.field).toBe("contract.startDate");

    const noDeadline = await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract({ maxEffortManDays: 10 }) });
    expect(noDeadline.status).toBe(400);
    expect(noDeadline.json.field).toBe("contract.terms.deadline");

    const endBeforeStart = await takeAsProject("d-1", {
      name: "P",
      type: "t_and_m",
      contract: contract(TERMS.t_and_m, { endDate: "2026-11-01" }),
    });
    expect(endBeforeStart.status).toBe(400);
    expect(endBeforeStart.json.field).toBe("contract.endDate");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("refuses a maintenance contract with neither SLA nor hours, naming contract.terms", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", { name: "P", type: "maintenance", contract: contract({ sla: null, hourPackage: null }) });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "maintenance_needs_sla_or_hours", field: "contract.terms" });
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });
});

describe("POST /queue/:dealId/project — the man-days come from the estimate (AC-3.1, AC-3.2)", () => {
  it("copies the estimate's man-days onto a fixed price contract, and keeps the estimate id", async () => {
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 42.5 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "Portal estimate" } })];
    const res = await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(201);
    expect(estimai.lastAuthorization).toMatch(/^Bearer /);
    const stored = await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } });
    expect(stored.estimatedManDays?.toNumber()).toBe(42.5);
    expect(stored.estimateId).toBe("est-1");
    expect(stored.deadline?.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("is a snapshot: a later change to the estimate does not change the contract (A6)", async () => {
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 42.5 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "Portal estimate" } })];
    await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract(TERMS.fixed_price) });
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 99 });
    const stored = await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } });
    expect(stored.estimatedManDays?.toNumber()).toBe(42.5);
  });

  it.each([{ estimatedManDays: 40 }, { estimatedManDays: null }])(
    "refuses sending terms.estimatedManDays (%o) for a deal with an estimate: 422 estimated_man_days_from_estimate, nothing written",
    async (extra) => {
      estimai.estimates.set("est-1", { name: "E", manDays: 42.5 });
      crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
      const res = await takeAsProject("d-1", {
        name: "P",
        type: "fixed_price",
        contract: contract({ ...TERMS.fixed_price, ...extra }),
      });
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "estimated_man_days_from_estimate", field: "contract.terms.estimatedManDays" });
      expect(await counts()).toEqual({ projects: 0, contracts: 0 });
      expect(estimai.calls).toBe(0);
    },
  );

  it("keeps `estimatedManDays: null` and the estimate id when EstimAI does not know the estimate", async () => {
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-gone", name: "Gone" } })];
    const res = await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(201);
    const stored = await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } });
    expect(stored.estimatedManDays).toBeNull();
    expect(stored.estimateId).toBe("est-gone");
  });

  it("answers 503 estimai_unavailable and writes nothing when EstimAI is down", async () => {
    estimai.down = true;
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const res = await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("estimai_unavailable");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it("does not ask EstimAI for a type that has no man-days: a down EstimAI does not stop a T&M take", async () => {
    estimai.down = true;
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const res = await takeAsProject("d-1", { name: "P", type: "t_and_m", contract: contract() });
    expect(res.status).toBe(201);
    expect(estimai.calls).toBe(0);
    expect((await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } })).estimateId).toBe("est-1");
  });

  it("takes the man-days as typed when the deal has no estimate", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", { name: "P", type: "fixed_price", contract: contract(TERMS.fixed_price_with_man_days) });
    expect(res.status).toBe(201);
    const stored = await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } });
    expect(stored.estimatedManDays?.toNumber()).toBe(40);
    expect(stored.estimateId).toBeNull();
    expect(estimai.calls).toBe(0);
  });
});

describe("POST /queue/:dealId/project — refusals leave nothing behind (AC-1.4, AC-1.6)", () => {
  const body = () => ({ name: "P", type: "t_and_m", contract: contract() });

  it("404 deal_not_found for a deal the CRM does not know", async () => {
    const res = await takeAsProject("d-nope", body());
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("deal_not_found");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("409 deal_not_won for a deal that is not won in the CRM now", async () => {
    crm.deals = [makeDeal({ id: "d-1", stage: "negotiation" })];
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("deal_not_won");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("409 deal_taken for a deal that already has a contract, and the first project is untouched", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    expect((await takeAsProject("d-1", body())).status).toBe(201);
    const second = await takeAsProject("d-1", body());
    expect(second.status).toBe(409);
    expect(second.json.code).toBe("deal_taken");
    expect(await counts()).toEqual({ projects: 1, contracts: 1 });
  });

  it("409 deal_taken for a taken deal even when it was reopened in the CRM since", async () => {
    const deal = makeDeal({ id: "d-1" });
    crm.deals = [deal];
    await takeAsProject("d-1", body());
    deal.stage = "negotiation";
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("deal_taken");
    expect(await counts()).toEqual({ projects: 1, contracts: 1 });
  });

  it("two concurrent takes of one deal make exactly one project: one 201, one 409 deal_taken", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const [a, b] = await Promise.all([takeAsProject("d-1", body()), takeAsProject("d-1", { ...body(), name: "Other" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.code).toBe("deal_taken");
    expect(await counts()).toEqual({ projects: 1, contracts: 1 });
  });

  it("403 out_of_scope when the caller manages the other entity only", async () => {
    crm.deals = [makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } })];
    const res = await takeAsProject("d-it", body(), "pmCh");
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("out_of_scope");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("403 forbidden for a reader who manages nothing", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    for (const as of ["viewer", "accounting"] as const) {
      const res = await takeAsProject("d-1", body(), as);
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("forbidden");
    }
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("an admin takes a deal of either entity", async () => {
    crm.deals = [makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } })];
    expect((await takeAsProject("d-it", body(), "admin")).status).toBe(201);
  });

  it("503 crm_unavailable when crm-api is down, and nothing is written", async () => {
    crm.down = true;
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("crm_unavailable");
    expect(await counts()).toEqual({ projects: 0, contracts: 0 });
  });

  it("refuses unknown body members with 400 (the body is strict)", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", { ...body(), entity: "welld_it" });
    expect(res.status).toBe(400);
  });
});

// ─── Attach to an existing project ───────────────────────────────────────────

describe("POST /queue/:dealId/attach — a contract on an existing project (AC-1.4)", () => {
  it("adds a contract of the project's type made from the deal, and the deal leaves the queue", async () => {
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } }), makeDeal({ id: "d-2" })];
    const project = await seed("t_and_m");
    const res = await attach("d-1", { projectId: project.id, contract: contract() });

    expect(res.status).toBe(201);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.json).toMatchObject({
      projectId: project.id,
      type: "t_and_m",
      company: { id: "co-acme", name: "Acme SA" },
      origin: "deal",
      dealId: "d-1",
      startDate: "2026-12-01",
      endDate: null,
      terms: { positions: [{ profile: "Senior developer", plannedManDays: 120 }] },
      version: 1,
    });
    expect(await db.contract.findUniqueOrThrow({ where: { id: res.json.id } })).toMatchObject({
      projectId: project.id,
      origin: "deal",
      dealId: "d-1",
      estimateId: "est-1",
    });
    expect(await inQueue()).toEqual(["d-2"]);
    // The project itself is unchanged: same state, same version.
    expect(await db.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ state: "planned", version: 1 });
  });

  it("takes the deal of any company onto a saas project (A12)", async () => {
    crm.deals = [makeDeal({ id: "d-1", company: { id: "co-zeta", name: "Zeta AG" }, entity: "welld_ch" })];
    const project = await seed("saas");
    const res = await attach("d-1", { projectId: project.id, contract: contract(TERMS.saas) });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ type: "saas", company: { id: "co-zeta", name: "Zeta AG" }, dealId: "d-1" });
  });

  it("works on an active or on-hold project too", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const project = await seed("t_and_m", { state: "active" });
    expect((await attach("d-1", { projectId: project.id, contract: contract() })).status).toBe(201);
  });

  it("needs manage for the DEAL's entity, not the target project's: a wellD CH deal joins a wellD IT project", async () => {
    crm.deals = [makeDeal({ id: "d-1", entity: "welld_ch" })];
    const project = await seed("t_and_m", { entity: "welld_it" });
    const res = await attach("d-1", { projectId: project.id, contract: contract() }, "pmCh");
    expect(res.status).toBe(201);
  });

  it("refuses an internal project with 409 contracts_not_allowed", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const project = await seed("internal");
    const res = await attach("d-1", { projectId: project.id, contract: contract({}) });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("contracts_not_allowed");
    expect(res.json.detail).toMatch(/internal/i);
    expect(await db.contract.count()).toBe(0);
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it.each(["closed", "cancelled"] as const)("refuses a %s project with 409 project_not_open", async (state) => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const project = await seed("t_and_m", { state });
    const res = await attach("d-1", { projectId: project.id, contract: contract() });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "project_not_open", state });
    expect(res.json.detail).toContain(state);
    expect(await db.contract.count()).toBe(0);
  });

  it("refuses a client project of another company with 422 company_mismatch", async () => {
    crm.deals = [makeDeal({ id: "d-1", company: { id: "co-zeta", name: "Zeta AG" } })];
    const project = await seed("t_and_m");
    const res = await attach("d-1", { projectId: project.id, contract: contract() });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("company_mismatch");
    expect(await db.contract.count()).toBe(0);
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it("404 project_not_found for an unknown project", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await attach("d-1", { projectId: "no-such-project", contract: contract() });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("project_not_found");
    expect(await db.contract.count()).toBe(0);
  });

  it("404 deal_not_found, 409 deal_not_won, 403 out_of_scope — and nothing written", async () => {
    crm.deals = [
      makeDeal({ id: "d-reopened", stage: "lost" }),
      makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } }),
    ];
    const project = await seed("t_and_m");
    const input = { projectId: project.id, contract: contract() };

    const missing = await attach("d-nope", input);
    expect([missing.status, missing.json.code]).toEqual([404, "deal_not_found"]);
    const reopened = await attach("d-reopened", input);
    expect([reopened.status, reopened.json.code]).toEqual([409, "deal_not_won"]);
    const otherEntity = await attach("d-it", input, "pmCh");
    expect([otherEntity.status, otherEntity.json.code]).toEqual([403, "out_of_scope"]);
    const reader = await attach("d-it", input, "viewer");
    expect([reader.status, reader.json.code]).toEqual([403, "forbidden"]);

    expect(await db.contract.count()).toBe(0);
  });

  it("409 deal_taken when the deal already feeds a contract, on this or another project", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const first = await seed("t_and_m", { name: "First" });
    const second = await seed("t_and_m", { name: "Second" });
    expect((await attach("d-1", { projectId: first.id, contract: contract() })).status).toBe(201);

    for (const target of [first, second]) {
      const res = await attach("d-1", { projectId: target.id, contract: contract() });
      expect([res.status, res.json.code]).toEqual([409, "deal_taken"]);
    }
    expect(await db.contract.count()).toBe(1);
  });

  it("two concurrent attaches of one deal make exactly one contract: one 201, one 409 deal_taken", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const first = await seed("t_and_m", { name: "First" });
    const second = await seed("t_and_m", { name: "Second" });
    const [a, b] = await Promise.all([
      attach("d-1", { projectId: first.id, contract: contract() }),
      attach("d-1", { projectId: second.id, contract: contract() }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((a.status === 409 ? a : b).json.code).toBe("deal_taken");
    expect(await db.contract.count()).toBe(1);
  });

  it("503 crm_unavailable when crm-api is down", async () => {
    crm.down = true;
    const project = await seed("t_and_m");
    const res = await attach("d-1", { projectId: project.id, contract: contract() });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("crm_unavailable");
  });

  it("names a body error by its full path (contract.terms.positions)", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const project = await seed("t_and_m");
    const res = await attach("d-1", { projectId: project.id, contract: contract({ positions: [] }) });
    expect(res.status).toBe(400);
    expect(res.json.field).toBe("contract.terms.positions");
    const noProject = await attach("d-1", { contract: contract() });
    expect(noProject.status).toBe(400);
    expect(noProject.json.field).toBe("projectId");
  });
});

describe("POST /queue/:dealId/attach — the man-days come from the estimate (AC-3.1, AC-3.2)", () => {
  it("copies the estimate's man-days onto a fixed price project's contract", async () => {
    estimai.estimates.set("est-1", { name: "E", manDays: 17.3 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const project = await seed("fixed_price");
    const res = await attach("d-1", { projectId: project.id, contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(201);
    expect(res.json.terms).toEqual({ deadline: "2027-03-31", estimatedManDays: 17.3, maxEffortManDays: 55.5 });
    expect((await db.contract.findFirstOrThrow({ where: { dealId: "d-1" } })).estimateId).toBe("est-1");
  });

  it("refuses sending terms.estimatedManDays for a deal with an estimate: 422, nothing written", async () => {
    estimai.estimates.set("est-1", { name: "E", manDays: 17.3 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const project = await seed("fixed_price");
    const res = await attach("d-1", { projectId: project.id, contract: contract(TERMS.fixed_price_with_man_days) });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("estimated_man_days_from_estimate");
    expect(await db.contract.count()).toBe(0);
  });

  it("keeps null man-days and the estimate id when EstimAI answers 404", async () => {
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-gone", name: "Gone" } })];
    const project = await seed("fixed_price");
    const res = await attach("d-1", { projectId: project.id, contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(201);
    expect(res.json.terms.estimatedManDays).toBeNull();
  });

  it("answers 503 estimai_unavailable and writes nothing when EstimAI is down", async () => {
    estimai.down = true;
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const project = await seed("fixed_price");
    const res = await attach("d-1", { projectId: project.id, contract: contract(TERMS.fixed_price) });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("estimai_unavailable");
    expect(await db.contract.count()).toBe(0);
    expect(await inQueue()).toEqual(["d-1"]);
  });
});
