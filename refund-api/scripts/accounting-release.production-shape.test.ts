/**
 * The release on the SHAPE of production, end to end, in process (T14, specs/20261124-receipt-numbers-from-the-register; plan § Test
 * strategy, Fixtures; AC-1.2, AC-1.17, AC-1.18, AC-5.1, AC-5.3, AC-5.7).
 *
 * Production on 2026-11-24, as the owner read it: 88 WellD CH lines of 9 employees approved or paid before the release, 77 of them
 * matching a register row exactly, 8 matching the date with another amount, 3 matching nothing. Reproduced synthetically (no real name,
 * number or amount): 9 employees with two `LC` and two `FR` among them, all four with a receipt code; a `FR26/002` split receipt; a
 * `LG25/001`-`LG25/007` then `LG26/008` run of wrong-year numbers; one `..26/000`; statement rows with no date and no number; and a
 * test account excluded from the register with a code of its own.
 *
 * Then: propose, decide in code, check, run, and every pre-release line holds exactly one number; no number equals another of the
 * same employee and year outside the split; the new numbers continue after the register; and a rerun does nothing.
 *
 * The register's worker texts are the employees' names IN CAPITALS, so a scan of every table of the database for the capitals finds
 * register content if the release ever stored any (an employee's own name is stored in Refund, in its usual case).
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { writeXlsx, type XlsxCell, type XlsxSpec } from "../src/accounting/xlsx";
import { dateSerial, REGISTER_HEADERS } from "../src/test-support/registerWorkbook";
import { truncateRefundTables } from "../src/test-support/dbCleanup";
import { setupTestAuth } from "../src/test-support/testAuth";

process.env["ALLOWED_ORIGINS"] = "http://localhost:5173";
process.env["AUTH_JWKS_URL"] = "http://localhost:3001/auth/jwks";
process.env["AUTH_ISSUER"] = "http://localhost:3001";
process.env["AUTH_BASE_URL"] = "http://localhost:3001";
process.env["AUTH_AUDIENCE"] = "operai-suite";
process.env["NODE_ENV"] = "test";
process.env["NOTIFY_INTERNAL_URL"] = "http://localhost:8081";
process.env["ACCOUNTING_INTERNAL_URL"] = "http://localhost:8089";
process.env["SERVICE_CLIENT_ID"] = "refund-api";
process.env["SERVICE_CLIENT_SECRET"] = "test-service-client-secret-at-least-32-characters";

const harness = setupTestAuth();
await harness.init();

const { db } = await import("../src/lib/db");
const { createFakeAccounting, restoreAccounting } = await import("../src/test-support/fakeAccounting");
const { decideLines, editPairing, pairingRecords } = await import("../src/test-support/releaseRun");
const { formatReport, parseDefaults, runAccountingRelease } = await import("./accounting-release");

const NOW = new Date("2026-11-24T08:00:00.000Z");
let fake = createFakeAccounting().setAccount("5901", "Spese viaggi in treno");
const ports = () => ({
  now: () => NOW,
  accounting: { begin: (name: Parameters<typeof fake.begin>[0]) => fake.begin(name) },
  ownerNames: { async lookup() { return { state: "gone" } as const; } },
  defaults: parseDefaults({ typeDefaults: { travel_train: { ledgerAccount: "5901" } } }),
});

beforeEach(async () => {
  await truncateRefundTables({ released: false });
  fake = createFakeAccounting().setAccount("5901", "Spese viaggi in treno");
});
afterAll(async () => {
  restoreAccounting();
  await truncateRefundTables({ released: false });
});

// ─── The nine employees ──────────────────────────────────────────────────────

interface Employee {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The receipt code in force at the release, if any. */
  readonly code?: string;
  /** How many pre-release lines, and how each one's register row looks. */
  readonly lines: number;
  readonly prefix: string;
  readonly kind?: "plain" | "amount-differs" | "wrong-year" | "split" | "zero" | "test";
}

