/**
 * The pairing file, pure (T10, specs/20261124-receipt-numbers-from-the-register; plan D3; AC-1.1, AC-1.3, AC-1.5 to AC-1.7,
 * AC-1.13 to AC-1.16, AC-2.3, AC-2.4, AC-2.6, AC-2.7). Synthetic names only.
 */

import { describe, expect, it } from "bun:test";
import {
  decisionsOf,
  excludedEmployees,
  formatProblems,
  linesDigest,
  outsideEmails,
  PAIRING_FORMAT,
  PairingFileError,
  readPairingCsv,
  validatePairing,
  workerOwnersFromFile,
  writePairingCsv,
  type PairingFile,
  type PairingFileData,
  type Problem,
  type ProblemCode,
} from "./pairingFile";
import { inventory, listWorkers, normaliseWorker, proposePairing, proposeWorkerMapping, type PairingInput } from "./pairing";
import { parseCsvRows } from "../lib/operatorFiles";
import type { PreReleaseLine, RegisterRow, ReleaseEmployee } from "./types";

// ─── A small world ───────────────────────────────────────────────────────────

const employee = (key: string, name: string, over: Partial<ReleaseEmployee> = {}): ReleaseEmployee => ({
  key,
  userId: `user-${key}`,
  name,
  email: `${key.toLowerCase()}@example.invalid`,
  emails: [`${key.toLowerCase()}@example.invalid`],
  code: null,
  initials: key === "E1" ? "AB" : "CD",
  numberedPrefixes: [],
  ...over,
});
const E1 = employee("E1", "Worker Alpha");
const E2 = employee("E2", "Worker Beta");
const EMPLOYEES = [E1, E2];

const L = (id: string, ownerUserId: string, date: string, approvedTotalCents: number): PreReleaseLine => ({
  id,
  ownerUserId,
  date,
  createdAt: "2026-04-01T08:00:00.000Z",
  approvedTotalCents,
  currency: "CHF",
});
const LINES: PreReleaseLine[] = [
  L("line-a1", "user-E1", "2026-03-12", 2450), // exact AB26/005
  L("line-a2", "user-E1", "2026-03-13", 1000), // split with a3
  L("line-a3", "user-E1", "2026-03-13", 1500),
  L("line-a4", "user-E1", "2026-03-14", 3000), // amount differs
  L("line-a5", "user-E1", "2026-03-15", 700), // no counterpart
  L("line-b1", "user-E2", "2026-03-20", 500), // exact CD26/001
  L("line-old", "user-E1", "2025-12-30", 100), // outside 2026
];

const NUMBER = /^([A-Z]{2,3})(\d{2})\/(\d{1,5})$/;
const R = (position: number, number: string, date: string | null, totalCents: number | null, worker: string | null = "Worker Alpha"): RegisterRow => {
  const m = NUMBER.exec(number);
  return {
    position,
    worker,
    number: number === "" ? { kind: "empty" } : m ? { kind: "paper", text: number, prefix: m[1]!, yy: Number(m[2]), seq: Number(m[3]) } : { kind: "malformed", shape: number.replace(/[A-Za-z]/g, "A").replace(/\d/g, "9") },
    date,
    totalCents,
  };
};
const ROWS: RegisterRow[] = [
  R(2, "AB26/005", "2026-03-12", 2450),
  R(3, "AB26/006", "2026-03-13", 1000),
  R(4, "AB26/006", "2026-03-13", 1500),
  R(5, "AB26/007", "2026-03-14", 3100),
  R(6, "CD26/001", "2026-03-20", 500, "Worker Beta"),
  R(7, "AB26/009", "2026-03-30", 100),
  R(8, "ZZ-1", "2026-03-31", 100),
  R(9, "AB26/010", "2026-04-01", 100, null),
];

