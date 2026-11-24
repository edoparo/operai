/**
 * `classifyAndNumber` with paper assignments (T4, specs/20261124-receipt-numbers-from-the-register; AC-1.2, AC-1.6, AC-1.17,
 * AC-3.3, AC-3.5, AC-4.5; plan § Components (b)-(d); ADR 20261124-a-receipt-number-is-issued-by-the-counter-or-imported-as-written-...).
 *
 * A paper line takes the text written in the accountant's register, with its classification copies in the same single UPDATE, and
 * skips the counter. Real Postgres; the function is exercised directly inside `db.$transaction`, the way the release calls it.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "../lib/db";
import { truncateRefundTables } from "../test-support/dbCleanup";
import { createFakeAccounting } from "../test-support/fakeAccounting";
import { ratePairKey } from "./accountingClient";
import { referenceSnapshot } from "./referenceSnapshot";
import { classifyAndNumber, type AccountingReads, type PaperAssignment } from "./numbering.repo";

const by = { createdByUserId: "admin", createdByEmail: "admin@welld.ch" };
const actor = { userId: "system:accounting-release", email: "accounting-release@welld.ch" };
const OWNER = { userId: "owner-1", name: "Matteo Codogno", email: "matteo.codogno@welld.ch" };

const fake = createFakeAccounting();
let reference: AccountingReads;

beforeEach(async () => {
  await truncateRefundTables();
  fake.removeAccount("5901");
  fake.setAccount("5901", "Treno");
  await db.expenseTypeAccountingDefault.create({ data: { entity: "welld_ch", type: "travel_train", accountNumber: "5901", accountName: "Treno", ...by } });
  const op = fake.begin("approve");
  const [data, answers] = await Promise.all([op.referenceData(), op.rates([])]);
  reference = { snapshot: referenceSnapshot(data), rates: new Map(answers.map((a) => [ratePairKey(a), a] as const)) };
});
afterAll(async () => {
  await truncateRefundTables();
});

/** One request of owner-1, with lines in the given order; ids are the keys. */
async function makeRequest(lines: { id: string; date: string; createdAt?: string }[], status: "submitted" | "approved" | "paid" = "approved") {
  const request = await db.refundRequest.create({
    data: { ownerUserId: OWNER.userId, ownerEmail: OWNER.email, ownerName: OWNER.name, status },
  });
  for (const spec of lines) {
    await db.refundLine.create({
      data: {
        id: spec.id,
        requestId: request.id,
        date: new Date(spec.date),
        type: "travel_train",
        motivo: "m",
        entity: "welld_ch",
        currency: "CHF",
        requestedAmountCents: 1000,
        approvedTotalCents: 1000,
        ...(spec.createdAt ? { createdAt: new Date(spec.createdAt) } : {}),
      },
    });
  }
  return request;
}

const paper = (entries: Record<string, PaperAssignment>) => new Map(Object.entries(entries));
const one = (number: string, registerRows: number[] = [3], splitPart = 1): PaperAssignment => ({ number, splitPart, registerRows });

const release = (requestIds: string[], assignments?: Map<string, PaperAssignment>) =>
  db.$transaction((tx) =>
    classifyAndNumber(tx, { owner: OWNER, requestIds, cause: "release", actor, reference, ...(assignments ? { paper: assignments } : {}) }),
  );

const lineOf = (id: string) => db.refundLine.findUniqueOrThrow({ where: { id } });
const counterOf = (year: number) => db.receiptCounter.findUnique({ where: { ownerUserId_year: { ownerUserId: OWNER.userId, year } } });
const assignedAudit = async (lineId: string) => (await db.refundAuditEntry.findFirstOrThrow({ where: { lineId, action: "receipt_number_assigned" } })).detail;

