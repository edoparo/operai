import { beforeEach, describe, expect, it } from "bun:test";
import { db, makeCompany, makeDeal, markEstimateReady, resetWorld } from "../src/test-support/world";
import type { DealLinkNotice } from "../src/lib/estimaiNotices";
import { runBackfill } from "./backfill-estimate-links";

function harness(ok: (n: DealLinkNotice) => boolean = () => true) {
  const sent: DealLinkNotice[] = [];
  const out: string[] = [];
  const err: string[] = [];
  return {
    sent,
    out,
    err,
    send: async (n: DealLinkNotice) => (sent.push(n), ok(n)),
    io: { log: (l: string) => void out.push(l), error: (l: string) => void err.push(l) },
  };
}

describe("backfill-estimate-links (specs/024 AC-3.7)", () => {
  beforeEach(async () => {
    await resetWorld();
    const company = await makeCompany();
    const a = await makeDeal(company.id, { stage: "qualified" });
    const b = await makeDeal(company.id, { stage: "qualified" });
    const c = await makeDeal(company.id, { stage: "qualified" });
    await markEstimateReady(a.id);
    await markEstimateReady(b.id);
    // c has only an override row: no estimate to send.
    await db.dealEstimate.create({
      data: { dealId: c.id, estimateId: "", estimateName: "", technicalUserId: "u", requestedBy: "u", requestedAt: new Date(), overrideBy: "u", overrideReason: "r", overrideAt: new Date() },
    });
  });

  it("dry run counts and sends nothing", async () => {
    const h = harness();
    expect(await runBackfill({ apply: false, send: h.send, io: h.io })).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(h.out.join(" ")).toContain("2 linked estimate(s)");
  });

  it("--apply sends one linked notice per real link, at requestedAt, skipping override-only rows", async () => {
    const h = harness();
    expect(await runBackfill({ apply: true, send: h.send, io: h.io })).toBe(0);
    const rows = await db.dealEstimate.findMany({ where: { estimateId: { not: "" } } });
    expect(h.sent).toHaveLength(2);
    for (const row of rows) {
      expect(h.sent).toContainEqual({ estimateId: row.estimateId, dealId: row.dealId, event: "linked", at: row.requestedAt.toISOString() });
    }
  });

  it("--apply without a configured client exits non-zero and sends nothing", async () => {
    const h = harness();
    expect(await runBackfill({ apply: true, send: null, io: h.io })).toBe(1);
    expect(h.err.join(" ")).toContain("not set");
  });

  it("exits non-zero when a delivery fails, but still tries the rest", async () => {
    const h = harness(() => false);
    expect(await runBackfill({ apply: true, send: h.send, io: h.io })).toBe(1);
    expect(h.sent).toHaveLength(2);
    expect(h.err.join(" ")).toContain("2 not delivered");
  });
});
