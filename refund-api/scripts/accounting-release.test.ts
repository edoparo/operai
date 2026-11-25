/**
 * The release script against real Postgres (T11, specs/20261118-refund-accounting-export; AC-2.5, AC-7.1, AC-7.2, AC-7.3; plan D2,
 * D6, D13, IS-1; rewritten by T22, specs/20261119-accounting: AC-7.4, AC-7.5, AC-6.8, D20; plan § Release scripts; reworked by T61 for
 * the 2026-11-19 sign-off: default ACCOUNTS only, no VAT default, no designation, the 14-type defaults file; SO-17, SO-22).
 *
 * Accounting is a FAKE `AccountingPort` (no network): the script reads it first, and a fake that cannot be read proves what the
 * script writes then (nothing). The rows covered:
 *   AC-7.4  Accounting unreachable (each kind, reference data or rates, dry run too): the run ends with `AccountingUnavailableError`
 *           (the CLI maps it to exit 2) and NO number, copy, default, counter, audit row or marker exists; a rerun with
 *           Accounting back works. The read comes first (the database is untouched when Accounting is asked), rates in chunks of 6
 *           months, one deadline per chunk. Legacy lines get the COPY of the default account's entry as Accounting holds it now (and no
 *           VAT code), and the rate copy when one is in effect, else "rate pending" (reported). A line that appears while the release runs is refused, not guessed.
 *   AC-7.5  Accounting holds no WellD CH accounts: every legacy line is numbered and listed without an account, and a later approval is
 *           409; an empty VAT code list refuses nothing.
 *   AC-8.3 of 20261118  Refund's 14 default accounts are seeded by natural key, only where Refund holds no row and only for an active
 *           account (else skipped and reported); no designation, no VAT; the catalog is never seeded (it is Accounting's).
 *   AC-7.1/7.2/7.3 of 20261118: numbering, unclassified lines and WellD Italia lines unchanged. SR-3, SR-4, D-1, offsets, dry run.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolveResponse } from "../src/authz/resolveClient";
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
const { createOwnerNameClient, OwnerNamesUnavailableError, OWNER_NAME_FAILURE_KINDS } = await import("../src/accounting/ownerNames");
const { ACCOUNTING_FAILURE_KINDS, AccountingUnavailableError } = await import("../src/accounting/accountingClient");
const { loadRecordedDefaults } = await import("../src/accounting/defaults.repo");
const { isAccountingReleased } = await import("../src/accounting/release");
const { loadExportSource, evaluateExport } = await import("../src/accounting/export.repo");
const { buildAccountingFile } = await import("../src/accounting/export");
const { cellValues, readWorkbook } = await import("../src/test-support/xlsxReader");
const { createFakeAccounting, restoreAccounting, useFakeAccounting } = await import("../src/test-support/fakeAccounting");
const { proposeAndConfirm } = await import("../src/test-support/releaseRun");
const { __resetAuthzCacheForTests } = await import("../src/auth/authz.middleware");
// @ts-expect-error -- the query suffix is a runtime-only cache-buster (testAuth.ts, "no shared router specifier")
const { decideRouter } = (await import("../src/review/decide.routes?release-script")) as typeof import("../src/review/decide.routes");
const {
  ACCOUNTING_UNREADABLE_MESSAGE,
  OWNER_NAMES_UNREADABLE_MESSAGE,
  chunkByMonths,
  DEFAULT_DEFAULTS_PATH,
  formatReport,
  parseDefaults,
  parseOffsetsCsv,
  RATE_CHUNK_MONTHS,
  describeReleaseFailure,
  InputMissingError,
  ReleaseError,
  runAccountingRelease,
} = await import("./accounting-release");

const NOW = new Date("2026-11-20T08:00:00.000Z");

/** What WellD CH's Accounting holds on release day: the 19 accounts and 6 VAT codes of the signed-off list (AC-7.6). */
const ACCOUNTS: readonly [string, string][] = [
  ["2620.1", "Altri debiti verso soci - CHF (CH)"],
  ["5901", "Spese viaggi in treno"],
  ["5902", "Spese viaggi in aereo"],
  ["5903", "Spese viaggi taxi"],
  ["5904", "Spese viaggi altri mezzi pubblici"],
  ["5905", "Spese rimborsi chilometrici (viaggi)"],
  ["5906", "Spese autostrade (viaggi)"],
  ["5907", "Spese parcheggio (viaggi)"],
  ["5909", "Spese di alloggio (viaggi)"],
  ["5999", "Altre spese di viaggio"],
  ["5808", "Contributo aziendale abbonamento mezzi pubblici personale"],
  ["6101", "Spese materiale ufficio"],
  ["6102", "Spese telefoniche, fax, internet"],
  ["6104", "Spese postali"],
  ["6405", "Spese licenze software"],
  ["6501", "Libri e manuali"],
  ["6701", "Spese pranzi e cene con clienti"],
  ["6720", "Spese pranzi e cene di lavoro (interni)"],
  ["7122", "Spese da riaddebitare a WellD Italia"],
];
function fullAccounting() {
  const accounting = createFakeAccounting();
  for (const [number, name] of ACCOUNTS) accounting.setAccount(number, name);
  return accounting
    .setVatCode("IPM81", "IVA 8.1%", 810)
    .setVatCode("IPM77", "IVA 7.7%", 770)
    .setVatCode("IP00", "IVA 0%", 0)
    .setVatCode("BZM81", "IVA 8.1% reverse charge (servizi dall'estero)", 810)
    .setVatCode("IPM26", "IVA 2.6% (aliquota ridotta)", 260)
    .setVatCode("IPM38", "IVA 3.8% (alloggio)", 380);
}
type Fake = ReturnType<typeof createFakeAccounting>;
let fake: Fake = fullAccounting();

const admin = { createdByUserId: "admin-1", createdByEmail: "admin@welld.ch" };

beforeEach(async () => {
  await truncateRefundTables({ released: false });
  fake = fullAccounting();
});
afterAll(async () => {
  restoreAccounting();
  await truncateRefundTables({ released: false });
});

interface L {
  id: string;
  date: string;
  type?: string;
  currency?: "CHF" | "EUR" | "USD" | "GBP";
  entity?: "welld_ch" | "welld_it";
  rejected?: boolean;
  createdAt?: string;
}

async function request(owner: string, lines: L[], opts: { status?: "draft" | "submitted" | "approved" | "paid" | "rejected"; name?: string | null; email?: string } = {}) {
  const r = await db.refundRequest.create({
    data: {
      ownerUserId: owner,
      ownerEmail: opts.email ?? `${owner}@welld.ch`,
      ownerName: opts.name === undefined ? "Matteo Codogno" : opts.name,
      status: opts.status ?? "approved",
      submittedAt: new Date("2026-03-01"),
    },
  });
  for (const l of lines) {
    await db.refundLine.create({
      data: {
        id: l.id,
        requestId: r.id,
        date: new Date(l.date),
        type: (l.type ?? "travel_train") as any,
        motivo: "m",
        entity: l.entity ?? "welld_ch",
        currency: l.currency ?? "CHF",
        requestedAmountCents: 1000,
        approvedTotalCents: 1000,
        ...(l.createdAt ? { createdAt: new Date(l.createdAt) } : {}),
        ...(l.rejected ? { rejectionReason: "no", rejectedAt: new Date(), rejectedByUserId: "a", rejectedByEmail: "a@x" } : {}),
      },
    });
  }
  return r;
}

/**
 * What auth holds, as the `OwnerNamePort` the script asks (T84). By default nobody: every unnamed request stays unnamed (404, a deleted
 * user), which is what the rest of this file needs. `asked` records the user ids the script asked for, in order.
 */
const authNames = { names: new Map<string, string>(), failWith: null as null | "unreachable" | "server_error" | "unauthorized", asked: [] as string[] };
beforeEach(() => {
  authNames.names.clear();
  authNames.failWith = null;
  authNames.asked.length = 0;
});
const ownerNames = {
  async lookup(userId: string) {
    authNames.asked.push(userId);
    if (authNames.failWith !== null) throw new OwnerNamesUnavailableError(authNames.failWith);
    const name = authNames.names.get(userId);
    return name === undefined ? ({ state: "gone" } as const) : ({ state: "found", name } as const);
  },
};

/**
 * A release as a person runs it (T12, specs/20261124): the propose mode on the header-only workbook (no worker, no number: every line has
 * no paper counterpart), every `proposed` record confirmed, then the run itself with the options the test gives. Accounting and auth are
 * asked by the propose step too; their counters are reset before the run, so a test that counts reads or asked names counts the run's.
 * With `offsets: [{...}]` the list complements the register (AC-3.1); `dryRun: true` is the check mode.
 */
const run = async (over: Parameters<typeof runAccountingRelease>[0] = {}) => {
  const base = { now: () => NOW, accounting: { begin: (name: Parameters<Fake["begin"]>[0]) => fake.begin(name) }, ownerNames, offsets: [] };
  const inputs = await proposeAndConfirm({
    run: (o) => runAccountingRelease({ ...base, ...(over.offsets !== undefined ? { offsets: over.offsets } : {}), ...o }),
  });
  fake.resetCalls();
  authNames.asked.length = 0;
  return runAccountingRelease({ ...base, register: inputs.register, ...(inputs.alreadyCompleted ? {} : { pairing: inputs.pairing }), ...over });
};
const line = (id: string) => db.refundLine.findUniqueOrThrow({ where: { id } });

/** Everything a release writes, counted: nothing of it may exist after a run that stopped (AC-7.4). */
async function snapshot() {
  return {
    typeDefaults: await db.expenseTypeAccountingDefault.count(),
    settings: await db.refundSetting.count(),
    counters: JSON.stringify(await db.receiptCounter.findMany({ orderBy: { year: "asc" } })),
    baseline: await db.receiptNumberBaseline.count(),
    lines: JSON.stringify(
      await db.refundLine.findMany({
        orderBy: { id: "asc" },
        select: { id: true, receiptNumber: true, accountNumber: true, accountName: true, vatCodeCopy: true, vatRateBasisPoints: true, fxRateMicros: true, fxRateMonth: true },
      }),
    ),
    audit: await db.refundAuditEntry.count(),
  };
}

