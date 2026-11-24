/**
 * The pairing, pure (T9, specs/20261124-receipt-numbers-from-the-register; plan § Pairing D2, § Counter continuation D5, § Prefixes D8;
 * AC-1.1 to AC-1.16, AC-3.1, AC-4.11). Synthetic names only; every row, line and employee is built here.
 */

import { describe, expect, it } from "bun:test";
import {
  analysePrefixes,
  compareEmployeeKeys,
  computeBaselines,
  countsTowardMaximum,
  firstNewNumber,
  formatCents,
  inventory,
  listWorkers,
  normaliseWorker,
  outsideEmployeeKey,
  proposePairing,
  proposeWorkerMapping,
  resolveWorkerDecision,
  rowsByEmployee,
  withOutsideEmployees,
  type PairingInput,
} from "./pairing";
import type { PairingCategory, PreReleaseLine, RegisterRow, ReleaseEmployee } from "./types";

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

// ─── Workers ─────────────────────────────────────────────────────────────────

describe("workers (AC-1.14)", () => {
  it("normalises by trim, collapsing, case-folding, stripping diacritics, and ignores the order of the words", () => {
    expect(normaliseWorker("  Rossi   ANNA ")).toBe(normaliseWorker("anna rossi"));
    expect(normaliseWorker("Zoë Müller")).toBe(normaliseWorker("zoe muller"));
    expect(normaliseWorker("Rossi, Anna")).toBe(normaliseWorker("Anna Rossi"));
    expect(normaliseWorker("Anna")).not.toBe(normaliseWorker("Anna Rossi"));
  });

  it("lists workers in order of first appearance as W1.., one per normalised text, counting rows", () => {
    const workers = listWorkers([row(5, "", "2026-01-01", 1, "Worker Beta"), row(3, "", "2026-01-01", 1, "Worker Alpha"), row(9, "", "2026-01-01", 1, "worker alpha"), row(7, "", null, null, null)]);
    expect(workers.map((w) => [w.id, w.rows])).toEqual([["W1", 2], ["W2", 1]]);
    expect(workers[0]!.text).toBe("Worker Alpha");
  });

  it("proposes an employee when exactly one has the same name, and leaves none and several unresolved", () => {
    const twins = [employee("E1", { name: "Worker Alpha" }), employee("E2", { name: "alpha worker" }), employee("E3", { name: "Worker Gamma" })];
    const workers = listWorkers([row(2, "", null, null, "Worker Gamma"), row(3, "", null, null, "Worker Alpha"), row(4, "", null, null, "Worker Delta")]);
    const proposals = proposeWorkerMapping(workers, twins);
    expect(proposals.map((p) => [p.workerId, p.employeeKey, p.matches])).toEqual([["W1", "E3", 1], ["W2", null, 2], ["W3", null, 0]]);
  });

  it("a decision names E<n>, an email of an employee (any of their request emails), a new email, or not-operai", () => {
    const e = [employee("E1", { emails: ["old@example.invalid", "new@example.invalid"] }), employee("E2")];
    expect(resolveWorkerDecision("e2", e)).toEqual({ kind: "employee", key: "E2" });
    expect(resolveWorkerDecision("OLD@example.invalid", e)).toEqual({ kind: "employee", key: "E1" });
    expect(resolveWorkerDecision("fresh@example.invalid", e)).toEqual({ kind: "email", email: "fresh@example.invalid" });
    expect(resolveWorkerDecision("Not-Operai", e)).toEqual({ kind: "not-operai" });
    expect(resolveWorkerDecision("E9", e)).toBeNull();
    expect(resolveWorkerDecision("somebody", e)).toBeNull();
  });

  it("an outside employee is added for an email no employee holds, once", () => {
    const all = withOutsideEmployees([E1], ["e1@example.invalid", "Fresh@Example.invalid", "fresh@example.invalid"]);
    expect(all.map((e) => e.key)).toEqual(["E1", outsideEmployeeKey("fresh@example.invalid")]);
    expect(all[1]).toMatchObject({ userId: null, emails: ["fresh@example.invalid"], code: null });
    expect(["mailto:b", "E10", "E2"].sort(compareEmployeeKeys)).toEqual(["E2", "E10", "mailto:b"]);
  });

  it("a row of an unmapped worker, of not-operai, of an excluded employee or with no worker is nobody's", () => {
    const owners = new Map([...OWNERS, [normaliseWorker("Worker Stranger"), "not-operai"]]);
    const rows = [row(2, "AB26/001", "2026-01-01", 1), row(3, "XX26/001", "2026-01-01", 1, "Worker Stranger"), row(4, "XX26/002", "2026-01-01", 1, "Worker Unknown"), row(5, "XX26/003", "2026-01-01", 1, null), row(6, "CD26/001", "2026-01-01", 1, "Worker Beta")];
    expect([...rowsByEmployee({ rows, workerOwners: owners, excluded: new Set() })].map(([k, r]) => [k, r.map((x) => x.position)])).toEqual([["E1", [2]], ["E2", [6]]]);
    expect([...rowsByEmployee({ rows, workerOwners: owners, excluded: new Set(["E2"]) }).keys()]).toEqual(["E1"]);
  });
});

