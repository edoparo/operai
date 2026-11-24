/**
 * The receipt-register migration `20261124090000_receipt_numbers_from_register`, on the test database
 * (T2, specs/20261124-receipt-numbers-from-the-register; AC-1.6, AC-1.11, AC-1.18, AC-4.3, AC-4.7; plan § Data model).
 *
 * Real Postgres, raw SQL where the trigger or the CHECK is the subject (the `db.accounting-signoff.test.ts` pattern, which also
 * pins the hand-written SQL against drift). The migration on data is in `migration.receipt-register.test.ts`. Cleanup uses
 * TRUNCATE, which does not fire row triggers.
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { db } from "./db";
import { truncateRefundTables } from "../test-support/dbCleanup";

const asPromise = <T>(value: PromiseLike<T>): Promise<T> => Promise.resolve(value);
type Row = Record<string, any>;
const query = (text: string, ...values: unknown[]) => asPromise(db.$queryRawUnsafe<Row[]>(text, ...values));
const exec = (text: string, ...values: unknown[]) => asPromise(db.$executeRawUnsafe(text, ...values));

interface LineSpec {
  readonly number?: string;
  readonly origin?: "issued" | "paper" | "paper_split";
  readonly part?: number;
  readonly year?: number;
  readonly seq?: number;
  readonly date?: string;
  /** Skip the numbering columns altogether. */
  readonly bare?: boolean;
}

let request: { id: string };

async function insertLine(spec: LineSpec = {}, owner = "owner-1", client: Pick<typeof db, "refundLine"> = db) {
  const year = spec.year ?? 2026;
  const seq = spec.seq ?? 1;
  return asPromise(
    client.refundLine.create({
      data: {
        requestId: request.id,
        date: new Date(spec.date ?? "2026-03-02"),
        type: "travel_train",
        motivo: "Train",
        entity: "welld_ch",
        currency: "CHF",
        requestedAmountCents: 1000,
        approvedTotalCents: 1000,
        ...(spec.bare
          ? {}
          : {
              receiptNumber: spec.number ?? `LCX${String(year % 100)}/${String(seq).padStart(3, "0")}`,
              receiptOwnerUserId: owner,
              receiptYear: year,
              receiptSeq: seq,
              numberedAt: new Date(),
              receiptOrigin: spec.origin ?? "issued",
              receiptSplitPart: spec.part ?? 1,
            }),
      },
    }),
  );
}

