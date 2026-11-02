import { describe, expect, it } from "bun:test";
import { stageTransition, summarisePipeline, weightedCents } from "./stages";

describe("weightedCents (D-9)", () => {
  it("rounds half up, once, in integer arithmetic", () => {
    expect(weightedCents(1001n, "qualified")).toBe(250n); // 250.25
    expect(weightedCents(1002n, "qualified")).toBe(251n); // 250.5
    expect(weightedCents(3n, "lead")).toBe(0n); // 0.3
    expect(weightedCents(5n, "lead")).toBe(1n); // 0.5
    expect(weightedCents(10_000_000_000_000n, "negotiation")).toBe(7_500_000_000_000n);
    expect(weightedCents(123n, "lost")).toBe(0n);
    expect(weightedCents(123n, "won")).toBe(123n);
  });
});

describe("stageTransition (AC-3.3)", () => {
  const now = new Date("2026-11-01T10:00:00Z");
  const earlier = new Date("2026-10-01T10:00:00Z");

  it("closing sets closedAt now; a lost reason survives only on lost", () => {
    expect(stageTransition("lost", "Price", now, { stage: "proposal", closedAt: null })).toEqual({
      stage: "lost",
      closedAt: now,
      lostReason: "Price",
    });
    expect(stageTransition("won", "Price", now, { stage: "proposal", closedAt: null }).lostReason).toBeNull();
  });

  it("re-saving the same closed stage keeps the original closing moment; switching won↔lost restamps", () => {
    expect(stageTransition("won", null, now, { stage: "won", closedAt: earlier }).closedAt).toBe(earlier);
    expect(stageTransition("lost", null, now, { stage: "won", closedAt: earlier }).closedAt).toBe(now);
  });

  it("an open stage clears closedAt and the reason", () => {
    expect(stageTransition("lead", "x", now, { stage: "lost", closedAt: earlier })).toEqual({
      stage: "lead",
      closedAt: null,
      lostReason: null,
    });
  });
});

describe("summarisePipeline", () => {
  it("never sums currencies together and lists every stage", () => {
    const stages = summarisePipeline([
      { stage: "proposal", currency: "EUR", amountCents: 100n },
      { stage: "proposal", currency: "CHF", amountCents: 300n },
      { stage: "proposal", currency: "EUR", amountCents: 1n },
    ]);
    expect(stages).toHaveLength(6);
    expect(stages[2]).toEqual({
      stage: "proposal",
      count: 3,
      totals: [
        { currency: "CHF", amountCents: 300, weightedCents: 150 },
        // 50 + 1 (0.5 rounds up): weighted per deal, then summed.
        { currency: "EUR", amountCents: 101, weightedCents: 51 },
      ],
    });
  });
});