// ─── The category table ──────────────────────────────────────────────────────

describe("the category table (D2)", () => {
  it("outside_2026 (AC-1.16): proposed new, pre-filled, even with a matching row", () => {
    const [p] = only([line({ date: "2025-12-30", approvedTotalCents: 1000 })], [row(2, "AB25/001", "2025-12-30", 1000)]);
    expect(p).toMatchObject({ category: "outside_2026", proposed: "new", proposedNumber: null, state: "proposed", registerRows: [] });
  });

  it("no_counterpart (AC-1.8): proposed new, pre-filled", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 1000 })], [row(2, "AB26/001", "2026-03-13", 1000)]);
    expect(p).toMatchObject({ category: "no_counterpart", proposed: "new", state: "proposed" });
  });

  it("exact (AC-1.1): one exact candidate, the number pre-filled and the row listed", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450)]);
    expect(p).toMatchObject({ category: "exact", proposed: "paper", proposedNumber: "AB26/005", state: "proposed", registerRows: [7], reason: null, group: null });
  });

  it("exact: a candidate of another amount next to it does not make it doubtful", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450), row(8, "", "2026-03-12", 999)]);
    expect(p).toMatchObject({ category: "exact", proposedNumber: "AB26/005" });
  });

  it("row_without_number (AC-1.13): every candidate is empty or malformed; proposed new, unresolved", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "", "2026-03-12", 2450), row(8, "ZZ-9", "2026-03-12", 2450)]);
    expect(p).toMatchObject({ category: "row_without_number", proposed: "new", proposedNumber: null, state: "unresolved", registerRows: [7, 8] });
    expect(p!.reason).toContain("R7, R8");
  });

  it("amount_differs (AC-1.3): one number, no exact; both amounts and the number shown, not taken", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(37, "AB26/005", "2026-03-12", 2600)]);
    expect(p).toMatchObject({ category: "amount_differs", proposed: "paper", proposedNumber: "AB26/005", state: "unresolved", registerRows: [37] });
    expect(p!.reason).toBe("amount differs: line 24.50 CHF, R37 26.00, AB26/005");
  });

  it("total_unreadable (AC-1.13): the only numbered candidates have no readable total", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(37, "AB26/005", "2026-03-12", null)]);
    expect(p).toMatchObject({ category: "total_unreadable", proposed: null, state: "unresolved", registerRows: [37] });
  });

  it("a row with a number but no readable date is not a candidate: the line has no counterpart (AC-1.13)", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(37, "AB26/005", null, 2450)]);
    expect(p!.category).toBe("no_counterpart");
  });

  it("several_candidates (AC-1.4): two exact candidates", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450), row(8, "AB26/006", "2026-03-12", 2450)]);
    expect(p).toMatchObject({ category: "several_candidates", proposed: null, proposedNumber: null, state: "unresolved", registerRows: [7, 8] });
    expect(p!.reason).toBe("several candidates: R7 AB26/005, R8 AB26/006");
  });

  it("several_candidates (AC-1.4): one row that is the exact candidate of two lines; both lines are doubtful", () => {
    const ps = only([line({ date: "2026-03-12", approvedTotalCents: 2450 }), line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450)]);
    expect(ps.map((p) => p.category)).toEqual(["several_candidates", "several_candidates"]);
    expect(ps.every((p) => p.state === "unresolved" && p.proposed === null)).toBe(true);
  });

  it("several_candidates (AC-1.7): no exact, two different numbers among the candidates", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 3000 })], [row(7, "AB26/005", "2026-03-12", 1000), row(8, "AB26/006", "2026-03-12", 2000)]);
    expect(p).toMatchObject({ category: "several_candidates", state: "unresolved" });
    expect(p!.reason).toContain("AB26/005");
    expect(p!.reason).toContain("AB26/006");
  });

  it("an exact match wins over another candidate of a different number", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(7, "AB26/005", "2026-03-12", 2450), row(8, "AB26/006", "2026-03-12", 100)]);
    expect(p).toMatchObject({ category: "exact", proposedNumber: "AB26/005" });
  });
});

