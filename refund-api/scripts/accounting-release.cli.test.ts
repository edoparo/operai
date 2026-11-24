/**
 * The release script as an OPERATOR runs it: `bun run scripts/accounting-release.ts [--dry-run] --register <xlsx> (--propose <csv> | --pairing <csv>)`
 * (QE pass T35, specs/20261118-refund-accounting-export; reworked by T22 and T63 of specs/20261119-accounting, and by T12 of
 * specs/20261124-receipt-numbers-from-the-register: the three steps propose, check and run; AC-2.1, AC-2.3, AC-2.8, AC-5.1, AC-5.3, AC-5.6).
 *
 * `cli(...)` does what the operator does with a register that has nothing to decide (the header-only workbook): it PROPOSES a pairing file,
 * confirms every proposed record, and then runs the arguments given with `--register` and `--pairing` added, so the journeys of the
 * older rounds still run as an operator with no paper numbers would. `cliBare(...)` runs exactly the arguments given.
 *
 * `accounting-release.test.ts` drives `runAccountingRelease()` in process, with a fake `AccountingPort`. What no in-process test
 * runs is the entry point itself (argument parsing, the report on stdout, the exit code, "nothing was changed" on failure), and
 * that is the one thing the owner types in production (infra/README.md runbook). A bad flag or a crash that still exits 0 would
 * leave approvals blocked (409 `accounting_release_pending`) or, worse, report a success that did not happen; and Accounting that
 * cannot be read must end the run with EXIT 2 and nothing written (AC-7.4).
 *
 * The child runs the REAL client: `NODE_ENV=development` (the service-token provider is disabled under `test`), `AUTH_BASE_URL`
 * and `ACCOUNTING_INTERNAL_URL` pointing at a small server of this test that plays `auth POST /system/service-token` and
 * accounting-api's two `/system/v1` reads, on the wire the contract describes. So the whole path is the production one: the token
 * mint, the Bearer, the schema, the chunked rate reads and the exit code.
 *
 * Real Postgres (the `refund` database of DATABASE_URL), the script run as a child process with the same environment.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { isAccountingReleased } from "../src/accounting/release";
import { confirmProposed, editPairing } from "../src/test-support/releaseRun";
import { buildRegisterWorkbook, headerOnlyRegisterWorkbook } from "../src/test-support/registerWorkbook";
import { truncateRefundTables } from "../src/test-support/dbCleanup";

const SCRIPT = join(import.meta.dir, "accounting-release.ts");
const tmp = mkdtempSync(join(tmpdir(), "accounting-release-cli-"));

// ─── Auth and Accounting, as the wire has them ───────────────────────────────

const TOKEN = "cli-test-service-jwt";
const ACCOUNTS: readonly [string, string][] = [
  ["5901", "Spese viaggi in treno"],
  ["5902", "Spese viaggi in aereo"],
  ["5903", "Spese viaggi taxi"],
  ["5904", "Spese viaggi altri mezzi pubblici"],
  ["5905", "Spese rimborsi chilometrici (viaggi)"],
  ["5906", "Spese autostrade (viaggi)"],
  ["5907", "Spese parcheggio (viaggi)"],
  ["6101", "Spese materiale ufficio"],
  ["6102", "Spese telefoniche, fax, internet"],
  ["6104", "Spese postali"],
  ["6501", "Libri e manuali"],
  ["6701", "Spese pranzi e cene con clienti"],
];
const VAT: readonly [string, string, number][] = [
  ["IPM81", "IVA 8.1%", 810],
  ["IPM77", "IVA 7.7%", 770],
  ["IP00", "IVA 0%", 0],
];

const world = { down: false, empty: false, rates: new Map<string, number>(), requests: [] as string[], mints: 0, contacts: new Map<string, string>(), contactStatus: 200 };

let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      world.requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (url.pathname === "/system/service-token" && request.method === "POST") {
        world.mints++;
        return Response.json({ token: TOKEN, expiresInSeconds: 300 });
      }
      if (world.down) return new Response("unavailable", { status: 503 });
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("no", { status: 401 });
      if (url.pathname === "/system/users/contact" && request.method === "POST") {
        // auth's POST /system/users/contact: scope users.contact; 404 for an unknown or deleted user (T84).
        if (world.contactStatus !== 200) return new Response("", { status: world.contactStatus });
        return request.json().then((raw) => {
          const body = raw as { userId: string };
          const name = world.contacts.get(body.userId);
          return name === undefined ? new Response("{}", { status: 404 }) : Response.json({ id: body.userId, email: "x@welld.ch", name });
        });
      }
      if (url.pathname === "/system/v1/entities/welld_ch/reference-data") {
        return Response.json({
          entity: "welld_ch",
          ownCurrency: "CHF",
          ledgerAccounts: world.empty ? [] : ACCOUNTS.map(([number, name]) => ({ number, name, active: true })),
          vatCodes: world.empty ? [] : VAT.map(([code, label, rateBasisPoints]) => ({ code, label, rateBasisPoints, active: true })),
        });
      }
      if (url.pathname === "/system/v1/entities/welld_ch/rates") {
        const pairs = (url.searchParams.get("pairs") ?? "").split(",").filter(Boolean);
        // As accounting-api (RATE_MONTH_FLOOR): one month before 2000-01 refuses the WHOLE request, 400 invalid_pairs.
        if (pairs.some((pair) => (pair.split(":")[1] ?? "") < "2000-01")) {
          return Response.json({ type: "about:blank", title: "Bad Request", status: 400, code: "invalid_pairs" }, { status: 400 });
        }
        return Response.json({
          entity: "welld_ch",
          rates: pairs.map((pair) => {
            const [currency, month] = pair.split(":") as ["EUR" | "USD" | "GBP", string];
            const rateMicros = world.rates.get(pair);
            return rateMicros !== undefined
              ? { currency, month, status: "in_effect", rateMicros, origin: "fetched", attempted: false }
              : { currency, month, status: "missing", attempted: false, reason: "not_published" };
          }),
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

beforeEach(async () => {
  await truncateRefundTables({ released: false });
  world.down = false;
  world.empty = false;
  world.rates.clear();
  world.requests.length = 0;
  world.mints = 0;
  world.contacts.clear();
  world.contactStatus = 200;
});
afterAll(async () => {
  server.stop(true);
  await truncateRefundTables({ released: false });
  rmSync(tmp, { recursive: true, force: true });
});

/** The workbook of the header row only: no worker, no number, so every line has no paper counterpart (T7). */
const REGISTER = join(tmp, "register-header-only.xlsx");
writeFileSync(REGISTER, headerOnlyRegisterWorkbook());

