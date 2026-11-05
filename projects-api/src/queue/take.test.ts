/**
 * Taking a deal from the to-start queue (specs/022 T7 as reshaped by T23; AC-1.2 – AC-1.6, AC-1.8,
 * AC-1.10, AC-3.1, AC-3.2, AC-3.5): `POST /queue/{dealId}/project` makes a new project with its terms
 * and its purchase order, with no project manager. Runs the ASSEMBLED app against the `*_test`
 * database; the CRM and EstimAI are the fakes of test-support/world.ts.
 *
 * Every refusal asserts that NOTHING was written: no project, no terms, no purchase order (the take is
 * one transaction), and that the deal is still in the queue where it was. The gates, the ops-manager
 * and referent checks and the notification are later tasks (T24, T25): here both are stored as sent.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, crm, db, estimai, makeDeal, resetWorld, seedDealProject, type PersonaName } from "../test-support/world";

beforeEach(async () => {
  await resetWorld();
  crm.companies = [
    { id: "co-acme", name: "Acme SA", entity: "welld_ch", archived: false },
    { id: "co-zeta", name: "Zeta AG", entity: "welld_it", archived: false },
  ];
});

/** The `terms` member of a take, specs/021's contract shape: `{ startDate, endDate?, terms }` (specs/022 AC-1.8). */
const start = { startDate: "2026-12-01" };
const TERMS = {
  fixed_price: { ...start, terms: { deadline: "2027-03-31", maxEffortManDays: 55.5 } },
  fixed_price_with_man_days: { ...start, terms: { deadline: "2027-03-31", estimatedManDays: 40, maxEffortManDays: 55.5 } },
  maintenance: { ...start, terms: { sla: { highDays: 1, normalDays: 3 }, hourPackage: null } },
  saas: { ...start, endDate: "2027-11-30" },
  t_and_m: { ...start, terms: { positions: [{ profile: "Senior developer", plannedManDays: 120 }] } },
} as const;

/** A take body: a T&M project by default, the ops-manager asked for, no referent. */
const body = (over: Record<string, unknown> = {}) => ({
  name: "Portal 2027",
  type: "t_and_m",
  terms: TERMS.t_and_m,
  opsManagerId: "user-ops",
  ...over,
});

const takeAsProject = (dealId: string, payload: unknown, as: PersonaName | null = "pmCh") =>
  call("POST", `/queue/${dealId}/project`, { as, body: payload });

const counts = async () => ({
  projects: await db.project.count(),
  terms: await db.projectTerms.count(),
  orders: await db.purchaseOrder.count(),
});
const NOTHING = { projects: 0, terms: 0, orders: 0 };
const ONE = { projects: 1, terms: 1, orders: 1 };
const inQueue = async (): Promise<string[]> =>
  (await call("GET", "/queue", { as: "viewer" })).json.items.map((item: { dealId: string }) => item.dealId);

// ─── A new project from a deal ───────────────────────────────────────────────

