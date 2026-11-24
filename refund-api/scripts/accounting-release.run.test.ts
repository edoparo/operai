/**
 * The release, as a three-step procedure, against real Postgres (T13, specs/20261124-receipt-numbers-from-the-register; plan § Test
 * strategy: the int rows of AC-1.1 to AC-1.18, AC-2.4 to AC-2.7, AC-2.9, AC-3.1 to AC-3.6, AC-4.11, AC-4.12, AC-5.1, AC-5.2, AC-5.4,
 * AC-5.5, AC-5.7).
 *
 * Everything is synthetic: workers `Worker Alpha`, `Worker Beta`, ..., e-mails at `example.invalid`, and register workbooks built by
 * `src/test-support/registerWorkbook.ts`. Accounting and auth are fakes. A scenario is: a few employees with legacy lines, a register,
 * PROPOSE, decide the file in code, CHECK, RUN, and then read what the database holds.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ResolveResponse } from "../src/authz/resolveClient";
import { buildRegisterWorkbook, type RegisterRowInput } from "../src/test-support/registerWorkbook";
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
const { isAccountingReleased } = await import("../src/accounting/release");
const { classifyAndNumber } = await import("../src/accounting/numbering.repo");
const { createFakeAccounting, restoreAccounting, useFakeAccounting } = await import("../src/test-support/fakeAccounting");
const { __resetAuthzCacheForTests } = await import("../src/auth/authz.middleware");
// @ts-expect-error -- the query suffix is a runtime-only cache-buster (testAuth.ts, "no shared router specifier")
const { decideRouter } = (await import("../src/review/decide.routes?release-run")) as typeof import("../src/review/decide.routes");
const { decideLines, editPairing, pairingRecords, confirmAll } = await import("../src/test-support/releaseRun");
const { NotDecidedError, parseDefaults, runAccountingRelease, SharedPrefixError, StaleError } = await import("./accounting-release");

const NOW = new Date("2026-11-24T08:00:00.000Z");

let fake = createFakeAccounting().setAccount("5901", "Spese viaggi in treno");
const owners = { async lookup() { return { state: "gone" } as const; } };
const defaults = parseDefaults({ typeDefaults: { travel_train: { ledgerAccount: "5901" } } });

beforeEach(async () => {
  await truncateRefundTables({ released: false });
  fake = createFakeAccounting().setAccount("5901", "Spese viaggi in treno");
});
afterAll(async () => {
  restoreAccounting();
  await truncateRefundTables({ released: false });
});

// ─── The world ───────────────────────────────────────────────────────────────

interface L {
  id: string;
  date: string;
  cents?: number;
  createdAt?: string;
  entity?: "welld_ch" | "welld_it";
}
interface Who {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}
const ALPHA: Who = { id: "u1", name: "Worker Alpha", email: "alpha@example.invalid" };
const BETA: Who = { id: "u2", name: "Worker Beta", email: "beta@example.invalid" };
const ANDERS: Who = { id: "u3", name: "Wendy Anders", email: "anders@example.invalid" }; // initials WA, like Worker Alpha

async function request(who: Who, lines: L[], status: "approved" | "paid" | "submitted" | "draft" = "approved") {
  const r = await db.refundRequest.create({
    data: { ownerUserId: who.id, ownerEmail: who.email, ownerName: who.name, status, submittedAt: new Date("2026-03-01") },
  });
  for (const l of lines) {
    await db.refundLine.create({
      data: {
        id: l.id,
        requestId: r.id,
        date: new Date(l.date),
        type: "travel_train",
        motivo: "m",
        entity: l.entity ?? "welld_ch",
        currency: "CHF",
        requestedAmountCents: l.cents ?? 1000,
        approvedTotalCents: l.cents ?? 1000,
        ...(l.createdAt ? { createdAt: new Date(l.createdAt) } : {}),
      },
    });
  }
  return r;
}

const row = (worker: string, number: string, date: string, total: string): RegisterRowInput => ({ worker, number, date, total });
/** A register row of Worker Alpha. `total` is the line's cents as the register writes them (`24.5`). */
const alpha = (number: string, date: string, total: string) => row(ALPHA.name, number, date, total);
const beta = (number: string, date: string, total: string) => row(BETA.name, number, date, total);

const line = (id: string) => db.refundLine.findUniqueOrThrow({ where: { id } });
const numberOf = async (id: string) => (await line(id)).receiptNumber;
const released = () => db.$transaction((tx) => isAccountingReleased(tx));

const ports = () => ({ now: () => NOW, accounting: { begin: (name: Parameters<typeof fake.begin>[0]) => fake.begin(name) }, ownerNames: owners, defaults });
async function propose(rows: RegisterRowInput[], over: Parameters<typeof runAccountingRelease>[0] = {}) {
  const register = buildRegisterWorkbook(rows);
  const report = await runAccountingRelease({ ...ports(), ...over, dryRun: true, propose: true, register });
  return { register, csv: report.pairingCsv!, report };
}
const check = (register: Uint8Array, pairing: string, over: Parameters<typeof runAccountingRelease>[0] = {}) =>
  runAccountingRelease({ ...ports(), ...over, dryRun: true, register, pairing });
const real = (register: Uint8Array, pairing: string, over: Parameters<typeof runAccountingRelease>[0] = {}) =>
  runAccountingRelease({ ...ports(), ...over, register, pairing });

