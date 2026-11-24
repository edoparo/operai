/**
 * QE gap tests for the pairing (T27, specs/20261124-receipt-numbers-from-the-register; AC-1.3, AC-1.4). Found by mutation checks that left
 * pairing.test.ts green: (1) two exact rows that carry the SAME number are still "several candidates" (a duplicated register row must not
 * be taken silently); (2) "to the cent" means a one-cent difference is "amount differs", not an exact match. Synthetic data only.
 */

import { describe, expect, it } from "bun:test";
import { normaliseWorker, proposePairing, type PairingInput } from "./pairing";
import type { PreReleaseLine, RegisterRow, ReleaseEmployee } from "./types";

// ─── Builders ────────────────────────────────────────────────────────────────

const employee = (key: string, over: Partial<ReleaseEmployee> = {}): ReleaseEmployee => ({
  key,
  userId: `user-${key}`,
  name: key === "E1" ? "Worker Alpha" : key === "E2" ? "Worker Beta" : `Worker ${key}`,
  email: `${key.toLowerCase()}@example.invalid`,
  emails: [`${key.toLowerCase()}@example.invalid`],
  code: null,
  initials: key === "E1" ? "AB" : key === "E2" ? "CD" : "XX",
  numberedPrefixes: [],
  ...over,
});
const E1 = employee("E1");
const E2 = employee("E2");

let lineSeq = 0;
const line = (over: Partial<PreReleaseLine> & { date: string; approvedTotalCents: number }): PreReleaseLine => ({
  id: `L${++lineSeq}`.padStart(4, "0"),
  ownerUserId: "user-E1",
  createdAt: "2026-04-01T08:00:00.000Z",
  currency: "CHF",
  ...over,
});

const NUMBER = /^([A-Z]{2,3})(\d{2})\/(\d{1,5})$/;
const row = (position: number, number: string, date: string | null, totalCents: number | null, worker: string | null = "Worker Alpha"): RegisterRow => {
  const m = NUMBER.exec(number);
  return {
    position,
    worker,
    number: number === "" ? { kind: "empty" } : m ? { kind: "paper", text: number, prefix: m[1]!, yy: Number(m[2]), seq: Number(m[3]) } : { kind: "malformed", shape: number.replace(/[A-Za-z]/g, "A").replace(/\d/g, "9") },
    date,
    totalCents,
  };
};

const OWNERS = new Map([
  [normaliseWorker("Worker Alpha"), "E1"],
  [normaliseWorker("Worker Beta"), "E2"],
]);

const input = (lines: PreReleaseLine[], rows: RegisterRow[], over: Partial<PairingInput> = {}): PairingInput => ({
  lines,
  rows,
  employees: [E1, E2],
  workerOwners: OWNERS,
  excluded: new Set(),
  ...over,
});

const only = (lines: PreReleaseLine[], rows: RegisterRow[], over: Partial<PairingInput> = {}) => proposePairing(input(lines, rows, over)).proposals;


describe("QE gaps (AC-1.3, AC-1.4)", () => {
  it("AC-1.4: two exact rows carrying the same number are several candidates, not an exact match", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450), row(8, "AB26/005", "2026-03-12", 2450)]);
    expect(p).toMatchObject({ category: "several_candidates", proposed: null, proposedNumber: null, state: "unresolved", registerRows: [7, 8] });
    expect(p!.reason).toBe("several candidates: R7 AB26/005, R8 AB26/005");
  });

  it("AC-1.3: 'to the cent': a register total one cent above or below is amount differs, never an exact match", () => {
    for (const total of [2449, 2451]) {
      const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(37, "AB26/005", "2026-03-12", total)]);
      expect(p).toMatchObject({ category: "amount_differs", proposed: "paper", state: "unresolved" });
      expect(p!.reason).toBe(`amount differs: line 24.50 CHF, R37 ${(total / 100).toFixed(2)}, AB26/005`);
    }
  });
});