describe("the defaults file", () => {
  it("is valid, and is the signed-off list of SO-17: fourteen types, accounts only; every number it names is in the signed-off list", () => {
    const raw = JSON.parse(readFileSync(DEFAULT_DEFAULTS_PATH, "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["_note", "typeDefaults"]); // no foreignCurrencyVatCode
    const defaults = parseDefaults(raw);
    expect(Object.keys(defaults.typeDefaults)).toHaveLength(14);
    expect(Object.fromEntries(Object.entries(defaults.typeDefaults).map(([type, entry]) => [type, entry!.ledgerAccount]))).toEqual({
      travel_km: "5905",
      travel_train: "5901",
      travel_other_public_transport: "5904",
      travel_flight: "5902",
      travel_taxi: "5903",
      travel_highway: "5906",
      travel_parking: "5907",
      representation_meals: "6701",
      representation_gifts: null,
      office_material: "6101",
      stationery: "6101",
      company_manuals: "6501",
      postal: "6104",
      telephone: "6102",
    });
    const numbers = new Set(ACCOUNTS.map(([number]) => number));
    for (const entry of Object.values(defaults.typeDefaults)) {
      expect(Object.keys(entry!)).toEqual(["ledgerAccount"]);
      if (entry!.ledgerAccount !== null) expect(numbers.has(entry!.ledgerAccount)).toBe(true);
    }
  });

  it("refuses a file with an unknown type, an empty key, a wrong shape, or any VAT key; accepts an empty map", () => {
    expect(() => parseDefaults({ typeDefaults: { not_a_type: { ledgerAccount: null } } })).toThrow(ReleaseError);
    expect(() => parseDefaults({ typeDefaults: { postal: { ledgerAccount: "" } } })).toThrow(ReleaseError);
    expect(() => parseDefaults({ typeDefaults: { postal: { ledgerAccount: 6104 } } })).toThrow(ReleaseError);
    expect(() => parseDefaults({})).toThrow(ReleaseError);
    expect(parseDefaults({ typeDefaults: {} })).toBeTruthy();
    expect(parseDefaults({ typeDefaults: { postal: { ledgerAccount: " 6104 " } } }).typeDefaults.postal).toEqual({ ledgerAccount: "6104" });
  });

  it("(SO-17) a file of the old world fails loudly: `vatCode` on an entry, or `foreignCurrencyVatCode` on the file, is refused, not ignored", () => {
    expect(() => parseDefaults({ typeDefaults: { postal: { ledgerAccount: "6104", vatCode: "NOVAT" } } })).toThrow(ReleaseError);
    expect(() => parseDefaults({ typeDefaults: { postal: { ledgerAccount: "6104", vatCode: null } } })).toThrow(/vatCode/);
    expect(() => parseDefaults({ typeDefaults: {}, foreignCurrencyVatCode: null })).toThrow(ReleaseError);
    expect(() => parseDefaults({ typeDefaults: {}, foreignCurrencyVatCode: "NOVAT" })).toThrow(/foreignCurrencyVatCode/);
    expect(() => parseDefaults({ typeDefaults: {}, somethingElse: 1 })).toThrow(ReleaseError);
  });
});

describe("parseOffsetsCsv", () => {
  it("reads email,year,lastIssuedSeq with or without a header, blanks and comments", () => {
    expect(parseOffsetsCsv("email,year,lastIssuedSeq\nmatteo@welld.ch,2026,81\n\n# a note\n\"anna@welld.ch\", 2026 , 12\r\n")).toEqual([
      { email: "matteo@welld.ch", year: 2026, lastIssuedSeq: 81 },
      { email: "anna@welld.ch", year: 2026, lastIssuedSeq: 12 },
    ]);
    expect(parseOffsetsCsv("a@b.ch,2026,1")).toHaveLength(1);
    expect(parseOffsetsCsv("\uFEFFemail,year,lastIssuedSeq\r\na@b.ch,2026,7\r\n")).toEqual([{ email: "a@b.ch", year: 2026, lastIssuedSeq: 7 }]);
    // the delimiter is detected (an Excel save in a Swiss or Italian locale writes `;`), and a tab works too
    expect(parseOffsetsCsv("email;year;lastIssuedSeq\r\na@b.ch;2026;7\r\n")).toEqual([{ email: "a@b.ch", year: 2026, lastIssuedSeq: 7 }]);
    expect(parseOffsetsCsv("a@b.ch\t2026\t7")).toEqual([{ email: "a@b.ch", year: 2026, lastIssuedSeq: 7 }]);
  });

  it("(AC-5.6) no message quotes the email of a row", () => {
    for (const bad of ["secret.person@b.ch,2026,x", "secret.person@b.ch,2025,5", "secret.person@b.ch,2026,5\nSecret.Person@b.ch,2026,6", "secret.person@b.ch,2026,0"]) {
      let message = "";
      try {
        parseOffsetsCsv(bad);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message.toLowerCase()).not.toContain("secret");
      expect(message).not.toContain("@");
    }
  });

  it("(AC-7.4) a file with only the header line is the explicit empty list; a file with nothing in it is refused, not read as 'no employee'", () => {
    expect(parseOffsetsCsv("email,year,lastIssuedSeq\n")).toEqual([]);
    expect(parseOffsetsCsv("EMAIL,Year,LastIssuedSeq")).toEqual([]);
    expect(parseOffsetsCsv("# none of them\nemail,year,lastIssuedSeq\n\n# end\n")).toEqual([]);
    expect(parseOffsetsCsv("\uFEFFemail,year,lastIssuedSeq\r\n")).toEqual([]);
    // A truncated or empty file would number from 001 over the paper numbers: it must say it is empty on purpose.
    for (const bad of ["", "\n\n", "   ", "# only a comment\n", "\uFEFF"]) {
      expect(() => parseOffsetsCsv(bad)).toThrow(/no header line and no row/);
    }
  });

  it("refuses malformed rows and duplicates, naming the line", () => {
    for (const bad of ["a@b.ch,2026", "nope,2026,1", "a@b.ch,26,1", "a@b.ch,2026,0", "a@b.ch,2026,x", "a@b.ch,2026,100000", "a@b.ch,2026,1\nA@b.ch,2026,2", " a@b.ch ,2026,1\nA@B.CH,2026,2"]) {
      expect(() => parseOffsetsCsv(bad)).toThrow(ReleaseError);
    }
    expect(() => parseOffsetsCsv("a@b.ch,2026,x")).toThrow(/row 1/);
  });

  it("(AC-4.12) only 2026 is accepted: a row of 2025, 2027 or any other year is refused, naming the line", () => {
    for (const year of ["2025", "2027", "2028", "2000"]) {
      expect(() => parseOffsetsCsv(`email,year,lastIssuedSeq\na@b.ch,${year},5`)).toThrow(/row 2: only 2026 continues the paper register/);
    }
    expect(() => parseOffsetsCsv("a@b.ch,2026,5\nc@d.ch,2027,5")).toThrow(/row 2/);
  });
});

describe("chunkByMonths", () => {
  const pair = (month: string, currency: "EUR" | "USD" | "GBP" = "EUR") => ({ currency, month });

  it("groups the pairs by at most six distinct months, oldest first, keeping every currency of a month together", () => {
    const pairs = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m) => [pair(m), pair(m, "USD")]);
    const chunks = chunkByMonths(pairs);
    expect(RATE_CHUNK_MONTHS).toBe(6);
    expect(chunks.map((c) => [...new Set(c.map((p) => p.month))])).toEqual([
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
      ["2026-07", "2026-08"],
    ]);
    expect(chunks.flat()).toHaveLength(16);
  });

  it("is empty for no pair, one chunk for six months, two for seven", () => {
    expect(chunkByMonths([])).toEqual([]);
    expect(chunkByMonths(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].map((m) => pair(m)))).toHaveLength(1);
    expect(chunkByMonths(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((m) => pair(m)))).toHaveLength(2);
  });
});