/** Every table the release writes, as text: equal before and after a refusal, a check and a failure. */
async function snapshot() {
  return JSON.stringify({
    defaults: await db.expenseTypeAccountingDefault.count(),
    settings: await db.refundSetting.count(),
    counters: await db.receiptCounter.findMany({ orderBy: [{ ownerUserId: "asc" }, { year: "asc" }] }),
    baseline: await db.receiptNumberBaseline.count(),
    lines: await db.refundLine.findMany({ orderBy: { id: "asc" }, select: { id: true, receiptNumber: true, receiptOrigin: true, receiptSplitPart: true, accountNumber: true } }),
    names: await db.refundRequest.findMany({ orderBy: { id: "asc" }, select: { id: true, ownerName: true } }),
    audit: await db.refundAuditEntry.count(),
  });
}
const baselineRows = () => db.receiptNumberBaseline.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const counterOf = (ownerUserId: string, year: number) => db.receiptCounter.findUnique({ where: { ownerUserId_year: { ownerUserId, year } } });
const caught = async (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => e as Error & { exit?: number; code?: string });
const code = async (prefix: string, owner: string) =>
  db.receiptCode.create({ data: { ownerUserId: owner, code: prefix, updatedByUserId: "admin-1", updatedByEmail: "admin@example.invalid", updatedAt: new Date() } });

// ─── US-1: one number per receipt, the paper one where it exists ────────────

describe("an exact match takes the paper number (AC-1.1, AC-1.2, AC-1.17)", () => {
  it("proposes it pre-filled, takes it as written once confirmed, issues nothing else for that line, and audits row positions only", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }, { id: "a2", date: "2026-03-13" }]);
    const { register, csv, report } = await propose([alpha("WA26/005", "2026-03-12", "24.5")]);
    expect(report.pairing!.linesByCategory.exact).toBe(1);
    const a1 = pairingRecords(csv).find((r) => r["id"] === "a1")!;
    expect(a1).toMatchObject({ category: "exact", proposed: "paper", proposedNumber: "WA26/005", decision: "paper", paperNumber: "WA26/005", state: "proposed" });

    // A pairing file that has not been confirmed is not enough (D3).
    expect(await caught(real(register, csv))).toBeInstanceOf(NotDecidedError);
    const confirmed = confirmAll(csv);
    const done = await real(register, confirmed);
    expect(done.markerWritten).toBe(true);

    const first = await line("a1");
    expect([first.receiptNumber, first.receiptOrigin, first.receiptSplitPart, first.receiptYear, first.receiptSeq]).toEqual(["WA26/005", "paper", 1, 2026, 5]);
    // AC-1.2: the other line took the NEXT number after the paper one; the counter moved once, for that line only.
    expect(await numberOf("a2")).toBe("WA26/006");
    expect(await counterOf("u1", 2026)).toMatchObject({ lastSeq: 6, startAfter: 5, startAfterSetBy: "baseline" });
    const assigned = await db.refundAuditEntry.findMany({ where: { action: "receipt_number_assigned" }, orderBy: { lineId: "asc" } });
    expect(assigned.map((a) => a.lineId)).toEqual(["a1", "a2"]); // one number each, none unclaimed (AC-1.2)
    expect(assigned.every((a) => a.actorUserId === "system:accounting-release")).toBe(true);
    expect(assigned[0]!.detail).toEqual({ cause: "release", receiptNumber: "WA26/005", year: 2026, seq: 5, origin: "paper", registerRows: [2] });
    expect(assigned[1]!.detail).toEqual({ cause: "release", receiptNumber: "WA26/006", year: 2026, seq: 6, origin: "new" });
  });

  it("(AC-1.17) the audit detail holds only the whitelisted keys, and no register content (no worker, no total, no description) is stored anywhere", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }, { id: "a2", date: "2026-03-14", cents: 1000 }, { id: "a3", date: "2026-03-15" }]);
    const { register, csv } = await propose([alpha("WA26/002", "2026-03-12", "24.5"), alpha("WA26/002", "2026-03-14", "10")]);
    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/002" }, a2: { decision: "new" } }));
    for (const entry of await db.refundAuditEntry.findMany({ where: { action: "receipt_number_assigned" } })) {
      const keys = Object.keys(entry.detail as object);
      expect(keys.every((k) => ["cause", "receiptNumber", "year", "seq", "origin", "registerRows", "splitPart"].includes(k))).toBe(true);
    }
    // No worker text and no register amount appears in any refund table (a full-text scan).
    const dump = JSON.stringify([
      await db.refundAuditEntry.findMany(),
      await db.refundSetting.findMany(),
      await db.receiptNumberBaseline.findMany(),
      await db.receiptCounter.findMany(),
      await db.refundLine.findMany({ select: { motivo: true, receiptNumber: true, accountName: true } }),
    ]);
    expect(dump).not.toContain("Worker");
    expect(dump).not.toContain("Alpha");
  });
});