let fileCounter = 0;
const fresh = (name: string) => join(tmp, `${++fileCounter}-${name}`);

/**
 * The release as the operator types it, in three steps, with the header-only register: PROPOSE to a new file, confirm every proposed
 * record, then run the arguments given with `--register` and `--pairing` added. A propose that fails (Accounting down, an unreachable
 * database, a usage error) is the result, as it would be for the operator. `world.requests` counts only the last step.
 */
async function cli(...args: string[]) {
  return cliWith({}, ...args);
}

async function cliWith(env: Record<string, string>, ...args: string[]) {
  const proposalPath = fresh("proposal.csv");
  const propose = await cliBare(env, "--dry-run", "--register", REGISTER, "--propose", proposalPath, ...args.filter((a) => a !== "--dry-run"));
  if (propose.exitCode !== 0) return propose;
  const confirmedPath = fresh("confirmed.csv");
  writeFileSync(confirmedPath, confirmProposed(readFileSync(proposalPath, "utf8")), { mode: 0o600 });
  world.requests.length = 0;
  world.mints = 0;
  return cliBare(env, ...args, "--register", REGISTER, "--pairing", confirmedPath);
}

async function cliBare(env: Record<string, string>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, SCRIPT, ...args], {
    env: { ...process.env, NODE_ENV: "development", AUTH_BASE_URL: baseUrl, ACCOUNTING_INTERNAL_URL: baseUrl, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

/** An approved request of Matteo Codogno with one WellD CH line per spec, plus an approved WellD Italia line. */
async function legacyRequest(dates: string[], currency: "CHF" | "EUR" = "CHF") {
  const request = await db.refundRequest.create({
    data: { ownerUserId: "u-matteo", ownerEmail: "matteo.codogno@welld.ch", ownerName: "Matteo Codogno", status: "approved", submittedAt: new Date("2026-03-01") },
  });
  const ids: string[] = [];
  for (const date of dates) {
    const l = await db.refundLine.create({
      data: { requestId: request.id, date: new Date(date), type: "travel_train", motivo: "m", entity: "welld_ch", currency, requestedAmountCents: 1000, approvedTotalCents: 1000 },
    });
    ids.push(l.id);
  }
  const it = await db.refundLine.create({
    data: { requestId: request.id, date: new Date("2026-03-01"), type: "travel_train", motivo: "it", entity: "welld_it", currency: "CHF", requestedAmountCents: 500, approvedTotalCents: 500 },
  });
  return { ids, itId: it.id };
}

const released = () => db.$transaction((tx) => isAccountingReleased(tx));
const numbers = async (ids: string[]) =>
  (await db.refundLine.findMany({ where: { id: { in: ids } }, orderBy: { date: "asc" } })).map((l) => l.receiptNumber);

/** Every refund table's row count: what a propose or a refusal must leave as it was. */
async function footprint() {
  return {
    audit: await db.refundAuditEntry.count(),
    settings: await db.refundSetting.count(),
    baseline: await db.receiptNumberBaseline.count(),
    counters: await db.receiptCounter.count(),
    defaults: await db.expenseTypeAccountingDefault.count(),
    numbered: await db.refundLine.count({ where: { receiptNumber: { not: null } } }),
    named: await db.refundRequest.count({ where: { ownerName: { not: null } } }),
    requests: await db.refundRequest.count(),
    lines: await db.refundLine.count(),
    codes: await db.receiptCode.count(),
  };
}

describe("accounting:release, run as the operator runs it", () => {
  it("an unknown argument exits 1 with the usage and changes nothing", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const res = await cli("--dryrun");
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("accounting:release failed, nothing was changed");
    expect(res.stderr).toContain("unknown argument --dryrun");
    expect(res.stdout).not.toContain("Accounting release completed");
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
    expect(world.requests).toEqual([]); // the arguments are checked before anything is asked of Accounting
  });

  it("(AC-5.6) --show-emails is refused as removed, naming the reason, and changes nothing", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const res = await cliBare({}, "--dry-run", "--show-emails", "--register", REGISTER, "--propose", fresh("p.csv"));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--show-emails was removed");
    expect(res.stderr).toContain("AC-5.6");
    expect(res.stdout).toBe("");
    expect(await numbers(ids)).toEqual([null]);
    expect(world.requests).toEqual([]);
  });

  it("(SO-17) --defaults with a file of the old world (a VAT code, or the foreign-currency VAT code) exits 1 and changes nothing, before Accounting is asked", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    for (const [name, body] of [
      ["entry-vat.json", { typeDefaults: { postal: { ledgerAccount: "6104", vatCode: "IPM81" } } }],
      ["designation.json", { typeDefaults: { postal: { ledgerAccount: "6104" } }, foreignCurrencyVatCode: "IP00" }],
    ] as const) {
      const file = join(tmp, name);
      writeFileSync(file, JSON.stringify(body));
      const res = await cli("--defaults", file);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("accounting:release failed, nothing was changed");
      expect(res.stderr).toMatch(/vatCode|foreignCurrencyVatCode/);
      expect(res.stdout).not.toContain("Accounting release completed");
    }
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
    expect(world.requests).toEqual([]);
  });

  it("a flag with no value exits 1 and changes nothing", async () => {
    await legacyRequest(["2026-03-02"]);
    for (const flag of ["--offsets", "--register", "--pairing", "--propose", "--sheet"]) {
      const res = await cliBare({}, "--dry-run", flag);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(`${flag} needs a value`);
    }
    expect(await released()).toBe(false);
  });

  it("--dry-run (check) prints what would happen, every line, and writes nothing: no marker, no seed, no number", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    const res = await cli("--dry-run");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("DRY RUN (check): nothing was written");
    expect(res.stdout).toContain("Numbered legacy WellD CH lines (2)");
    // D-1 (qe-report.md): the report must not claim the marker was written by a dry run.
    expect(res.stdout).not.toContain("Release marker written: yes");
    expect(res.stdout).toMatch(/Release marker written: no \(dry run: the real run would write it\)/);
    expect(res.stdout).not.toContain("Accounting release completed");
    expect(res.stdout).toMatch(/MC26\/001 {2}new {2}2026-03-02/);
    expect(res.stdout).toMatch(/MC26\/002 {2}new {2}2026-03-10/);
    expect(res.stdout).toContain("WellD Italia lines of approved or paid requests left without a number: 1");
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null, null]);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
    expect(await db.receiptCounter.count()).toBe(0);
    // It did read Accounting: the report is what the real run would do.
    expect(world.requests.some((r) => r.includes("/reference-data"))).toBe(true);
  });

  it("the real run releases: marker, seed, classification and numbers by date, the Italian line untouched; a second run is 'already completed' and changes nothing", async () => {
    const { ids, itId } = await legacyRequest(["2026-03-10", "2026-03-02"]);
    const first = await cli();
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("Accounting release completed.");
    expect(first.stdout).toContain("Release marker written: yes");
    expect(await released()).toBe(true);
    expect(await numbers(ids)).toEqual(["MC26/001", "MC26/002"]); // by expense date: 03-02 first
    const classified = await db.refundLine.findMany({ where: { id: { in: ids } } });
    expect(classified.every((l) => l.accountNumber === "5901" && l.vatCodeCopy === null)).toBe(true); // an account, never a VAT code
    const it = await db.refundLine.findUniqueOrThrow({ where: { id: itId } });
    expect([it.receiptNumber, it.accountNumber, it.vatCodeCopy]).toEqual([null, null, null]); // AC-7.3

    const before = await footprint();
    world.requests.length = 0;
    const second = await cliBare({});
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("was already completed");
    expect(await numbers(ids)).toEqual(["MC26/001", "MC26/002"]);
    expect(await footprint()).toEqual(before);
    expect(world.requests).toEqual([]); // not even a token: nothing was read, from anybody
  });

  it("(AC-5.3, D11) after completion ANY inputs exit 0 'already completed', ask nobody and write nothing: none, wrong ones, a missing file, a decided one", async () => {
    await legacyRequest(["2026-03-02"]);
    expect((await cli()).exitCode).toBe(0);
    const before = await footprint();
    world.requests.length = 0;
    const garbage = fresh("garbage.xlsx");
    writeFileSync(garbage, "not a workbook");
    for (const args of [
      [],
      ["--register", garbage, "--pairing", garbage],
      ["--register", "/does/not/exist.xlsx", "--pairing", "/does/not/exist.csv"],
      ["--dry-run"],
      ["--dry-run", "--register", REGISTER, "--propose", fresh("never-written.csv")],
      ["--offsets", garbage],
    ]) {
      const res = await cliBare({}, ...args);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("was already completed");
      expect(res.stdout).not.toContain("Accounting release completed");
    }
    expect(await footprint()).toEqual(before);
    expect(world.requests).toEqual([]);
    expect(existsSync(join(tmp, `${fileCounter}-never-written.csv`))).toBe(false);
  });

  it("(AC-7.4) Accounting that answers 503 ends the run with EXIT 2 and the message, and NOTHING is written; a rerun once it is back works", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    world.down = true;
    const res = await cli();
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Accounting cannot be read: nothing was numbered or classified; run again later");
    expect(res.stdout).not.toContain("Accounting release completed");
    expect(res.stderr).not.toContain("nothing was changed"); // that is the exit-1 wording of any other failure
    // The message names no address, host or token.
    expect(res.stderr).not.toMatch(/127\.0\.0\.1|http:|cli-test-service-jwt|localhost/);
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null, null]);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
    expect(await db.receiptCounter.count()).toBe(0);
    expect(await db.refundAuditEntry.count()).toBe(0);
    expect(await db.refundSetting.count()).toBe(0);

    // A dry run is a read of Accounting too: it stops the same way.
    const dry = await cli("--dry-run");
    expect(dry.exitCode).toBe(2);

    world.down = false;
    const again = await cli();
    expect(again.exitCode).toBe(0);
    expect(await released()).toBe(true);
    expect(await numbers(ids)).toEqual(["MC26/001", "MC26/002"]);
  });

  it("(AC-2.1) Accounting is read BEFORE the workbook: with Accounting down and a register that does not exist the status is 2, not 6, and no file is written", async () => {
    await legacyRequest(["2026-03-02"]);
    world.down = true;
    const out = fresh("never.csv");
    const res = await cliBare({}, "--dry-run", "--register", "/does/not/exist.xlsx", "--propose", out);
    expect(res.exitCode).toBe(2);
    expect(existsSync(out)).toBe(false);
    world.down = false;
    const later = await cliBare({}, "--dry-run", "--register", "/does/not/exist.xlsx", "--propose", out);
    expect(later.exitCode).toBe(6);
    expect(existsSync(out)).toBe(false);
  });

  it("(AC-7.4) Accounting that cannot even be connected to (nothing listens) is exit 2 as well, with nothing written", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const res = await cliWith({ ACCOUNTING_INTERNAL_URL: "http://127.0.0.1:1" }, "--dry-run");
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain("Accounting cannot be read: nothing was numbered or classified; run again later");
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
  });

  it("(AC-7.4) auth that cannot mint the service token is 'Accounting cannot be read' too: exit 2, nothing written", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const res = await cliWith({ AUTH_BASE_URL: "http://127.0.0.1:1" });
    expect(res.exitCode).toBe(2);
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
  });

  it("(T84) a legacy request with no name is named from auth before numbering: the receipt prefix comes from the NAME, the report counts it; a deleted user stays unnamed", async () => {
    const named = await db.refundRequest.create({
      data: { ownerUserId: "u-named", ownerEmail: "zz.unrelated@welld.ch", ownerName: null, status: "approved", submittedAt: new Date("2026-03-01") },
    });
    const gone = await db.refundRequest.create({
      data: { ownerUserId: "u-gone", ownerEmail: "anna.rossi@welld.ch", ownerName: null, status: "approved", submittedAt: new Date("2026-03-01") },
    });
    for (const r of [named, gone]) {
      await db.refundLine.create({
        data: { requestId: r.id, date: new Date("2026-03-02"), type: "travel_train", motivo: "m", entity: "welld_ch", currency: "CHF", requestedAmountCents: 1000, approvedTotalCents: 1000 },
      });
    }
    world.contacts.set("u-named", "Marco Cattaneo");
    const res = await cli();
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("employees named: 1 (1 request)");
    expect(res.stdout).toContain("employees left unnamed: 1");
    expect(res.stdout).not.toMatch(/Marco|Cattaneo/);
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: named.id } })).ownerName).toBe("Marco Cattaneo");
    expect((await db.refundRequest.findUniqueOrThrow({ where: { id: gone.id } })).ownerName).toBeNull();
    const receipts = (await db.refundLine.findMany({ orderBy: { requestId: "asc" } })).map((l) => [l.requestId, l.receiptNumber]);
    expect(Object.fromEntries(receipts)).toEqual({ [named.id]: "MC26/001", [gone.id]: "AR26/001" });
    expect(world.requests.filter((r) => r.includes("users/contact"))).toHaveLength(2); // one call per distinct employee
  });

  it("(T84) auth that cannot be read for the names (5xx, 401, nothing listening) is EXIT 4 with the message and NOTHING written, a dry run too; once it is back the rerun works", async () => {
    const r = await db.refundRequest.create({
      data: { ownerUserId: "u-named", ownerEmail: "zz.unrelated@welld.ch", ownerName: null, status: "approved", submittedAt: new Date("2026-03-01") },
    });
    const l = await db.refundLine.create({
      data: { requestId: r.id, date: new Date("2026-03-02"), type: "travel_train", motivo: "m", entity: "welld_ch", currency: "CHF", requestedAmountCents: 1000, approvedTotalCents: 1000 },
    });
    world.contacts.set("u-named", "Marco Cattaneo");
    for (const status of [503, 401]) {
      world.contactStatus = status;
      for (const args of [[], ["--dry-run"]]) {
        const res = await cli(...args);
        expect(res.exitCode).toBe(4);
        expect(res.stderr).toContain("Auth cannot be read for the employees' names: nothing was named, numbered or classified; run again later");
        expect(res.stderr).toContain("users.contact");
        expect(res.stderr).not.toMatch(/127\.0\.0\.1|http:|cli-test-service-jwt|Marco/);
        expect(res.stdout).not.toContain("Accounting release completed");
        expect(await released()).toBe(false);
        expect((await db.refundRequest.findUniqueOrThrow({ where: { id: r.id } })).ownerName).toBeNull();
        expect((await db.refundLine.findUniqueOrThrow({ where: { id: l.id } })).receiptNumber).toBeNull();
        expect(await db.refundSetting.count()).toBe(0);
      }
    }
    world.contactStatus = 200;
    const again = await cli();
    expect(again.exitCode).toBe(0);
    expect((await db.refundLine.findUniqueOrThrow({ where: { id: l.id } })).receiptNumber).toBe("MC26/001");
  });

  it("(AC-7.4, AC-5.1) a legacy EUR line gets the copy of the rate in effect; a month with none is rate pending, and the report counts it; the rates are asked as `system:refund-api`", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-04-02"], "EUR");
    world.rates.set("EUR:2026-03", 924_600);
    const res = await cli();
    expect(res.exitCode).toBe(0);
    const lines = await db.refundLine.findMany({ where: { id: { in: ids } }, orderBy: { date: "asc" } });
    expect(lines.map((l) => [l.fxRateMicros, l.fxRateMonth?.toISOString().slice(0, 7) ?? null])).toEqual([[924_600, "2026-03"], [null, null]]);
    expect(res.stdout).toContain("Rate pending: 1 line (no rate");
    expect(world.mints).toBe(1);
    expect(world.requests.filter((r) => r.includes("/rates"))).toEqual(["GET /system/v1/entities/welld_ch/rates?pairs=EUR:2026-03,EUR:2026-04"]);
  });

  it("(F-02) a legacy EUR line dated before Accounting's 2000-01 floor does not fail the whole rates read: exit 0, the pair is not asked, the line is numbered and rate pending", async () => {
    const { ids } = await legacyRequest(["1999-05-05", "2026-03-02"], "EUR");
    world.rates.set("EUR:2026-03", 924_600);
    const res = await cli();
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Accounting release completed.");
    expect(await released()).toBe(true);
    expect(world.requests.filter((r) => r.includes("/rates"))).toEqual(["GET /system/v1/entities/welld_ch/rates?pairs=EUR:2026-03"]);
    const lines = await db.refundLine.findMany({ where: { id: { in: ids } }, orderBy: { date: "asc" } });
    expect(lines.map((l) => [l.receiptNumber !== null, l.fxRateMicros])).toEqual([[true, null], [true, 924_600]]);
    expect(res.stdout).toContain("Rate pending: 1 line (no rate");
  });

  it("(F-02) only dates before the floor: no rates call at all, exit 0", async () => {
    const { ids } = await legacyRequest(["1999-05-05"], "EUR");
    const res = await cli();
    expect(res.exitCode).toBe(0);
    expect(world.requests.filter((r) => r.includes("/rates"))).toEqual([]);
    expect((await numbers(ids))[0]).not.toBeNull();
  });

  it("(F-03) a failure the script did not write itself prints the kind only: no driver text, host, credential or source path", async () => {
    await legacyRequest(["2026-03-02"]);
    const res = await cliWith({ DATABASE_URL: "postgresql://leak_user:leak_pw@127.0.0.1:1/refund" }, "--dry-run");
    expect(res.exitCode).toBe(1);
    const mine = res.stderr.slice(res.stderr.lastIndexOf("accounting:release failed"));
    expect(mine.trim().split("\n")).toHaveLength(1);
    expect(mine).toContain("accounting:release failed, nothing was changed: ");
    expect(mine).not.toMatch(/leak_pw|leak_user|127\.0\.0\.1|reach database|findMany|accounting-release\.ts|\/Users\//);
    expect(mine).toMatch(/PrismaClient\w*Error|Error/);
  });

  it("(T57, F-03) with an unreachable database NOTHING but the script's own line reaches stdout or stderr: no host, credential, path or invocation text, in either development or production mode", async () => {
    await legacyRequest(["2026-03-02"]);
    for (const nodeEnv of ["development", "production", "test"]) {
      for (const args of [["--dry-run"], []]) {
        const res = await cliWith({ DATABASE_URL: "postgresql://leak_user:leak_pw@127.0.0.1:1/refund", NODE_ENV: nodeEnv }, ...args);
        const all = `${res.stdout}\n${res.stderr}`;
        expect(res.exitCode).toBe(1);
        expect(all).not.toMatch(/leak_pw|leak_user|127\.0\.0\.1|invocation|\/Users\/|\.ts\b|prisma:|node_modules|ECONNREFUSED|reach database|findMany/i);
        // The only output is the script's own one line.
        expect(res.stdout).toBe("");
        expect(res.stderr.trim().split("\n")).toHaveLength(1);
        expect(res.stderr).toContain("accounting:release failed, nothing was changed: ");
      }
    }
  });

  it("(AC-7.5) Accounting with no WellD CH entries: exit 0, every legacy line numbered and listed without an account, with the warning", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    world.empty = true;
    const res = await cli();
    expect(res.exitCode).toBe(0);
    expect(await numbers(ids)).toEqual(["MC26/001", "MC26/002"]);
    expect(res.stdout).toContain("Left without an account (2)");
    expect(res.stdout).toContain("Accounting holds no active WellD CH ledger accounts");
    expect(await released()).toBe(true);
    expect(await db.expenseTypeAccountingDefault.count()).toBe(0);
  });
});