describe("POST /queue/:dealId/project — a new project from a won deal (AC-1.2, AC-1.3, AC-1.8)", () => {
  it("creates a planned project with the deal's company and entity and NO project manager, its terms and its purchase order", async () => {
    crm.deals = [makeDeal({ id: "d-1", title: "Portal rebuild", estimate: { id: "est-1", name: "Portal estimate" } })];
    const res = await takeAsProject("d-1", body({ referentContactId: "contact-1" }));

    expect(res.status).toBe(201);
    expect(res.headers.get("ETag")).toBe('"1"');
    expect(res.json).toMatchObject({
      name: "Portal 2027",
      type: "t_and_m",
      state: "planned",
      entity: "welld_ch",
      company: { id: "co-acme", name: "Acme SA" },
      projectManager: null,
      awaitingProjectManager: true,
      startDate: "2026-12-01",
      endDate: null,
      version: 1,
      terms: {
        type: "t_and_m",
        startDate: "2026-12-01",
        endDate: null,
        terms: { positions: [{ profile: "Senior developer", plannedManDays: 120 }] },
        version: 1,
      },
      purchaseOrder: {
        id: expect.any(String),
        deal: { id: "d-1", title: "Portal rebuild", won: true },
        estimate: { id: "est-1" },
        bexioOrderId: null,
        // Referent details are read from the CRM by T26; here only the id is stored.
        referent: null,
        opsManager: { id: "user-ops", name: "Name of user-ops", deleted: false },
        version: 1,
      },
    });

    const stored = await db.project.findUniqueOrThrow({ where: { id: res.json.id }, include: { terms: true, purchaseOrder: true } });
    // The person who took the deal is not made the project manager (D42).
    expect(stored).toMatchObject({ createdById: "user-pm-ch", projectManagerId: null, companyId: "co-acme", entity: "welld_ch", state: "planned" });
    expect(stored.terms).toMatchObject({ type: "t_and_m" });
    expect(stored.purchaseOrder).toMatchObject({
      dealId: "d-1",
      estimateId: "est-1",
      opsManagerId: "user-ops",
      referentContactId: "contact-1",
      createdById: "user-pm-ch",
      bexioOrderId: null,
    });
    expect(await counts()).toEqual(ONE);
  });

  it("stores the ops-manager and the referent as sent; the referent is optional", async () => {
    crm.deals = [makeDeal({ id: "d-1" }), makeDeal({ id: "d-2" }), makeDeal({ id: "d-3" })];
    const withNull = await takeAsProject("d-1", body({ opsManagerId: "user-anyone", referentContactId: null }));
    expect(withNull.status).toBe(201);
    expect(await db.purchaseOrder.findUniqueOrThrow({ where: { dealId: "d-1" } })).toMatchObject({ opsManagerId: "user-anyone", referentContactId: null });
    const without = await takeAsProject("d-2", body());
    expect(without.status).toBe(201);
    expect(await db.purchaseOrder.findUniqueOrThrow({ where: { dealId: "d-2" } })).toMatchObject({ referentContactId: null });
  });

  it("makes the deal leave the queue (AC-1.3, AC-1.6)", async () => {
    crm.deals = [makeDeal({ id: "d-1" }), makeDeal({ id: "d-2" })];
    expect(await inQueue()).toContain("d-1");
    expect((await takeAsProject("d-1", body())).status).toBe(201);
    expect(await inQueue()).toEqual(["d-2"]);
  });

  it("takes the deal's entity, not the caller's: a wellD IT deal makes a wellD IT project", async () => {
    crm.deals = [makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } })];
    const res = await takeAsProject("d-it", body({ type: "maintenance", terms: TERMS.maintenance }), "salesIt");
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" }, projectManager: null });
  });

  it.each(["t_and_m", "fixed_price", "maintenance", "saas"] as const)("accepts the client type %s, and its terms have that type (D40)", async (type) => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", body({ type, terms: TERMS[type] }));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ type, company: { id: "co-acme" }, terms: { type } });
    expect(await counts()).toEqual(ONE);
  });

  it("takes a saas deal as a licence project with its company and its licence period, SLA and hours optional (AC-5.1, AC-1.8)", async () => {
    crm.deals = [makeDeal({ id: "d-1", title: "Koordy licence" })];
    const res = await takeAsProject("d-1", body({ type: "saas", terms: TERMS.saas }));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      type: "saas",
      company: { id: "co-acme", name: "Acme SA" },
      terms: { type: "saas", startDate: "2026-12-01", endDate: "2027-11-30", terms: { sla: null, hourPackage: null } },
    });
  });

  it("refuses the type internal: a project from a deal has a company and a purchase order", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", body({ type: "internal", terms: start }));
    expect(res.status).toBe(400);
    expect(res.json.field).toBe("type");
    expect(await counts()).toEqual(NOTHING);
  });

  it("refuses a project manager in the body: 400, the take makes none (D42), and nothing is written", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", body({ projectManagerId: "user-colleague" }));
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: "validation_failed" });
    expect(await counts()).toEqual(NOTHING);
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it.each([
    ["the ops-manager", { opsManagerId: undefined }, "opsManagerId"],
    ["a blank ops-manager", { opsManagerId: "" }, "opsManagerId"],
    ["the terms", { terms: undefined }, "terms"],
    ["terms without a start date", { terms: { terms: TERMS.t_and_m.terms } }, "terms.startDate"],
    ["terms with members beside the dates (they go in `terms.terms`)", { terms: { ...start, positions: [] } }, "terms"],
    ["a name", { name: "  " }, "name"],
    ["a referent that is not a string", { referentContactId: 7 }, "referentContactId"],
    ["an entity of the caller's choosing", { entity: "welld_it" }, ""],
    ["a state", { state: "active" }, ""],
  ])("is 400 `validation_failed` for %s", async (_label, over, field) => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", body(over));
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ code: "validation_failed", field });
    expect(await counts()).toEqual(NOTHING);
  });

  it("names a body error by its full path in the body (terms.startDate, terms.terms.deadline, terms.endDate)", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const badDate = await takeAsProject("d-1", body({ terms: { ...TERMS.t_and_m, startDate: "01/12/2026" } }));
    expect(badDate.status).toBe(400);
    expect(badDate.json.field).toBe("terms.startDate");

    const noDates = await takeAsProject("d-1", body({ terms: { terms: TERMS.t_and_m.terms } }));
    expect(noDates.status).toBe(400);
    expect(noDates.json.field).toBe("terms.startDate");

    const noDeadline = await takeAsProject("d-1", body({ type: "fixed_price", terms: { ...start, terms: { maxEffortManDays: 10 } } }));
    expect(noDeadline.status).toBe(400);
    expect(noDeadline.json.field).toBe("terms.terms.deadline");

    const noTerms = await takeAsProject("d-1", body({ type: "fixed_price", terms: { ...start } }));
    expect(noTerms.status).toBe(400);
    expect(noTerms.json.field).toBe("terms.terms.deadline");

    const endBeforeStart = await takeAsProject("d-1", body({ terms: { ...TERMS.t_and_m, endDate: "2026-11-01" } }));
    expect(endBeforeStart.status).toBe(400);
    expect(endBeforeStart.json.field).toBe("terms.endDate");

    const notAnObject = await takeAsProject("d-1", body({ terms: "soon" }));
    expect(notAnObject.status).toBe(400);
    expect(notAnObject.json.field).toBe("terms");

    const innerNotAnObject = await takeAsProject("d-1", body({ terms: { ...start, terms: "soon" } }));
    expect(innerNotAnObject.status).toBe(400);
    expect(innerNotAnObject.json.field).toBe("terms.terms");
    expect(await counts()).toEqual(NOTHING);
  });

  it("refuses maintenance terms with neither SLA nor hours, naming terms.terms", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const res = await takeAsProject("d-1", body({ type: "maintenance", terms: { ...start, terms: { sla: null, hourPackage: null } } }));
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "maintenance_needs_sla_or_hours", field: "terms.terms" });
    expect(await counts()).toEqual(NOTHING);
  });
});