describe("Accounting is read first (AC-7.4, AC-6.8)", () => {
  async function legacy() {
    await request("u1", [
      { id: "chf", date: "2026-03-02" },
      { id: "eur", date: "2026-03-05", currency: "EUR" },
    ]);
    await request("u2", [{ id: "paid", date: "2026-02-10", type: "office_material" }], { status: "paid", name: "Anna Rossi" });
  }

  it("with Accounting unreachable, whatever the kind: the run stops with AccountingUnavailableError, and not a number, copy, default, counter, audit row or marker exists", async () => {
    await legacy();
    const before = await snapshot();
    for (const kind of ACCOUNTING_FAILURE_KINDS) {
      fake.failWith(kind);
      const error = await run().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountingUnavailableError);
      expect((error as InstanceType<typeof AccountingUnavailableError>).kind).toBe(kind);
      expect(await snapshot()).toEqual(before);
    }
    expect(await db.$transaction((tx) => isAccountingReleased(tx))).toBe(false);
    expect(before.typeDefaults + before.settings + before.audit).toBe(0);
  });

  it("the reference data failing alone, or the rates failing alone, is the same; a dry run stops too", async () => {
    await legacy();
    const before = await snapshot();
    fake.failReferenceDataWith("timeout");
    await expect(run()).rejects.toBeInstanceOf(AccountingUnavailableError);
    fake.failReferenceDataWith(null).failRatesWith("schema");
    await expect(run()).rejects.toBeInstanceOf(AccountingUnavailableError);
    await expect(run({ dryRun: true })).rejects.toBeInstanceOf(AccountingUnavailableError);
    expect(await snapshot()).toEqual(before);
  });

  it("a rerun once Accounting is back works, and numbers exactly what the first attempt would have", async () => {
    await legacy();
    fake.failWith("network");
    await expect(run()).rejects.toBeInstanceOf(AccountingUnavailableError);
    fake.failWith(null).setRate("EUR", "2026-03", 924_600);
    const report = await run();
    expect(report.markerWritten).toBe(true);
    expect(report.lines.map((l) => l.receiptNumber).sort()).toEqual(["AR26/001", "MC26/001", "MC26/002"]);
    expect((await line("eur")).fxRateMicros).toBe(924_600);
  });

  it("asks Accounting BEFORE the first write: when it is read, the database holds no marker, counter, default or number", async () => {
    await legacy();
    const seen: number[] = [];
    fake.onRead(async () => {
      seen.push(
        (await db.refundSetting.count()) +
          (await db.receiptCounter.count()) +
          (await db.expenseTypeAccountingDefault.count()) +
          (await db.refundLine.count({ where: { receiptNumber: { not: null } } })),
      );
    });
    await run();
    expect(seen.length).toBeGreaterThanOrEqual(2); // the reference data and at least one rates read
    expect(seen.every((n) => n === 0)).toBe(true);
  });

  it("asks the reference data once and the rates of the legacy foreign-currency lines only, as the operation `release`", async () => {
    await request("u1", [
      { id: "a", date: "2026-03-05", currency: "EUR" },
      { id: "b", date: "2026-03-09", currency: "EUR" }, // same pair: asked once
      { id: "c", date: "2026-03-09", currency: "USD" },
      { id: "chf", date: "2026-03-09" }, // CHF: no rate
      { id: "rej", date: "2025-01-09", currency: "GBP", rejected: true }, // rejected: never classified
      { id: "it", date: "2025-02-09", currency: "EUR", entity: "welld_it" }, // WellD Italia: never touched
    ]);
    await request("u1", [{ id: "sub", date: "2025-03-09", currency: "EUR" }], { status: "submitted" });
    await run({ dryRun: true });
    expect(fake.calls.map((c) => [c.operation, c.read, c.pairs])).toEqual([
      ["release", "referenceData", undefined],
      ["release", "rates", ["EUR:2026-03", "USD:2026-03"]],
    ]);
  });

  it("with no legacy foreign-currency line it asks no rate at all", async () => {
    await request("u1", [{ id: "chf", date: "2026-03-09" }]);
    await run();
    expect(fake.reads).toEqual({ referenceData: 1, rates: 0, total: 1 });
  });

  it("(F-02) a legacy foreign-currency line dated before Accounting's 2000-01 floor is not asked about and does not fail the read: it is numbered, rate pending, and reported", async () => {
    await request("u1", [
      { id: "old", date: "1999-12-30", currency: "EUR" },
      { id: "ok", date: "2026-03-09", currency: "EUR" },
    ]);
    fake.setRate("EUR", "2026-03", 924_600);
    const report = await run();
    expect(fake.calls.filter((c) => c.read === "rates").map((c) => c.pairs)).toEqual([["EUR:2026-03"]]);
    expect(report.lines).toHaveLength(2);
    expect(report.ratePending.map((l) => l.lineId)).toEqual(["old"]);
    expect(report.accounting.ratePairsAsked).toBe(2);
    expect(await isAccountingReleased(db as never)).toBe(true);
  });

  it("asks the rates in chunks of six months: 14 months, three reads of 6, 6 and 2 months, each its own operation", async () => {
    const months = Array.from({ length: 14 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
    await request("u1", months.map((month, i) => ({ id: `m${i}`, date: `${month}-10`, currency: "EUR" as const })));
    await run({ dryRun: true });
    const rateReads = fake.calls.filter((c) => c.read === "rates");
    expect(rateReads.map((c) => new Set(c.pairs!.map((p) => p.split(":")[1])).size)).toEqual([6, 6, 2]);
    expect(rateReads.flatMap((c) => c.pairs!)).toHaveLength(14);
    expect(fake.calls.every((c) => c.operation === "release")).toBe(true);
  });

  it("a legacy line that appears while Accounting is being read was not asked about: the run is refused and rolled back, never guessed", async () => {
    await request("u1", [{ id: "known", date: "2026-03-05", currency: "EUR" }]);
    fake.setRate("EUR", "2026-03", 924_600);
    const base = { now: () => NOW, accounting: { begin: (name: Parameters<Fake["begin"]>[0]) => fake.begin(name) }, ownerNames, offsets: [] };
    const inputs = await proposeAndConfirm({ run: (o) => runAccountingRelease({ ...base, ...o }) });
    const before = await snapshot();
    fake.onRead(async (call) => {
      if (call.read !== "rates") return;
      fake.onRead(null);
      await request("u1", [{ id: "late", date: "2026-05-05", currency: "EUR" }]);
    });
    const error = await runAccountingRelease({ ...base, register: inputs.register, pairing: inputs.pairing }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReleaseError);
    // The line is not in the pairing file: a new proposal is needed (AC-2.7), exit 7. Never numbered from data not read.
    expect((error as InstanceType<typeof ReleaseError>).code).toBe("stale");
    expect((error as InstanceType<typeof ReleaseError>).exit).toBe(7);
    const after = await snapshot();
    expect({ ...after, lines: "" }).toEqual({ ...before, lines: "" });
    expect((await line("known")).receiptNumber).toBeNull();
    expect(await db.$transaction((tx) => isAccountingReleased(tx))).toBe(false);
  });

  it("the message of AC-7.4 says what was and was not done", () => {
    expect(ACCOUNTING_UNREADABLE_MESSAGE).toBe("Accounting cannot be read: nothing was numbered or classified; run again later");
  });
});

describe("backfill (AC-7.1, AC-7.4)", () => {
  it("classifies CHF and EUR lines alike with the type's default account, as COPIES, and no VAT code, and numbers by expense date across requests", async () => {
    fake.setRate("EUR", "2026-03", 924_600);
    await request("u1", [{ id: "a-late", date: "2026-03-20", type: "travel_train" }, { id: "a-eur", date: "2026-03-05", type: "travel_train", currency: "EUR" }]);
    await request("u1", [{ id: "a-early", date: "2026-02-10", type: "office_material" }], { status: "paid" });
    const report = await run();

    expect(await Promise.all(["a-early", "a-eur", "a-late"].map(async (id) => (await line(id)).receiptNumber))).toEqual(["MC26/001", "MC26/002", "MC26/003"]);
    const chf = await line("a-late");
    expect([chf.accountNumber, chf.accountName, chf.vatCodeCopy, chf.vatRateBasisPoints]).toEqual(["5901", "Spese viaggi in treno", null, null]);
    expect([chf.ledgerAccountIsDefault, chf.vatCodeIsDefault]).toEqual([true, null]);
    const eur = await line("a-eur");
    expect([eur.accountNumber, eur.vatCodeCopy, eur.vatRateBasisPoints]).toEqual(["5901", null, null]);
    const early = await line("a-early");
    expect([early.accountNumber, early.vatCodeCopy]).toEqual(["6101", null]);

    const audit = await db.refundAuditEntry.findMany({ where: { action: { in: ["line_classified", "receipt_number_assigned"] } } });
    expect(audit).toHaveLength(6);
    expect(audit.every((a) => a.actorUserId === "system:accounting-release" && a.actorEmail === "system-accounting-release@welld.ch")).toBe(true);
    expect(audit.every((a) => (a.detail as any).cause === "release")).toBe(true);

    expect(report.lines.map((l) => l.receiptNumber)).toEqual(["MC26/001", "MC26/002", "MC26/003"]);
    expect(report.numbered).toEqual([{ employeeRef: "MC · u1", year: 2026, count: 3, first: "MC26/001", last: "MC26/003" }]);
    expect(report.unclassified).toEqual([]);
    expect(report.markerWritten).toBe(true);
    expect(await db.$transaction((tx) => isAccountingReleased(tx))).toBe(true);
  });

  it("the copy holds the entry as Accounting holds it NOW (the default's values come from the read), not as it was when the default was chosen", async () => {
    fake.setAccount("5901", "Treno (nuovo nome)");
    await request("u1", [{ id: "x", date: "2026-03-20", type: "travel_train" }]);
    await run();
    expect((await line("x")).accountName).toBe("Treno (nuovo nome)");
  });

  it("a foreign-currency line gets the copy of the rate in effect for its expense month; one with no rate stays PENDING, is reported, and is audited as pending", async () => {
    fake.setRate("EUR", "2026-03", 924_600).setRate("GBP", "2026-02", 1_063_500).setRateMissing("USD", "2026-03", "not_published");
    await request("u1", [
      { id: "eur", date: "2026-03-05", currency: "EUR" },
      { id: "usd", date: "2026-03-06", currency: "USD" },
      { id: "gbp", date: "2026-02-10", currency: "GBP" },
    ]);
    const report = await run();

    const eur = await line("eur");
    expect([eur.fxRateMicros, eur.fxRateMonth?.toISOString(), eur.fxRateCopiedAt !== null]).toEqual([924_600, "2026-03-01T00:00:00.000Z", true]);
    const gbp = await line("gbp");
    expect([gbp.fxRateMicros, gbp.fxRateMonth?.toISOString().slice(0, 7)]).toEqual([1_063_500, "2026-02"]);
    const usd = await line("usd");
    expect([usd.fxRateMicros, usd.fxRateMonth, usd.fxRateCopiedAt]).toEqual([null, null, null]);
    // The numbering is the same either way: pending is not a refusal.
    expect([usd.receiptNumber, usd.accountNumber, usd.vatCodeCopy]).toEqual(["MC26/003", "5901", null]);

    const detailOf = async (id: string) =>
      (await db.refundAuditEntry.findFirstOrThrow({ where: { lineId: id, action: "line_classified" } })).detail as Record<string, any>;
    expect((await detailOf("eur"))["fxRate"]).toEqual({ rateMicros: 924_600, month: "2026-03" });
    expect((await detailOf("usd"))["fxRate"]).toBe("pending");

    expect(report.ratePending.map((l) => [l.lineId, l.rate])).toEqual([["usd", "pending"]]);
    expect(report.lines.find((l) => l.lineId === "eur")!.rate).toBe("0.9246");
    expect(report.unclassified).toEqual([]);
    const text = formatReport(report);
    expect(text).toContain("Rate pending: 1 line (no rate");
    expect(text).toContain("Left without an account (0)");
  });

  it("(IS-1) classifies and numbers a legacy line of a PAID request, which the database then locks", async () => {
    await request("u1", [{ id: "p1", date: "2026-03-02" }], { status: "paid" });
    await run();
    const l = await line("p1");
    expect([l.receiptNumber, l.accountNumber, l.vatCodeCopy]).toEqual(["MC26/001", "5901", null]);
    // T16 (specs/20261119-accounting): guard v2 watches the COPY columns, no longer the old FK columns.
    await expect(
      Promise.resolve(db.$executeRawUnsafe(`UPDATE "refund_line" SET "accountNumber" = '9999', "accountName" = 'x' WHERE id = 'p1'`)),
    ).rejects.toThrow(/locked/);
  });

  it("numbers each employee in their own sequence, two years as two sequences, the prefix from the receipt code or else the name's initials", async () => {
    await request("u1", [{ id: "x1", date: "2025-12-30" }, { id: "x2", date: "2026-01-02" }]);
    await request("u2", [{ id: "y1", date: "2026-03-02" }], { name: "Marco Cattaneo" });
    await request("u3", [{ id: "z1", date: "2026-03-02" }], { name: null, email: "anna.rossi@welld.ch" });
    // u1 and u2 both derive the initials MC: before they are numbered each needs a receipt code of its own (AC-4.11); u3 needs none.
    for (const [ownerUserId, code] of [["u1", "MCO"], ["u2", "MCA"]] as const) {
      await db.receiptCode.create({ data: { ownerUserId, code, updatedByUserId: "admin-1", updatedByEmail: "admin@welld.ch", updatedAt: new Date() } });
    }
    await run();
    expect(await Promise.all(["x1", "x2", "y1", "z1"].map(async (id) => (await line(id)).receiptNumber))).toEqual(["MCO25/001", "MCO26/001", "MCA26/001", "AR26/001"]);
  });

  it("(AC-7.2, AC-8.3) numbers but leaves without an account the gifts line (no default account), and reports it; a missing VAT code never leaves a line unclassified", async () => {
    // No VAT code is active in Accounting at all: nothing of it is needed.
    for (const code of ["IPM81", "IPM77", "IP00", "BZM81", "IPM26", "IPM38"]) fake.setVatCodeActive(code, false);
    fake.setRate("EUR", "2026-03", 924_600);
    await request("u1", [
      { id: "gift", date: "2026-03-02", type: "representation_gifts" },
      { id: "manual", date: "2026-03-03", type: "company_manuals" },
      { id: "eur", date: "2026-03-04", type: "travel_train", currency: "EUR" },
      { id: "ok", date: "2026-03-05", type: "travel_train" },
    ]);
    const report = await run();
    expect(report.seeded.warnings).toEqual([]);

    const gift = await line("gift");
    expect([gift.receiptNumber, gift.accountNumber, gift.vatCodeCopy]).toEqual(["MC26/001", null, null]);
    const manual = await line("manual");
    expect([manual.receiptNumber, manual.accountNumber, manual.vatCodeCopy]).toEqual(["MC26/002", "6501", null]);
    const eur = await line("eur");
    expect([eur.receiptNumber, eur.accountNumber, eur.vatCodeCopy]).toEqual(["MC26/003", "5901", null]);
    // The rate is copied all the same.
    expect(eur.fxRateMicros).toBe(924_600);
    expect((await line("ok")).vatCodeCopy).toBeNull();

    expect(report.unclassified.map((l) => [l.lineId, l.missing])).toEqual([["gift", ["account"]]]);
    expect(formatReport(report)).toContain("missing account");
    expect(formatReport(report)).not.toContain("missing vatCode");
  });

  it("(AC-7.2) a default whose account was deactivated in Accounting after Refund recorded it is numbered, left without that account, and reported", async () => {
    await db.expenseTypeAccountingDefault.create({
      data: { entity: "welld_ch", type: "travel_train", accountNumber: "5901", accountName: "Spese viaggi in treno", ...admin },
    });
    fake.setAccountActive("5901", false);
    await request("u1", [{ id: "t", date: "2026-03-02", type: "travel_train" }]);
    const report = await run();
    const l = await line("t");
    expect([l.receiptNumber, l.accountNumber, l.vatCodeCopy]).toEqual(["MC26/001", null, null]);
    expect(report.unclassified.map((u) => [u.lineId, u.missing, u.account])).toEqual([["t", ["account"], null]]);
  });

  it("(AC-7.3) leaves WellD Italia lines without number, classification, audit row or counter, and counts them", async () => {
    await request("u1", [{ id: "it", date: "2026-03-02", entity: "welld_it", currency: "EUR" }], { status: "paid" });
    const report = await run();
    expect(report.itLinesLeftUnnumbered).toBe(1);
    const l = await line("it");
    expect([l.receiptNumber, l.accountNumber, l.vatCodeCopy, l.fxRateMicros]).toEqual([null, null, null, null]);
    expect(await db.refundAuditEntry.count()).toBe(0);
    expect(await db.receiptCounter.count()).toBe(0);
    await run();
    expect((await line("it")).receiptNumber).toBeNull();
  });

  it("skips rejected lines, and requests that are not approved or paid", async () => {
    await request("u1", [{ id: "rej", date: "2026-03-02", rejected: true }, { id: "fine", date: "2026-03-03" }]);
    await request("u1", [{ id: "sub", date: "2026-03-04" }], { status: "submitted" });
    await request("u1", [{ id: "dra", date: "2026-03-05" }], { status: "draft" });
    await request("u1", [{ id: "rjr", date: "2026-03-06" }], { status: "rejected" });
    await run();
    expect((await line("fine")).receiptNumber).toBe("MC26/001");
    for (const id of ["rej", "sub", "dra", "rjr"]) expect((await line(id)).receiptNumber).toBeNull();
  });
});

describe("legacy owners with no name are named from auth before numbering (T84, 2026-11-20 eval round 3; AC-4.2, AC-6.13 of 20261118)", () => {
  const names = (ids: string[]) => db.refundRequest.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: { ownerUserId: true, ownerName: true } });

  it("a legacy request with no name gets auth's name BEFORE numbering, and its receipt prefix comes from the NAME, not the email", async () => {
    const r = await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-03" }], { name: null, email: "zz.unrelated@welld.ch" });
    authNames.names.set("u1", "  Marco Cattaneo ");
    const report = await run();
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } })).ownerName).toBe("Marco Cattaneo");
    expect([(await line("l1")).receiptNumber, (await line("l2")).receiptNumber]).toEqual(["MC26/001", "MC26/002"]); // not ZU26
    expect(report.ownerNames).toEqual({ employeesNamed: 1, requestsNamed: 1, employeesUnnamed: 0 });
    expect(report.lines.map((l) => l.employeeRef)).toEqual(["MC · u1", "MC · u1"]);
  });

  it("also names the requests that are not numbered (a draft, a submitted one), one call per DISTINCT employee", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    await request("u1", [{ id: "b", date: "2026-03-03" }], { name: null, status: "submitted" });
    await request("u1", [{ id: "c", date: "2026-03-04" }], { name: null, status: "draft" });
    await request("u2", [{ id: "d", date: "2026-03-05" }], { name: "Anna Rossi" });
    authNames.names.set("u1", "Marco Cattaneo");
    authNames.names.set("u2", "Someone Else");
    const report = await run();
    expect(authNames.asked).toEqual(["u1"]); // u2 already has a name: not asked
    expect((await db.refundRequest.findMany({ select: { ownerName: true } })).map((r) => r.ownerName).sort()).toEqual(["Anna Rossi", "Marco Cattaneo", "Marco Cattaneo", "Marco Cattaneo"]);
    expect(report.ownerNames).toEqual({ employeesNamed: 1, requestsNamed: 3, employeesUnnamed: 0 });
  });

  it("an existing name is never overwritten, even when auth holds another one; and a blank name from auth is no name", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: "Anna Rossi" });
    await request("u2", [{ id: "b", date: "2026-03-03" }], { name: null });
    await request("u3", [{ id: "c", date: "2026-03-04" }], { name: null, email: "carla.bianchi@welld.ch" });
    authNames.names.set("u1", "Marco Cattaneo");
    authNames.names.set("u2", "   ");
    authNames.names.set("u3", "Carla Bianchi");
    const report = await run();
    const byOwner = Object.fromEntries((await db.refundRequest.findMany()).map((r) => [r.ownerUserId, r.ownerName]));
    expect(byOwner).toEqual({ u1: "Anna Rossi", u2: null, u3: "Carla Bianchi" });
    expect(report.ownerNames).toEqual({ employeesNamed: 1, requestsNamed: 1, employeesUnnamed: 1 });
    expect((await line("a")).receiptNumber).toBe("AR26/001");
  });

  it("a deleted user (404) is not an error: the request stays unnamed, the initials fall back to the email, and the report counts it", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null, email: "anna.rossi@welld.ch" });
    await request("u2", [{ id: "b", date: "2026-03-03" }], { name: null });
    authNames.names.set("u2", "Marco Cattaneo");
    const report = await run();
    expect((await db.refundRequest.findMany({ where: { ownerUserId: "u1" } }))[0]?.ownerName).toBeNull();
    expect((await line("a")).receiptNumber).toBe("AR26/001");
    expect((await line("b")).receiptNumber).toBe("MC26/001");
    expect(report.ownerNames).toEqual({ employeesNamed: 1, requestsNamed: 1, employeesUnnamed: 1 });
    expect(report.markerWritten).toBe(true);
    const text = formatReport(report);
    expect(text).toContain("employees named: 1 (1 request)");
    expect(text).toContain("employees left unnamed: 1");
    expect(text).not.toMatch(/Marco|Cattaneo|@/); // counts only: no name, no email
  });

  it("auth unreachable, whatever the kind (a dry run too): the run stops with OwnerNamesUnavailableError and NOTHING is written, not even a name", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-03" }], { name: null });
    await request("u2", [{ id: "c", date: "2026-03-04" }], { name: "Anna Rossi" });
    const before = await snapshot();
    const namesBefore = JSON.stringify(await db.refundRequest.findMany({ orderBy: { id: "asc" }, select: { id: true, ownerName: true } }));
    authNames.names.set("u1", "Marco Cattaneo");
    for (const kind of ["unreachable", "server_error", "unauthorized"] as const) {
      authNames.failWith = kind;
      for (const dryRun of [false, true]) {
        const error = await run({ dryRun }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(OwnerNamesUnavailableError);
        expect((error as InstanceType<typeof OwnerNamesUnavailableError>).kind).toBe(kind);
        expect(await snapshot()).toEqual(before);
        expect(JSON.stringify(await db.refundRequest.findMany({ orderBy: { id: "asc" }, select: { id: true, ownerName: true } }))).toBe(namesBefore);
      }
    }
    expect(await isAccountingReleased(db as never)).toBe(false);
    // A rerun once auth is back works and numbers from the name.
    authNames.failWith = null;
    await run();
    expect((await line("a")).receiptNumber).toBe("MC26/001");
  });

  it("an unreadable Accounting still comes first: Accounting down AND auth down is the Accounting error, and auth is not asked", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    fake.failWith("timeout");
    authNames.failWith = "unreachable";
    expect(await run().catch((e: unknown) => e)).toBeInstanceOf(AccountingUnavailableError);
    expect(authNames.asked).toEqual([]);
  });

  it("a DRY RUN reports the names it would fill and writes nothing", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    authNames.names.set("u1", "Marco Cattaneo");
    const before = await snapshot();
    const report = await run({ dryRun: true });
    expect(report.ownerNames).toEqual({ employeesNamed: 1, requestsNamed: 1, employeesUnnamed: 0 });
    expect(report.lines[0]?.receiptNumber).toBe("MC26/001");
    expect((await db.refundRequest.findFirstOrThrow()).ownerName).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it("a baseline row of an unnamed legacy employee reports the initials of the NAME Refund will use", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null, email: "zz.unrelated@welld.ch" });
    authNames.names.set("u1", "Marco Cattaneo");
    const report = await run({ offsets: [{ email: "zz.unrelated@welld.ch", year: 2026, lastIssuedSeq: 81 }] });
    expect(report.baseline[0]?.employeeRef).toBe("MC · u1");
    expect((await line("a")).receiptNumber).toBe("MC26/082");
  });

  it("is idempotent: a rerun asks nobody, fills nothing and changes nothing", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    authNames.names.set("u1", "Marco Cattaneo");
    await run();
    authNames.asked.length = 0;
    authNames.names.set("u1", "Changed Later");
    const after = await snapshot();
    const second = await run();
    expect(authNames.asked).toEqual([]);
    expect(second.ownerNames).toEqual({ employeesNamed: 0, requestsNamed: 0, employeesUnnamed: 0 });
    expect(await snapshot()).toEqual(after);
    expect((await db.refundRequest.findFirstOrThrow()).ownerName).toBe("Marco Cattaneo");
  });

  it("auth failing on the SECOND employee, after the first was answered, writes nothing: the first name is not kept (QE delta 2026-11-20)", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    await request("u2", [{ id: "b", date: "2026-03-03" }], { name: null });
    authNames.names.set("u1", "Marco Cattaneo");
    authNames.names.set("u2", "Anna Rossi");
    const before = await snapshot();
    const asked: string[] = [];
    const rateLimitedOnU2 = {
      async lookup(userId: string) {
        asked.push(userId);
        if (userId === "u2") throw new OwnerNamesUnavailableError("rate_limited");
        return ownerNames.lookup(userId);
      },
    };
    const error = await run({ ownerNames: rateLimitedOnU2 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rate_limited" });
    expect(asked).toEqual(["u1", "u2"]); // sorted by user id: u1 was answered, u2 failed
    expect(await db.refundRequest.count({ where: { ownerName: { not: null } } })).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(await isAccountingReleased(db as never)).toBe(false);
  });

  it("a rerun after the release asks auth nothing, so an auth outage cannot stop it, and changes nothing (QE delta 2026-11-20, F-2)", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    await request("u2", [{ id: "b", date: "2026-03-03" }], { name: null, email: "gone.user@welld.ch" });
    authNames.names.set("u1", "Marco Cattaneo"); // u2 is gone in auth
    await run();
    authNames.asked.length = 0;
    const after = await snapshot();
    authNames.failWith = "unreachable";
    await run();
    expect(authNames.asked).toEqual([]); // released: nobody is asked, not even the employee still unnamed
    expect(await snapshot()).toEqual(after);
    expect((await line("b")).receiptNumber).toBe("GU26/001"); // numbered from the email at the release, untouched
  });

  it("the message of exit 4 says what was and was not done and names the scope to check", () => {
    expect(OWNER_NAMES_UNREADABLE_MESSAGE).toMatch(/nothing was named, numbered or classified; run again later/);
    expect(OWNER_NAMES_UNREADABLE_MESSAGE).toContain("users.contact");
  });
});

