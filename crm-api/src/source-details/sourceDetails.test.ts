import { beforeEach, describe, expect, it } from "bun:test";
import { call, makeCompany, makeDeal, resetWorld } from "../test-support/world";
import { foldDetail } from "./sourceDetails.routes";

beforeEach(resetWorld);

describe("GET /source-details (specs/20261101-crm US-7)", () => {
  it("lists the details of one source across companies and deals, one entry per spelling family, most used first", async () => {
    const a = await makeCompany({ source: "event", sourceDetail: "Swiss Digital Day 2026" });
    await makeCompany({ source: "event", sourceDetail: "swiss  digital day 2026" });
    await makeDeal(a.id, { source: "event", sourceDetail: "Swiss Digital Day 2026" });
    await makeDeal(a.id, { source: "event", sourceDetail: "Café Tech" });
    await makeCompany({ source: "referral", sourceDetail: "Mario Rossi" });
    await makeCompany({ source: "inbound" });

    const res = await call("GET", "/source-details?source=event", { as: "consultant" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      items: [
        { value: "Swiss Digital Day 2026", count: 3 },
        { value: "Café Tech", count: 1 },
      ],
    });
    expect((await call("GET", "/source-details?source=referral", { as: "consultant" })).json).toEqual({
      items: [{ value: "Mario Rossi", count: 1 }],
    });
  });

  it("accepts only a source that has a detail", async () => {
    expect((await call("GET", "/source-details?source=inbound", { as: "consultant" })).status).toBe(422);
    expect((await call("GET", "/source-details", { as: "consultant" })).status).toBe(422);
  });

  it("folds case, accents and spacing", () => {
    expect(foldDetail("  Café   TECH ")).toBe("cafe tech");
  });
});