describe("the propose mode (AC-2.1, AC-2.3)", () => {
  it("writes the pairing file with mode 0600, prints the report and writes NOTHING to the database: every refund table's row count is as it was", async () => {
    await legacyRequest(["2026-03-02", "2026-03-10"]);
    const before = await footprint();
    const out = fresh("proposal.csv");
    const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", out);
    expect(res.exitCode).toBe(0);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(res.stdout).toContain("DRY RUN (propose)");
    expect(res.stdout).toContain("Pre-release lines: 2");
    expect(res.stdout).toContain("no paper counterpart: 2 lines");
    expect(res.stdout).toContain("Release marker written: no");
    expect(await footprint()).toEqual(before);
    const text = readFileSync(out, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("operai-pairing/1");
    // Accounting and auth were read first (the token was minted, the reference data asked).
    expect(world.requests.some((r) => r.includes("/reference-data"))).toBe(true);
  });

  it("refuses an existing path with exit 1 and leaves that file exactly as it was", async () => {
    await legacyRequest(["2026-03-02"]);
    const decided = fresh("decided.csv");
    writeFileSync(decided, "a decided file, never overwritten");
    const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", decided);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("accounting:release failed, nothing was changed");
    expect(readFileSync(decided, "utf8")).toBe("a decided file, never overwritten");
  });

  it("(AC-5.6) the report prints no name and no email, the pairing file does hold them (it is the operator's), and an employee is `<prefix> · <id8>`", async () => {
    await legacyRequest(["2026-03-02"]);
    const out = fresh("privacy.csv");
    const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", out);
    expect(res.exitCode).toBe(0);
    for (const text of [res.stdout, res.stderr]) {
      expect(text).not.toContain("@");
      expect(text).not.toMatch(/Matteo|Codogno/);
    }
    expect(res.stdout).toContain("MC · u-matteo");
    expect(readFileSync(out, "utf8")).toContain("matteo.codogno@welld.ch");
  });

  it("--offsets complements the register: an offsets-only employee shows in the report by reference, without the email", async () => {
    await legacyRequest(["2026-03-02"]);
    const list = fresh("offsets.csv");
    writeFileSync(list, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2026,81\nanna.rossi@welld.ch,2026,12\n");
    const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"), "--offsets", list);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("MC · u-matteo: 1 line; offsets 81, register maximum 0, imported maximum 0, baseline 81; first new number MC26/082");
    expect(res.stdout).toContain("not yet in Refund: 0 lines; offsets 12");
    expect(res.stdout).not.toContain("@");
    expect(res.stdout).not.toContain("anna.rossi");
  });
});

describe("the inputs: present (exit 5) and readable (exit 6)", () => {
  it("(AC-2.8) a real run with no --register or no --pairing, or with --offsets alone, is exit 5 'run the dry run first' with NOTHING written", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    const list = fresh("offsets.csv");
    writeFileSync(list, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2026,81\n");
    const confirmed = fresh("confirmed.csv");
    writeFileSync(confirmed, "x");
    for (const args of [[], ["--register", REGISTER], ["--pairing", confirmed], ["--offsets", list]]) {
      const res = await cliBare({}, ...args);
      expect(res.exitCode).toBe(5);
      expect(res.stderr).toContain("run the dry run first");
      expect(res.stderr).not.toContain("nothing was changed"); // that is the exit-1 wording
      expect(res.stdout).not.toContain("Accounting release completed");
    }
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null, null]);
    expect(await footprint()).toMatchObject({ settings: 0, baseline: 0, counters: 0, audit: 0, defaults: 0, numbered: 0 });
    // Accounting was read first, and only read.
    expect(world.requests.every((r) => r.startsWith("GET /system/v1/") || r === "POST /system/service-token")).toBe(true);
  });

  it("(AC-2.8) a dry run needs the register and exactly one mode: neither, or both, is exit 5", async () => {
    await legacyRequest(["2026-03-02"]);
    const some = fresh("some.csv");
    writeFileSync(some, "x");
    for (const args of [["--dry-run"], ["--dry-run", "--register", REGISTER], ["--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"), "--pairing", some], ["--dry-run", "--propose", fresh("p.csv")]]) {
      const res = await cliBare({}, ...args);
      expect(res.exitCode).toBe(5);
    }
    // --propose without --dry-run is not a mode of the real run either
    expect((await cliBare({}, "--register", REGISTER, "--propose", fresh("p.csv"))).exitCode).toBe(5);
    expect(await released()).toBe(false);
  });

  it("(AC-7.4) Accounting unreadable AND no inputs is still exit 2: Accounting is read first", async () => {
    await legacyRequest(["2026-03-02"]);
    world.down = true;
    expect((await cliBare({})).exitCode).toBe(2);
    expect((await cliBare({}, "--dry-run")).exitCode).toBe(2);
  });

  it("an unreadable workbook, a missing sheet, a sheet with no header, a pairing file of another format and a bad offsets file are exit 6, quote no cell, and write nothing", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const garbage = fresh("garbage.xlsx");
    writeFileSync(garbage, "SECRET-CELL-TEXT is not a workbook");
    const noHeader = fresh("no-header.xlsx");
    writeFileSync(noHeader, buildRegisterWorkbook([], { sheetName: "2026" }));
    const wrongFormat = fresh("wrong-format.csv");
    writeFileSync(wrongFormat, "record,id,label,decision,state\nmeta,format,operai-pairing/9,,\nmeta,register,x,,\nmeta,lines,y,,\n");
    const badOffsets = fresh("bad-offsets.csv");
    writeFileSync(badOffsets, "secret.person@welld.ch,2025,5\n");
    const proposal = fresh("proposal.csv");
    expect((await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", proposal)).exitCode).toBe(0);

    const cases: [string, string[]][] = [
      ["a file that is no workbook", ["--dry-run", "--register", garbage, "--propose", fresh("p.csv")]],
      ["a missing file", ["--dry-run", "--register", "/does/not/exist.xlsx", "--propose", fresh("p.csv")]],
      ["a sheet the workbook does not have", ["--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"), "--sheet", "Nope"]],
      ["a pairing file of another format", ["--dry-run", "--register", REGISTER, "--pairing", wrongFormat]],
      ["a missing pairing file", ["--dry-run", "--register", REGISTER, "--pairing", "/does/not/exist.csv"]],
      ["a bad offsets file", ["--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"), "--offsets", badOffsets]],
    ];
    for (const [name, args] of cases) {
      const res = await cliBare({}, ...args);
      expect({ name, exit: res.exitCode }).toEqual({ name, exit: 6 });
      expect(res.stderr).toContain("accounting:release stopped (exit 6)");
      const all = `${res.stdout}\n${res.stderr}`;
      expect(all).not.toMatch(/SECRET-CELL-TEXT|secret\.person/);
    }
    void noHeader;
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
    expect(await footprint()).toMatchObject({ settings: 0, baseline: 0, counters: 0, audit: 0, defaults: 0, numbered: 0 });
  });

  it("(AC-4.12) a file with only the header line is the explicit empty offsets list, and an empty or comment-only file is refused: exit 6, nothing written", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    const header = fresh("empty.csv");
    writeFileSync(header, "email,year,lastIssuedSeq\n");
    const ok = await cli("--offsets", header);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("none: numbering starts at 001");
    expect(await numbers(ids)).toEqual(["MC26/001", "MC26/002"]);
    expect(await db.receiptNumberBaseline.count()).toBe(0);
  });

  it("a truncated offsets file would number from 001 over the paper numbers: empty, blank or comment-only is exit 6", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    for (const [name, body] of [["zero.csv", ""], ["blank.csv", "\n\n"], ["comment.csv", "# all of them are new\n"]] as const) {
      const file = fresh(name);
      writeFileSync(file, body);
      const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"), "--offsets", file);
      expect(res.exitCode).toBe(6);
      expect(res.stderr).toContain("no header line and no row");
    }
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
  });
});