describe("POST /queue/:dealId/project — the man-days come from the estimate (AC-3.1, AC-3.2, AC-3.5)", () => {
  it("copies the estimate's man-days onto fixed price terms, and keeps the estimate id on the purchase order", async () => {
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 42.5 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "Portal estimate" } })];
    const res = await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    expect(res.status).toBe(201);
    expect(estimai.lastAuthorization).toMatch(/^Bearer /);
    expect(res.json.terms.terms).toEqual({ estimatedManDays: 42.5, deadline: "2027-03-31", maxEffortManDays: 55.5 });
    expect(res.json.purchaseOrder.estimate).toEqual({ id: "est-1" });
    const stored = await db.projectTerms.findFirstOrThrow({ where: { project: { purchaseOrder: { dealId: "d-1" } } } });
    expect(stored.estimatedManDays?.toNumber()).toBe(42.5);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { dealId: "d-1" } })).estimateId).toBe("est-1");
  });

  it("is a snapshot: a later change to the estimate does not change the terms (A6)", async () => {
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 42.5 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "Portal estimate" } })];
    await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    estimai.estimates.set("est-1", { name: "Portal estimate", manDays: 99 });
    const stored = await db.projectTerms.findFirstOrThrow({ where: { project: { purchaseOrder: { dealId: "d-1" } } } });
    expect(stored.estimatedManDays?.toNumber()).toBe(42.5);
  });

  it.each([{ estimatedManDays: 40 }, { estimatedManDays: null }])(
    "refuses sending terms.terms.estimatedManDays (%o) for a deal with an estimate: 422 estimated_man_days_from_estimate, nothing written",
    async (extra) => {
      estimai.estimates.set("est-1", { name: "E", manDays: 42.5 });
      crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
      const res = await takeAsProject("d-1", body({ type: "fixed_price", terms: { ...start, terms: { ...TERMS.fixed_price.terms, ...extra } } }));
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "estimated_man_days_from_estimate", field: "terms.terms.estimatedManDays" });
      expect(await counts()).toEqual(NOTHING);
      expect(estimai.calls).toBe(0);
    },
  );

  it("keeps `estimatedManDays: null` and the estimate id when EstimAI does not know the estimate", async () => {
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-gone", name: "Gone" } })];
    const res = await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    expect(res.status).toBe(201);
    expect(res.json.terms.terms.estimatedManDays).toBeNull();
    expect(res.json.purchaseOrder.estimate).toEqual({ id: "est-gone" });
  });

  it("answers 503 estimai_unavailable and writes nothing when EstimAI is down", async () => {
    estimai.down = true;
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const res = await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("estimai_unavailable");
    expect(await counts()).toEqual(NOTHING);
    expect(await inQueue()).toEqual(["d-1"]);
  });

  it("does not ask EstimAI for a type that has no man-days: a down EstimAI does not stop a T&M take", async () => {
    estimai.down = true;
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(201);
    expect(estimai.calls).toBe(0);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { dealId: "d-1" } })).estimateId).toBe("est-1");
  });

  it("takes the man-days as typed when the deal has no estimate, or leaves them empty (AC-3.5)", async () => {
    crm.deals = [makeDeal({ id: "d-1" }), makeDeal({ id: "d-2" })];
    const typed = await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price_with_man_days }));
    expect(typed.status).toBe(201);
    expect(typed.json.terms.terms.estimatedManDays).toBe(40);
    expect(typed.json.purchaseOrder.estimate).toBeNull();
    expect(estimai.calls).toBe(0);
    const empty = await takeAsProject("d-2", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    expect(empty.status).toBe(201);
    expect(empty.json.terms.terms.estimatedManDays).toBeNull();
  });

  it("keeps the man-days server-owned afterwards: the terms edit refuses them (AC-3.1)", async () => {
    estimai.estimates.set("est-1", { name: "E", manDays: 42.5 });
    crm.deals = [makeDeal({ id: "d-1", estimate: { id: "est-1", name: "E" } })];
    const created = await takeAsProject("d-1", body({ type: "fixed_price", terms: TERMS.fixed_price }));
    const res = await call("PATCH", `/projects/${created.json.id}/terms`, {
      as: "pmCh",
      body: { terms: { deadline: "2027-04-30", maxEffortManDays: 60, estimatedManDays: 1 } },
      ifMatch: 1,
    });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("estimated_man_days_from_estimate");
  });
});