const EMPLOYEES: readonly Employee[] = [
  { id: "u-lena", name: "Lena Cross", email: "lena.cross@example.invalid", code: "LCM", lines: 12, prefix: "LC" }, // LC
  { id: "u-lars", name: "Lars Cole", email: "lars.cole@example.invalid", code: "LCP", lines: 11, prefix: "LC" }, // LC again
  { id: "u-frida", name: "Frida Rowe", email: "frida.rowe@example.invalid", code: "FRO", lines: 10, prefix: "FR", kind: "split" }, // FR
  { id: "u-felix", name: "Felix Reed", email: "felix.reed@example.invalid", code: "FRI", lines: 9, prefix: "FR" }, // FR again
  { id: "u-gina", name: "Gina Moss", email: "gina.moss@example.invalid", lines: 8, prefix: "LG", kind: "wrong-year" }, // GM, writes LG
  { id: "u-hugo", name: "Hugo Nash", email: "hugo.nash@example.invalid", lines: 10, prefix: "HN", kind: "zero" },
  { id: "u-ines", name: "Ines Ortiz", email: "ines.ortiz@example.invalid", lines: 8, prefix: "IO", kind: "amount-differs" },
  { id: "u-joel", name: "Joel Park", email: "joel.park@example.invalid", lines: 17, prefix: "JP" },
  { id: "u-test", name: "Test Account", email: "test.account@example.invalid", code: "TST", lines: 3, prefix: "TA", kind: "test" },
];

const pad = (n: number) => String(n).padStart(3, "0");
const dayOf = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const cents = (employeeIndex: number, lineIndex: number) => 1000 + employeeIndex * 100 + lineIndex * 7;
const decimal = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

interface RegisterRow {
  worker: string;
  number: string;
  date: string | null;
  total: string;
}

interface World {
  readonly rows: RegisterRow[];
  readonly lineIds: string[];
}

async function buildWorld(): Promise<World> {
  const rows: RegisterRow[] = [];
  const lineIds: string[] = [];
  for (const [e, employee] of EMPLOYEES.entries()) {
    const request = await db.refundRequest.create({
      data: { ownerUserId: employee.id, ownerEmail: employee.email, ownerName: employee.name, status: e % 2 === 0 ? "approved" : "paid", submittedAt: new Date("2026-03-01") },
    });
    if (employee.code) {
      await db.receiptCode.create({ data: { ownerUserId: employee.id, code: employee.code, updatedByUserId: "admin-1", updatedByEmail: "admin@example.invalid", updatedAt: new Date() } });
    }
    for (let i = 1; i <= employee.lines; i++) {
      const id = `${employee.id}-l${pad(i)}`;
      // Frida's lines 2 and 3 are one receipt entered twice (one number, two VAT codes): the same date.
      const splitPair = employee.kind === "split" && (i === 2 || i === 3);
      const date = splitPair ? dayOf(e * 40 + 2) : dayOf(e * 40 + i);
      const lineCents = cents(e, i);
      await db.refundLine.create({
        data: {
          id,
          requestId: request.id,
          date: new Date(date),
          type: "travel_train",
          motivo: `Description of ${id}`,
          entity: "welld_ch",
          currency: "CHF",
          requestedAmountCents: lineCents,
          approvedTotalCents: lineCents,
        },
      });
      lineIds.push(id);
      if (employee.kind === "test") continue; // matches nothing
      const worker = employee.name.toUpperCase();
      let number = `${employee.prefix}26/${pad(i)}`;
      let total = lineCents;
      if (employee.kind === "wrong-year") number = i <= 7 ? `LG25/${pad(i)}` : "LG26/008";
      if (employee.kind === "zero") number = i === 1 ? "HN26/000" : `HN26/${pad(i - 1)}`;
      if (employee.kind === "amount-differs") total = lineCents + 100;
      if (employee.kind === "split") number = i <= 2 ? `FR26/${pad(i === 1 ? 1 : 2)}` : i === 3 ? "FR26/002" : `FR26/${pad(i - 1)}`;
      rows.push({ worker, number, date, total: decimal(total) });
    }
  }
  // Monthly statement rows (motorway, telematics): a worker and a total, no number and no expense date.
  for (const employee of [EMPLOYEES[7]!, EMPLOYEES[0]!, EMPLOYEES[5]!, EMPLOYEES[7]!]) rows.push({ worker: employee.name.toUpperCase(), number: "", date: null, total: "55.00" });
  // An unrelated row nobody has a line for (a worker who is not in Refund at all).
  rows.push({ worker: "SOMEONE WHO LEFT", number: "SL26/044", date: "2026-02-02", total: "3.00" });
  return { rows, lineIds };
}

