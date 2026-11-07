import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, makeDeal, markEstimateReady, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

describe("deals (US-3)", () => {
  it("creates a deal in lead, entity from the company, owner = creator (AC-3.2)", async () => {
    const company = await makeCompany({ entity: "welld_ch" });
    const res = await call("POST", "/deals", {
      as: "salesCh",
      body: { companyId: company.id, title: "Data platform", amountCents: 120_000_00, currency: "CHF", expectedCloseDate: "2026-12-15" },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      stage: "lead",
      entity: "welld_ch",
      amountCents: 12_000_000,
      expectedCloseDate: "2026-12-15",
      owner: { id: "user-sales-ch" },
      closedAt: null,
      version: 1,
    });
  });

  it("the amount is optional: a lead starts without one, and it can be set and cleared later (AC-3.2)", async () => {
    const company = await makeCompany({ entity: "welld_ch" });
    const created = await call("POST", "/deals", {
      as: "salesCh",
      body: { companyId: company.id, title: "Just a lead", currency: "CHF" },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ amountCents: null, currency: "CHF" });
    const priced = await call("PATCH", `/deals/${created.json.id}`, { as: "salesCh", ifMatch: 1, body: { amountCents: 50_000_00 } });
    expect(priced.json).toMatchObject({ amountCents: 5_000_000, version: 2 });
    const cleared = await call("PATCH", `/deals/${created.json.id}`, { as: "salesCh", ifMatch: 2, body: { amountCents: null } });
    expect(cleared.json.amountCents).toBeNull();
    const negative = await call("POST", "/deals", { as: "salesCh", body: { companyId: company.id, title: "X", currency: "CHF", amountCents: -1 } });
    expect(negative.json.field).toBe("amountCents");
  });

  it("a deal records where the lead came from; readable by everyone, the detail goes with the source (US-7)", async () => {
    const company = await makeCompany({ entity: "welld_ch" });
    const created = await call("POST", "/deals", {
      as: "salesCh",
      body: { companyId: company.id, title: "Referral lead", currency: "CHF", source: "referral", sourceDetail: "Mario Rossi, Cornèr" },
    });
    expect(created.json).toMatchObject({ source: "referral", sourceDetail: "Mario Rossi, Cornèr" });
    // not money: a caller without deal:financials reads it too
    expect((await call("GET", `/deals/${created.json.id}`, { as: "consultant" })).json).toMatchObject({ source: "referral" });
    const changed = await call("PATCH", `/deals/${created.json.id}`, { as: "salesCh", ifMatch: 1, body: { source: "inbound" , sourceDetail: null } });
    expect(changed.json).toMatchObject({ source: "inbound", sourceDetail: null });
    const cleared = await call("PATCH", `/deals/${created.json.id}`, { as: "salesCh", ifMatch: 2, body: { source: null } });
    expect(cleared.json.source).toBeNull();
  });

  it("deal writes need deal:manage (403) and the deal's entity in scope (403 out_of_scope, D-5)", async () => {
    const ch = await makeCompany({ entity: "welld_ch" });
    const it_ = await makeCompany({ entity: "welld_it" });
    const body = { title: "X", amountCents: 1, currency: "EUR" };

    const noCap = await call("POST", "/deals", { as: "consultant", body: { ...body, companyId: ch.id } });
    expect(noCap.status).toBe(403);
    expect(noCap.json.code).toBeUndefined();

    const outOfScope = await call("POST", "/deals", { as: "salesCh", body: { ...body, companyId: it_.id } });
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.json).toMatchObject({ code: "out_of_scope", entity: "welld_it" });

    // Booking an Italian company's deal on the CH entity is in scope.
    expect((await call("POST", "/deals", { as: "salesCh", body: { ...body, companyId: it_.id, entity: "welld_ch" } })).status).toBe(201);

    const itDeal = await makeDeal(it_.id, { currency: "EUR" });
    // Readable by everyone with crm:access…
    expect((await call("GET", `/deals/${itDeal.id}`, { as: "consultant" })).status).toBe(200);
    // …but not editable or movable out of scope, nor movable INTO another entity.
    expect((await call("PATCH", `/deals/${itDeal.id}`, { as: "salesCh", ifMatch: 1, body: { title: "Y" } })).json.code).toBe("out_of_scope");
    expect((await call("POST", `/deals/${itDeal.id}/stage`, { as: "salesCh", ifMatch: 1, body: { stage: "won" } })).status).toBe(403);
    const chDeal = await makeDeal(ch.id);
    expect((await call("PATCH", `/deals/${chDeal.id}`, { as: "salesCh", ifMatch: 1, body: { entity: "welld_it" } })).json.code).toBe("out_of_scope");
  });

  it("refuses an archived or unknown company and a closed starting stage", async () => {
    const company = await makeCompany();
    await call("POST", `/companies/${company.id}/archive`, { ifMatch: 1 });
    const body = { title: "X", amountCents: 1, currency: "CHF" };
    expect((await call("POST", "/deals", { body: { ...body, companyId: company.id } })).json.code).toBe("company_archived");
    expect((await call("POST", "/deals", { body: { ...body, companyId: "nope" } })).json.code).toBe("company_not_found");
    const open = await makeCompany();
    expect((await call("POST", "/deals", { body: { ...body, companyId: open.id, stage: "won" } })).json.code).toBe("stage_not_open");
    expect((await call("POST", "/deals", { body: { ...body, companyId: open.id, amountCents: -1 } })).status).toBe(422);
    expect((await call("POST", "/deals", { body: { ...body, companyId: open.id, amountCents: 1.5 } })).status).toBe(422);
  });

  it("closing records closedAt, a lost reason only on lost, reopening clears both (AC-3.3)", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const lost = await call("POST", `/deals/${deal.id}/stage`, { ifMatch: 1, body: { stage: "lost", lostReason: "Budget cut" } });
    expect(lost.json).toMatchObject({ stage: "lost", lostReason: "Budget cut", version: 2 });
    expect(lost.json.closedAt).not.toBeNull();

    await markEstimateReady(deal.id);
    const won = await call("POST", `/deals/${deal.id}/stage`, { ifMatch: 2, body: { stage: "won", lostReason: "ignored" } });
    expect(won.json).toMatchObject({ stage: "won", lostReason: null });

    const reopened = await call("POST", `/deals/${deal.id}/stage`, { ifMatch: 3, body: { stage: "negotiation" } });
    expect(reopened.json).toMatchObject({ stage: "negotiation", closedAt: null, lostReason: null });
    expect((await call("POST", `/deals/${deal.id}/stage`, { ifMatch: 3, body: { stage: "won" } })).status).toBe(409);
  });

  it("lists open deals by expected close date, nulls last", async () => {
    const company = await makeCompany();
    await makeDeal(company.id, { title: "No date" });
    await makeDeal(company.id, { title: "Later", expectedCloseDate: "2027-03-01" });
    await makeDeal(company.id, { title: "Sooner", expectedCloseDate: "2026-11-30" });
    const closed = await makeDeal(company.id, { title: "Closed" });
    await call("POST", `/deals/${closed.id}/stage`, { ifMatch: 1, body: { stage: "lost" } });
    const res = await call("GET", "/deals?open=true&pageSize=200", { as: "consultant" });
    expect(res.json.items.map((d: { title: string }) => d.title)).toEqual(["Sooner", "Later", "No date"]);
    expect((await call("GET", "/deals?pageSize=201")).status).toBe(422);
    expect((await call("GET", "/deals?open=true&entity=welld_it")).json.total).toBe(0);
  });

  it("pipeline: per stage and currency, weighted once per deal, won/lost of this year only (AC-3.4, D-8–D-10)", async () => {
    const company = await makeCompany();
    await makeDeal(company.id, { amountCents: 1001, currency: "CHF", stage: "qualified" }); // 25% → 250.25 → 250
    await makeDeal(company.id, { amountCents: 1003, currency: "CHF", stage: "qualified" }); // 250.75 → 251
    await makeDeal(company.id, { amountCents: 2000, currency: "EUR", stage: "qualified" }); // 500
    const won = await makeDeal(company.id, { amountCents: 5000, currency: "EUR", stage: "qualified" });
    await markEstimateReady(won.id);
    await call("POST", `/deals/${won.id}/stage`, { ifMatch: 1, body: { stage: "won" } });
    const oldWin = await makeDeal(company.id, { amountCents: 9999 });
    await markEstimateReady(oldWin.id);
    await call("POST", `/deals/${oldWin.id}/stage`, { ifMatch: 1, body: { stage: "won" } });
    await db.deal.update({ where: { id: oldWin.id }, data: { closedAt: new Date(Date.UTC(2020, 5, 1)) } });

    // The board lists the same set the figures total: open deals and this year's closed ones.
    const board = await call("GET", "/deals?board=true&pageSize=200", { as: "consultant" });
    expect(board.json.total).toBe(4);
    expect(board.json.items.map((d: { id: string }) => d.id)).not.toContain(oldWin.id);
    expect(board.json.items.find((d: { id: string }) => d.id === won.id)).toMatchObject({ stage: "won", version: 2 });

    const res = await call("GET", "/pipeline", { as: "salesCh" });
    expect(res.status).toBe(200);
    expect(res.json.probabilities).toEqual({ lead: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 });
    const byStage = Object.fromEntries(res.json.stages.map((s: { stage: string }) => [s.stage, s]));
    expect(res.json.stages.map((s: { stage: string }) => s.stage)).toEqual(["lead", "qualified", "proposal", "negotiation", "won", "lost"]);
    expect(byStage.qualified).toEqual({
      stage: "qualified",
      count: 3,
      totals: [
        { currency: "CHF", amountCents: 2004, weightedCents: 501 },
        { currency: "EUR", amountCents: 2000, weightedCents: 500 },
      ],
    });
    expect(byStage.won).toEqual({ stage: "won", count: 1, totals: [{ currency: "EUR", amountCents: 5000, weightedCents: 5000 }] });
    expect(byStage.lead).toEqual({ stage: "lead", count: 0, totals: [] });
    expect((await call("GET", "/pipeline?entity=welld_it")).json.stages[1].count).toBe(0);
    // The company filter narrows the figures like the board's list.
    const other = await makeCompany();
    await makeDeal(other.id, { amountCents: 700, currency: "CHF", stage: "qualified" });
    expect((await call("GET", "/pipeline")).json.stages[1].count).toBe(4);
    expect((await call("GET", `/pipeline?companyId=${company.id}`)).json.stages[1].count).toBe(3);
    const narrowed = await call("GET", `/pipeline?companyId=${other.id}`);
    expect(narrowed.json.stages[1]).toMatchObject({ count: 1, totals: [{ currency: "CHF", amountCents: 700 }] });
    expect(narrowed.json.stages[4].count).toBe(0);
  });
});

