/**
 * Output privacy of the release across EVERY mode and EVERY refusal (T14, specs/20261124-receipt-numbers-from-the-register; AC-5.6,
 * AC-5.1, AC-5.3, AC-1.17).
 *
 * The script is run as the operator runs it (a child process, the real Accounting and auth clients against a small fake server). A
 * fixture of SYNTHETIC but conspicuous secrets: worker names, employee names and emails, line descriptions, a rejection reason, and the
 * amounts of lines that are not doubtful. The text on stdout and stderr of every mode and every refusal is searched for them.
 * An employee appears as `<prefix> · <8>`, a line by id, a register row by position; a doubtful pairing may show its own amounts.
 *
 * What the pairing file holds is NOT in this test's scope: it is the operator's own file, kept outside the repository, and names workers
 * and employees by design (the test only checks that it exists with mode 0600).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { isAccountingReleased } from "../src/accounting/release";
import { buildRegisterWorkbook, type RegisterRowInput } from "../src/test-support/registerWorkbook";
import { decideLines, editPairing } from "../src/test-support/releaseRun";
import { truncateRefundTables } from "../src/test-support/dbCleanup";

const SCRIPT = join(import.meta.dir, "accounting-release.ts");
const tmp = mkdtempSync(join(tmpdir(), "accounting-release-privacy-"));

// ─── The secrets ─────────────────────────────────────────────────────────────

const SECRETS = [
  "Zelda Fitzgerald", // employee name
  "ZELDA FITZGERALD", // the register's text of that worker
  "Fitzgerald",
  "zelda.fitz",
  "secret-mail",
  "Zoe Foster",
  "ZOE FOSTER",
  "Quentin Vandermeer", // a worker that is nobody's
  "QUENTIN VANDERMEER",
  "Vandermeer",
  "Dinner with the Hotel Zeta clients", // a line description
  "Hotel Zeta",
  "SECRET-REJECTION-REASON", // a rejection reason
  "4711.17", // the amount of a line, and of its row, that are not doubtful
  "471117",
  "6543.21", // the amount of a row that nobody pairs with
  "leak_pw", // the database credentials of the unreachable-database case
  "leak_user",
  "@",
];
/** What a doubtful pairing may show: its own line amount and the row amounts of the pairing. */
const ALLOWED_AMOUNTS = ["2222.22", "3333.33"];

// ─── Auth and Accounting, as the wire has them ───────────────────────────────

const TOKEN = "privacy-test-service-jwt";
const world = { down: false, contactStatus: 200 };
let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/system/service-token" && request.method === "POST") return Response.json({ token: TOKEN, expiresInSeconds: 300 });
      if (world.down) return new Response("unavailable", { status: 503 });
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("no", { status: 401 });
      if (url.pathname === "/system/users/contact" && request.method === "POST") {
        return world.contactStatus !== 200 ? new Response("", { status: world.contactStatus }) : new Response("{}", { status: 404 });
      }
      if (url.pathname === "/system/v1/entities/welld_ch/reference-data") {
        return Response.json({
          entity: "welld_ch",
          ownCurrency: "CHF",
          ledgerAccounts: [{ number: "5901", name: "Spese viaggi in treno", active: true }],
          vatCodes: [],
        });
      }
      if (url.pathname === "/system/v1/entities/welld_ch/rates") return Response.json({ entity: "welld_ch", rates: [] });
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});
beforeEach(async () => {
  await truncateRefundTables({ released: false });
  world.down = false;
  world.contactStatus = 200;
});
afterAll(async () => {
  server.stop(true);
  await truncateRefundTables({ released: false });
  rmSync(tmp, { recursive: true, force: true });
});

let counter = 0;
const fresh = (name: string) => join(tmp, `${++counter}-${name}`);