describe("a doubtful line is taken only if the file says so (AC-1.3, AC-1.4, AC-1.5)", () => {
  it("AC-1.3 amount differs: unresolved, refused with 8 naming the line, and taken once a person confirms the paper number", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }]);
    const { register, csv } = await propose([alpha("WA26/005", "2026-03-12", "26")]);
    const a1 = pairingRecords(csv).find((r) => r["id"] === "a1")!;
    expect(a1).toMatchObject({ category: "amount_differs", decision: "", state: "unresolved", proposedNumber: "WA26/005" });
    expect(a1["reason"]).toBe("amount differs: line 24.50 CHF, R2 26.00, WA26/005");

    const before = await snapshot();
    const error = await caught(real(register, confirmAll(csv)));
    expect(error).toBeInstanceOf(NotDecidedError);
    expect((error as InstanceType<typeof NotDecidedError>).exit).toBe(8);
    expect((error as InstanceType<typeof NotDecidedError>).problems.map((p) => `${p.code}:${p.id}`)).toEqual(["no-decision:a1"]);
    expect(await snapshot()).toEqual(before);

    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/005" } }));
    expect(await numberOf("a1")).toBe("WA26/005");
  });

  it("AC-1.4 several candidates: nothing is pre-filled, both lines of a shared row are doubtful", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }, { id: "a2", date: "2026-03-12", cents: 1000 }]);
    const { csv, report } = await propose([alpha("WA26/005", "2026-03-12", "10")]);
    const records = pairingRecords(csv).filter((r) => r["record"] === "line");
    expect(records.map((r) => [r["category"], r["decision"], r["state"]])).toEqual([["several_candidates", "", "unresolved"], ["several_candidates", "", "unresolved"]]);
    expect(report.pairing!.doubtful.map((d) => d.lineId)).toEqual(["a1", "a2"]);
  });

  it("AC-1.5 a file that gives one number to two lines is refused with 8 naming both, and nothing is written", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }, { id: "a2", date: "2026-03-14", cents: 2000 }]);
    const { register, csv } = await propose([alpha("WA26/005", "2026-03-12", "10"), alpha("WA26/005", "2026-03-14", "20")]);
    expect(pairingRecords(csv).filter((r) => r["record"] === "line").map((r) => r["category"])).toEqual(["number_taken", "number_taken"]);
    const before = await snapshot();
    const decided = decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/005" }, a2: { decision: "paper", paperNumber: "WA26/005" } });
    const error = (await caught(real(register, decided))) as InstanceType<typeof NotDecidedError>;
    expect(error).toBeInstanceOf(NotDecidedError);
    expect(error.problems.map((p) => `${p.code}:${p.id}`)).toEqual(["number-on-two-lines:a1", "number-on-two-lines:a2"]);
    expect(await snapshot()).toEqual(before);
    // One of them takes it and the other a new number: allowed.
    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/005" }, a2: { decision: "new" } }));
    expect([await numberOf("a1"), await numberOf("a2")]).toEqual(["WA26/005", "WA26/006"]);
  });

  it("AC-1.5 the sequence collision LG25/003 vs LG26/003 on two 2026 lines is 'number taken' too (the unique key has no prefix)", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }, { id: "a2", date: "2026-03-14", cents: 2000 }]);
    const { register, csv } = await propose([alpha("LG25/003", "2026-03-12", "10"), alpha("LG26/003", "2026-03-14", "20")]);
    expect(pairingRecords(csv).filter((r) => r["record"] === "line").map((r) => r["category"])).toEqual(["number_taken", "number_taken"]);
    const decided = decideLines(csv, { a1: { decision: "paper", paperNumber: "LG25/003" }, a2: { decision: "paper", paperNumber: "LG26/003" } });
    const error = (await caught(real(register, decided))) as InstanceType<typeof NotDecidedError>;
    expect(error.problems.map((p) => p.code)).toEqual(["number-on-two-lines", "number-on-two-lines"]);
  });
});

describe("split receipts (AC-1.6, AC-1.7)", () => {
  it("AC-1.6 two lines, two rows, one number: both take it, as a split, parts 1 and 2, the only equal numbers of an employee and year", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }, { id: "a2", date: "2026-03-12", cents: 1500 }, { id: "a3", date: "2026-03-20" }]);
    const { register, csv } = await propose([alpha("WA26/002", "2026-03-12", "10"), alpha("WA26/002", "2026-03-12", "15")]);
    expect(pairingRecords(csv).filter((r) => r["category"] === "split_receipt").map((r) => [r["id"], r["split"], r["state"]])).toEqual([["a1", "S1", "proposed"], ["a2", "S1", "proposed"]]);
    await real(register, confirmAll(csv));
    const [a1, a2] = [await line("a1"), await line("a2")];
    expect([a1.receiptNumber, a2.receiptNumber]).toEqual(["WA26/002", "WA26/002"]);
    expect([a1.receiptOrigin, a2.receiptOrigin, a1.receiptSplitPart, a2.receiptSplitPart]).toEqual(["paper_split", "paper_split", 1, 2]);
    expect(await numberOf("a3")).toBe("WA26/003");
    const audit = await db.refundAuditEntry.findMany({ where: { action: "receipt_number_assigned", lineId: { in: ["a1", "a2"] } }, orderBy: { lineId: "asc" } });
    expect(audit.map((a) => (a.detail as { origin: string; splitPart: number; registerRows: number[] }))).toMatchObject([
      { origin: "paper_split", splitPart: 1, registerRows: [2] },
      { origin: "paper_split", splitPart: 2, registerRows: [3] },
    ]);
    // AC-1.18: within the employee and year no two numbers are equal, except the lines of the confirmed split.
    const all = (await db.refundLine.findMany({ where: { receiptOwnerUserId: "u1", receiptYear: 2026 } })).map((l) => l.receiptNumber);
    expect(all.filter((n, i) => all.indexOf(n) !== i)).toEqual(["WA26/002"]);
  });

  it("AC-1.7 one line, two rows of one number adding up to its total: the number is taken once, as a split of one line", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 3000 }]);
    const { register, csv } = await propose([alpha("WA26/002", "2026-03-12", "10"), alpha("WA26/002", "2026-03-12", "20")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "split_receipt", split: "S1", registerRows: "R2 R3" });
    await real(register, confirmAll(csv));
    const a1 = await line("a1");
    expect([a1.receiptNumber, a1.receiptOrigin, a1.receiptSplitPart]).toEqual(["WA26/002", "paper_split", 1]);
    const detail = (await db.refundAuditEntry.findFirstOrThrow({ where: { action: "receipt_number_assigned", lineId: "a1" } })).detail as Record<string, unknown>;
    expect(detail).toMatchObject({ origin: "paper_split", splitPart: 1, registerRows: [2, 3] });
  });

  it("AC-1.7 one line, two rows of two numbers: doubtful; the number not picked stays in the register and still counts toward the baseline", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 3000 }, { id: "a2", date: "2026-03-20" }]);
    const { register, csv } = await propose([alpha("WA26/002", "2026-03-12", "10"), alpha("WA26/003", "2026-03-12", "20")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "several_candidates", state: "unresolved" });
    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/002" } }));
    expect(await numberOf("a1")).toBe("WA26/002");
    expect(await numberOf("a2")).toBe("WA26/004"); // after the maximum (003), which no line took
  });

  it("a confirmed split of lines of two dates is refused with 8 naming the group", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }, { id: "a2", date: "2026-03-12", cents: 1500 }, { id: "a3", date: "2026-03-13", cents: 700 }]);
    const { register, csv } = await propose([alpha("WA26/002", "2026-03-12", "10"), alpha("WA26/002", "2026-03-12", "15"), alpha("WA26/009", "2026-03-13", "7")]);
    const broken = editPairing(confirmAll(csv), (r) => {
      if (r["id"] === "a3") Object.assign(r, { decision: "split", paperNumber: "WA26/002", split: "S1" });
    });
    const error = (await caught(real(register, broken))) as InstanceType<typeof NotDecidedError>;
    expect(error.problems.map((p) => `${p.code}:${p.id}`)).toContain("split-two-dates:S1");
    expect(await released()).toBe(false);
  });
});