describe("the name the release filled reaches the export (eval round 4, 20261118 AC-6.13; 1f44c2e5)", () => {
  /** Puts a request into a compiled batch and returns the Description cells of the export file built from it. */
  async function descriptionsOfExport(requestId: string): Promise<string[]> {
    const batch = await db.refundBatch.create({
      data: { cutoff: new Date("2026-04-30"), status: "compiled", createdByUserId: "a", createdByEmail: "a@x", pdfObjectKey: `refund/batches/${crypto.randomUUID()}/compiled.pdf` },
    });
    await db.refundRequest.update({ where: { id: requestId }, data: { batchId: batch.id } });
    await db.refundBatchItem.create({ data: { batchId: batch.id, requestId } });
    const source = await loadExportSource(batch.id);
    const evaluated = evaluateExport(source!, { kind: "none" });
    expect(evaluated.summary.exportable).toBe(true);
    const book = readWorkbook(buildAccountingFile(evaluated.lines).bytes);
    return book.rows.slice(1).map((row) => cellValues(row)[1] as string);
  }

  it("a request with no name, filled by the release, is exported with the NAME in the Description, not the email", async () => {
    const r = await request("u1", [{ id: "l1", date: "2026-03-02" }], { name: null, email: "zz.unrelated@welld.ch" });
    authNames.names.set("u1", "Marco Cattaneo");
    await run();
    const [description] = await descriptionsOfExport(r.id);
    expect(description).toBe("m - MC26/001 - Marco Cattaneo");
    expect(description).not.toContain("zz.unrelated@welld.ch");
  });

  it("control: a request auth does not know (404) is exported with the email, as before", async () => {
    const r = await request("u2", [{ id: "l2", date: "2026-03-02" }], { name: null, email: "anna.rossi@welld.ch" });
    await run();
    expect((await descriptionsOfExport(r.id))[0]).toBe("m - AR26/001 - anna.rossi@welld.ch");
  });

  it("auth's answer is normalised before it is stored: bidi override and zero-width characters removed, capped at 200 code points", async () => {
    await request("u1", [{ id: "a", date: "2026-03-02" }], { name: null });
    await request("u2", [{ id: "b", date: "2026-03-03" }], { name: null });
    await request("u3", [{ id: "c", date: "2026-03-04" }], { name: null });
    authNames.names.set("u1", "Marco \u202ECattaneo\u200B");
    authNames.names.set("u2", `Anna ${"x".repeat(300)}`);
    authNames.names.set("u3", "\u202E\u200B\u2060"); // only format characters: no name
    const report = await run();
    const byOwner = Object.fromEntries((await db.refundRequest.findMany()).map((x) => [x.ownerUserId, x.ownerName]));
    expect(byOwner["u1"]).toBe("Marco Cattaneo");
    expect(Array.from(byOwner["u2"] as string).length).toBe(200);
    expect(byOwner["u2"]).toBe(`Anna ${"x".repeat(195)}`);
    expect(byOwner["u3"]).toBeNull();
    expect(report.ownerNames).toEqual({ employeesNamed: 2, requestsNamed: 2, employeesUnnamed: 1 });
    // The initials come from the cleaned name, not from the override character.
    expect((await line("a")).receiptNumber).toBe("MC26/001");
  });
});