describe("split receipts (AC-1.6, AC-1.7)", () => {
  it("AC-1.6: two lines, one date, two rows with one number: a split group, pre-filled", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-12", approvedTotalCents: 1500 })],
      [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-12", 1500)],
    );
    expect(ps.map((p) => [p.category, p.proposed, p.proposedNumber, p.group, p.state])).toEqual([
      ["split_receipt", "split", "AB26/002", "S1", "proposed"],
      ["split_receipt", "split", "AB26/002", "S1", "proposed"],
    ]);
    expect(ps.map((p) => p.registerRows)).toEqual([[7], [8]]);
  });

  it("AC-1.7: one line, two rows of one number adding up to its total: a split of one", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 3000 })], [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-12", 2000)]);
    expect(p).toMatchObject({ category: "split_receipt", proposed: "split", proposedNumber: "AB26/002", group: "S1", state: "proposed", registerRows: [7, 8] });
  });

  it("AC-1.7: the same two rows that do not add up make the line doubtful (amount differs)", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 3100 })], [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-12", 2000)]);
    expect(p!.category).toBe("amount_differs");
  });

  it("two lines of one number on two different dates are no split: both exact, then number_taken", () => {
    const ps = only([line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-13", approvedTotalCents: 1500 })], [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-13", 1500)]);
    expect(ps.map((p) => [p.category, p.group])).toEqual([["number_taken", null], ["number_taken", null]]);
  });

  it("groups are numbered S1, S2 in line order across employees", () => {
    const ps = only(
      [
        line({ ownerUserId: "user-E2", date: "2026-03-05", approvedTotalCents: 100 }),
        line({ ownerUserId: "user-E2", date: "2026-03-05", approvedTotalCents: 200 }),
        line({ date: "2026-03-12", approvedTotalCents: 1000 }),
        line({ date: "2026-03-12", approvedTotalCents: 1500 }),
      ],
      [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-12", 1500), row(9, "CD26/002", "2026-03-05", 100, "Worker Beta"), row(10, "CD26/002", "2026-03-05", 200, "Worker Beta")],
    );
    expect(ps.map((p) => [p.employeeKey, p.group])).toEqual([["E1", "S1"], ["E1", "S1"], ["E2", "S2"], ["E2", "S2"]]);
  });
});