describe("lines without a paper counterpart (AC-1.8, AC-1.9, AC-1.16)", () => {
  it("AC-1.8 no counterpart is proposed as new, and only taken as new once the file confirms it", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "no_counterpart", proposed: "new", decision: "new", state: "proposed" });
    const before = await snapshot();
    expect(((await caught(real(register, csv))) as InstanceType<typeof NotDecidedError>).problems.map((p) => p.code)).toEqual(["not-confirmed"]);
    expect(await snapshot()).toEqual(before);
    await real(register, confirmAll(csv));
    expect(await numberOf("a1")).toBe("WA26/001");
  });

  it("AC-1.9 and AC-3.4 a register row no line pairs with writes nothing but raises the baseline; an employee with rows and no line is covered", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    await request(BETA, []); // known to Refund, no line
    const rows = [alpha("WA26/010", "2026-02-01", "1"), alpha("WA26/012", "2026-02-02", "1"), beta("WB26/031", "2026-02-03", "1")];
    const { register, csv, report } = await propose(rows);
    expect(report.pairing!.rows.noLine).toBe(3);
    await real(register, confirmAll(csv));
    expect(await numberOf("a1")).toBe("WA26/013");
    expect((await baselineRows()).map((r) => [r.emailKey, r.lastIssuedSeq])).toEqual([["alpha@example.invalid", 12], ["beta@example.invalid", 31]]);
    expect(await db.refundLine.count({ where: { receiptNumber: { not: null } } })).toBe(1); // nothing was written for the rows
    // Beta's first line, approved later, continues after the register (AC-3.4): a WellD Italia line needs no Accounting read.
    const later = await db.refundRequest.findFirstOrThrow({ where: { ownerUserId: "u2" } });
    await db.refundLine.create({ data: { id: "b1", requestId: later.id, date: new Date("2026-06-01"), type: "travel_train", motivo: "m", entity: "welld_it", currency: "CHF", requestedAmountCents: 100, approvedTotalCents: 100 } });
    await db.$transaction((tx) =>
      classifyAndNumber(tx, { owner: { userId: "u2", name: BETA.name, email: BETA.email }, requestIds: [later.id], cause: "approval", actor: { userId: "a", email: "a@example.invalid" }, reference: null }),
    );
    expect(await numberOf("b1")).toBe("WB26/032");
  });

  it("AC-3.4 an employee with lines and no register row starts at 001 and is listed so that a wrong mapping is noticed", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { csv, report } = await propose([beta("WB26/010", "2026-02-01", "1")]);
    expect(report.pairing!.employees.find((e) => e.noMappedWorker && e.lines === 1)).toMatchObject({ baseline: 0, firstNew: "WA26/001" });
    void csv;
  });

  it("AC-1.16 a line outside 2026 is proposed new and numbered in the sequence of its own year from 001; a paper number for it is refused", async () => {
    await request(ALPHA, [{ id: "old", date: "2025-12-30" }, { id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("WA25/001", "2025-12-30", "10")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "old")).toMatchObject({ category: "outside_2026", proposed: "new", state: "proposed" });
    const wrong = decideLines(csv, { old: { decision: "paper", paperNumber: "WA25/001" } });
    expect(((await caught(real(register, wrong))) as InstanceType<typeof NotDecidedError>).problems.map((p) => p.code)).toEqual(["paper-outside-2026"]);
    await real(register, confirmAll(csv));
    expect([await numberOf("old"), await numberOf("a1")]).toEqual(["WA25/001", "WA26/001"]);
    expect(await counterOf("u1", 2025)).toMatchObject({ lastSeq: 1, startAfter: 0 });
  });
});