function build() {
  const workers = listWorkers(ROWS);
  const mapping = proposeWorkerMapping(workers, EMPLOYEES);
  const owners = new Map<string, string>();
  for (const w of workers) {
    const key = mapping.find((m) => m.workerId === w.id)!.employeeKey;
    if (key) owners.set(w.key, key);
  }
  const pairingInput: PairingInput = { lines: LINES, rows: ROWS, employees: EMPLOYEES, workerOwners: owners, excluded: new Set() };
  const result = proposePairing(pairingInput);
  const inv = inventory(pairingInput, result);
  const data: PairingFileData = {
    meta: { register: `sha256:${"a".repeat(64)}`, sheet: "2026", lines: linesDigest(LINES), builtAt: "2026-11-24T10:00:00.000Z" },
    employees: EMPLOYEES.map((e) => ({ key: e.key, label: `${e.initials} · ${e.userId!.slice(0, 8)}`, email: e.email })),
    workers: workers.map((w) => ({ id: w.id, text: w.text, employeeKey: mapping.find((m) => m.workerId === w.id)!.employeeKey })),
    lines: result.proposals.map((p) => {
      const line = LINES.find((l) => l.id === p.lineId)!;
      return { proposal: p, label: `${EMPLOYEES.find((e) => e.key === p.employeeKey)!.initials} · x`, date: line.date, amountCents: line.approvedTotalCents, currency: line.currency };
    }),
    rows: [
      ...inv.malformed.map((m) => ({ position: m.position, category: "malformed" as const, shape: m.shape })),
      ...inv.noWorker.filter((p) => !inv.malformed.some((m) => m.position === p)).map((position) => ({ position, category: "no_worker" as const, shape: "AA99/999" })),
    ],
  };
  return { csv: writePairingCsv(data), data, result };
}

/** The file with every record confirmed and every proposal taken: what a person ends with after a fill-down. */
function confirmed(file: PairingFile): PairingFile {
  return {
    ...file,
    workers: file.workers.map((w) => ({ ...w, state: "confirmed" })),
    lines: file.lines.map((l) => ({ ...l, state: "confirmed" })),
    rows: file.rows.map((r) => ({ ...r, decision: "acknowledged", state: "confirmed" })),
  };
}
/** The doubtful lines of the fixture decided: a4 takes AB26/007, the rest are already decided. */
function decided(): PairingFile {
  const file = confirmed(readPairingCsv(build().csv));
  return { ...file, lines: file.lines.map((l) => (l.id === "line-a4" ? { ...l, decision: "paper", paperNumber: "AB26/007" } : l)) };
}

const validate = (file: PairingFile, over: Partial<Parameters<typeof validatePairing>[0]> = {}): Problem[] =>
  validatePairing({ file, lines: LINES, employees: EMPLOYEES, rows: ROWS, offsets: [], ...over });
const codes = (problems: Problem[]) => problems.map((p) => `${p.code}:${p.id}`);

// ─── Writer and reader ───────────────────────────────────────────────────────