describe("refund_line: origin and split part of a receipt number", () => {
  beforeEach(async () => {
    await truncateRefundTables();
    request = await db.refundRequest.create({ data: { ownerUserId: "owner-1", ownerEmail: "owner-1@welld.ch", status: "approved" } });
  });
  afterAll(async () => {
    await truncateRefundTables();
  });

  it("(control) an issued line, a paper line and a confirmed split pair are accepted; an unnumbered line has no origin", async () => {
    await expect(insertLine({ seq: 1 })).resolves.toBeTruthy();
    await expect(insertLine({ seq: 5, origin: "paper", number: "AB26/005" })).resolves.toBeTruthy();
    await asPromise(
      db.$transaction(async (tx) => {
        await insertLine({ seq: 7, origin: "paper_split", part: 1, number: "AB26/007" }, "owner-1", tx);
        await insertLine({ seq: 7, origin: "paper_split", part: 2, number: "AB26/007" }, "owner-1", tx);
      }),
    );
    const bare = await insertLine({ bare: true });
    expect(bare.receiptOrigin).toBeNull();
    expect(bare.receiptSplitPart).toBeNull();
  });

  it("a second part 1 of one (owner, year, seq) violates the unique index (AC-1.18)", async () => {
    await insertLine({ seq: 3 });
    await expect(insertLine({ seq: 3 })).rejects.toThrow(/unique constraint failed/i);
    // another owner, another year, another seq: fine
    await expect(insertLine({ seq: 3 }, "owner-2")).resolves.toBeTruthy();
    await expect(insertLine({ seq: 3, year: 2027 })).resolves.toBeTruthy();
    await expect(insertLine({ seq: 4 })).resolves.toBeTruthy();
  });

  it("the old three-column unique index is gone, the new four-column one exists", async () => {
    const names = (await query(`SELECT indexname FROM pg_indexes WHERE tablename = 'refund_line'`)).map((r) => r["indexname"]);
    expect(names).toContain("refund_line_receipt_owner_year_seq_part_key");
    expect(names).not.toContain("refund_line_receiptOwnerUserId_receiptYear_receiptSeq_key");
  });

  describe("a confirmed split is checked at COMMIT", () => {
    const split = (rows: LineSpec[], dates?: string[]) =>
      asPromise(
        db.$transaction(async (tx) => {
          for (const [i, r] of rows.entries()) await insertLine({ ...(dates?.[i] ? { date: dates[i] } : {}), ...r }, "owner-1", tx);
        }),
      );

    it("a part 2 with another number fails at commit", async () => {
      await expect(
        split([
          { seq: 9, origin: "paper_split", part: 1, number: "AB26/009" },
          { seq: 9, origin: "paper_split", part: 2, number: "CD26/009" },
        ]),
      ).rejects.toThrow(/split receipt/);
      expect(await db.refundLine.count()).toBe(0);
    });

    it("a part 2 with another expense date fails at commit", async () => {
      await expect(
        split(
          [
            { seq: 9, origin: "paper_split", part: 1, number: "AB26/009" },
            { seq: 9, origin: "paper_split", part: 2, number: "AB26/009" },
          ],
          ["2026-03-02", "2026-03-03"],
        ),
      ).rejects.toThrow(/split receipt/);
      expect(await db.refundLine.count()).toBe(0);
    });

    it("a part 2 attached to an issued part 1 fails at commit", async () => {
      await insertLine({ seq: 9, origin: "issued", part: 1 });
      await expect(insertLine({ seq: 9, origin: "paper_split", part: 2 })).rejects.toThrow(/split receipt/);
      expect(await db.refundLine.count()).toBe(1);
    });

    it("a part 2 with no part 1 fails at commit", async () => {
      await expect(split([{ seq: 9, origin: "paper_split", part: 2, number: "AB26/009" }])).rejects.toThrow(/split receipt/);
    });

    it("the group is read at COMMIT: the pair may be written part 2 first", async () => {
      await expect(
        split([
          { seq: 9, origin: "paper_split", part: 2, number: "AB26/009" },
          { seq: 9, origin: "paper_split", part: 1, number: "AB26/009" },
        ]),
      ).resolves.toBeUndefined();
      expect(await db.refundLine.count()).toBe(2);
    });
  });

  it("`issued` with seq 0 fails, `paper` with seq 0 passes (AC-1.11)", async () => {
    await expect(insertLine({ seq: 0, origin: "issued" })).rejects.toThrow(/refund_line_receipt_seq_range/);
    await expect(insertLine({ seq: 0, origin: "paper", number: "AB26/000" })).resolves.toBeTruthy();
    await expect(insertLine({ seq: 100000, origin: "paper", number: "AB26/100000" })).rejects.toThrow(/refund_line_receipt_seq_range|number_shape/);
  });

  it("the shape CHECK accepts `LCX26/040` and refuses `LCXX26/040` (AC-4.2)", async () => {
    await expect(insertLine({ seq: 40, number: "LCX26/040" })).resolves.toBeTruthy();
    for (const [i, bad] of ["LCXX26/040", "L26/040", "lcx26/041", "LCX26-042", "LCX26/", "LCX2026/043", "LCX26/123456"].entries()) {
      await expect(insertLine({ seq: 41 + i, number: bad })).rejects.toThrow(/refund_line_receipt_number_shape/);
    }
  });

  it("origin and part are set together with the number or not at all; the values are bounded", async () => {
    const bare = await insertLine({ bare: true });
    await expect(exec(`UPDATE "refund_line" SET "receiptOrigin" = 'issued' WHERE id = $1`, bare.id)).rejects.toThrow(/receipt_origin_all_or_none/);
    await expect(insertLine({ seq: 2, origin: "other" as never })).rejects.toThrow(/receipt_origin_known/);
    await expect(insertLine({ seq: 3, part: 0 })).rejects.toThrow(/receipt_split_part/);
    // a part above 1 is a split's
    await expect(insertLine({ seq: 4, part: 2, origin: "paper" })).rejects.toThrow(/receipt_split_part/);
  });

  it("UPDATE of the origin, the split part or the number of a numbered line raises; DELETE raises (AC-1.6)", async () => {
    const line = await insertLine({ seq: 6, origin: "paper", number: "AB26/006" });
    for (const set of [
      `"receiptOrigin" = 'issued'`,
      `"receiptSplitPart" = 2`,
      `"receiptNumber" = 'AB26/007'`,
      `"receiptSeq" = 7`,
    ]) {
      await expect(exec(`UPDATE "refund_line" SET ${set} WHERE id = $1`, line.id)).rejects.toThrow(/immutable|receipt_split_part/);
    }
    await expect(exec(`DELETE FROM "refund_line" WHERE id = $1`, line.id)).rejects.toThrow(/cannot be deleted/);
    const reread = await db.refundLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reread).toMatchObject({ receiptNumber: "AB26/006", receiptOrigin: "paper", receiptSplitPart: 1, receiptSeq: 6 });
  });

  it("a line with no number may still be numbered afterwards, origin and part together (the approval path)", async () => {
    const line = await insertLine({ bare: true });
    await expect(
      exec(
        `UPDATE "refund_line" SET "receiptNumber" = 'LCX26/001', "receiptOwnerUserId" = 'owner-1', "receiptYear" = 2026, "receiptSeq" = 1,
           "numberedAt" = now(), "receiptOrigin" = 'issued', "receiptSplitPart" = 1 WHERE id = $1`,
        line.id,
      ),
    ).resolves.toBe(1);
  });
});