describe("the auth client of the owners' names (T84)", () => {
  const tokens = () => {
    const calls = { minted: 0, invalidated: [] as string[] };
    return { calls, provider: { async getToken() { return `tok-${++calls.minted}`; }, invalidate(t: string) { calls.invalidated.push(t); } } };
  };
  const client = (respond: (req: { url: string; auth: string | null; body: unknown }) => unknown, t = tokens()) => ({
    t,
    port: createOwnerNameClient({
      baseUrl: "http://auth.test",
      tokens: t.provider,
      fetchImpl: (async (url: string, init: RequestInit) =>
        respond({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) })) as unknown as typeof fetch,
    }),
  });

  it("POSTs the user id to /system/users/contact with the service token, and reads {id, email, name}", async () => {
    const seen: unknown[] = [];
    const { port } = client((r) => {
      seen.push(r);
      return Response.json({ id: "u1", email: "m@welld.ch", name: "Marco Cattaneo" });
    });
    expect(await port.lookup("u1")).toEqual({ state: "found", name: "Marco Cattaneo" });
    expect(seen).toEqual([{ url: "http://auth.test/system/users/contact", auth: "Bearer tok-1", body: { userId: "u1" } }]);
  });

  it("404 is gone, not an error", async () => {
    const { port } = client(() => new Response("{}", { status: 404 }));
    expect(await port.lookup("u1")).toEqual({ state: "gone" });
  });

  it("a 401 re-mints the token once; a second 401 is `unauthorized`", async () => {
    let n = 0;
    const ok = client(() => (n++ === 0 ? new Response("", { status: 401 }) : Response.json({ id: "u1", email: "m@welld.ch", name: "A B" })));
    expect(await ok.port.lookup("u1")).toEqual({ state: "found", name: "A B" });
    expect(ok.t.calls.invalidated).toEqual(["tok-1"]);
    const bad = client(() => new Response("", { status: 401 }));
    expect(await bad.port.lookup("u1").catch((e: unknown) => e)).toMatchObject({ kind: "unauthorized" });
  });

  it("every other way of not getting a clean answer is an OwnerNamesUnavailableError of a known kind", async () => {
    const kinds: [Response | (() => never), (typeof OWNER_NAME_FAILURE_KINDS)[number]][] = [
      [new Response("", { status: 503 }), "server_error"],
      [new Response("", { status: 429 }), "rate_limited"],
      [new Response("", { status: 400 }), "unexpected"],
      [new Response("not json", { status: 200 }), "unexpected"],
      [Response.json({ id: "someone-else", email: "x", name: "N" }), "unexpected"],
      [Response.json({ id: "u1", email: "x" }), "unexpected"],
      [() => { throw new Error("connect ECONNREFUSED"); }, "unreachable"],
    ];
    for (const [answer, kind] of kinds) {
      const { port } = client(() => (typeof answer === "function" ? answer() : answer.clone()));
      const error = await port.lookup("u1").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OwnerNamesUnavailableError);
      expect((error as InstanceType<typeof OwnerNamesUnavailableError>).kind).toBe(kind);
      expect(OWNER_NAME_FAILURE_KINDS).toContain(kind);
      expect(String((error as Error).message)).not.toMatch(/ECONNREFUSED|auth\.test|tok-/);
    }
  });

  /**
   * CONTRACT with auth's route. `auth/src/system/userContact.routes.ts` is not importable here (it pulls auth's db and env, and its
   * zod schemas are module-private), so the shapes are written out as a fixture and each is cited:
   *   request  `UserContactRequestSchema` (userContact.routes.ts:54) = `{ userId: string 1..200 }` .strict(): exactly one key;
   *   answer   `UserContactResponseSchema` (userContact.routes.ts:56-60) = `{ id, email, name }`, all strings;
   *   404      unknown and soft-deleted users are the same 404 (file header; the 404 handler near :249-:300);
   *   path     `/system/users/contact`, POST (userContact.routes.ts:~73-76, `postUserContactRoute`).
   * If auth's schema changes, this fixture and the client change together; the second test reads auth's source so a drift fails here.
   */
  const AUTH_CONTRACT = {
    method: "POST",
    path: "/system/users/contact",
    requestKeys: ["userId"],
    userIdMax: 200,
    answer: { id: "u1", email: "m@welld.ch", name: "Marco Cattaneo" },
  } as const;

  it("contract: the client sends exactly the request auth's strict schema accepts, and reads exactly the answer it returns", async () => {
    const sent: { method: string; url: string; body: Record<string, unknown> }[] = [];
    const t = tokens();
    const port = createOwnerNameClient({
      baseUrl: "http://auth.test",
      tokens: t.provider,
      fetchImpl: (async (url: string, init: RequestInit) => {
        sent.push({ method: String(init.method), url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return Response.json(AUTH_CONTRACT.answer);
      }) as unknown as typeof fetch,
    });
    expect(await port.lookup("u1")).toEqual({ state: "found", name: AUTH_CONTRACT.answer.name });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe(AUTH_CONTRACT.method);
    expect(new URL(sent[0]!.url).pathname).toBe(AUTH_CONTRACT.path);
    expect(Object.keys(sent[0]!.body)).toEqual([...AUTH_CONTRACT.requestKeys]); // .strict(): no other key
    expect(typeof sent[0]!.body["userId"]).toBe("string");
  });

  it("contract drift guard: auth's route source still declares the same request keys, answer keys and path as the fixture", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "auth", "src", "system", "userContact.routes.ts"), "utf8");
    expect(source.includes(`path: "${AUTH_CONTRACT.path}"`)).toBe(true);
    // POST on THIS path: the route declaration pairs the two, and the handler is registered on the same path.
    expect(source).toMatch(new RegExp(`method: "post",\\s*path: "${AUTH_CONTRACT.path.replace(/\//g, "\\/")}"`));
    expect(source.includes(`router.post("${AUTH_CONTRACT.path}"`)).toBe(true);
    expect(source.includes(`UserContactRequestSchema = z.object({ userId: z.string().min(1).max(${AUTH_CONTRACT.userIdMax}) }).strict()`)).toBe(true);
    const answer = /UserContactResponseSchema = z\.object\(\{([^}]*)\}\)/.exec(source)?.[1] ?? "";
    expect([...answer.matchAll(/(\w+): z\.string\(\)/g)].map((m) => m[1])).toEqual(Object.keys(AUTH_CONTRACT.answer));
  });

  it("a token that cannot be minted is `token`", async () => {
    const port = createOwnerNameClient({ baseUrl: "http://auth.test", tokens: { async getToken() { throw new Error("x"); }, invalidate() {} } });
    expect(await port.lookup("u1").catch((e: unknown) => e)).toMatchObject({ kind: "token" });
  });
});