describe("the board's calendar year (specs/017 AC-3.6)", () => {
  it("shows every open deal, and the won and lost deals of the year asked for, this one by default", async () => {
    const company = await makeCompany();
    const year = new Date().getUTCFullYear();
    const open = await makeDeal(company.id, { title: "Still open" });
    await db.deal.update({ where: { id: open.id }, data: { createdAt: new Date(Date.UTC(year - 2, 5, 1)) } });
    const closed = async (title: string, stage: "won" | "lost", when: Date) => {
      const deal = await makeDeal(company.id, { title });
      await db.deal.update({ where: { id: deal.id }, data: { stage, closedAt: when } });
    };
    await closed("Won this year", "won", new Date(Date.UTC(year, 0, 15)));
    await closed("Won last year", "won", new Date(Date.UTC(year - 1, 11, 31, 23, 0)));
    await closed("Lost last year", "lost", new Date(Date.UTC(year - 1, 3, 1)));

    const titles = async (query: string) =>
      (await call("GET", `/deals?board=true${query}`)).json.items.map((d: { title: string }) => d.title).sort();
    expect(await titles("")).toEqual(["Still open", "Won this year"]);
    expect(await titles(`&year=${year - 1}`)).toEqual(["Lost last year", "Still open", "Won last year"]);

    const last = await call("GET", `/pipeline?year=${year - 1}`, { as: "salesCh" });
    expect(last.json.year).toBe(year - 1);
    expect(last.json.stages.find((s: { stage: string }) => s.stage === "won").count).toBe(1);
    expect(last.json.stages.find((s: { stage: string }) => s.stage === "lead").count).toBe(1);
    // the picker: years with closed deals, newest first, this year always there
    expect(last.json.years).toEqual([year, year - 1]);
    expect((await call("GET", "/pipeline?year=1999")).status).toBe(422);
  });
});