describe("a paper assignment skips the counter (AC-1.2, AC-1.6, AC-3.3)", () => {
  it("writes the paper text with the expense year and the paper sequence, origin paper, and does not move the counter", async () => {
    await db.receiptNumberBaseline.create({ data: { emailKey: OWNER.email, year: 2026, lastIssuedSeq: 10, ...by } });
    const r = await makeRequest([
      { id: "a", date: "2026-03-02" },
      { id: "b", date: "2026-03-03" },
      { id: "c", date: "2026-03-04" },
    ]);
    const res = await release([r.id], paper({ b: one("AB26/005", [4]) }));
    expect(res.ok && res.lines.map((l) => [l.lineId, l.receiptNumber, l.origin, l.seq])).toEqual([
      ["a", "MC26/011", "issued", 11],
      ["b", "AB26/005", "paper", 5],
      ["c", "MC26/012", "issued", 12],
    ]);
    expect(await lineOf("b")).toMatchObject({
      receiptNumber: "AB26/005",
      receiptOwnerUserId: "owner-1",
      receiptYear: 2026,
      receiptSeq: 5,
      receiptOrigin: "paper",
      receiptSplitPart: 1,
    });
    expect(await lineOf("a")).toMatchObject({ receiptOrigin: "issued", receiptSplitPart: 1 });
    // lastSeq = baseline + the number of NEW numbers, not counting the paper one
    expect(await counterOf(2026)).toMatchObject({ lastSeq: 12, startAfter: 10 });
  });

  it("the paper text is stored trimmed and upper-cased, and a zero paper sequence is stored as 0", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-03" }]);
    await release([r.id], paper({ a: one(" ab26/005 "), b: one("LG26/000", [9]) }));
    expect(await lineOf("a")).toMatchObject({ receiptNumber: "AB26/005", receiptSeq: 5 });
    expect(await lineOf("b")).toMatchObject({ receiptNumber: "LG26/000", receiptSeq: 0, receiptOrigin: "paper" });
  });

  it("a call with only paper lines creates no counter, so a later approval starts from the baseline or 001", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }]);
    await release([r.id], paper({ a: one("AB26/005") }));
    expect(await counterOf(2026)).toBeNull();
    const next = await makeRequest([{ id: "n", date: "2026-03-10" }]);
    await release([next.id]);
    expect(await lineOf("n")).toMatchObject({ receiptNumber: "MC26/001" });
  });

  it("the paper line is classified like any other, in the same statement (a paid request's guard allows it)", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }], "paid");
    const res = await release([r.id], paper({ a: one("AB26/005") }));
    expect(res.ok).toBe(true);
    expect(await lineOf("a")).toMatchObject({ receiptNumber: "AB26/005", accountNumber: "5901", accountName: "Treno", ledgerAccountIsDefault: true });
    expect(await db.refundAuditEntry.count({ where: { lineId: "a", action: "line_classified" } })).toBe(1);
  });

  it("(AC-1.16, AC-3.5) a paper number on a line of another year keeps that year's paper sequence and opens no counter; new lines of the year start at 001", async () => {
    const r = await makeRequest([{ id: "p25", date: "2025-12-30" }, { id: "n25", date: "2025-12-31" }, { id: "n27", date: "2027-01-05" }]);
    const res = await release([r.id], paper({ p25: one("AB25/041") }));
    expect(res.ok && res.lines.map((l) => [l.lineId, l.receiptNumber])).toEqual([
      ["p25", "AB25/041"],
      ["n25", "MC25/001"],
      ["n27", "MC27/001"],
    ]);
    expect(await lineOf("p25")).toMatchObject({ receiptYear: 2025, receiptSeq: 41 });
    expect((await counterOf(2025))?.lastSeq).toBe(1);
    expect((await counterOf(2027))?.lastSeq).toBe(1);
  });

  it("the new lines are numbered in (expense date, createdAt, id) order whatever is paper", async () => {
    // The baseline keeps the counter above the paper sequences, as the release writes it (AC-3.1): the key (owner, year, seq) is unique.
    await db.receiptNumberBaseline.create({ data: { emailKey: OWNER.email, year: 2026, lastIssuedSeq: 10, ...by } });
    const r = await makeRequest([
      { id: "z", date: "2026-03-02", createdAt: "2026-03-05T10:00:00Z" },
      { id: "y", date: "2026-03-02", createdAt: "2026-03-05T09:00:00Z" },
      { id: "x", date: "2026-03-01" },
      { id: "w", date: "2026-03-09" },
    ]);
    await release([r.id], paper({ y: one("AB26/002") }));
    expect(await Promise.all(["x", "y", "z", "w"].map(async (id) => (await lineOf(id)).receiptNumber))).toEqual([
      "MC26/011",
      "AB26/002",
      "MC26/012",
      "MC26/013",
    ]);
  });

  it("a receipt code applies to the new numbers of the same call, never to a paper number (AC-4.12)", async () => {
    await db.receiptCode.create({ data: { ownerUserId: "owner-1", code: "LCX", updatedByUserId: "a", updatedByEmail: "a@welld.ch" } });
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-03" }]);
    await release([r.id], paper({ a: one("MC26/005") }));
    expect(await lineOf("a")).toMatchObject({ receiptNumber: "MC26/005" });
    expect(await lineOf("b")).toMatchObject({ receiptNumber: "LCX26/001" });
  });
});