describe("Accounting holds no WellD CH accounts (AC-7.5)", () => {
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

  it("every legacy line is numbered and listed without an account, nothing is seeded, the report says why; a later approval of a WellD CH request is refused 409 classification_missing", async () => {
    fake = createFakeAccounting();
    await request("u1", [
      { id: "chf", date: "2026-03-02" },
      { id: "eur", date: "2026-03-03", currency: "EUR" },
      { id: "it", date: "2026-03-04", entity: "welld_it" },
    ]);
    const report = await run();

    expect(report.markerWritten).toBe(true);
    expect(report.lines.map((l) => l.receiptNumber)).toEqual(["MC26/001", "MC26/002"]);
    expect(report.unclassified.map((l) => [l.lineId, l.missing])).toEqual([
      ["chf", ["account"]],
      ["eur", ["account"]],
    ]);
    expect(report.seeded.typeDefaults).toEqual([]);
    expect(report.seeded.warnings.length).toBeGreaterThan(0);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
    const text = formatReport(report);
    expect(text).toContain("Accounting holds no active WellD CH ledger accounts");
    expect(text).toContain("Left without an account (2)");
    const l = await line("chf");
    expect([l.accountNumber, l.vatCodeCopy]).toEqual([null, null]);

    // The marker is set, so approvals are accepted again; a CH line then has nothing to be booked with.
    useFakeAccounting(fake);
    __resetAuthzCacheForTests();
    harness.setResolve(async () => perms);
    const submitted = await db.refundRequest.create({
      data: { ownerUserId: "u9", ownerEmail: "u9@welld.ch", ownerName: "Anna Rossi", status: "submitted", submittedAt: new Date("2026-11-20") },
    });
    await db.refundLine.create({
      data: { requestId: submitted.id, date: new Date("2026-11-10"), type: "travel_train", motivo: "m", entity: "welld_ch", currency: "CHF", requestedAmountCents: 1000 },
    });
    const token = await harness.signToken({ sub: "acct-1", email: "acct-1@welld.ch" });
    const res = await decideRouter.request(`/review/requests/${submitted.id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("classification_missing");
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: submitted.id } })).status).toBe("submitted");
  });
});

describe("Refund's default accounts (AC-8.3 of 20261118, SO-17, D20)", () => {
  it("seeds the fourteen type defaults where the file names an account, as COPIES by natural key, with the system actor, and no designation", async () => {
    const report = await run();
    expect(report.seeded.typeDefaults).toHaveLength(13); // gifts names no account: no row
    expect(report.seeded.typeDefaults).not.toContain("representation_gifts");
    for (const type of ["travel_flight", "travel_taxi", "company_manuals", "representation_meals"]) expect(report.seeded.typeDefaults).toContain(type);
    const km = await db.expenseTypeAccountingDefault.findFirstOrThrow({ where: { type: "travel_km" } });
    expect(km).toMatchObject({
      entity: "welld_ch",
      accountNumber: "5905",
      accountName: "Spese rimborsi chilometrici (viaggi)",
      createdByUserId: "system:accounting-seed",
      createdByEmail: "system-accounting-seed@welld.ch",
    });
    expect(Object.keys(km).filter((key) => /vat/i.test(key))).toEqual([]);
    const byType = Object.fromEntries((await db.expenseTypeAccountingDefault.findMany()).map((r) => [r.type, [r.accountNumber, r.accountName]]));
    expect(byType).toMatchObject({
      travel_flight: ["5902", "Spese viaggi in aereo"],
      travel_taxi: ["5903", "Spese viaggi taxi"],
      company_manuals: ["6501", "Libri e manuali"],
      representation_meals: ["6701", "Spese pranzi e cene con clienti"],
    });
    expect(await db.expenseTypeAccountingDefault.count({ where: { type: "representation_gifts" } })).toBe(0);

    const recorded = await loadRecordedDefaults();
    expect(Object.keys(recorded)).toEqual(["defaults"]);
    expect(recorded.defaults.representation_gifts).toBeUndefined();
    await expect(Promise.resolve(db.$executeRawUnsafe(`UPDATE "expense_type_accounting_default" SET "accountNumber" = NULL WHERE id = $1`, km.id))).rejects.toThrow();
    const tables = await db.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE tablename = 'foreign_currency_vat_designation'`);
    expect(tables).toEqual([]);
  });

  it("(AC-8.3) on an empty database the release gives the gifts type no default account, so a gifts line is numbered, listed without an account, and refused at approval until one is chosen", async () => {
    await request("u1", [{ id: "gift", date: "2026-03-02", type: "representation_gifts" }]);
    const report = await run();
    expect(await db.expenseTypeAccountingDefault.findMany({ where: { type: "representation_gifts" } })).toEqual([]);
    expect((await line("gift")).receiptNumber).toBe("MC26/001");
    expect((await line("gift")).accountNumber).toBeNull(); // numbered with no account: it is reported, never guessed
    expect(report.unclassified.map((u) => [u.lineId, u.missing])).toEqual([["gift", ["account"]]]);
  });

  it("never creates anything in Accounting: it only reads (a reader's projection has no write at all)", async () => {
    await run();
    expect(fake.calls.every((c) => c.read === "referenceData" || c.read === "rates")).toBe(true);
  });

  it("an admin's earlier choice for a type (even an explicit none) is kept, and nothing is appended for it", async () => {
    await db.expenseTypeAccountingDefault.create({ data: { entity: "welld_ch", type: "postal", ...admin } });
    await db.expenseTypeAccountingDefault.create({
      data: { entity: "welld_ch", type: "telephone", accountNumber: "5901", accountName: "My own name", ...admin },
    });
    const report = await run();
    expect(report.seeded.typeDefaults).not.toContain("postal");
    expect(report.seeded.typeDefaults).not.toContain("telephone");
    expect(await db.expenseTypeAccountingDefault.count({ where: { type: "postal" } })).toBe(1);
    const telephone = await db.expenseTypeAccountingDefault.findMany({ where: { type: "telephone" } });
    expect(telephone).toHaveLength(1);
    expect(telephone[0]!.accountName).toBe("My own name");
  });

  it("does not seed a default whose account is deactivated or missing in Accounting, and says so", async () => {
    fake.setAccountActive("6104", false);
    const report = await run();
    expect(report.seeded.warnings.join("\n")).toContain("6104");
    expect(report.seeded.warnings.join("\n")).toContain("deactivated");
    expect(await db.expenseTypeAccountingDefault.count({ where: { type: "postal" } })).toBe(0);
    expect(report.seeded.typeDefaults).not.toContain("postal");

    // An account the file names that Accounting does not hold at all is "not found" in the warning.
    await truncateRefundTables({ released: false });
    fake = fullAccounting();
    fake.removeAccount("5905");
    const second = await run();
    expect(second.seeded.warnings.join("\n")).toMatch(/5905 is not found/);
    expect(await db.expenseTypeAccountingDefault.count({ where: { type: "travel_km" } })).toBe(0);
  });

  it("(AC-7.5) a VAT code list that is empty, or has no active code, changes nothing of the seed or of the report's warnings", async () => {
    for (const code of ["IPM81", "IPM77", "IP00", "BZM81", "IPM26", "IPM38"]) fake.removeVatCode(code);
    const report = await run();
    expect(report.seeded.typeDefaults).toHaveLength(13);
    expect(report.seeded.warnings).toEqual([]);
    expect(report.accounting.vatCodes).toEqual({ active: 0, total: 0 });
    expect(formatReport(report)).not.toContain("WARNING");
  });
});