describe("demotions of an exact or split line to doubtful (D2)", () => {
  const one = (number: string, over: Partial<PairingInput> = {}, date = "2026-03-12") => only([line({ date, approvedTotalCents: 1000 })], [row(7, number, date, 1000)], over)[0]!;

  it("wrong_year (AC-1.10): LG25/003 on a 2026 expense; the proposal is kept for reference, never taken", () => {
    expect(one("AB25/003")).toMatchObject({ category: "wrong_year", state: "unresolved", proposed: "paper", proposedNumber: "AB25/003" });
  });

  it("sequence_000 (AC-1.11): its own category, the proposal changes to new", () => {
    expect(one("AB26/000")).toMatchObject({ category: "sequence_000", state: "unresolved", proposed: "new", proposedNumber: null });
  });

  it("prefix_differs (AC-1.12): a prefix that is not the code, the initials, nor that of the employee's other paper numbers", () => {
    expect(one("ZZ26/005")).toMatchObject({ category: "prefix_differs", state: "unresolved" });
  });

  it("prefix is fine when it is the code, the initials, or the prefix of the employee's OTHER paper numbers (AC-1.12)", () => {
    const coded = { employees: [employee("E1", { code: "ABX" }), E2] };
    expect(one("ABX26/005", coded).category).toBe("exact");
    expect(one("AB26/005", coded).category).toBe("exact");
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-13", approvedTotalCents: 2000 })],
      [row(7, "ZZ26/005", "2026-03-12", 1000), row(8, "ZZ26/006", "2026-03-13", 2000)],
    );
    expect(ps.map((p) => p.category)).toEqual(["exact", "exact"]);
  });

  it("number_taken (AC-1.5): the same number on two lines outside a split, both listed", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-14", approvedTotalCents: 2000 })],
      [row(7, "AB26/005", "2026-03-12", 1000), row(8, "AB26/005", "2026-03-14", 2000)],
    );
    expect(ps.map((p) => [p.category, p.state])).toEqual([["number_taken", "unresolved"], ["number_taken", "unresolved"]]);
    expect(ps[0]!.reason).toContain("sequence 5");
  });

  it("number_taken: the seq collision LG25/003 vs LG26/003 on two 2026 lines of one employee (the unique key has no prefix)", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-14", approvedTotalCents: 2000 })],
      [row(7, "AB25/003", "2026-03-12", 1000), row(8, "AB26/003", "2026-03-14", 2000)],
    );
    expect(ps.map((p) => p.category)).toEqual(["number_taken", "number_taken"]);
  });

  it("number_taken: two `/000` of one employee collide as well", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-14", approvedTotalCents: 2000 })],
      [row(7, "AB26/000", "2026-03-12", 1000), row(8, "AB26/000", "2026-03-14", 2000)],
    );
    expect(ps.map((p) => p.category)).toEqual(["number_taken", "number_taken"]);
  });

  it("the same seq on two DIFFERENT employees is no collision", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ ownerUserId: "user-E2", date: "2026-03-14", approvedTotalCents: 2000 })],
      [row(7, "AB26/005", "2026-03-12", 1000), row(8, "CD26/005", "2026-03-14", 2000, "Worker Beta")],
    );
    expect(ps.map((p) => p.category)).toEqual(["exact", "exact"]);
  });

  it("a confirmed split of one number is not a collision, and a wrong year demotes the whole group", () => {
    const ps = only(
      [line({ date: "2026-03-12", approvedTotalCents: 1000 }), line({ date: "2026-03-12", approvedTotalCents: 1500 })],
      [row(7, "AB25/002", "2026-03-12", 1000), row(8, "AB25/002", "2026-03-12", 1500)],
    );
    expect(ps.map((p) => [p.category, p.group, p.proposed])).toEqual([["wrong_year", "S1", "split"], ["wrong_year", "S1", "split"]]);
  });
});

describe("an excluded employee (AC-1.15) and rows that are nobody's", () => {
  it("has no rows: its lines have no counterpart and are proposed new", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 1000 })], [row(7, "AB26/005", "2026-03-12", 1000)], { excluded: new Set(["E1"]) });
    expect(p).toMatchObject({ category: "no_counterpart", proposed: "new" });
  });
  it("a row of an unmapped worker never pairs", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 1000 })], [row(7, "AB26/005", "2026-03-12", 1000, "Worker Unknown")]);
    expect(p!.category).toBe("no_counterpart");
  });
});

describe("determinism", () => {
  it("the same inputs in any order give the identical proposals, groups and ids", () => {
    const lines = [
      line({ date: "2026-03-12", approvedTotalCents: 1000, createdAt: "2026-04-01T08:00:00.000Z" }),
      line({ date: "2026-03-12", approvedTotalCents: 1500, createdAt: "2026-04-01T08:00:01.000Z" }),
      line({ ownerUserId: "user-E2", date: "2026-03-05", approvedTotalCents: 100 }),
      line({ date: "2026-03-20", approvedTotalCents: 1234 }),
      line({ date: "2026-03-21", approvedTotalCents: 99 }),
    ];
    const rows = [row(7, "AB26/002", "2026-03-12", 1000), row(8, "AB26/002", "2026-03-12", 1500), row(9, "CD26/011", "2026-03-05", 100, "Worker Beta"), row(10, "AB26/040", "2026-03-20", 1200)];
    const base = proposePairing(input(lines, rows));
    const shuffled = proposePairing(input([...lines].reverse(), [...rows].reverse(), { employees: [E2, E1] }));
    expect(shuffled.proposals).toEqual(base.proposals);
    expect([...shuffled.groups]).toEqual([...base.groups]);
    expect(base.proposals.map((p) => p.lineId)).toEqual(lines.slice().sort((a, b) => (a.ownerUserId === b.ownerUserId ? (a.date + a.createdAt + a.id < b.date + b.createdAt + b.id ? -1 : 1) : a.ownerUserId < b.ownerUserId ? -1 : 1)).map((l) => l.id));
  });
});