describe("receipt_code and receipt_code_change (AC-4.3, AC-4.7)", () => {
  beforeEach(async () => {
    await truncateRefundTables();
  });
  afterAll(async () => {
    await truncateRefundTables();
  });

  const code = (ownerUserId: string, value: string) =>
    exec(
      `INSERT INTO "receipt_code" ("ownerUserId", "code", "updatedByUserId", "updatedByEmail", "updatedAt") VALUES ($1, $2, 'acct-1', 'acct@welld.ch', now())`,
      ownerUserId,
      value,
    );
  const change = (id: string, before: string | null, after: string | null, owner = "owner-1") =>
    exec(
      `INSERT INTO "receipt_code_change" ("id", "ownerUserId", "codeBefore", "codeAfter", "createdByUserId", "createdByEmail") VALUES ($1, $2, $3, $4, 'acct-1', 'acct@welld.ch')`,
      id,
      owner,
      before,
      after,
    );

  it("two receipt_code rows with one code violate the unique index; one row per employee", async () => {
    await code("owner-1", "LCX");
    await expect(code("owner-2", "LCX")).rejects.toThrow(/receipt_code_code_key/);
    await expect(code("owner-1", "LCY")).rejects.toThrow(/receipt_code_pkey/);
    await expect(code("owner-2", "LC")).resolves.toBe(1);
  });

  it("the code is two or three letters A-Z", async () => {
    for (const bad of ["L", "LCXX", "lcx", "L1", "LC ", "ÀB", ""]) {
      await expect(code("owner-x", bad)).rejects.toThrow(/receipt_code_shape/);
    }
  });

  it("receipt_code is mutable: UPDATE and DELETE are allowed", async () => {
    await code("owner-1", "LCX");
    await expect(exec(`UPDATE "receipt_code" SET "code" = 'LCY', "updatedAt" = now() WHERE "ownerUserId" = 'owner-1'`)).resolves.toBe(1);
    await expect(exec(`DELETE FROM "receipt_code" WHERE "ownerUserId" = 'owner-1'`)).resolves.toBe(1);
  });

  it("a change row records a set, a change and a clear; a no-op or a bad shape is refused", async () => {
    await expect(change("c1", null, "LCX")).resolves.toBe(1);
    await expect(change("c2", "LCX", "LCY")).resolves.toBe(1);
    await expect(change("c3", "LCY", null)).resolves.toBe(1);
    await expect(change("c4", "LCY", "LCY")).rejects.toThrow(/receipt_code_change_changes/);
    await expect(change("c5", null, null)).rejects.toThrow(/receipt_code_change_changes/);
    await expect(change("c6", "lcy", "LCX")).rejects.toThrow(/receipt_code_change_shape/);
    await expect(change("c7", "LCX", "LCXX")).rejects.toThrow(/receipt_code_change_shape/);
  });

  it("UPDATE and DELETE of receipt_code_change raise, and the row is untouched", async () => {
    await change("c1", null, "LCX");
    await expect(exec(`UPDATE "receipt_code_change" SET "codeAfter" = 'LCY' WHERE id = 'c1'`)).rejects.toThrow();
    await expect(exec(`DELETE FROM "receipt_code_change" WHERE id = 'c1'`)).rejects.toThrow();
    const rows = await query(`SELECT "codeBefore", "codeAfter" FROM "receipt_code_change"`);
    expect(rows).toEqual([{ codeBefore: null, codeAfter: "LCX" }]);
  });

  it("the truncate helper empties both tables", async () => {
    await code("owner-1", "LCX");
    await change("c1", null, "LCX");
    await truncateRefundTables();
    expect(await db.receiptCode.count()).toBe(0);
    expect(await db.receiptCodeChange.count()).toBe(0);
  });
});
