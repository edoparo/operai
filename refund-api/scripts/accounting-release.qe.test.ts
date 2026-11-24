/**
 * QE gap tests for the release run (T27, specs/20261124-receipt-numbers-from-the-register; AC-2.7, AC-5.1). Found by a mutation check:
 * removing the sheet comparison of the stale check left every existing test green. A pairing file built from sheet `2026` must not be
 * run against a read of another sheet, even with the same workbook bytes: refused as stale (7), nothing written. Synthetic data only.
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
const { editPairing, confirmAll } = await import("../src/test-support/releaseRun");
const { parseDefaults, runAccountingRelease, StaleError } = await import("./accounting-release");

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


describe("the stale check covers the sheet (AC-2.7)", () => {
  it("a pairing file whose meta names another sheet than the one being read is stale (7) in the check and the real run, and nothing is written", async () => {
    await request(ALPHA, [{ id: "a1", date: "2026-03-12", cents: 2450 }]);
    const { register, csv } = await propose([alpha("WA26/005", "2026-03-12", "24.5")]);
    const otherSheet = editPairing(confirmAll(csv), (r) => {
      if (r["record"] === "meta" && r["id"] === "sheet") r["label"] = "2027";
    });
    expect(otherSheet).not.toBe(confirmAll(csv)); // the edit really changed the meta record
    const before = await snapshot();
    for (const run of [check, real]) {
      const error = await caught(run(register, otherSheet));
      expect(error).toBeInstanceOf(StaleError);
      expect((error as { exit: number }).exit).toBe(7);
    }
    expect(await snapshot()).toEqual(before);
    expect(await released()).toBe(false);
    await real(register, confirmAll(csv)); // the untouched file still works
    expect(await released()).toBe(true);
  });
});