describe("idempotence and dry run", () => {
  it("a second run changes nothing, not even a second marker", async () => {
    fake.setRate("EUR", "2026-03", 924_600);
    await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-03", currency: "EUR" }]);
    await request("u2", [{ id: "l3", date: "2026-03-04", type: "postal" }], { name: "Anna Rossi" });
    await run();
    const before = await snapshot();
    const second = await run();
    expect(await snapshot()).toEqual(before);
    expect(second).toMatchObject({ alreadyCompleted: { at: expect.any(String) }, markerWritten: false, lines: [], unclassified: [], ratePending: [] });
    expect(formatReport(second)).toContain("already completed");
    expect(second.seeded).toMatchObject({ typeDefaults: [] });
    expect(second.seeded).not.toHaveProperty("foreignCurrencyVatCode");
    expect(await db.refundSetting.count({ where: { key: "accounting-release-completed-at" } })).toBe(1);
  });

  it("--dry-run reads Accounting, writes nothing and reports exactly what the real run then does, rates included", async () => {
    fake.setRate("EUR", "2026-03", 924_600);
    await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-01", type: "postal" }, { id: "l3", date: "2026-03-07", currency: "EUR" }]);
    const before = await snapshot();
    const dry = await run({ dryRun: true });
    expect(await snapshot()).toEqual(before);
    expect(dry.dryRun).toBe(true);
    expect(fake.reads.total).toBeGreaterThan(0);
    expect(await db.$transaction((tx) => isAccountingReleased(tx))).toBe(false);
    const view = (r: typeof dry) => r.lines.map((l) => [l.lineId, l.receiptNumber, l.account, l.rate]);
    expect(view(dry)).toEqual([
      ["l2", "MC26/001", "6104", null],
      ["l1", "MC26/002", "5901", null],
      ["l3", "MC26/003", "5901", "0.9246"],
    ]);
    expect(formatReport(dry)).toContain("DRY RUN");
    expect(formatReport(dry)).toContain("MC26/002");
    expect(formatReport(dry)).toContain("0.9246");

    const real = await run();
    expect(view(real)).toEqual(view(dry));
    expect(real.dryRun).toBe(false);
  });
});

describe("the baseline (T63 of 20261119, rewritten by T12 of 20261124: AC-3.1, AC-4.12, AC-4.13, AC-2.8)", () => {
  const baselineRows = () => db.receiptNumberBaseline.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const counterOf = (ownerUserId: string, year: number) => db.receiptCounter.findUnique({ where: { ownerUserId_year: { ownerUserId, year } } });

  it("numbering starts after the offsets row (81 gives 082), the table holds the row under the lower-cased email, and the counter says it started from the baseline", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-03" }], { email: "matteo.codogno@welld.ch" });
    const report = await run({ offsets: [{ email: "Matteo.Codogno@welld.ch", year: 2026, lastIssuedSeq: 81 }] });
    expect(report.baseline).toEqual([{ employeeRef: "MC · u1", baseline: 81, outcome: "written" }]);
    expect((await line("l1")).receiptNumber).toBe("MC26/082");
    expect((await line("l2")).receiptNumber).toBe("MC26/083");
    expect(await counterOf("u1", 2026)).toMatchObject({ lastSeq: 83, startAfter: 81, startAfterSetBy: "baseline" });
    expect(await baselineRows()).toMatchObject([
      { emailKey: "matteo.codogno@welld.ch", year: 2026, lastIssuedSeq: 81, createdByUserId: "system:accounting-release" },
    ]);
  });

  it("an employee in the list with no Refund request at release is accepted, reported as not yet in Refund with no email, and no counter is made for them", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    const report = await run({
      offsets: [
        { email: "m@welld.ch", year: 2026, lastIssuedSeq: 10 },
        { email: "Newcomer@welld.ch", year: 2026, lastIssuedSeq: 40 },
      ],
    });
    expect(report.baseline.map((b) => [b.employeeRef, b.baseline, b.outcome])).toEqual([
      ["MC · u1", 10, "written"],
      ["not yet in Refund", 40, "written"],
    ]);
    expect((await baselineRows()).map((r) => [r.emailKey, r.lastIssuedSeq])).toEqual([
      ["m@welld.ch", 10],
      ["newcomer@welld.ch", 40],
    ]);
    expect(await db.receiptCounter.count()).toBe(1); // only Matteo's, made by the numbering
    expect((await line("l1")).receiptNumber).toBe("MC26/011");
    const text = formatReport(report);
    expect(text).toContain("not yet in Refund 2026: numbering continues after 40 (written)");
    expect(text).toContain("MC · u1 2026: numbering continues after 10 (written)");
    // D-10: a group of one reads "1 line", never "1 lines"
    expect(text).toContain("2026: 1 line, MC26/011 to MC26/011");
    expect(text).not.toMatch(/\b1 lines\b/);
    expect(text).not.toContain("@");
    expect(text.toLowerCase()).not.toContain("newcomer");
  });

  it("the release makes no counter for an employee who has no line to number: the baseline row waits for the counter's creation (receipt.baseline.test.ts)", async () => {
    await request("u1", [], { email: "late@welld.ch" }); // a request with no line at all
    await run({ offsets: [{ email: "late@welld.ch", year: 2026, lastIssuedSeq: 7 }] });
    expect(await db.receiptCounter.count()).toBe(0);
    expect((await baselineRows()).map((r) => [r.emailKey, r.lastIssuedSeq])).toEqual([["late@welld.ch", 7]]);
  });

  it("a row for any year but 2026 is refused (AC-4.12), and then NOTHING is written", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    const before = await snapshot();
    for (const year of [2025, 2027]) {
      await expect(run({ offsets: [{ email: "m@welld.ch", year, lastIssuedSeq: 5 }] })).rejects.toThrow(/only 2026 continues the paper register/);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("a sequence outside 1..99999, and the same email twice, are refused whatever the case, and write nothing", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    const before = await snapshot();
    for (const lastIssuedSeq of [0, 100_000, -1, 1.5]) {
      await expect(run({ offsets: [{ email: "m@welld.ch", year: 2026, lastIssuedSeq }] })).rejects.toThrow(/whole number from 1 to 99999/);
    }
    await expect(
      run({ offsets: [{ email: "m@welld.ch", year: 2026, lastIssuedSeq: 5 }, { email: "M@Welld.ch", year: 2026, lastIssuedSeq: 6 }] }),
    ).rejects.toThrow(/appear twice/);
    expect(await snapshot()).toEqual(before);
  });

  it("is refused for an employee whose 2026 counter already exists with another start, and then NOTHING is written", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    await db.receiptCounter.create({ data: { ownerUserId: "u1", year: 2026, lastSeq: 3, startAfter: 0 } });
    const before = await snapshot();
    await expect(run({ offsets: [{ email: "m@welld.ch", year: 2026, lastIssuedSeq: 81 }] })).rejects.toThrow(/counter already exists/);
    expect(await snapshot()).toEqual(before);
    expect((await line("l1")).receiptNumber).toBeNull();
  });

  it("an email behind two user ids is refused: each would start after it and repeat the other's numbers; nothing is written", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    await request("u2", [], { email: "x@welld.ch" });
    await request("u3", [], { email: "X@welld.ch" });
    const before = await snapshot();
    await expect(run({ offsets: [{ email: "x@welld.ch", year: 2026, lastIssuedSeq: 5 }] })).rejects.toThrow(/more than one user id/);
    expect(await snapshot()).toEqual(before);
    expect((await line("l1")).receiptNumber).toBeNull();
  });

  it("a row for any of the employee's request emails applies, and is written under the newest one (the counter reads them all)", async () => {
    const r = await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "old@welld.ch" });
    await db.refundRequest.create({ data: { ownerUserId: "u1", ownerEmail: "new@welld.ch", ownerName: "Matteo Codogno", status: "draft", createdAt: new Date(r.createdAt.getTime() + 60_000) } });
    const report = await run({ offsets: [{ email: "old@welld.ch", year: 2026, lastIssuedSeq: 5 }] });
    expect(report.baseline).toEqual([{ employeeRef: "MC · u1", baseline: 5, outcome: "written" }]);
    expect((await baselineRows()).map((x) => [x.emailKey, x.lastIssuedSeq])).toEqual([["new@welld.ch", 5]]);
    expect((await line("l1")).receiptNumber).toBe("MC26/006");
  });

  it("(AC-2.8) a real run with no register or no pairing, and a dry run with no mode, are refused with InputMissingError (exit 5) and write nothing", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-03" }], { email: "m@welld.ch" });
    const before = await snapshot();
    const base = { now: () => NOW, accounting: { begin: (name: Parameters<Fake["begin"]>[0]) => fake.begin(name) }, ownerNames, offsets: [] };
    const inputs = await proposeAndConfirm({ run: (o) => runAccountingRelease({ ...base, ...o }) });
    fake.resetCalls();
    for (const over of [
      {},
      { register: inputs.register },
      { pairing: inputs.pairing },
      { register: inputs.register, propose: true },
      { dryRun: true },
      { dryRun: true, register: inputs.register },
      { dryRun: true, register: inputs.register, propose: true, pairing: inputs.pairing },
    ]) {
      const error = await runAccountingRelease({ ...base, ...over }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InputMissingError);
      expect((error as InstanceType<typeof InputMissingError>).exit).toBe(5);
    }
    expect(await snapshot()).toEqual(before);
    expect(await isAccountingReleased(db as never)).toBe(false);
    expect((await line("l1")).receiptNumber).toBeNull();
    // Accounting is read first even then: a refusal for missing inputs comes after it (the exit table follows the order of the run)
    expect(fake.reads.total).toBeGreaterThan(0);
  });

  it("(AC-7.4) an unreadable Accounting still comes first: missing inputs AND Accounting down is the Accounting error", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    fake.failWith("timeout");
    const base = { now: () => NOW, accounting: { begin: (name: Parameters<Fake["begin"]>[0]) => fake.begin(name) }, ownerNames, offsets: [] };
    await expect(runAccountingRelease(base)).rejects.toBeInstanceOf(AccountingUnavailableError);
    await expect(runAccountingRelease({ ...base, dryRun: true })).rejects.toBeInstanceOf(AccountingUnavailableError);
  });

  it("(AC-4.12) with no offsets list at all the lines are numbered from 001, the report says so, and no baseline row exists", async () => {
    await request("u1", [{ id: "l1", date: "2026-03-02" }], { email: "m@welld.ch" });
    const report = await run({ offsets: [] });
    expect(report.baseline).toEqual([]);
    expect((await line("l1")).receiptNumber).toBe("MC26/001");
    expect(await db.receiptNumberBaseline.count()).toBe(0);
    expect(await counterOf("u1", 2026)).toMatchObject({ lastSeq: 1, startAfter: 0, startAfterSetBy: null });
    expect(formatReport(report)).toContain("none: numbering starts at 001");
  });

  it("2027 restarts at 001 whatever the baseline and the 2026 sequence (AC-4.13), and 2025 is not continued either", async () => {
    await request("u1", [{ id: "a", date: "2025-12-30" }, { id: "b", date: "2026-03-02" }, { id: "c", date: "2027-01-05" }], { email: "m@welld.ch" });
    await run({ offsets: [{ email: "m@welld.ch", year: 2026, lastIssuedSeq: 141 }] });
    expect([(await line("a")).receiptNumber, (await line("b")).receiptNumber, (await line("c")).receiptNumber]).toEqual(["MC25/001", "MC26/142", "MC27/001"]);
    expect(await counterOf("u1", 2025)).toMatchObject({ startAfter: 0, startAfterSetBy: null });
    expect(await counterOf("u1", 2027)).toMatchObject({ startAfter: 0, startAfterSetBy: null });
  });
});