describe("numbers that need a decision (AC-1.10 to AC-1.13)", () => {
  it("AC-1.10 a wrong-year number is doubtful; confirmed as written it is stored with the expense year and counts toward the maximum", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }, { id: "a2", date: "2026-03-20" }]);
    const { register, csv } = await propose([alpha("LG25/003", "2026-03-12", "10")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "wrong_year", state: "unresolved", decision: "" });
    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "LG25/003" } }));
    const a1 = await line("a1");
    expect([a1.receiptNumber, a1.receiptYear, a1.receiptSeq, a1.receiptOrigin]).toEqual(["LG25/003", 2026, 3, "paper"]);
    expect(await numberOf("a2")).toBe("WA26/004");
  });

  it("AC-1.10 confirmed as a new number it takes the next number; the wrong-year row still counts (its date is in 2026)", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("LG25/003", "2026-03-12", "10")]);
    await real(register, decideLines(csv, { a1: { decision: "new" } }));
    expect(await numberOf("a1")).toBe("WA26/004");
  });

  it("AC-1.11 a sequence 000 is its own category; confirmed as written it is stored with seq 0, else a new number, and it never counts toward a maximum", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("WA26/000", "2026-03-12", "10")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "sequence_000", proposed: "new", state: "unresolved" });
    await real(register, decideLines(csv, { a1: { decision: "paper", paperNumber: "WA26/000" } }));
    const a1 = await line("a1");
    expect([a1.receiptNumber, a1.receiptSeq]).toEqual(["WA26/000", 0]);
    expect(await db.receiptNumberBaseline.count()).toBe(0);
  });

  it("AC-1.11 otherwise the line takes a new number, from 001 (the 000 counts for nothing)", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("WA26/000", "2026-03-12", "10")]);
    await real(register, decideLines(csv, { a1: { decision: "new" } }));
    expect(await numberOf("a1")).toBe("WA26/001");
  });

  it("AC-1.13 a row with no number is never taken: the line is doubtful and takes a new number once confirmed", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("", "2026-03-12", "10"), alpha("WA26/007", "2026-02-01", "1")]);
    expect(pairingRecords(csv).find((r) => r["id"] === "a1")).toMatchObject({ category: "row_without_number", proposed: "new", state: "unresolved", decision: "" });
    await real(register, decideLines(csv, { a1: { decision: "new" } }));
    expect(await numberOf("a1")).toBe("WA26/008"); // the empty row counts toward nothing
  });

  it("AC-1.13 a malformed number is listed by shape and must be acknowledged: unacknowledged is 8, acknowledged runs", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("Worker Alpha 7", "2026-03-12", "10")]);
    const rowRecord = pairingRecords(csv).find((r) => r["record"] === "row")!;
    expect(rowRecord).toMatchObject({ id: "R2", category: "malformed", label: "AAAAAA AAAAA 9", state: "unresolved" });
    expect(csv).not.toContain("Alpha 7");
    const decided = decideLines(csv, { a1: { decision: "new" } }); // its only candidate has no paper number
    const unacknowledged = editPairing(decided, (r) => {
      if (r["record"] === "row") r["decision"] = "";
    });
    const before = await snapshot();
    expect(((await caught(real(register, unacknowledged))) as InstanceType<typeof NotDecidedError>).problems.map((p) => `${p.code}:${p.id}`)).toEqual(["row-unacknowledged:R2"]);
    expect(await snapshot()).toEqual(before);
    await real(register, decided);
    expect(await numberOf("a1")).toBe("WA26/001");
  });

  it("AC-1.13 a row with a number but no worker must be acknowledged too (D14)", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([row("", "WA26/050", "2026-02-01", "1")]);
    expect(pairingRecords(csv).find((r) => r["record"] === "row")).toMatchObject({ id: "R2", category: "no_worker" });
    const unacknowledged = editPairing(confirmAll(csv), (r) => {
      if (r["record"] === "row") r["decision"] = "";
    });
    expect(((await caught(real(register, unacknowledged))) as InstanceType<typeof NotDecidedError>).problems.map((p) => p.code)).toEqual(["row-unacknowledged"]);
    await real(register, confirmAll(csv));
    expect(await released()).toBe(true);
  });
});

describe("employees (AC-1.14, AC-1.15)", () => {
  it("AC-1.14 a worker no employee matches is refused until it is mapped or marked not-operai", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv, report } = await propose([row("Worker Stranger", "ZZ26/001", "2026-03-12", "10")]);
    expect(report.pairing!.rows.unmappedWorkers).toBe(1);
    expect(pairingRecords(csv).find((r) => r["record"] === "worker")).toMatchObject({ id: "W1", employee: "", decision: "", state: "unresolved" });
    const before = await snapshot();
    expect(((await caught(real(register, confirmAll(csv)))) as InstanceType<typeof NotDecidedError>).problems.map((p) => `${p.code}:${p.id}`)).toEqual(["worker-unmapped:W1"]);
    expect(await snapshot()).toEqual(before);
    const notOperai = editPairing(confirmAll(csv), (r) => {
      if (r["record"] === "worker") r["decision"] = "not-operai";
    });
    await real(register, notOperai);
    expect(await numberOf("a1")).toBe("WA26/001"); // that worker's row paired with nobody and counted for nobody
  });

  it("AC-1.14 a worker can be mapped by an email of an employee, whichever email its requests used", async () => {
    const r = await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 1000 }]);
    await db.refundRequest.create({ data: { ownerUserId: "u1", ownerEmail: "alpha.new@example.invalid", ownerName: ALPHA.name, status: "draft", createdAt: new Date(r.createdAt.getTime() + 60_000) } });
    const { register, csv } = await propose([row("Somebody Else", "WA26/020", "2026-03-12", "10")]);
    const mapped = editPairing(csv, (rec) => {
      if (rec["record"] === "worker") rec["decision"] = ALPHA.email.toUpperCase();
    });
    // The line was proposed before the worker was mapped: a person pairs it by hand with a number on a row of its employee (D7).
    await real(register, decideLines(mapped, { a1: { decision: "paper", paperNumber: "WA26/020" } }));
    expect(await numberOf("a1")).toBe("WA26/020");
  });

  it("AC-1.14 two employees with the same prefix keep separate rows and separate sequences (each with its own code)", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    await request(ANDERS, [{ id: "d1", date: "2026-03-12" }]);
    await code("WAA", "u1");
    await code("WAB", "u3");
    const { register, csv } = await propose([alpha("WA26/010", "2026-02-01", "1"), row(ANDERS.name, "WA26/020", "2026-02-01", "1")]);
    await real(register, confirmAll(csv));
    expect([await numberOf("a1"), await numberOf("d1")]).toEqual(["WAA26/011", "WAB26/021"]);
    expect([(await counterOf("u1", 2026))!.lastSeq, (await counterOf("u3", 2026))!.lastSeq]).toEqual([11, 21]);
  });

  it("AC-1.15 an excluded employee: no row paired or counted, its lines take new numbers from 001 with its code, and it needs one when its initials are shared", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    await request(ANDERS, [{ id: "t1", date: "2026-03-12" }, { id: "t2", date: "2026-03-13" }]); // the test account: initials WA, like Alpha
    await code("WAA", "u1");
    const rows = [alpha("WA26/010", "2026-02-01", "1"), row(ANDERS.name, "WA26/090", "2026-03-12", "10")];
    const { register, csv } = await propose(rows);
    // The proposal paired t1 with a row of the worker that happens to carry the test account's name; the person excludes the account,
    // marks that worker not-operai and gives the account's lines a new number (a paper number for it is refused, below).
    const excluded = decideLines(
      editPairing(csv, (r) => {
        if (r["record"] === "employee" && r["id"] === "E2") r["decision"] = "excluded";
        if (r["record"] === "worker" && r["decision"] === "E2") r["decision"] = "not-operai";
      }),
      { t1: { decision: "new" }, t2: { decision: "new" } },
    );
    // Without a code of its own it shares the initials WA with Alpha's register prefix: refused, exit 9, nothing written.
    const before = await snapshot();
    const refused = await caught(real(register, excluded));
    expect(refused).toBeInstanceOf(SharedPrefixError);
    expect((refused as { exit: number }).exit).toBe(9);
    expect(await snapshot()).toEqual(before);
    await code("TST", "u3");
    await real(register, excluded);
    expect([await numberOf("t1"), await numberOf("t2")]).toEqual(["TST26/001", "TST26/002"]);
    expect(await numberOf("a1")).toBe("WAA26/011");
    expect(await db.receiptNumberBaseline.count({ where: { emailKey: ANDERS.email } })).toBe(0);
  });

  it("AC-1.15 a paper decision for the excluded employee, and an offsets row for it, are refused with 8", async () => {
    await request(ANDERS, [{ id: "t1", date: "2026-03-12" }]);
    await code("TST", "u3");
    const { register, csv } = await propose([row("Worker Test", "WA26/090", "2026-03-12", "10")]);
    const mapped = editPairing(confirmAll(csv), (r) => {
      if (r["record"] === "employee" && r["id"] === "E1") r["decision"] = "excluded";
      if (r["record"] === "worker") r["decision"] = "not-operai";
    });
    const offsetsRefused = (await caught(real(register, mapped, { offsets: [{ email: ANDERS.email, year: 2026, lastIssuedSeq: 3 }] }))) as InstanceType<typeof NotDecidedError>;
    expect(offsetsRefused.problems.map((p) => p.code)).toContain("offsets-for-excluded");
    const paper = editPairing(mapped, (r) => {
      if (r["id"] === "t1") Object.assign(r, { decision: "paper", paperNumber: "WA26/090" });
    });
    expect(((await caught(real(register, paper))) as InstanceType<typeof NotDecidedError>).problems.map((p) => p.code)).toContain("paper-for-excluded");
  });
});