describe("what a doubtful line's reason says", () => {
  it("names the line's own amount and the rows' positions and numbers, and no worker", () => {
    const [p] = only([line({ date: "2026-03-12", approvedTotalCents: 2450 })], [row(37, "AB26/005", "2026-03-12", 2600)]);
    expect(p!.reason).not.toContain("Worker");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-1234)).toBe("-12.34");
  });
});

// ─── Counter continuation ────────────────────────────────────────────────────

describe("the baseline (AC-3.1, D5)", () => {
  const baselineOf = (rows: RegisterRow[], extra: { offsets?: { email: string; lastIssuedSeq: number }[]; imported?: string[]; excluded?: string[] } = {}) => {
    const result = computeBaselines({
      employees: [E1, E2],
      rows,
      workerOwners: OWNERS,
      excluded: new Set(extra.excluded ?? []),
      offsets: extra.offsets ?? [],
      imported: new Map(extra.imported ? [["E1", extra.imported]] : []),
    });
    return result.get("E1")!;
  };

  it("offsets only, register only, imported only, all three: the highest wins", () => {
    expect(baselineOf([], { offsets: [{ email: "e1@example.invalid", lastIssuedSeq: 30 }] })).toMatchObject({ offsets: 30, registerMax: 0, importedMax: 0, baseline: 30 });
    expect(baselineOf([row(2, "AB26/040", "2026-03-01", 1), row(3, "AB26/021", "2026-03-02", 1)])).toMatchObject({ registerMax: 40, baseline: 40 });
    expect(baselineOf([], { imported: ["AB26/012", "AB25/050"] })).toMatchObject({ importedMax: 50, baseline: 50 });
    expect(baselineOf([row(2, "AB26/040", "2026-03-01", 1)], { offsets: [{ email: "e1@example.invalid", lastIssuedSeq: 45 }], imported: ["AB26/041"] })).toMatchObject({ offsets: 45, registerMax: 40, importedMax: 41, baseline: 45 });
  });

  it("an offsets row matches any of the employee's emails, case-insensitively, and never another employee's", () => {
    const e = employee("E1", { emails: ["old@example.invalid", "new@example.invalid"] });
    const result = computeBaselines({
      employees: [e, E2],
      rows: [],
      workerOwners: OWNERS,
      excluded: new Set(),
      offsets: [{ email: "OLD@example.invalid", lastIssuedSeq: 7 }, { email: "e2@example.invalid", lastIssuedSeq: 9 }],
      imported: new Map(),
    });
    expect(result.get("E1")!.baseline).toBe(7);
    expect(result.get("E2")!.baseline).toBe(9);
  });

  it("a wrong-year number counts when its row's date is in 2026, missing or unreadable, and not when it is readable and outside 2026", () => {
    expect(countsTowardMaximum(row(2, "AB25/090", "2026-03-01", 1))).toBe(true);
    expect(countsTowardMaximum(row(2, "AB25/090", null, 1))).toBe(true);
    expect(countsTowardMaximum(row(2, "AB25/090", "2025-11-30", 1))).toBe(false);
    expect(countsTowardMaximum(row(2, "AB26/090", "2025-11-30", 1))).toBe(true);
    expect(baselineOf([row(2, "AB26/010", "2026-01-01", 1), row(3, "AB25/090", "2025-11-30", 1)]).registerMax).toBe(10);
    expect(baselineOf([row(2, "AB26/010", "2026-01-01", 1), row(3, "AB25/090", null, 1)]).registerMax).toBe(90);
  });

  it("a sequence 000, an empty number and a malformed number count for nothing", () => {
    expect(countsTowardMaximum(row(2, "AB26/000", "2026-03-01", 1))).toBe(false);
    expect(countsTowardMaximum(row(2, "", "2026-03-01", 1))).toBe(false);
    expect(countsTowardMaximum(row(2, "AA99/9A", "2026-03-01", 1))).toBe(false);
    expect(baselineOf([row(2, "AB26/000", "2026-03-01", 1), row(3, "", "2026-03-01", 1), row(4, "AA99/9A", "2026-03-01", 1)]).baseline).toBe(0);
  });

  it("an unpaired row counts, and a row with a number but no date or total counts", () => {
    expect(baselineOf([row(2, "AB26/077", null, null)]).registerMax).toBe(77);
  });

  it("an excluded employee has no register maximum, no offsets and no imported number", () => {
    const b = baselineOf([row(2, "AB26/077", "2026-03-01", 1)], { excluded: ["E1"], offsets: [{ email: "e1@example.invalid", lastIssuedSeq: 5 }], imported: ["AB26/090"] });
    expect(b).toMatchObject({ offsets: 0, registerMax: 0, importedMax: 0, baseline: 0 });
  });

  it("the first new number continues after the baseline with the code, else the initials; none for an employee outside Refund", () => {
    expect(firstNewNumber(E1, 40)).toBe("AB26/041");
    expect(firstNewNumber(employee("E1", { code: "ABX" }), 39)).toBe("ABX26/040");
    expect(firstNewNumber(withOutsideEmployees([], ["x@example.invalid"])[0]!, 3)).toBeNull();
  });
});

