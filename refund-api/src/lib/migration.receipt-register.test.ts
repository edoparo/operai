/**
 * The migration `20261124090000_receipt_numbers_from_register`, on data (T2, specs/20261124-receipt-numbers-from-the-register;
 * AC-1.6, AC-1.18, AC-4.7; plan § Data model).
 *
 * A scratch database `refund_mig_rn_*` on the same server as DATABASE_URL (never the test database itself) is built migration by
 * migration from the files of `prisma/migrations` up to the previous head, filled with numbered lines, then the new migration is
 * applied as Prisma does (one multi-statement simple query). Each scratch database is removed at the end. Applied migrations are
 * never edited.
 *
 * `prisma migrate diff` (the CLI, through `node`) must find no difference between the schema file and the database that the
 * migrations produce, from zero and from the carried database.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const MIGRATIONS_DIR = join(ROOT, "prisma/migrations");
const BEFORE = "20261119200200_vat_defaults_retired";
const MIGRATION = "20261124090000_receipt_numbers_from_register";

const baseUrl = new URL(process.env["DATABASE_URL"]!);
const urlOf = (database: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${database}`;
  return u.toString();
};

const migrationNames = readdirSync(MIGRATIONS_DIR)
  .filter((n) => /^\d{14}_/.test(n))
  .sort();

/** Apply the migration files up to `to` (included) and from `from` (included, when given), each as one simple query. */
async function apply(sql: SQL, to: string, from?: string) {
  for (const name of migrationNames) {
    if (from && name < from) continue;
    if (name > to) break;
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8")).simple();
  }
}

const created = new Set<string>();
const admin = new SQL(urlOf(baseUrl.pathname.slice(1)), { max: 1 });

async function scratch(name: string): Promise<SQL> {
  expect(name).toMatch(/^refund_mig_rn_[a-z0-9_]*$/); // never anything but a scratch name of this file
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  created.add(name);
  return new SQL(urlOf(name), { max: 1 });
}

afterAll(async () => {
  for (const name of created) await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.close();
}, 60_000);

type Row = Record<string, any>;
const rows = async (sql: SQL, text: string, params: unknown[] = []): Promise<Row[]> => Array.from(await sql.unsafe(text, params as never[]));

