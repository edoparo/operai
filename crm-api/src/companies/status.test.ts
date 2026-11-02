import { describe, expect, it } from "bun:test";
import { effectiveStatus, isLapsed, lapseCutoff } from "./status";

describe("company status lapse (specs/017 AC-1.9)", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const recent = new Date("2026-03-01T10:00:00Z");
  const old = new Date("2025-11-01T10:00:00Z");

  it("the cutoff is twelve months back", () => {
    expect(lapseCutoff(now).toISOString()).toBe("2025-11-02T10:00:00.000Z");
  });

  it("a customer whose last win is older than the cutoff, with no open deal, reads former", () => {
    const facts = { status: "customer", openDealCount: 0, lastWonAt: old } as const;
    expect(isLapsed(facts, now)).toBe(true);
    expect(effectiveStatus(facts, now)).toBe("former");
  });

  it("a recent win or an open deal keeps a customer active", () => {
    expect(effectiveStatus({ status: "customer", openDealCount: 0, lastWonAt: recent }, now)).toBe("customer");
    expect(effectiveStatus({ status: "customer", openDealCount: 1, lastWonAt: old }, now)).toBe("customer");
  });

  it("a customer that never won a deal keeps the status set by hand", () => {
    expect(effectiveStatus({ status: "customer", openDealCount: 0, lastWonAt: null }, now)).toBe("customer");
  });

  it("prospects and former clients are never changed on read", () => {
    expect(effectiveStatus({ status: "prospect", openDealCount: 0, lastWonAt: old }, now)).toBe("prospect");
    const former = { status: "former", openDealCount: 0, lastWonAt: old } as const;
    expect(effectiveStatus(former, now)).toBe("former");
    expect(isLapsed(former, now)).toBe(false);
  });
});