describe("the row inventory (AC-1.9, AC-1.13, AC-1.14)", () => {
  it("counts rows with no line, rows without a number, rows with a number but no date or total, malformed and worker-less rows, unmapped workers by id", () => {
    const rows = [
      row(2, "AB26/001", "2026-03-12", 1000),
      row(3, "AB26/002", "2026-03-13", 5),
      row(4, "", "2026-03-14", 5),
      row(5, "AB26/003", null, 5),
      row(6, "AB26/004", "2026-03-15", null),
      row(7, "ZZ-9", "2026-03-16", 5),
      row(8, "AB26/005", "2026-03-17", 5, null),
      row(9, "AB26/006", "2026-03-18", 5, "Worker Unknown"),
    ];
    const pairingInput = input([line({ date: "2026-03-12", approvedTotalCents: 1000 })], rows);
    const result = proposePairing(pairingInput);
    expect(inventory(pairingInput, result)).toEqual({
      rowsWithNoLine: 5,
      rowsWithoutNumber: 2,
      rowsWithoutDateOrTotal: [5, 6],
      malformed: [{ position: 7, shape: "AA-9" }],
      noWorker: [8],
      unmappedWorkers: ["W2"],
    });
  });
});

// ─── Shared prefixes ─────────────────────────────────────────────────────────