function workbookOf(rows: readonly RegisterRow[]): Uint8Array {
  const text = (value: string, style = 1): XlsxCell => (value === "" ? { kind: "empty", style: 0 } : { kind: "text", value, style });
  const spec: XlsxSpec = {
    sheetName: "2026",
    numFmts: { 164: "yyyy\\-mm\\-dd;@" },
    styles: [{ numFmtId: 0 }, { numFmtId: 49, quotePrefix: true }, { numFmtId: 164 }, { numFmtId: 2 }, { numFmtId: 49, bold: true, quotePrefix: true }],
    columnWidths: [24, 14, 12, 12],
    rows: [
      REGISTER_HEADERS.map((header): XlsxCell => ({ kind: "text", value: header, style: 4 })),
      ...rows.map((row): XlsxCell[] => [
        text(row.worker),
        text(row.number),
        row.date === null ? { kind: "empty", style: 0 } : { kind: "number", value: String(dateSerial(row.date)), style: 2 },
        { kind: "number", value: row.total, style: 3 },
      ]),
    ],
  };
  return writeXlsx(spec);
}

const line = (id: string) => db.refundLine.findUniqueOrThrow({ where: { id } });
const numbersOf = async (ids: readonly string[]) => Promise.all(ids.map(async (id) => (await line(id)).receiptNumber));

async function snapshot() {
  return JSON.stringify({
    lines: await db.refundLine.findMany({ orderBy: { id: "asc" }, select: { id: true, receiptNumber: true, receiptOrigin: true, receiptSplitPart: true } }),
    counters: await db.receiptCounter.findMany({ orderBy: [{ ownerUserId: "asc" }, { year: "asc" }] }),
    baseline: await db.receiptNumberBaseline.findMany({ orderBy: { emailKey: "asc" } }),
    settings: await db.refundSetting.count(),
    audit: await db.refundAuditEntry.count(),
    defaults: await db.expenseTypeAccountingDefault.count(),
  });
}

/** Every row of every table of the database, as JSON text: for the scan of what the release may have stored. */
async function everyTableAsText(): Promise<string> {
  const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`);
  const parts: string[] = [];
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) continue;
    const rows = await db.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM "${tablename}" t`);
    parts.push(...rows.map((r) => r.j));
  }
  return parts.join("\n");
}

/** What a person decides in the proposed file: the doubtful lines, the test account excluded, the worker who left marked not-operai. */
function decideProduction(csv: string): string {
  const decisions: Record<string, { decision: "paper" | "new" | "split"; paperNumber?: string }> = {};
  for (let i = 1; i <= 7; i++) decisions[`u-gina-l${pad(i)}`] = { decision: "paper", paperNumber: `LG25/${pad(i)}` }; // wrong-year, as written
  decisions["u-hugo-l001"] = { decision: "new" }; // the `/000` takes a new number
  for (let i = 1; i <= 8; i++) {
    decisions[`u-ines-l${pad(i)}`] = i % 2 === 1 ? { decision: "paper", paperNumber: `IO26/${pad(i)}` } : { decision: "new" }; // four paper, four new
  }
  const decided = decideLines(
    editPairing(csv, (r) => {
      if (r["record"] === "employee" && r["id"] === "E9") r["decision"] = "excluded"; // the test account (by user id, u-test is the ninth)
    }),
    decisions,
  );
  return editPairing(decided, (r) => {
    if (r["record"] === "worker" && r["decision"] === "") r["decision"] = "not-operai";
  });
}

// ─── The run ─────────────────────────────────────────────────────────────────

