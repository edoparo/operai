import { beforeEach, describe, expect, it } from "bun:test";
import { call, makeCompany, makeDeal, resetWorld } from "../test-support/world";

/** specs/018 US-1: without deal:financials the money is left out, not zeroed. */
describe("financial visibility (specs/018 US-1)", () => {
  beforeEach(resetWorld);

  it("a technician sees the deal without amount, currency or notes", async () => {
    const deal = await makeDeal((await makeCompany()).id, { notes: "Discount 10% agreed" });
    const sales = await call("GET", `/deals/${deal.id}`, { as: "salesCh" });
    expect(sales.json).toMatchObject({ amountCents: 10_000_00, currency: "CHF", notes: "Discount 10% agreed" });

    const tech = await call("GET", `/deals/${deal.id}`, { as: "consultant" });
    expect(tech.status).toBe(200);
    expect(tech.json.title).toBe("Platform rebuild");
    for (const field of ["amountCents", "currency", "notes"]) expect(field in tech.json).toBe(false);

    const list = await call("GET", "/deals", { as: "consultant" });
    expect("amountCents" in list.json.items[0]).toBe(false);
  });

  it("the pipeline keeps counts and drops totals", async () => {
    await makeDeal((await makeCompany()).id);
    const tech = await call("GET", "/pipeline", { as: "consultant" });
    const lead = tech.json.stages.find((s: { stage: string }) => s.stage === "lead");
    expect(lead).toEqual({ stage: "lead", count: 1 });
    const sales = await call("GET", "/pipeline", { as: "salesCh" });
    expect(sales.json.stages.find((s: { stage: string }) => s.stage === "lead").totals).toHaveLength(1);
  });

  it("offers and entity profiles are financial routes", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    expect((await call("GET", `/deals/${deal.id}/offers`, { as: "consultant" })).status).toBe(403);
    expect((await call("GET", "/entity-profiles", { as: "consultant" })).status).toBe(403);
    // deal:manage without deal:financials cannot generate either (AC-1.4, AC-5.2).
    const managerOnly = await call("POST", `/deals/${deal.id}/offers`, { as: "managerNoMoney", body: { language: "en" } });
    expect(managerOnly.status).toBe(403);
  });
});