describe("the check, the decisions that differ, and staleness (AC-2.4 to AC-2.9, AC-5.5)", () => {
  async function scenario() {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }, { id: "a2", date: "2026-03-14", cents: 1000 }, { id: "a3", date: "2026-03-18" }]);
    await request(BETA, [{ id: "b1", date: "2026-03-15", cents: 500 }, { id: "b2", date: "2026-03-16" }]);
    return propose([alpha("WA26/005", "2026-03-12", "24.5"), alpha("WA26/006", "2026-03-14", "10"), beta("WB26/011", "2026-03-15", "5")]);
  }

  it("AC-2.9 and AC-5.5 the check writes nothing and reports exactly the numbers the real run then writes, line by line", async () => {
    const { register, csv } = await scenario();
    const confirmed = confirmAll(csv);
    const before = await snapshot();
    const dry = await check(register, confirmed);
    expect(await snapshot()).toEqual(before);
    expect(dry.mode).toBe("check");
    expect(await released()).toBe(false);
    const run = await real(register, confirmed);
    const view = (r: typeof run) => r.lines.map((l) => [l.lineId, l.receiptNumber, l.origin]);
    expect(view(run)).toEqual(view(dry));
    expect(view(run)).toEqual([["a1", "WA26/005", "paper"], ["a2", "WA26/006", "paper"], ["a3", "WA26/007", "new"], ["b1", "WB26/011", "paper"], ["b2", "WB26/012", "new"]]);
    for (const l of run.lines) expect(await numberOf(l.lineId)).toBe(l.receiptNumber);
  });

  it("AC-2.4 the report lists a changed exact match, compared with the proposal RECOMPUTED, not with the file's own `proposed` columns", async () => {
    const { register, csv } = await scenario();
    const changed = editPairing(confirmAll(csv), (r) => {
      if (r["id"] === "a1") Object.assign(r, { decision: "new", paperNumber: "" });
      if (r["id"] === "a2") Object.assign(r, { proposed: "new", proposedNumber: "" }); // a person edits the informational column
    });
    const report = await check(register, changed);
    expect(report.differsFromProposal).toEqual([{ lineId: "a1", proposed: "paper WA26/005", decided: "new" }]);
    const text = (await import("./accounting-release")).formatReport(report);
    expect(text).toContain("a1: proposed paper WA26/005, the file decides new");
    const real1 = await real(register, changed);
    expect(real1.differsFromProposal).toHaveLength(1);
    expect(await numberOf("a1")).toBe("WA26/007"); // Alpha's baseline is 6 (the register maximum and the imported 006): a1 and a3 take 007 and 008
  });

  it("AC-2.7 a workbook that differs by one byte of content is stale (7), also a line approved since the proposal; a new proposal then works", async () => {
    const { csv } = await scenario();
    const other = buildRegisterWorkbook([alpha("WA26/005", "2026-03-12", "24.5"), alpha("WA26/006", "2026-03-14", "10"), beta("WB26/011", "2026-03-15", "6")]);
    const before = await snapshot();
    const stale = await caught(real(other, confirmAll(csv)));
    expect(stale).toBeInstanceOf(StaleError);
    expect((stale as { exit: number }).exit).toBe(7);
    expect(await snapshot()).toEqual(before);
    expect(await caught(check(other, confirmAll(csv)))).toBeInstanceOf(StaleError);

    const same = buildRegisterWorkbook([alpha("WA26/005", "2026-03-12", "24.5"), alpha("WA26/006", "2026-03-14", "10"), beta("WB26/011", "2026-03-15", "5")]);
    await request(ALPHA, [{ id: "late", date: "2026-05-05" }]); // approved into the pre-release set after the proposal
    const lateStale = await caught(real(same, confirmAll(csv)));
    expect(lateStale).toBeInstanceOf(StaleError);
    const withLate = await snapshot();
    expect(await caught(real(same, confirmAll(csv)))).toBeInstanceOf(StaleError);
    expect(await snapshot()).toEqual(withLate); // nothing written by the refusal
    const again = await propose([alpha("WA26/005", "2026-03-12", "24.5"), alpha("WA26/006", "2026-03-14", "10"), beta("WB26/011", "2026-03-15", "5")]);
    await real(again.register, confirmAll(again.csv));
    expect(await released()).toBe(true);
  });

  it("a sheet the workbook does not have is an unreadable input (6), naming no cell", async () => {
    const { register, csv } = await scenario();
    const error = (await caught(real(register, confirmAll(csv), { sheet: "2027" }))) as { exit: number; message: string };
    expect(error.exit).toBe(6);
    expect(error.message).not.toContain("Worker");
  });
});