describe("paths in a git worktree (AC-5.6, L-1)", () => {
  function checkout() {
    const repo = join(tmp, `some-checkout-${++seq}`);
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "nested"), { recursive: true });
    return repo;
  }
  let seq = 0;

  it("a register or offsets path inside a git worktree prints a warning on stderr, a path outside does not; the run goes on", async () => {
    await legacyRequest(["2026-03-02"]);
    const repo = checkout();
    const insideRegister = join(repo, "nested", "register.xlsx");
    writeFileSync(insideRegister, headerOnlyRegisterWorkbook());
    const insideOffsets = join(repo, "nested", "offsets.csv");
    writeFileSync(insideOffsets, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2026,81\n");
    const out = fresh("outside-out.csv");
    const warned = await cliBare({}, "--dry-run", "--register", insideRegister, "--propose", out, "--offsets", insideOffsets);
    expect(warned.exitCode).toBe(0);
    for (const what of ["the register export", "the offsets file"]) expect(warned.stderr).toContain(what);
    expect(warned.stderr).toContain("inside a git worktree");
    expect(warned.stderr).not.toContain("@");

    const quiet = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", fresh("outside.csv"));
    expect(quiet.exitCode).toBe(0);
    expect(quiet.stderr).not.toContain("WARNING");
    expect(existsSync(out)).toBe(true);
  });

  it("(L-1) --propose inside a git worktree is REFUSED with exit 1: nothing is read from Accounting or written, the file is not created", async () => {
    await legacyRequest(["2026-03-02"]);
    const repo = checkout();
    const out = join(repo, "nested", "accounting-release-pairing.csv");
    const refused = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", out);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("inside a git worktree");
    expect(refused.stderr).toContain("Nothing was written");
    expect(existsSync(out)).toBe(false);
    expect(refused.stdout).not.toContain("Pairing file written");
  });

  it("(L-1, T36) the refusal on a database not yet released reads nothing from Accounting and auth and writes nothing to Refund", async () => {
    await legacyRequest(["2026-03-02"]);
    const before = await footprint();
    world.requests.length = 0;
    const out = join(checkout(), "nested", "accounting-release-pairing.csv");
    const refused = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", out);
    expect(refused.exitCode).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(world.requests).toEqual([]);
    expect(await footprint()).toEqual(before);
  });

  it("(D11, L-1) on an already released database --propose inside a git worktree exits 0 'already completed' and writes nothing: the marker is checked first", async () => {
    await legacyRequest(["2026-03-02"]);
    expect((await cli()).exitCode).toBe(0);
    const before = await footprint();
    world.requests.length = 0;
    const out = join(checkout(), "nested", "accounting-release-pairing.csv");
    const res = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", out);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("was already completed");
    expect(existsSync(out)).toBe(false);
    expect(await footprint()).toEqual(before);
    expect(world.requests).toEqual([]);
  });
});