describe("POST /queue/:dealId/project — refusals leave nothing behind (AC-1.6)", () => {
  it("404 deal_not_found for a deal the CRM does not know", async () => {
    const res = await takeAsProject("d-nope", body());
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("deal_not_found");
    expect(await counts()).toEqual(NOTHING);
  });

  it("409 deal_not_won for a deal that is not won in the CRM now", async () => {
    crm.deals = [makeDeal({ id: "d-1", stage: "negotiation" })];
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("deal_not_won");
    expect(await counts()).toEqual(NOTHING);
  });

  it("409 deal_taken for a deal that already has a purchase order, and the first project is untouched", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    expect((await takeAsProject("d-1", body())).status).toBe(201);
    const second = await takeAsProject("d-1", body({ name: "Second" }));
    expect(second.status).toBe(409);
    expect(second.json.code).toBe("deal_taken");
    expect(await counts()).toEqual(ONE);
  });

  it("409 deal_taken for a deal taken by a project made another way, whatever its state", async () => {
    crm.deals = [makeDeal({ id: "d-seed" })];
    await seedDealProject({ order: { dealId: "d-seed" }, project: { state: "closed" } });
    const res = await takeAsProject("d-seed", body());
    expect([res.status, res.json.code]).toEqual([409, "deal_taken"]);
    expect(await counts()).toEqual(ONE);
  });

  it("409 deal_taken for a taken deal even when it was reopened in the CRM since", async () => {
    const deal = makeDeal({ id: "d-1" });
    crm.deals = [deal];
    await takeAsProject("d-1", body());
    deal.stage = "negotiation";
    const res = await takeAsProject("d-1", body());
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("deal_taken");
    expect(await counts()).toEqual(ONE);
  });

  it("two concurrent takes of one deal make exactly one project: one 201, one 409 deal_taken, nothing half-written", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const [a, b] = await Promise.all([takeAsProject("d-1", body()), takeAsProject("d-1", body({ name: "Other" }))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.code).toBe("deal_taken");
    expect(await counts()).toEqual(ONE);
  });

  it("403 out_of_scope when the caller manages the other entity only", async () => {
    crm.deals = [makeDeal({ id: "d-it", entity: "welld_it", company: { id: "co-zeta", name: "Zeta AG" } })];
    const res = await takeAsProject("d-it", body(), "pmCh");
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("out_of_scope");
    expect(await counts()).toEqual(NOTHING);
  });

  it("403 forbidden for a reader who manages nothing", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    for (const as of ["viewer", "accounting"] as const) {
      const res = await takeAsProject("d-1", body(), as);
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("forbidden");
    }
    expect(await counts()).toEqual(NOTHING);
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
    expect(await counts()).toEqual(NOTHING);
  });
});