describe("a failure rolls the whole run back (AC-2.5, AC-5.2)", () => {
  it("a fault after the first employee is numbered leaves nothing; the rerun on the same inputs completes with the same numbers", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    await request(BETA, [{ id: "b1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("WA26/010", "2026-02-01", "1")]);
    const confirmed = confirmAll(csv);
    const before = await snapshot();
    const fault = await caught(
      real(register, confirmed, {
        afterEmployeeNumbered: (done) => {
          if (done === 1) throw new Error("injected fault");
        },
      }),
    );
    expect(fault).toMatchObject({ message: "injected fault" });
    expect(await snapshot()).toEqual(before);
    expect(await released()).toBe(false);
    expect(await db.receiptCounter.count()).toBe(0);
    await real(register, confirmed);
    expect([await numberOf("a1"), await numberOf("b1")]).toEqual(["WA26/011", "WB26/001"]);
  });
});

// ─── US-3: the counter continues after the paper numbers ─────────────────────

describe("new numbers continue after the highest of everything (AC-3.1 to AC-3.6)", () => {
  it("AC-3.2 and AC-3.6 paper 001-040 with 021 and 022 unmatched: the next new number is 041, then 042 and 043, and the unmatched ones are never issued", async () => {
    const lines: L[] = [{ id: "m1", date: "2026-01-01", cents: 100 }, { id: "n1", date: "2026-04-10" }, { id: "n2", date: "2026-04-11" }, { id: "n3", date: "2026-04-12" }];
    await request(ALPHA, lines);
    // forty rows on forty different days from 2026-01-01; the first is the exact match of m1 (1.00)
    const rows = Array.from({ length: 40 }, (_, i) => alpha(`WA26/${String(i + 1).padStart(3, "0")}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), "1"));
    const { register, csv } = await propose(rows);
    expect(pairingRecords(csv).find((r) => r["id"] === "m1")).toMatchObject({ category: "exact", proposedNumber: "WA26/001" });
    await real(register, decideLines(csv, {}));
    expect([await numberOf("m1"), await numberOf("n1"), await numberOf("n2"), await numberOf("n3")]).toEqual(["WA26/001", "WA26/041", "WA26/042", "WA26/043"]);
    const issued = (await db.refundLine.findMany({ where: { receiptNumber: { not: null } } })).map((l) => l.receiptSeq);
    expect(issued.includes(21) || issued.includes(22)).toBe(false);
    expect(await counterOf("u1", 2026)).toMatchObject({ lastSeq: 43, startAfter: 40 });
  });

  it("AC-3.3 several new lines of one employee are numbered by expense date, then creation time, then id", async () => {
    await request(ALPHA, [
      { id: "x1", date: "2026-04-10" },
      { id: "x2", date: "2026-04-05", createdAt: "2026-04-06T10:00:00.000Z" },
      { id: "x3", date: "2026-04-05", createdAt: "2026-04-06T09:00:00.000Z" },
      { id: "x5", date: "2026-04-05", createdAt: "2026-04-06T10:00:00.000Z" },
    ]);
    const { register, csv } = await propose([]);
    await real(register, confirmAll(csv));
    expect(await Promise.all(["x3", "x2", "x5", "x1"].map(numberOf))).toEqual(["WA26/001", "WA26/002", "WA26/003", "WA26/004"]);
  });

  it("AC-3.1 the baseline is the highest of the offsets row, the register maximum and the imported numbers", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([alpha("WA26/030", "2026-02-01", "1")], { offsets: [{ email: ALPHA.email, year: 2026, lastIssuedSeq: 35 }] });
    const report = await real(register, confirmAll(csv), { offsets: [{ email: ALPHA.email, year: 2026, lastIssuedSeq: 35 }] });
    expect(await numberOf("a1")).toBe("WA26/036");
    expect(report.baseline).toEqual([{ employeeRef: "WA · u1", baseline: 35, outcome: "written" }]);
  });

  it("AC-3.1 a register-only employee named by an email that Refund does not know gets a baseline row under it", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([row("Worker Newcomer", "WN26/040", "2026-02-01", "1")]);
    const mapped = editPairing(confirmAll(csv), (r) => {
      if (r["record"] === "worker") r["decision"] = "newcomer@example.invalid";
    });
    const report = await real(register, mapped);
    expect((await baselineRows()).map((b) => [b.emailKey, b.lastIssuedSeq])).toEqual([["newcomer@example.invalid", 40]]);
    expect(report.baseline).toEqual([{ employeeRef: "not yet in Refund", baseline: 40, outcome: "written" }]);
    expect(await db.receiptCounter.count()).toBe(1); // only Alpha's
  });

  it("AC-3.5 in 2027 the sequence restarts at 001, whatever the baseline", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }, { id: "y27", date: "2027-01-05" }]);
    const { register, csv } = await propose([alpha("WA26/030", "2026-02-01", "1")]);
    await real(register, confirmAll(csv));
    expect([await numberOf("a1"), await numberOf("y27")]).toEqual(["WA26/031", "WA27/001"]);
  });
});

// ─── US-4: prefixes ──────────────────────────────────────────────────────────

describe("shared prefixes at the release (AC-4.11, AC-4.12)", () => {
  async function pair() {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    await request(ANDERS, [{ id: "d1", date: "2026-03-12", cents: 700 }]);
    return propose([row(ANDERS.name, "WA26/020", "2026-03-12", "7")]);
  }

  it("the dry run lists the employees with a shared prefix that hold no code", async () => {
    const { report } = await pair();
    expect(report.pairing!.employees.filter((e) => e.needsCode).map((e) => e.ref)).toEqual(["WA · u1", "WA · u3"]);
    expect(await released()).toBe(false);
  });

  it("a new number for a codeless member of a shared pair is refused with 9 and nothing is written; a member whose lines are all paper is not blocked", async () => {
    const { register, csv } = await pair();
    const before = await snapshot();
    for (const mode of [real, check]) {
      const error = await caught(mode(register, confirmAll(csv)));
      expect(error).toBeInstanceOf(SharedPrefixError);
      expect((error as { exit: number }).exit).toBe(9);
      expect((error as Error).message).toContain("WA · u1");
      expect((error as Error).message).not.toContain("WA · u3"); // Anders takes paper only
    }
    expect(await snapshot()).toEqual(before);
    await code("WAA", "u1");
    await real(register, confirmAll(csv));
    expect([await numberOf("a1"), await numberOf("d1")]).toEqual(["WAA26/001", "WA26/020"]); // 4.12: the code on the new number, the paper as written
  });

  it("AC-4.12 a paper number keeps its text whatever the employee's code, and the new ones carry the code in force, check included", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }, { id: "a2", date: "2026-03-13" }]);
    await code("WAX", "u1");
    const { register, csv } = await propose([alpha("WA26/005", "2026-03-12", "24.5")]);
    const confirmed = confirmAll(csv);
    const dry = await check(register, confirmed);
    expect(dry.lines.map((l) => l.receiptNumber)).toEqual(["WA26/005", "WAX26/006"]);
    await real(register, confirmed);
    expect([await numberOf("a1"), await numberOf("a2")]).toEqual(["WA26/005", "WAX26/006"]);
  });
});

// ─── US-5: safe to run, refuse and repeat ────────────────────────────────────

describe("approvals around the release (AC-5.4, AC-5.7)", () => {
  const perms: ResolveResponse = {
    sub: "",
    epoch: 1,
    permissions: [
      { resource: "refund", action: "access", conditions: null },
      { resource: "request", action: "review", conditions: null },
      { resource: "request", action: "approve", conditions: null },
    ],
    entity: null,
    jobTitle: null,
  };
  const approve = async (requestId: string) => {
    const token = await harness.signToken({ sub: "acct-1", email: "acct-1@example.invalid" });
    const res = await decideRouter.request(`/review/requests/${requestId}/approve`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    return { status: res.status, body: (await res.json()) as { code?: string } };
  };

  it("AC-5.4 approvals answer 409 accounting_release_pending before the release, also after a dry run, and no number is consumed; after it, 200 and the number continues the register", async () => {
    useFakeAccounting(fake);
    __resetAuthzCacheForTests();
    harness.setResolve(async () => perms);
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const submitted = await request(BETA, [{ id: "it1", date: "2026-11-10", entity: "welld_it" }], "submitted");
    const { register, csv } = await propose([beta("WB26/030", "2026-02-01", "1")]);
    const confirmed = confirmAll(csv);

    expect(await approve(submitted.id)).toEqual({ status: 409, body: expect.objectContaining({ code: "accounting_release_pending" }) });
    await check(register, confirmed);
    expect(await approve(submitted.id)).toEqual({ status: 409, body: expect.objectContaining({ code: "accounting_release_pending" }) });
    expect(await db.receiptCounter.count()).toBe(0);
    expect(await numberOf("it1")).toBeNull();

    await real(register, confirmed);
    expect((await approve(submitted.id)).status).toBe(200);
    expect(await numberOf("it1")).toBe("WB26/031"); // AC-3.1: after the register maximum of an employee with no pre-release line
  });

  it("AC-5.7 the WellD Italia lines of approved requests stay unnumbered after the release", async () => {
    await request(ALPHA, [{ id: "ch", date: "2026-03-12" }, { id: "it", date: "2026-03-13", entity: "welld_it" }]);
    const { register, csv } = await propose([]);
    const report = await real(register, confirmAll(csv));
    expect(await numberOf("it")).toBeNull();
    expect(report.itLinesLeftUnnumbered).toBe(1);
    expect(await numberOf("ch")).toBe("WA26/001");
  });
});

describe("a rerun after completion (AC-5.3)", () => {
  it("changes nothing, writes no second marker, issues no number and asks Accounting and auth nothing, whatever the inputs", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12" }]);
    const { register, csv } = await propose([]);
    await real(register, confirmAll(csv));
    const before = await snapshot();
    fake.resetCalls();
    for (const over of [{}, { register, pairing: confirmAll(csv) }, { register: new Uint8Array([1, 2, 3]), pairing: "nonsense" }, { dryRun: true as const }]) {
      const report = await runAccountingRelease({ ...ports(), ...over });
      expect(report.alreadyCompleted).not.toBeNull();
    }
    expect(fake.reads.total).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(await db.refundSetting.count({ where: { key: "accounting-release-completed-at" } })).toBe(1);
  });
});