describe("the baseline from --offsets, run as the operator runs it", () => {
  it("--offsets <csv> continues numbering after the paper-era number, and the file is read from the path given", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const csv = fresh("offsets.csv");
    writeFileSync(csv, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2026,81\n");
    const res = await cli("--offsets", csv);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("MC · u-matteo 2026: numbering continues after 81"); // AC-5.6: no email in any output
    expect(await numbers(ids)).toEqual(["MC26/082"]);
  });

  it("(AC-5.6) no `@` and no name anywhere in a dry run or a real run with offsets", async () => {
    await legacyRequest(["2026-03-02", "2026-03-10"]);
    const csv = fresh("mask-offsets.csv");
    writeFileSync(csv, "matteo.codogno@welld.ch,2026,81\n");
    const dry = await cli("--dry-run", "--offsets", csv);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain("Every line");
    expect(dry.stdout).toContain("MC · u-matteo");
    for (const text of [dry.stdout, dry.stderr]) expect(text).not.toMatch(/@|Matteo|Codogno/);
    const real = await cli("--offsets", csv);
    expect(real.exitCode).toBe(0);
    for (const text of [real.stdout, real.stderr]) expect(text).not.toMatch(/@|Matteo|Codogno/);
  });

  it("the report names each baseline by the prefix Refund will use, and an employee not yet in Refund as such, never by email", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const list = fresh("two-rows.csv");
    writeFileSync(list, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2026,81\nanna.rossi@welld.ch,2026,12\n");
    const res = await cli("--offsets", list);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("MC · u-matteo 2026: numbering continues after 81 (written)");
    expect(res.stdout).toContain("not yet in Refund 2026: numbering continues after 12 (written)");
    expect(res.stdout).not.toContain("matteo.codogno");
    expect(res.stdout).not.toContain("anna.rossi");
    expect(await numbers(ids)).toEqual(["MC26/082"]);
    expect((await db.receiptNumberBaseline.findMany({ orderBy: { emailKey: "asc" } })).map((r) => [r.emailKey, r.lastIssuedSeq])).toEqual([
      ["anna.rossi@welld.ch", 12],
      ["matteo.codogno@welld.ch", 81],
    ]);
  });

  it("a row for a year but 2026 is refused (exit 6), with nothing written and no email in the message", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const list = fresh("wrong-year.csv");
    writeFileSync(list, "email,year,lastIssuedSeq\nmatteo.codogno@welld.ch,2027,5\n");
    const res = await cli("--offsets", list);
    expect(res.exitCode).toBe(6);
    expect(res.stderr).toContain("only 2026 continues the paper register");
    expect(res.stderr).not.toContain("matteo.codogno");
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
  });

  it("a malformed offsets file is refused before anything is written, and the bad cell is not echoed", async () => {
    await legacyRequest(["2026-03-02"]);
    const csv = fresh("bad.csv");
    writeFileSync(csv, "not-an-email,2026,81\n");
    const res = await cli("--offsets", csv);
    expect(res.exitCode).toBe(6);
    expect(res.stderr).not.toContain("not-an-email");
    expect(await released()).toBe(false);
  });
});