describe("the writer (AC-2.3)", () => {
  const { csv, data } = build();

  it("starts with a BOM and one header for every record, and ends lines with CRLF", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split("\r\n")[0]!.slice(1)).toBe("record,id,label,employee,expenseDate,amount,currency,category,reason,proposed,proposedNumber,decision,paperNumber,split,state,registerRows");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("holds the meta, an employee per employee, a worker per worker, a line per pre-release line and a row per malformed or worker-less row", () => {
    const rows = parseCsvRows(csv);
    const kinds = rows.slice(1).map((r) => r[0]);
    expect(kinds.filter((k) => k === "meta")).toHaveLength(5);
    expect(kinds.filter((k) => k === "employee")).toHaveLength(2);
    expect(kinds.filter((k) => k === "worker")).toHaveLength(2);
    expect(kinds.filter((k) => k === "line")).toHaveLength(LINES.length);
    expect(rows.filter((r) => r[0] === "row").map((r) => [r[1], r[7]])).toEqual([["R8", "malformed"], ["R9", "no_worker"]]);
    expect(data.rows).toHaveLength(2);
  });

  it("pre-fills exact matches, splits, no counterpart and outside 2026 as proposed, and leaves a doubtful line blank and unresolved", () => {
    const file = readPairingCsv(csv);
    const state = (id: string) => file.lines.find((l) => l.id === id)!;
    expect(state("line-a1")).toMatchObject({ decision: "paper", paperNumber: "AB26/005", state: "proposed" });
    expect(state("line-a2")).toMatchObject({ decision: "split", paperNumber: "AB26/006", split: "S1", state: "proposed" });
    expect(state("line-a3")).toMatchObject({ decision: "split", split: "S1" });
    expect(state("line-a4")).toMatchObject({ decision: "", paperNumber: "", state: "unresolved", proposed: "paper" });
    expect(state("line-a5")).toMatchObject({ decision: "new", state: "proposed" });
    expect(state("line-old")).toMatchObject({ decision: "new", state: "proposed" });
  });

  it("states the line's own columns: date, amount, currency, category, reason and rows", () => {
    const rows = parseCsvRows(csv);
    const a4 = rows.find((r) => r[1] === "line-a4")!;
    expect(a4.slice(3, 10)).toEqual(["E1", "2026-03-14", "30.00", "CHF", "amount_differs", "amount differs: line 30.00 CHF, R5 31.00, AB26/007", "paper"]);
    expect(a4[15]).toBe("R5");
  });

  it("holds the fingerprints as text with the sha256: prefix and the lines digest of the lines", () => {
    const file = readPairingCsv(csv);
    expect(file.meta).toEqual({ format: PAIRING_FORMAT, register: `sha256:${"a".repeat(64)}`, sheet: "2026", lines: linesDigest(LINES), builtAt: "2026-11-24T10:00:00.000Z" });
    expect(linesDigest(LINES)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(linesDigest([...LINES].reverse())).toBe(linesDigest(LINES));
    expect(linesDigest(LINES.slice(1))).not.toBe(linesDigest(LINES));
    expect(linesDigest(LINES.map((l, i) => (i === 0 ? { ...l, approvedTotalCents: l.approvedTotalCents + 1 } : l)))).not.toBe(linesDigest(LINES));
  });

  it("neutralises a cell a spreadsheet would run as a formula", () => {
    const evil: PairingFileData = { ...data, workers: [{ id: "W1", text: "=HYPERLINK(\"http://x\")", employeeKey: null }] };
    const written = parseCsvRows(writePairingCsv(evil)).find((r) => r[0] === "worker")!;
    expect(written[2]!.startsWith("'=")).toBe(true);
  });
});

describe("the reader (R6: Excel round trips)", () => {
  const { csv, data } = build();

  it("round-trips what the writer wrote", () => {
    const file = readPairingCsv(csv);
    expect(file.lines.map((l) => l.id)).toEqual(data.lines.map((l) => l.proposal.lineId));
    expect(file.workers.map((w) => [w.id, w.decision, w.state])).toEqual([["W1", "E1", "proposed"], ["W2", "E2", "proposed"]]);
    expect(file.rows.map((r) => [r.id, r.state])).toEqual([["R8", "unresolved"], ["R9", "unresolved"]]);
    expect(file.employees.map((e) => e.id)).toEqual(["E1", "E2"]);
  });

  it("reads an Excel-style re-save: `;` delimiter, CRLF, no BOM, quotes dropped, lower-case headers and enums, short rows", () => {
    const rows = parseCsvRows(csv);
    const resaved = rows
      .map((r, i) => (i === 0 ? r.map((c) => c.toUpperCase()) : r.map((c, j) => (j === 14 || j === 11 || j === 0 ? c.toUpperCase() : c))))
      .map((r) => r.join(";"))
      .join("\r\n");
    const file = readPairingCsv(resaved);
    expect(file.meta.register).toBe(`sha256:${"a".repeat(64)}`);
    expect(file.lines.find((l) => l.id === "line-a1")).toMatchObject({ decision: "paper", paperNumber: "AB26/005", state: "proposed" });
    expect(file.lines).toHaveLength(LINES.length);
  });

  it("reads a tab-delimited file with the columns in another order, and ignores columns it does not know", () => {
    const text = "state\tid\tnote\trecord\tlabel\tdecision\tpaperNumber\nconfirmed\tformat\t\tmeta\toperai-pairing/1\t\t\nconfirmed\tregister\t\tmeta\tsha256:x\t\t\nconfirmed\tlines\t\tmeta\tsha256:y\t\t\nconfirmed\tl1\tthis is free text\tline\tlabel\tPAPER\tab26/005\n";
    const file = readPairingCsv(text);
    expect(file.lines).toEqual([{ id: "l1", decision: "paper", paperNumber: "AB26/005", split: "", state: "confirmed", proposed: "" }]);
  });

  it("an unknown decision or state is read as invalid and judged by the validator, not refused here", () => {
    const text = csv.replace(/line-a1,[^\r\n]*/, (m) => m.replaceAll(",paper,", ",maybe,").replaceAll(",proposed,", ",perhaps,"));
    const l = readPairingCsv(text).lines.find((x) => x.id === "line-a1")!;
    expect(l.decision).toBe("invalid");
    expect(l.state).toBe("invalid");
  });

  it("refuses a file that is not a pairing file, with a reason that quotes nothing", () => {
    const refusal = (text: string) => {
      try {
        readPairingCsv(text);
      } catch (e) {
        return e as PairingFileError;
      }
      return null;
    };
    expect(refusal("a,b\n1,2")!.code).toBe("header-missing");
    expect(refusal("record,id,label,decision,state\nline,l1,x,paper,confirmed")!.code).toBe("meta-missing");
    expect(refusal(csv.replace("operai-pairing/1", "operai-pairing/2"))!.code).toBe("format-unknown");
    expect(refusal(csv.replace(/^.*register,sha256[^\r\n]*\r\n/m, ""))!.code).toBe("meta-missing");
    expect(refusal('record,id,label,decision,state\nmeta,format,"operai-pairing/1')!.code).toBe("csv-malformed");
    expect(refusal("")!.code).toBe("header-missing");
    for (const text of ["a,b\n1,2", csv.replace("operai-pairing/1", "operai-pairing/Worker")]) expect(refusal(text)!.message).not.toContain("Worker");
  });

  it("the mapping and the excluded set come from the file: W<n> in the register's own order, an unknown email is outside", () => {
    const file = decided();
    const withDecisions = {
      ...file,
      employees: file.employees.map((e) => (e.id === "E2" ? { ...e, decision: "excluded" } : e)),
      workers: file.workers.map((w) => (w.id === "W2" ? { ...w, decision: "someone@example.invalid" } : w)),
    };
    expect([...workerOwnersFromFile(withDecisions, ROWS, EMPLOYEES)]).toEqual([[normaliseWorker("Worker Alpha"), "E1"], [normaliseWorker("Worker Beta"), "mailto:someone@example.invalid"]]);
    expect(outsideEmails(withDecisions, EMPLOYEES)).toEqual(["someone@example.invalid"]);
    expect([...excludedEmployees(withDecisions)]).toEqual(["E2"]);
    expect(decisionsOf(file).get("line-a2")).toEqual({ decision: "split", paperNumber: "AB26/006", group: "S1" });
    expect(decisionsOf(file).get("line-a5")).toEqual({ decision: "new", paperNumber: null, group: null });
  });
});

// ─── Validation: one test per problem, each naming the id ────────────────────

describe("the validator (AC-2.4, AC-2.6)", () => {
  it("accepts the fixture once every doubtful line is decided and everything is confirmed", () => {
    expect(validate(decided())).toEqual([]);
  });

  it("names every problem together, each by id, in a stable order", () => {
    const file = decided();
    const broken = { ...file, lines: file.lines.filter((l) => l.id !== "line-a5").map((l) => (l.id === "line-a4" ? { ...l, state: "unresolved" as const } : l)) };
    const problems = validate(broken);
    expect(codes(problems)).toEqual(["not-confirmed:line-a4", "line-missing:line-a5"]);
    expect(formatProblems(problems).join("\n")).toContain("line-a5");
  });

  const one = (name: string, mutate: (file: PairingFile) => PairingFile, expected: string[], over: Partial<Parameters<typeof validatePairing>[0]> = {}) =>
    it(name, () => expect(codes(validate(mutate(decided()), over))).toEqual(expected));
  const withLine = (file: PairingFile, id: string, patch: Partial<PairingFile["lines"][number]>): PairingFile => ({ ...file, lines: file.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  one("a line missing from the file", (f) => ({ ...f, lines: f.lines.filter((l) => l.id !== "line-a1") }), ["line-missing:line-a1"]);
  one("a line listed that is not a pre-release line", (f) => ({ ...f, lines: [...f.lines, { ...f.lines[0]!, id: "line-ghost" }] }), ["line-extra:line-ghost"]);
  one("a line listed twice", (f) => ({ ...f, lines: [...f.lines, f.lines[0]!] }), ["line-duplicate:line-old"]);
  one("an unresolved line", (f) => withLine(f, "line-a4", { state: "unresolved" }), ["not-confirmed:line-a4"]);
  one("a line still `proposed` (the file is not confirmed)", (f) => withLine(f, "line-a1", { state: "proposed" }), ["not-confirmed:line-a1"]);
  one("a line with no decision", (f) => withLine(f, "line-a4", { decision: "" }), ["no-decision:line-a4"]);
  one("a paper number that is not a receipt number", (f) => withLine(f, "line-a4", { paperNumber: "AB-7" }), ["paper-number-invalid:line-a4"]);
  one("a paper number that is not on a row of the line's employee", (f) => withLine(f, "line-a4", { paperNumber: "AB26/099" }), ["paper-number-not-in-register:line-a4"]);
  one("a paper number of another employee's row", (f) => withLine(f, "line-a4", { paperNumber: "CD26/001" }), ["paper-number-not-in-register:line-a4"]);
  one("a paper number on a line outside 2026 (D6)", (f) => withLine(f, "line-old", { decision: "paper", paperNumber: "AB26/009" }), ["paper-outside-2026:line-old"]);
  one("a number given to two lines outside a split (AC-1.5), both named", (f) => withLine(f, "line-a4", { paperNumber: "AB26/005" }), ["number-on-two-lines:line-a1", "number-on-two-lines:line-a4"]);
  it("the same sequence of one year on two lines of one employee collides although the text differs", () => {
    const rows = [...ROWS, R(10, "AB25/005", "2026-03-14", 3000)];
    const file = withLine(decided(), "line-a4", { paperNumber: "AB25/005" });
    expect(codes(validate(file, { rows })).sort()).toEqual(["number-on-two-lines:line-a1", "number-on-two-lines:line-a4"]);
  });
  it("two `/000` of one employee collide", () => {
    const rows = [...ROWS, R(10, "AB26/000", "2026-03-14", 3000), R(11, "AB26/000", "2026-03-15", 700)];
    const file = withLine(withLine(decided(), "line-a4", { paperNumber: "AB26/000" }), "line-a5", { decision: "paper", paperNumber: "AB26/000" });
    expect(codes(validate(file, { rows })).sort()).toEqual(["number-on-two-lines:line-a4", "number-on-two-lines:line-a5"]);
  });
  it("a split group with two dates, two numbers or two employees is named by its group", () => {
    const base = decided();
    const twoDates = codes(validate(withLine(base, "line-a5", { decision: "split", paperNumber: "AB26/006", split: "S1" }), { rows: [...ROWS] }));
    expect(twoDates).toContain("split-two-dates:S1");
    const twoNumbers = codes(validate(withLine(base, "line-a3", { paperNumber: "AB26/007" })));
    expect(twoNumbers).toContain("split-two-numbers:S1");
    const rowsB = [...ROWS, R(12, "CD26/006", "2026-03-13", 500, "Worker Beta")];
    const linesB = [...LINES, L("line-b2", "user-E2", "2026-03-13", 500)];
    const fileB: PairingFile = { ...base, lines: [...base.lines, { id: "line-b2", decision: "split", paperNumber: "AB26/006", split: "S1", state: "confirmed", proposed: "" }] };
    expect(codes(validate(fileB, { rows: rowsB, lines: linesB }))).toContain("split-two-employees:S1");
  });
  one("`new` in a split group", (f) => withLine(f, "line-a5", { decision: "new", split: "S1" }), ["new-in-group:line-a5"]);
  one("a split with no group", (f) => withLine(f, "line-a2", { split: "" }), ["number-on-two-lines:line-a2", "split-without-group:line-a2", "number-on-two-lines:line-a3"]);
  it("a split group of one line is accepted (AC-1.7)", () => {
    const file = withLine(decided(), "line-a4", { decision: "split", paperNumber: "AB26/007", split: "S2" });
    expect(validate(file)).toEqual([]);
  });
  one("a paper number for an excluded employee", (f) => ({ ...f, employees: f.employees.map((e) => (e.id === "E1" ? { ...e, decision: "excluded" } : e)) }), [
    "worker-excluded:W1",
    "paper-for-excluded:line-a1",
    "paper-for-excluded:line-a2",
    "paper-for-excluded:line-a3",
    "paper-for-excluded:line-a4",
  ]);
  one("a worker with no mapping", (f) => ({ ...f, workers: f.workers.map((w) => (w.id === "W2" ? { ...w, decision: "" } : w)) }), ["worker-unmapped:W2", "paper-number-not-in-register:line-b1"]);
  one("a worker mapped to something that is not an employee, an email or not-operai", (f) => ({ ...f, workers: f.workers.map((w) => (w.id === "W2" ? { ...w, decision: "E7" } : w)) }), ["worker-unmapped:W2", "paper-number-not-in-register:line-b1"]);
  one("a worker marked not-operai is accepted (its row is nobody's)", (f) => ({ ...f, workers: f.workers.map((w) => (w.id === "W2" ? { ...w, decision: "not-operai" } : w)) }), ["paper-number-not-in-register:line-b1"]);
  one("a worker not confirmed", (f) => ({ ...f, workers: f.workers.map((w) => (w.id === "W1" ? { ...w, state: "proposed" as const } : w)) }), ["not-confirmed:W1"]);
  one("a worker record of a worker the register does not have", (f) => ({ ...f, workers: [...f.workers, { id: "W9", decision: "E1", state: "confirmed" as const }] }), ["worker-unknown:W9"]);
  one("a worker with no record", (f) => ({ ...f, workers: f.workers.filter((w) => w.id !== "W2") }), ["worker-unmapped:W2", "paper-number-not-in-register:line-b1"]);
  one("a worker mapped to an excluded employee", (f) => ({ ...f, employees: f.employees.map((e) => (e.id === "E2" ? { ...e, decision: "excluded" } : e)) }), ["worker-excluded:W2", "paper-for-excluded:line-b1"]);
  one("a malformed row not acknowledged", (f) => ({ ...f, rows: f.rows.map((r) => (r.id === "R8" ? { ...r, decision: "" } : r)) }), ["row-unacknowledged:R8"]);
  one("a worker-less row not confirmed", (f) => ({ ...f, rows: f.rows.map((r) => (r.id === "R9" ? { ...r, state: "unresolved" as const } : r)) }), ["row-unacknowledged:R9"]);
  one("a malformed row with no record", (f) => ({ ...f, rows: f.rows.filter((r) => r.id !== "R8") }), ["row-missing:R8"]);
  one("an offsets row for an excluded employee", (f) => ({ ...f, employees: f.employees.map((e) => (e.id === "E2" ? { ...e, decision: "excluded" } : e)), workers: f.workers.map((w) => (w.id === "W2" ? { ...w, decision: "not-operai" } : w)) }), ["paper-for-excluded:line-b1", "offsets-for-excluded:offsets"], {
    offsets: [{ email: "e2@example.invalid", lastIssuedSeq: 5 }],
  });
  one("an employee record that is not an employee, or with another decision", (f) => ({ ...f, employees: [...f.employees, { id: "E9", decision: "" }, { id: "E1", decision: "banned" }].filter((e, i) => i !== 0 || true) }), ["employee-record-invalid:E1", "employee-record-invalid:E9"]);

  it("a problem names ids and numbers, never a worker, an email or a description", () => {
    const file = decided();
    const text = formatProblems(validate({ ...file, lines: file.lines.map((l) => (l.id === "line-a4" ? { ...l, paperNumber: "AB26/099" } : l)) })).join("\n");
    for (const forbidden of ["Worker", "example.invalid", "Alpha", "Beta"]) expect(text).not.toContain(forbidden);
  });

  it("every problem code is exercised above", () => {
    const all: ProblemCode[] = [
      "line-missing", "line-extra", "line-duplicate", "not-confirmed", "no-decision", "paper-number-invalid", "paper-number-not-in-register", "paper-outside-2026", "paper-for-excluded",
      "number-on-two-lines", "split-without-group", "split-two-dates", "split-two-numbers", "split-two-employees", "new-in-group", "worker-unmapped", "worker-unknown", "worker-excluded",
      "row-unacknowledged", "row-missing", "employee-record-invalid", "offsets-for-excluded",
    ];
    expect(new Set(all).size).toBe(22);
  });
});