// ─── No attach ───────────────────────────────────────────────────────────────

describe("no attach, no purchase order on an existing project (AC-1.10, D39)", () => {
  it("has no `POST /queue/:dealId/attach` any more: 404, the deal stays in the queue", async () => {
    crm.deals = [makeDeal({ id: "d-1" })];
    const { project } = await seedDealProject({ order: { dealId: "d-other" } });
    const res = await call("POST", "/queue/d-1/attach", { as: "admin", body: { projectId: project.id, terms: TERMS.t_and_m } });
    expect(res.status).toBe(404);
    expect(await inQueue()).toEqual(["d-1"]);
    expect(await db.purchaseOrder.count()).toBe(1);
  });

  it("has no route that adds a purchase order to a project: the terms route and the Bexio route make none", async () => {
    const byHand = await db.project.create({
      data: { name: "By hand", type: "t_and_m", entity: "welld_ch", companyId: "co-acme", projectManagerId: "user-pm-ch", createdById: "user-pm-ch" },
    });
    for (const [method, path] of [
      ["POST", `/projects/${byHand.id}/purchase-order`],
      ["PUT", `/projects/${byHand.id}/purchase-order`],
      ["PATCH", `/projects/${byHand.id}/purchase-order`],
    ] as const) {
      expect((await call(method, path, { as: "admin", body: { dealId: "d-1" }, ifMatch: 1 })).status).toBe(404);
    }
    expect(await db.purchaseOrder.count()).toBe(0);
  });
});