async function insert(sql: SQL, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const text = `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
  await sql.unsafe(text, Object.values(row) as never[]);
}

/** Three employees: numbered lines of two years, a four-digit sequence, one unnumbered line. */
async function fixtures(sql: SQL) {
  const req = (id: string, owner: string, status = "approved") =>
    insert(sql, "refund_request", { id, ownerUserId: owner, ownerEmail: `${owner}@welld.ch`, status, updatedAt: "2026-04-01T00:00:00.000" });
  await req("rq-1", "owner-1");
  await req("rq-2", "owner-2", "paid");
  await req("rq-3", "owner-3", "submitted");
  const line = (id: string, request: string, date: string, number?: [string, string, number, number]) =>
    insert(sql, "refund_line", {
      id,
      requestId: request,
      date,
      type: "office_material",
      motivo: `reason of ${id}`,
      entity: "welld_ch",
      currency: "CHF",
      requestedAmountCents: 1000,
      approvedTotalCents: 1000,
      updatedAt: "2026-04-01T07:00:00.000",
      ...(number
        ? { receiptNumber: number[0], receiptOwnerUserId: number[1], receiptYear: number[2], receiptSeq: number[3], numberedAt: "2026-04-01T08:00:00.000" }
        : {}),
    });
  await line("L-1", "rq-1", "2026-03-02", ["MC26/001", "owner-1", 2026, 1]);
  await line("L-2", "rq-1", "2026-03-03", ["MC26/002", "owner-1", 2026, 2]);
  await line("L-3", "rq-1", "2025-12-30", ["MC25/040", "owner-1", 2025, 40]);
  await line("L-4", "rq-2", "2026-03-04", ["ZZ26/1000", "owner-2", 2026, 1000]);
  await line("L-5", "rq-3", "2026-03-05");
}

/** `prisma migrate diff` from the database to the schema file: exit 0 and "No difference detected" when they agree. */
function prismaDiff(databaseUrl: string): { code: number; out: string } {
  const node = Bun.which("node");
  if (!node) throw new Error("`node` is not on PATH: the Prisma CLI (db:generate, migrate) needs it, so this test needs it too");
  const proc = Bun.spawnSync(
    [node, join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-config-datasource", "--to-schema", join(ROOT, "prisma/schema.prisma"), "--exit-code"],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 90_000 },
  );
  return { code: proc.exitCode ?? -1, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

describe("the receipt-register migration carries a database with numbered lines", () => {
  let sql: SQL;
  let url: string;
  let linesBefore: Row[];

  const LINE_KEPT = `SELECT id, "requestId", "date", "receiptNumber", "receiptOwnerUserId", "receiptYear", "receiptSeq", "numberedAt" FROM refund_line ORDER BY id`;

  beforeAll(async () => {
    sql = await scratch("refund_mig_rn_data");
    url = urlOf("refund_mig_rn_data");
    await apply(sql, BEFORE);
    await fixtures(sql);
    linesBefore = await rows(sql, LINE_KEPT);
    await apply(sql, MIGRATION, MIGRATION);
  }, 120_000);

  it("(control) the migration is the one after the previous head", () => {
    expect(migrationNames[migrationNames.indexOf(MIGRATION) - 1]).toBe(BEFORE);
    expect(linesBefore).toHaveLength(5);
  });

  it("backfills every numbered line as issued, part 1, and an unnumbered line stays bare", async () => {
    const after = await rows(sql, `SELECT id, "receiptNumber", "receiptOrigin", "receiptSplitPart" FROM refund_line ORDER BY id`);
    expect(after).toEqual([
      { id: "L-1", receiptNumber: "MC26/001", receiptOrigin: "issued", receiptSplitPart: 1 },
      { id: "L-2", receiptNumber: "MC26/002", receiptOrigin: "issued", receiptSplitPart: 1 },
      { id: "L-3", receiptNumber: "MC25/040", receiptOrigin: "issued", receiptSplitPart: 1 },
      { id: "L-4", receiptNumber: "ZZ26/1000", receiptOrigin: "issued", receiptSplitPart: 1 },
      { id: "L-5", receiptNumber: null, receiptOrigin: null, receiptSplitPart: null },
    ]);
  });

  it("keeps every number, owner, year, sequence and numbering time", async () => {
    expect(await rows(sql, LINE_KEPT)).toEqual(linesBefore);
  });

  it("the new unique index exists and the old one does not", async () => {
    const names = (await rows(sql, `SELECT indexname FROM pg_indexes WHERE tablename = 'refund_line'`)).map((r) => r["indexname"]);
    expect(names).toContain("refund_line_receipt_owner_year_seq_part_key");
    expect(names).not.toContain("refund_line_receiptOwnerUserId_receiptYear_receiptSeq_key");
  });

  it("the guard (v3) refuses a change of the new columns on a backfilled line", async () => {
    await expect(sql.unsafe(`UPDATE refund_line SET "receiptOrigin" = 'paper' WHERE id = 'L-1'`).simple()).rejects.toThrow(/immutable/);
    await expect(sql.unsafe(`UPDATE refund_line SET "receiptSplitPart" = 2 WHERE id = 'L-1'`).simple()).rejects.toThrow();
  });

  it("the two receipt-code tables exist, empty, and the split trigger is deferred", async () => {
    expect(await rows(sql, `SELECT count(*)::int AS n FROM receipt_code`)).toEqual([{ n: 0 }]);
    expect(await rows(sql, `SELECT count(*)::int AS n FROM receipt_code_change`)).toEqual([{ n: 0 }]);
    const trg = await rows(sql, `SELECT tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'refund_line_split_receipt'`);
    expect(trg).toEqual([{ tgdeferrable: true, tginitdeferred: true }]);
  });

  it("prisma migrate diff finds no difference between the schema file and the carried database", async () => {
    // schema.prisma describes the head of the chain: carry the database through the migrations written after this one too.
    const next = migrationNames[migrationNames.indexOf(MIGRATION) + 1];
    if (next) await apply(sql, "99999999999999", next);
    const r = prismaDiff(url);
    expect(r.out).toContain("No difference detected");
    expect(r.code).toBe(0);
  }, 120_000);

  it("prisma migrate diff finds no difference on a database built from zero", async () => {
    const fresh = await scratch("refund_mig_rn_zero");
    await apply(fresh, "99999999999999");
    await fresh.close();
    const r = prismaDiff(urlOf("refund_mig_rn_zero"));
    expect(r.out).toContain("No difference detected");
    expect(r.code).toBe(0);
  }, 180_000);
});