// ─── Fix round 1 (T41): D-1, SR-3, SR-4 ──────────────────────────────────────

describe("the report (D-1, SR-4)", () => {
  async function legacy() {
    await request("u1", [{ id: "l1", date: "2026-03-02" }, { id: "l2", date: "2026-03-03", type: "representation_gifts" }], { email: "matteo.codogno@welld.ch" });
  }

  it("D-1: a dry run never says the marker was written; the real run says yes; a later run says it was already set", async () => {
    await legacy();
    const dry = formatReport(await run({ dryRun: true }));
    expect(dry).toContain("Release marker written: no (dry run: the real run would write it)");
    expect(dry).not.toContain("Release marker written: yes");
    expect(formatReport(await run())).toContain("Release marker written: yes");
    expect(formatReport(await run())).toContain("already completed");
    expect(formatReport(await run({ dryRun: true }))).toContain("already completed");
  });

  it("SR-4: an employee is `<prefix> · <first 8 characters of the user id>`, and no `@` and no name appears anywhere (--show-emails no longer exists)", async () => {
    await request("0123456789abcdef", [{ id: "l1", date: "2026-03-02" }], { email: "matteo.codogno@welld.ch", name: "Matteo Codogno" });
    const report = await run({ dryRun: true, offsets: [{ email: "matteo.codogno@welld.ch", year: 2026, lastIssuedSeq: 4 }] });
    const text = formatReport(report);
    expect(text).not.toContain("@");
    expect(text).not.toContain("Matteo");
    expect(text).not.toContain("Codogno");
    expect(text).toContain("MC · 01234567");
    expect(text).not.toContain("89abcdef");
  });

  it("SR-4: the unclassified lines are listed by the same reference", async () => {
    await legacy();
    const text = formatReport(await run({ dryRun: true }));
    expect(text).toMatch(/Left without an account \(1\)\n {2}MC26\/002 MC · u1 2026-03-03 representation_gifts/);
    expect(text).not.toContain("@");
  });
});

describe("describeReleaseFailure (F-03)", () => {
  it("a ReleaseError prints its own, already masked, message", () => {
    expect(describeReleaseFailure(new ReleaseError("usage", "unknown argument --x"))).toBe("unknown argument --x");
  });

  it("any other error prints its kind (and a plain error code), never its message, which can carry an address, a host or a credential", () => {
    const driver = Object.assign(new Error("connect ECONNREFUSED postgresql://user:secret@db.internal:5432/refund for matteo.codogno@welld.ch"), {
      name: "PrismaClientInitializationError",
      code: "P1001",
    });
    const text = describeReleaseFailure(driver);
    expect(text).toBe("PrismaClientInitializationError (P1001)");
    expect(text).not.toMatch(/secret|db\.internal|@|matteo/);
    expect(describeReleaseFailure(new TypeError("x@y.ch"))).toBe("TypeError");
    expect(describeReleaseFailure(Object.assign(new Error("m"), { code: "has spaces and secret@x.ch" }))).toBe("Error");
    expect(describeReleaseFailure(Object.assign(new Error("m"), { name: "Evil\nname secret@x.ch" }))).toBe("Error");
    expect(describeReleaseFailure("secret@x.ch")).toBe("an unknown error");
    expect(describeReleaseFailure(null)).toBe("an unknown error");
  });
});

describe(".gitignore keeps the operator files out of the repository (SR-3, S-03; AC-5.6)", () => {
  const root = join(import.meta.dir, "..", "..");
  const ignored = (path: string) => Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd: root }).exitCode === 0;

  it("ignores offsets CSVs and accounting-offsets files anywhere in the tree", () => {
    for (const path of ["refund-api/offsets.csv", "refund-api/scripts/accounting-offsets.csv", "accounting-offsets", "refund-api/accounting-offsets.txt", "refund-api/data/paper-offsets-2026.csv", "x/y/z/offsets.csv"]) {
      expect(ignored(path)).toBe(true);
    }
  });
  it("ignores a pairing file and the accountant's register export anywhere in the tree", () => {
    for (const path of ["refund-api/pairing-2026.csv", "refund-api/scripts/release-pairing.csv", "x/y/pairing-check.csv", "refund-api/Recap_RS_2026.xlsx", "Recap_RS_2026 (copy).xlsx", "a/b/Recap_RS_2025.xls"]) {
      expect(ignored(path)).toBe(true);
    }
  });
  it("does not ignore the script, its tests, its defaults file or the committed header-only fixture", () => {
    for (const path of ["refund-api/scripts/accounting-release.ts", "refund-api/scripts/accounting-release.test.ts", "refund-api/scripts/data/accounting-defaults.welld-ch.json", "refund-api/scripts/fixtures/synthetic-register-header-only.xlsx", "refund-api/scripts/release/pairingFile.ts"]) {
      expect(ignored(path)).toBe(false);
    }
  });
  it("no tracked file matches the patterns", () => {
    const tracked = new TextDecoder().decode(Bun.spawnSync(["git", "ls-files"], { cwd: root }).stdout).split("\n");
    expect(tracked.filter((f) => /offsets.*\.csv$/.test(f) || /accounting-offsets/.test(f) || /pairing.*\.csv$/i.test(f) || /Recap_RS/.test(f))).toEqual([]);
  });
});