describe("a confirmed split receipt: one number on several lines (AC-1.6, AC-1.18)", () => {
  it("two lines get parts 1 and 2, origin paper_split, one number, and the counter does not move", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-02" }, { id: "c", date: "2026-03-05" }]);
    const res = await release([r.id], paper({ a: one("AB26/007", [6], 1), b: one("AB26/007", [6], 2) }));
    expect(res.ok && res.lines.map((l) => [l.lineId, l.receiptNumber, l.origin, l.splitPart])).toEqual([
      ["a", "AB26/007", "paper_split", 1],
      ["b", "AB26/007", "paper_split", 2],
      ["c", "MC26/001", "issued", 1],
    ]);
    expect(await lineOf("a")).toMatchObject({ receiptOrigin: "paper_split", receiptSplitPart: 1, receiptSeq: 7 });
    expect(await lineOf("b")).toMatchObject({ receiptOrigin: "paper_split", receiptSplitPart: 2, receiptSeq: 7 });
    expect((await counterOf(2026))?.lastSeq).toBe(1);
  });

  it("parts that are not 1..n once each are refused before anything is written", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-02" }]);
    await expect(release([r.id], paper({ a: one("AB26/007", [6], 2), b: one("AB26/007", [6], 3) }))).rejects.toThrow(/split parts/);
    await expect(release([r.id], paper({ a: one("AB26/007", [6], 1), b: one("AB26/007", [6], 1) }))).rejects.toThrow(/split parts/);
    await expect(release([r.id], paper({ a: one("AB26/007", [6], 2) }))).rejects.toThrow(/split parts/);
    expect((await lineOf("a")).receiptNumber).toBeNull();
    expect(await counterOf(2026)).toBeNull();
  });

  it("two numbers that only differ in case are one number", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-02" }]);
    await release([r.id], paper({ a: one("ab26/007", [6], 1), b: one("AB26/007", [6], 2) }));
    expect(await lineOf("b")).toMatchObject({ receiptNumber: "AB26/007", receiptOrigin: "paper_split" });
  });
});

describe("the audit detail of each origin (AC-1.17: row positions only)", () => {
  it("new, paper and paper_split", async () => {
    const r = await makeRequest([
      { id: "n", date: "2026-03-01" },
      { id: "p", date: "2026-03-02" },
      { id: "s1", date: "2026-03-03" },
      { id: "s2", date: "2026-03-03" },
    ]);
    await release([r.id], paper({ p: one("AB26/005", [4]), s1: one("CD26/009", [8, 9], 1), s2: one("CD26/009", [8, 9], 2) }));
    expect(await assignedAudit("n")).toEqual({ cause: "release", receiptNumber: "MC26/001", year: 2026, seq: 1, origin: "new" });
    expect(await assignedAudit("p")).toEqual({ cause: "release", receiptNumber: "AB26/005", year: 2026, seq: 5, origin: "paper", registerRows: [4] });
    expect(await assignedAudit("s1")).toEqual({
      cause: "release", receiptNumber: "CD26/009", year: 2026, seq: 9, origin: "paper_split", registerRows: [8, 9], splitPart: 1,
    });
    expect(await assignedAudit("s2")).toEqual({
      cause: "release", receiptNumber: "CD26/009", year: 2026, seq: 9, origin: "paper_split", registerRows: [8, 9], splitPart: 2,
    });
  });
});

describe("what is refused, loudly and before anything is written", () => {
  it("a paper number for a line this call does not number", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }]);
    await expect(release([r.id], paper({ ghost: one("AB26/005") }))).rejects.toThrow(/does not number/);
    expect((await lineOf("a")).receiptNumber).toBeNull();
    // an already numbered line is not one either
    await release([r.id]);
    await expect(release([r.id], paper({ a: one("AB26/005") }))).rejects.toThrow(/does not number/);
    expect(await lineOf("a")).toMatchObject({ receiptNumber: "MC26/001", receiptOrigin: "issued" });
  });

  it("text that is not a receipt number, and a split part below 1", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }]);
    for (const bad of ["AA99/9A", "ABCD26/001", "", "5"]) {
      await expect(release([r.id], paper({ a: one(bad) }))).rejects.toThrow(/not a receipt number/);
    }
    await expect(release([r.id], paper({ a: one("AB26/005", [1], 0) }))).rejects.toThrow(/split part/);
    expect(await counterOf(2026)).toBeNull();
    expect((await lineOf("a")).receiptNumber).toBeNull();
  });

  it("a paper sequence that the counter has already reached is refused by the database (uniqueness per owner, year and sequence), and the call rolls back", async () => {
    const r0 = await makeRequest([{ id: "first", date: "2026-03-01" }]);
    await release([r0.id]); // MC26/001
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }]);
    await expect(release([r.id], paper({ a: one("AB26/001") }))).rejects.toThrow();
    expect((await lineOf("a")).receiptNumber).toBeNull();
  });

  it("two lines of one employee with the same paper sequence and different text are refused by the database, and the call rolls back", async () => {
    const r = await makeRequest([{ id: "a", date: "2026-03-02" }, { id: "b", date: "2026-03-03" }]);
    await expect(release([r.id], paper({ a: one("AB26/005"), b: one("CD26/005") }))).rejects.toThrow();
    expect((await lineOf("a")).receiptNumber).toBeNull();
    expect((await lineOf("b")).receiptNumber).toBeNull();
  });
});