describe("shared prefixes (AC-4.11, DS-8)", () => {
  const FRA = employee("E1", { name: "Worker Alpha", initials: "FR" });
  const FRB = employee("E2", { name: "Worker Beta", initials: "FR" });
  const analyse = (employees: ReleaseEmployee[], over: Partial<Parameters<typeof analysePrefixes>[0]> = {}) =>
    analysePrefixes({ employees, rows: [], workerOwners: OWNERS, excluded: new Set(), imported: new Map(), withNewNumbers: new Set(), ...over });

  it("two employees that derive the same initials are a shared pair; both need a code", () => {
    const a = analyse([FRA, FRB]);
    expect(a.shared).toEqual(["E1", "E2"]);
    expect(a.needCode).toEqual(["E1", "E2"]);
    expect(a.blocked).toEqual([]);
  });

  it("is blocked only when a NEW number would go to a codeless member; an all-paper member is not blocked", () => {
    expect(analyse([FRA, FRB], { withNewNumbers: new Set(["E1"]) }).blocked).toEqual(["E1"]);
    expect(analyse([FRA, FRB], { withNewNumbers: new Set() }).blocked).toEqual([]);
  });

  it("a code on each ends the pair (different codes, registers aside)", () => {
    const a = analyse([employee("E1", { initials: "FR", code: "FRO" }), employee("E2", { initials: "FR", code: "FRI" })], { withNewNumbers: new Set(["E1", "E2"]) });
    expect(a.shared).toEqual([]);
    expect(a.blocked).toEqual([]);
  });

  it("register-mapped numbers make a pair even when the derived initials differ", () => {
    const owners = new Map([[normaliseWorker("Worker Alpha"), "E1"], [normaliseWorker("Worker Beta"), "E2"]]);
    const rows = [row(2, "LC26/001", "2026-03-01", 1), row(3, "LC26/002", "2026-03-01", 1, "Worker Beta")];
    const a = analyse([employee("E1", { initials: "AB" }), employee("E2", { initials: "CD" })], { rows, workerOwners: owners, withNewNumbers: new Set(["E1"]) });
    expect(a.shared).toEqual(["E1", "E2"]);
    expect(a.needCode).toEqual(["E1", "E2"]);
    expect(a.blocked).toEqual(["E1"]);
  });

  it("two LC employees with their own codes are not blocked although both registers say LC", () => {
    const owners = new Map([[normaliseWorker("Worker Alpha"), "E1"], [normaliseWorker("Worker Beta"), "E2"]]);
    const rows = [row(2, "LC26/001", "2026-03-01", 1), row(3, "LC26/002", "2026-03-01", 1, "Worker Beta")];
    const a = analyse([employee("E1", { initials: "LC", code: "LCM" }), employee("E2", { initials: "LC", code: "LCP" })], { rows, workerOwners: owners, withNewNumbers: new Set(["E1", "E2"]) });
    expect(a.shared).toEqual(["E1", "E2"]); // they still meet on LC
    expect(a.needCode).toEqual([]);
    expect(a.blocked).toEqual([]);
  });

  it("paper decisions and already numbered prefixes count (imported, issued)", () => {
    const a = analyse([employee("E1", { initials: "AB" }), employee("E2", { initials: "CD", numberedPrefixes: ["AB"] })], { withNewNumbers: new Set(["E1"]) });
    expect(a.shared).toEqual(["E1", "E2"]);
    const b = analyse([employee("E1", { initials: "AB" }), employee("E2", { initials: "CD" })], { imported: new Map([["E2", ["AB26/004"]]]), withNewNumbers: new Set(["E1"]) });
    expect(b.shared).toEqual(["E1", "E2"]);
    expect(b.blocked).toEqual(["E1"]);
  });

  it("DS-8: a coded employee whose code equals a codeless colleague's initials is in a shared pair, and the colleague needs a code; the coded one's new number is refused until then", () => {
    const coded = employee("E1", { initials: "AB", code: "FR" });
    const colleague = employee("E2", { initials: "FR" });
    const a = analyse([coded, colleague], { withNewNumbers: new Set(["E1"]) });
    expect(a.shared).toEqual(["E1", "E2"]);
    expect(a.needCode).toEqual(["E2"]);
    expect(a.blocked).toEqual(["E1"]);
    expect(analyse([coded, employee("E2", { initials: "FR", code: "FRX" })], { withNewNumbers: new Set(["E1"]) }).blocked).toEqual([]);
  });

  it("the excluded test account takes part with its code or initials, its register rows dropped", () => {
    const owners = new Map([[normaliseWorker("Worker Alpha"), "E1"]]);
    const rows = [row(2, "AB26/001", "2026-03-01", 1)];
    const a = analyse([employee("E1", { initials: "XX" }), employee("E2", { initials: "AB" })], { rows, workerOwners: owners, excluded: new Set(["E1"]), withNewNumbers: new Set(["E2"]) });
    // E1's AB26 row is dropped (excluded), so only E2's own initials AB remain: no pair.
    expect(a.shared).toEqual([]);
    const b = analyse([employee("E1", { initials: "AB" }), employee("E2", { initials: "AB" })], { excluded: new Set(["E1"]), withNewNumbers: new Set(["E2"]) });
    expect(b.blocked).toEqual(["E2"]);
  });

  it("an employee not yet in Refund takes part but is never asked for a code", () => {
    const outside = withOutsideEmployees([employee("E1", { initials: "AB" })], ["x@example.invalid"]);
    const owners = new Map([[normaliseWorker("Worker Gamma"), outside[1]!.key]]);
    const a = analyse(outside, { rows: [row(2, "AB26/001", "2026-03-01", 1, "Worker Gamma")], workerOwners: owners, withNewNumbers: new Set(["E1"]) });
    expect(a.shared).toEqual(["E1", outside[1]!.key]);
    expect(a.needCode).toEqual(["E1"]);
  });
});

describe("the category type", () => {
  it("covers the table and the four demotions", () => {
    const all: PairingCategory[] = ["outside_2026", "no_counterpart", "row_without_number", "split_receipt", "exact", "several_candidates", "amount_differs", "total_unreadable", "wrong_year", "sequence_000", "prefix_differs", "number_taken"];
    expect(new Set(all).size).toBe(12);
  });
});