describe("the synthetic production shape, end to end", () => {
  it("88 lines of 9 employees: propose reads the shape, a person decides it, the check and the real run agree, every line holds one number, and a rerun does nothing", async () => {
    const world = await buildWorld();
    expect(world.lineIds).toHaveLength(88);
    const register = workbookOf(world.rows);

    // ── PROPOSE ──
    const proposed = await runAccountingRelease({ ...ports(), dryRun: true, propose: true, register });
    const p = proposed.pairing!;
    expect(p.lineCount).toBe(88);
    expect(p.linesByCategory).toMatchObject({
      exact: 67, // 77 matches, less the 7 wrong-year numbers, the `/000` and the 2 lines of the split
      split_receipt: 2,
      amount_differs: 8,
      wrong_year: 7,
      sequence_000: 1,
      no_counterpart: 3,
      several_candidates: 0,
      number_taken: 0,
      prefix_differs: 0,
      outside_2026: 0,
      row_without_number: 0,
    });
    expect(p.splitGroups).toBe(1);
    expect(p.openDecisions).toBe(16); // 8 amount differs, 7 wrong year, the `/000`
    expect(p.rows).toMatchObject({ withoutNumber: 4, malformed: [], noWorker: [], unmappedWorkers: 1 }); // the 4 statement rows; the worker who left
    expect(p.employees.filter((e) => e.needsCode)).toEqual([]); // the four shared initials all hold a code
    expect(proposed.itLinesLeftUnnumbered).toBe(0);
    const csv = proposed.pairingCsv!;
    expect(pairingRecords(csv).filter((r) => r["record"] === "line")).toHaveLength(88);
    expect(await db.refundSetting.count()).toBe(0); // the propose wrote nothing

    // ── DECIDE, in code ──
    const final = decideProduction(csv);

    // ── CHECK ──
    const before = await snapshot();
    const dry = await runAccountingRelease({ ...ports(), dryRun: true, register, pairing: final });
    expect(await snapshot()).toEqual(before);
    expect(dry.lines).toHaveLength(88);

    // ── RUN ──
    const run = await runAccountingRelease({ ...ports(), register, pairing: final });
    expect(run.markerWritten).toBe(true);
    expect(run.lines.map((l) => [l.lineId, l.receiptNumber])).toEqual(dry.lines.map((l) => [l.lineId, l.receiptNumber])); // AC-5.5

    // Every pre-release line holds exactly one number (AC-1.2).
    const numbers = await numbersOf(world.lineIds);
    expect(numbers.every((n) => n !== null)).toBe(true);
    // No two numbers of one employee and year are equal, except the lines of the one split receipt (AC-1.18).
    const numbered = await db.refundLine.findMany({ where: { receiptNumber: { not: null } }, select: { id: true, receiptOwnerUserId: true, receiptYear: true, receiptSeq: true, receiptNumber: true, receiptOrigin: true } });
    const seen = new Map<string, string[]>();
    for (const n of numbered) seen.set(`${n.receiptOwnerUserId}|${n.receiptYear}|${n.receiptSeq}`, [...(seen.get(`${n.receiptOwnerUserId}|${n.receiptYear}|${n.receiptSeq}`) ?? []), n.id]);
    expect([...seen.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => [key, ids.length])).toEqual([["u-frida|2026|2", 2]]);
    expect(numbered.filter((n) => n.receiptOrigin === "paper_split").map((n) => n.receiptNumber)).toEqual(["FR26/002", "FR26/002"]);

    // The paper numbers as written, wherever the employee's code differs from them.
    expect(await numbersOf(["u-lena-l001", "u-lena-l012", "u-lars-l001", "u-felix-l009", "u-joel-l017"])).toEqual(["LC26/001", "LC26/012", "LC26/001", "FR26/009", "JP26/017"]);
    expect(await numbersOf(["u-frida-l001", "u-frida-l002", "u-frida-l003", "u-frida-l004"])).toEqual(["FR26/001", "FR26/002", "FR26/002", "FR26/003"]);
    expect(await numbersOf(["u-gina-l001", "u-gina-l007", "u-gina-l008"])).toEqual(["LG25/001", "LG25/007", "LG26/008"]);
    expect((await line("u-gina-l001"))).toMatchObject({ receiptYear: 2026, receiptSeq: 1, receiptOrigin: "paper" });
    // The new numbers continue after the register, with the code in force: Hugo's `/000` after HN26/009, Ines' four after IO26/008 (the
    // four she took by paper are 001, 003, 005, 007), and the excluded test account from 001 with its own code.
    expect(await numbersOf(["u-hugo-l001", "u-hugo-l002", "u-hugo-l010"])).toEqual(["HN26/010", "HN26/001", "HN26/009"]);
    expect(await numbersOf(["u-ines-l001", "u-ines-l002", "u-ines-l003", "u-ines-l004", "u-ines-l006", "u-ines-l008"])).toEqual(["IO26/001", "IO26/009", "IO26/003", "IO26/010", "IO26/011", "IO26/012"]);
    expect(await numbersOf(["u-test-l001", "u-test-l002", "u-test-l003"])).toEqual(["TST26/001", "TST26/002", "TST26/003"]);

    // The baseline rows: the register maximum per employee (the test account none, the worker who left none).
    const baseline = Object.fromEntries((await db.receiptNumberBaseline.findMany()).map((b) => [b.emailKey, b.lastIssuedSeq]));
    expect(baseline).toEqual({
      "lena.cross@example.invalid": 12,
      "lars.cole@example.invalid": 11,
      "frida.rowe@example.invalid": 9,
      "felix.reed@example.invalid": 9,
      "gina.moss@example.invalid": 8,
      "hugo.nash@example.invalid": 9,
      "ines.ortiz@example.invalid": 8,
      "joel.park@example.invalid": 17,
    });

    // The release audited its own numbers, row positions only (AC-1.17), and the capitals of the register are nowhere in the database.
    const assigned = await db.refundAuditEntry.findMany({ where: { action: "receipt_number_assigned" } });
    expect(assigned).toHaveLength(88);
    for (const a of assigned) {
      expect(Object.keys(a.detail as object).every((k) => ["cause", "receiptNumber", "year", "seq", "origin", "registerRows", "splitPart"].includes(k))).toBe(true);
      expect((a.detail as { cause: string }).cause).toBe("release");
      expect(a.actorUserId).toBe("system:accounting-release");
    }
    const dump = await everyTableAsText();
    for (const employee of EMPLOYEES) expect(dump).not.toContain(employee.name.toUpperCase());
    expect(dump).not.toContain("SOMEONE WHO LEFT");
    expect(dump).not.toContain("SL26/044"); // a paper number of a row no line took: it only feeds a maximum of nobody here
    expect(dump).not.toContain("55.00");

    // The report names employees by reference only, and never an email or a name.
    const text = formatReport(run);
    expect(text).not.toMatch(/@|Lena|Lars|Frida|Felix|Gina|Hugo|Ines|Joel|Test Account|LENA|SOMEONE/);
    expect(text).toContain("LCM · u-lena");

    // ── RERUN ──
    const after = await snapshot();
    const rerun = await runAccountingRelease({ ...ports(), register, pairing: final });
    expect(rerun.alreadyCompleted).not.toBeNull();
    expect(rerun.lines).toEqual([]);
    expect(await snapshot()).toEqual(after);
    expect(await db.refundSetting.count({ where: { key: "accounting-release-completed-at" } })).toBe(1);
  });

  it("the same shape through the check alone leaves the database as it was, and a second propose gives the same proposal (deterministic)", async () => {
    const world = await buildWorld();
    const register = workbookOf(world.rows);
    const first = await runAccountingRelease({ ...ports(), dryRun: true, propose: true, register });
    const second = await runAccountingRelease({ ...ports(), dryRun: true, propose: true, register });
    const strip = (csv: string) => csv.replace(/^.*builtAt.*$/m, "");
    expect(strip(second.pairingCsv!)).toBe(strip(first.pairingCsv!));
    expect(second.pairing).toEqual(first.pairing);
  });

  it("AC-5.7 WellD Italia lines of approved requests stay unnumbered, and the release counts them", async () => {
    const world = await buildWorld();
    const request = await db.refundRequest.findFirstOrThrow({ where: { ownerUserId: "u-joel" } });
    await db.refundLine.create({
      data: { id: "it-line", requestId: request.id, date: new Date("2026-05-05"), type: "travel_train", motivo: "m", entity: "welld_it", currency: "CHF", requestedAmountCents: 500, approvedTotalCents: 500 },
    });
    const register = workbookOf(world.rows);
    const proposed = await runAccountingRelease({ ...ports(), dryRun: true, propose: true, register });
    const run = await runAccountingRelease({ ...ports(), register, pairing: decideProduction(proposed.pairingCsv!) });
    expect(run.itLinesLeftUnnumbered).toBe(1);
    expect((await line("it-line")).receiptNumber).toBeNull();
    expect(await db.refundLine.count({ where: { entity: "welld_it", receiptNumber: { not: null } } })).toBe(0);
  });
});