async function cli(env: Record<string, string>, ...args: string[]) {
  const child = Bun.spawn([process.execPath, SCRIPT, ...args], {
    env: { ...process.env, NODE_ENV: "development", AUTH_BASE_URL: baseUrl, ACCOUNTING_INTERNAL_URL: baseUrl, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode, all: `${stdout}\n${stderr}` };
}

// ─── The data ────────────────────────────────────────────────────────────────

/**
 * Zelda has an exact match (not doubtful, 4711.17) and an amount-differs line (doubtful: line 2222.22, row 3333.33), a rejected line with a
 * secret reason, and descriptions that must never be printed. Zoe has the same initials ZF and takes a new number. A third row belongs to a
 * worker that is nobody's and one has an amount of its own that nobody pairs with.
 */
async function fixture() {
  const zelda = await db.refundRequest.create({
    data: { ownerUserId: "u-zelda", ownerEmail: "zelda.fitz@secret-mail.example.invalid", ownerName: "Zelda Fitzgerald", status: "approved", submittedAt: new Date("2026-03-01") },
  });
  const zoe = await db.refundRequest.create({
    data: { ownerUserId: "u-zoe", ownerEmail: "zoe.foster@secret-mail.example.invalid", ownerName: "Zoe Foster", status: "approved", submittedAt: new Date("2026-03-01") },
  });
  const make = (requestId: string, id: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
    db.refundLine.create({
      data: { id, requestId, date: new Date(date), type: "travel_train", motivo: "Dinner with the Hotel Zeta clients", entity: "welld_ch", currency: "CHF", requestedAmountCents: cents, approvedTotalCents: cents, ...extra },
    });
  await make(zelda.id, "z-exact", "2026-03-12", 471_117);
  await make(zelda.id, "z-differs", "2026-03-14", 222_222);
  await make(zelda.id, "z-rejected", "2026-03-15", 100, { rejectionReason: "SECRET-REJECTION-REASON", rejectedAt: new Date(), rejectedByUserId: "a", rejectedByEmail: "a@example.invalid" });
  await make(zoe.id, "o-new", "2026-03-20", 300);
  // A request with no name: auth is asked for it (and may be unreadable: exit 4). It holds no line.
  await db.refundRequest.create({ data: { ownerUserId: "u-ghost", ownerEmail: "ghost@secret-mail.example.invalid", ownerName: null, status: "draft" } });
  const rows: RegisterRowInput[] = [
    { worker: "ZELDA FITZGERALD", number: "ZF26/001", date: "2026-03-12", total: "4711.17" },
    { worker: "ZELDA FITZGERALD", number: "ZF26/002", date: "2026-03-14", total: "3333.33" },
    { worker: "QUENTIN VANDERMEER", number: "QV26/009", date: "2026-02-02", total: "6543.21" },
  ];
  return { register: buildRegisterWorkbook(rows), rows };
}

function noSecrets(text: string, where: string) {
  for (const secret of SECRETS) {
    if (text.includes(secret)) throw new Error(`${where}: the output contains a secret (${JSON.stringify(secret.length > 6 ? secret.slice(0, 4) + "..." : secret)})`);
  }
  for (const line of text.split("\n")) {
    // an amount with cents next to a currency or a row position is a figure of the register: only the doubtful pairing's own are allowed
    for (const amount of line.match(/\b\d{3,}\.\d{2}\b/g) ?? []) {
      if (!ALLOWED_AMOUNTS.includes(amount)) throw new Error(`${where}: an amount that is not a doubtful pairing's own is printed (${amount.length} characters)`);
    }
  }
}

describe("the check itself bites", () => {
  it("fails on a name, an email, a description, a reason and a stray amount, and passes on references and a doubtful pairing's own amounts", () => {
    for (const leak of ["accounting:release failed: Zelda Fitzgerald", "to zelda.fitz", "Dinner with the Hotel Zeta clients", "SECRET-REJECTION-REASON", "amount 4711.17 CHF", "a row of 9999.99 CHF"]) {
      expect(() => noSecrets(leak, "t")).toThrow();
    }
    expect(() => noSecrets("ZF · u-zelda: line z-differs 2222.22 CHF, R3 3333.33, ZF26/002", "t")).not.toThrow();
  });
});

describe("no output of any mode or refusal carries a name, an email, a description, a reason or a non-doubtful amount (AC-5.6)", () => {
  it("every mode and every refusal of one release, from the first proposal to the rerun after completion", async () => {
    const { register, rows } = await fixture();
    const registerPath = fresh("register.xlsx");
    writeFileSync(registerPath, register);
    const outputs: [string, { all: string; exitCode: number }][] = [];
    const run = async (label: string, want: number, env: Record<string, string>, ...args: string[]) => {
      const res = await cli(env, ...args);
      outputs.push([label, res]);
      expect({ label, exit: res.exitCode }).toEqual({ label, exit: want });
      return res;
    };

    // PROPOSE (0): the report names references only, and the file is the operator's, 0600.
    const proposal = fresh("proposal.csv");
    const proposed = await run("propose", 0, {}, "--dry-run", "--register", registerPath, "--propose", proposal);
    expect(statSync(proposal).mode & 0o777).toBe(0o600);
    expect(proposed.stdout).toContain("ZF · u-zelda");
    expect(proposed.stdout).toContain("2222.22"); // the doubtful pairing's own amount, and the row's
    expect(proposed.stdout).toContain("3333.33");
    const file = readFileSync(proposal, "utf8");
    expect(file).toContain("ZELDA FITZGERALD"); // the file is where names are, by design
    expect(file).not.toContain("SECRET-REJECTION-REASON");

    // Usage and input refusals (1, 5, 6)
    await run("unknown argument", 1, {}, "--frobnicate", registerPath);
    await run("--show-emails", 1, {}, "--dry-run", "--show-emails", "--register", registerPath, "--propose", fresh("x.csv"));
    await run("a path to write that exists", 1, {}, "--dry-run", "--register", registerPath, "--propose", proposal);
    await run("no inputs", 5, {});
    await run("no pairing", 5, {}, "--register", registerPath);
    await run("a dry run with both modes", 5, {}, "--dry-run", "--register", registerPath, "--propose", fresh("y.csv"), "--pairing", proposal);
    const garbage = fresh("garbage.xlsx");
    writeFileSync(garbage, "Zelda Fitzgerald is not a workbook");
    await run("a file that is no workbook", 6, {}, "--dry-run", "--register", garbage, "--propose", fresh("z.csv"));
    await run("a missing file", 6, {}, "--dry-run", "--register", "/does/not/exist.xlsx", "--propose", fresh("w.csv"));
    const offsets = fresh("offsets.csv");
    writeFileSync(offsets, "zelda.fitz@secret-mail.example.invalid,2025,5\n");
    await run("an offsets file of another year", 6, {}, "--dry-run", "--register", registerPath, "--propose", fresh("v.csv"), "--offsets", offsets);
    const wrongFormat = fresh("wrong-format.csv");
    writeFileSync(wrongFormat, file.replace("operai-pairing/1", "operai-pairing/7"));
    await run("a pairing file of another format", 6, {}, "--dry-run", "--register", registerPath, "--pairing", wrongFormat);

    // Not decided (8): the proposal as it is has unresolved records.
    await run("not decided, dry run", 8, {}, "--dry-run", "--register", registerPath, "--pairing", proposal);
    await run("not decided, real run", 8, {}, "--register", registerPath, "--pairing", proposal);

    // Stale (7): another register.
    const other = fresh("other.xlsx");
    writeFileSync(other, buildRegisterWorkbook([...rows, { worker: "ZELDA FITZGERALD", number: "ZF26/003", date: "2026-03-30", total: "1.00" }]));
    const decidedPath = fresh("decided.csv");
    // Zelda's doubtful line takes a new number; Zoe's line takes a new number; the worker who is nobody's is not-operai.
    const decided = editPairing(decideLines(file, { "z-differs": { decision: "new" } }), (r) => {
      if (r["record"] === "worker" && r["decision"] === "") r["decision"] = "not-operai";
    });
    writeFileSync(decidedPath, decided, { mode: 0o600 });
    await run("stale register, dry run", 7, {}, "--dry-run", "--register", other, "--pairing", decidedPath);
    await run("stale register, real run", 7, {}, "--register", other, "--pairing", decidedPath);

    // Shared prefix (9): Zelda and Zoe both derive ZF, and neither holds a code.
    await run("shared prefix, dry run", 9, {}, "--dry-run", "--register", registerPath, "--pairing", decidedPath);
    const refused = await run("shared prefix, real run", 9, {}, "--register", registerPath, "--pairing", decidedPath);
    expect(refused.all).toContain("ZF · u-zoe");
    expect(await isAccountingReleased(db as never)).toBe(false);

    // Accounting (2) and auth (4) unreadable.
    world.down = true;
    await run("Accounting unreadable", 2, {}, "--dry-run", "--register", registerPath, "--pairing", decidedPath);
    world.down = false;
    world.contactStatus = 503;
    await run("auth unreadable", 4, {}, "--dry-run", "--register", registerPath, "--pairing", decidedPath);
    world.contactStatus = 200;
    // The database unreachable: the script's own line only.
    await run("database unreachable", 1, { DATABASE_URL: "postgresql://leak_user:leak_pw@127.0.0.1:1/refund" }, "--dry-run", "--register", registerPath, "--pairing", decidedPath);

    // The codes are set (runbook step 6): the check, the run and the rerun.
    for (const [owner, code] of [["u-zelda", "ZEL"], ["u-zoe", "ZOE"]] as const) {
      await db.receiptCode.create({ data: { ownerUserId: owner, code, updatedByUserId: "admin-1", updatedByEmail: "admin@example.invalid", updatedAt: new Date() } });
    }
    const check = await run("check", 0, {}, "--dry-run", "--register", registerPath, "--pairing", decidedPath);
    expect(check.all).toContain("ZEL26/");
    const real = await run("run", 0, {}, "--register", registerPath, "--pairing", decidedPath);
    expect(real.all).toContain("Accounting release completed");
    const again = await run("rerun", 0, {}, "--register", registerPath, "--pairing", decidedPath);
    expect(again.all).toContain("already completed");
    await run("rerun with no inputs", 0, {});
    await run("a dry run after completion", 0, {}, "--dry-run");
    expect(await isAccountingReleased(db as never)).toBe(true);

    for (const [label, res] of outputs) noSecrets(res.all, label);
    expect(outputs.length).toBeGreaterThan(24);
  });

  it("the doubtful line's own amounts are shown, and only those: the report lists the pairing's line and row amounts, not the exact match's", async () => {
    const { register } = await fixture();
    const registerPath = fresh("register.xlsx");
    writeFileSync(registerPath, register);
    const res = await cli({}, "--dry-run", "--register", registerPath, "--propose", fresh("p.csv"));
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/z-differs {2}2026-03-14 {2}2222\.22 CHF {2}amount differs: line 2222\.22 CHF, R3 3333\.33, ZF26\/002/);
    expect(res.stdout).not.toContain("4711.17");
    expect(res.stdout).not.toContain("z-exact ");
  });

  it("(AC-1.17) the audit trail of the numbers holds the row position and the paper number, and nothing of the register", async () => {
    const { register } = await fixture();
    for (const [owner, code] of [["u-zelda", "ZEL"], ["u-zoe", "ZOE"]] as const) {
      await db.receiptCode.create({ data: { ownerUserId: owner, code, updatedByUserId: "admin-1", updatedByEmail: "admin@example.invalid", updatedAt: new Date() } });
    }
    const registerPath = fresh("register.xlsx");
    writeFileSync(registerPath, register);
    const proposal = fresh("proposal.csv");
    expect((await cli({}, "--dry-run", "--register", registerPath, "--propose", proposal)).exitCode).toBe(0);
    const decided = editPairing(decideLines(readFileSync(proposal, "utf8"), { "z-differs": { decision: "new" } }), (r) => {
      if (r["record"] === "worker" && r["decision"] === "") r["decision"] = "not-operai";
    });
    const decidedPath = fresh("decided.csv");
    writeFileSync(decidedPath, decided, { mode: 0o600 });
    expect((await cli({}, "--register", registerPath, "--pairing", decidedPath)).exitCode).toBe(0);
    const entries = await db.refundAuditEntry.findMany({ where: { action: "receipt_number_assigned" }, orderBy: { lineId: "asc" } });
    expect(entries.map((e) => [e.lineId, e.detail])).toEqual([
      ["o-new", { cause: "release", receiptNumber: "ZOE26/001", year: 2026, seq: 1, origin: "new" }],
      ["z-differs", { cause: "release", receiptNumber: "ZEL26/003", year: 2026, seq: 3, origin: "new" }],
      ["z-exact", { cause: "release", receiptNumber: "ZF26/001", year: 2026, seq: 1, origin: "paper", registerRows: [2] }],
    ]);
    const text = JSON.stringify(await db.refundAuditEntry.findMany());
    for (const secret of ["ZELDA FITZGERALD", "QUENTIN", "4711", "6543", "3333"]) expect(text).not.toContain(secret);
  });
});