describe("the refusal families, each with a status of its own and nothing written (AC-5.1, AC-2.6, AC-2.7, AC-4.11)", () => {
  /** The file of a PROPOSE on the header-only register, every proposed record confirmed: what the operator ends with. */
  async function decidedFile() {
    const proposal = fresh("matrix-proposal.csv");
    expect((await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", proposal)).exitCode).toBe(0);
    const confirmed = fresh("matrix-confirmed.csv");
    writeFileSync(confirmed, confirmProposed(readFileSync(proposal, "utf8")), { mode: 0o600 });
    return confirmed;
  }

  it("exit 7 stale: a line approved into the pre-release set after the proposal, or a register that is not the proposal's; then a new proposal works", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const file = await decidedFile();
    await db.refundLine.create({ data: { requestId: (await db.refundRequest.findFirstOrThrow()).id, date: new Date("2026-04-02"), type: "travel_train", motivo: "m", entity: "welld_ch", currency: "CHF", requestedAmountCents: 100, approvedTotalCents: 100 } });
    const before = await footprint();
    const lines = await cliBare({}, "--register", REGISTER, "--pairing", file);
    expect(lines.exitCode).toBe(7);
    expect(lines.stderr).toContain("accounting:release stopped (exit 7)");
    expect(lines.stderr).toContain("stale");
    expect(lines.stderr).toContain("Run the dry run again");
    const other = fresh("other.xlsx");
    writeFileSync(other, buildRegisterWorkbook([{ worker: "Worker Gamma", number: "GG26/001", date: "2026-03-02", total: "10" }]));
    const register = await cliBare({}, "--dry-run", "--register", other, "--pairing", file);
    expect(register.exitCode).toBe(7);
    expect(await footprint()).toEqual(before);
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
    // A new proposal starts clean and succeeds.
    expect((await cli()).exitCode).toBe(0);
    expect(await released()).toBe(true);
  });

  it("exit 8 not decided: a line with no decision and a record not confirmed are named by id, no name or amount is printed, and nothing is written", async () => {
    const { ids } = await legacyRequest(["2026-03-02", "2026-03-10"]);
    const file = await decidedFile();
    const broken = fresh("broken.csv");
    writeFileSync(
      broken,
      editPairing(readFileSync(file, "utf8"), (r) => {
        if (r["record"] === "line" && r["expenseDate"] === "2026-03-10") Object.assign(r, { decision: "", state: "unresolved" });
      }),
    );
    const before = await footprint();
    for (const dry of [true, false]) {
      const res = await cliBare({}, ...(dry ? ["--dry-run"] : []), "--register", REGISTER, "--pairing", broken);
      expect(res.exitCode).toBe(8);
      expect(res.stderr).toContain("accounting:release stopped (exit 8)");
      expect(res.stderr).toContain(`line ${ids[1]} is not confirmed`);
      expect(res.stderr).toContain(`line ${ids[1]} has no decision`);
      expect(res.stderr).not.toMatch(/@|Matteo|Codogno|10\.00/);
      expect(res.stdout).not.toContain("Accounting release completed");
    }
    expect(await footprint()).toEqual(before);
    expect(await released()).toBe(false);
  });

  it("exit 9 shared prefix: two employees with the same initials and no codes, a new number for one of them; the message names references only", async () => {
    await legacyRequest(["2026-03-02"]); // Matteo Codogno: MC
    const other = await db.refundRequest.create({
      data: { ownerUserId: "u-marco", ownerEmail: "marco.cattaneo@welld.ch", ownerName: "Marco Cattaneo", status: "approved", submittedAt: new Date("2026-03-01") },
    });
    await db.refundLine.create({ data: { requestId: other.id, date: new Date("2026-03-03"), type: "travel_train", motivo: "m", entity: "welld_ch", currency: "CHF", requestedAmountCents: 1000, approvedTotalCents: 1000 } });
    const before = await footprint();
    const propose = await cliBare({}, "--dry-run", "--register", REGISTER, "--propose", fresh("p.csv"));
    expect(propose.exitCode).toBe(0);
    expect(propose.stdout).toContain("Employees that need a receipt code (a prefix shared with another employee, AC-4.11): 2");
    for (const res of [await cli(), await cli("--dry-run")]) {
      expect(res.exitCode).toBe(9);
      expect(res.stderr).toContain("accounting:release stopped (exit 9)");
      expect(res.stderr).toContain("MC · u-marco");
      expect(res.stderr).toContain("MC · u-matteo");
      expect(res.stderr).not.toMatch(/@|Marco|Cattaneo|Matteo|Codogno/);
    }
    expect(await footprint()).toEqual(before);
    expect(await released()).toBe(false);
  });

  it("the matrix: every family ends with its own status, and the footprint of every refund table is as it was", async () => {
    const { ids } = await legacyRequest(["2026-03-02"]);
    const before = await footprint();
    const file = await decidedFile();
    const results: [number, number][] = [];
    // 2 Accounting unreadable, 4 auth unreadable, 5 inputs missing, 6 inputs unreadable, 7 stale, 8 not decided
    world.down = true;
    results.push([2, (await cliBare({}, "--dry-run", "--register", REGISTER, "--pairing", file)).exitCode]);
    world.down = false;
    world.contactStatus = 503;
    await db.refundRequest.updateMany({ data: { ownerName: null } });
    const namesBefore = await footprint();
    results.push([4, (await cliBare({}, "--register", REGISTER, "--pairing", file)).exitCode]);
    world.contactStatus = 200;
    await db.refundRequest.updateMany({ data: { ownerName: "Matteo Codogno" } });
    expect(namesBefore.named).toBe(0);
    results.push([5, (await cliBare({})).exitCode]);
    results.push([6, (await cliBare({}, "--register", "/does/not/exist.xlsx", "--pairing", file)).exitCode]);
    const other = fresh("matrix-other.xlsx");
    writeFileSync(other, buildRegisterWorkbook([{ worker: "Worker Gamma", number: "GG26/001", date: "2026-03-02", total: "10" }]));
    results.push([7, (await cliBare({}, "--register", other, "--pairing", file)).exitCode]);
    const undecided = fresh("matrix-undecided.csv");
    writeFileSync(undecided, editPairing(readFileSync(file, "utf8"), (r) => {
      if (r["record"] === "line") r["state"] = "unresolved";
    }));
    results.push([8, (await cliBare({}, "--register", REGISTER, "--pairing", undecided)).exitCode]);
    expect(results.map(([want, got]) => `${want}:${got}`)).toEqual(results.map(([want]) => `${want}:${want}`));
    expect(await footprint()).toEqual(before);
    expect(await released()).toBe(false);
    expect(await numbers(ids)).toEqual([null]);
  });
});
