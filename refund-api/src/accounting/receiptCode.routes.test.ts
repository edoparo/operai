/**
 * Integration tests of the receipt-code endpoints (T5, specs/20261124-receipt-numbers-from-the-register; plan § API contracts, D8;
 * design sync DS-2, DS-8; AC-4.1, AC-4.2, AC-4.3, AC-4.6, AC-4.7, AC-4.9, AC-4.10, AC-4.11).
 *
 * Real Postgres, jwt/authz mocked. The numbering that follows a change is exercised through `classifyAndNumber` (the approve
 * transaction calls it) on WellD Italia lines, which need no Accounting read.
 */

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import type { ResolveResponse } from "../authz/resolveClient";
import { setupTestAuth } from "../test-support/testAuth";
import { truncateRefundTables } from "../test-support/dbCleanup";

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
process.env["REFUND_S3_ENDPOINT"] = "https://test.s3.railway-eu-amsterdam.example.com";
process.env["REFUND_S3_REGION"] = "auto";
process.env["REFUND_S3_EU_ENDPOINT_HOSTS"] = "s3.railway-eu-amsterdam.example.com";
process.env["REFUND_S3_BUCKET"] = "test-bucket";
process.env["REFUND_S3_ACCESS_KEY_ID"] = "test-key";
process.env["REFUND_S3_SECRET_ACCESS_KEY"] = "test-secret";
process.env["REFUND_APP_BASE_URL"] = "http://localhost:5173";

const harness = setupTestAuth();
await harness.init();

const { receiptCodeRouter } = await import("./receiptCode.routes");
const { classifyAndNumber } = await import("./numbering.repo");
const { db } = await import("../lib/db");
const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");

const grant = (resource: string, action: string) => ({ resource, action, conditions: null });
const asUser = (...permissions: { resource: string; action: string; conditions: null }[]): ResolveResponse => ({
  sub: "",
  epoch: 1,
  permissions,
  entity: null,
  jobTitle: null,
});
const MANAGER = asUser(grant("refund", "access"), grant("receipt-code", "manage"));
/** Every other Refund capability, and the Accounting ones: none opens the receipt codes (AC-4.9). */
const NOT_MANAGER = asUser(
  grant("refund", "access"),
  grant("settings", "read"),
  grant("settings", "manage"),
  grant("request", "review"),
  grant("request", "approve"),
  grant("accounting", "manage"),
  grant("accounting", "read"),
);

async function call(method: string, path: string, opts: { body?: unknown; raw?: string; as?: ResolveResponse; token?: boolean; email?: string } = {}) {
  __resetAuthzCacheForTests();
  harness.setResolve(async () => opts.as ?? MANAGER);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token !== false) headers["Authorization"] = `Bearer ${await harness.signToken({ sub: "acct-1", email: opts.email ?? "acct-1@welld.ch" })}`;
  const res = await receiptCodeRouter.request(path, {
    method,
    headers,
    ...(opts.raw !== undefined ? { body: opts.raw } : opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    body = { text };
  }
  return { status: res.status, body, headers: res.headers, text };
}

const list = (opts: Parameters<typeof call>[2] = {}) => call("GET", "/accounting/receipt-codes", opts);
const put = (userId: string, code: unknown, opts: Parameters<typeof call>[2] = {}) =>
  call("PUT", `/accounting/receipt-codes/${userId}`, { body: { code }, ...opts });
const history = (userId: string, opts: Parameters<typeof call>[2] = {}) => call("GET", `/accounting/receipt-codes/${userId}/history`, opts);
const rowOf = (res: { body: Record<string, any> }, userId: string) => (res.body["employees"] as any[]).find((e) => e.userId === userId);

const PEOPLE = {
  luca: { id: "u-luca", name: "Luca Conti", email: "luca.conti@welld.ch" }, // LC
  anna: { id: "u-anna", name: "Anna Rossi", email: "anna.rossi@welld.ch" }, // AR
  marco: { id: "u-marco", name: "Marco Bianchi", email: "marco.bianchi@welld.ch" }, // MB
  second: { id: "u-second", name: "Lucia Costa", email: "lucia.costa@welld.ch" }, // LC again
};

beforeEach(async () => {
  await truncateRefundTables();
  __resetAuthzCacheForTests();
});
afterAll(async () => {
  await truncateRefundTables();
});

/** A request of the employee with `count` WellD Italia lines (numbered by `classifyAndNumber` without Accounting). */
async function request(person: { id: string; name: string; email: string }, count = 1, firstDate = "2026-03-02") {
  const created = await db.refundRequest.create({
    data: { ownerUserId: person.id, ownerEmail: person.email, ownerName: person.name, status: "submitted" },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const day = String(Number(firstDate.slice(8)) + i).padStart(2, "0");
    const line = await db.refundLine.create({
      data: {
        requestId: created.id,
        date: new Date(`${firstDate.slice(0, 8)}${day}`),
        type: "office_material",
        motivo: "m",
        entity: "welld_it",
        currency: "CHF",
        requestedAmountCents: 1000,
      },
    });
    ids.push(line.id);
  }
  return { requestId: created.id, lineIds: ids };
}

/** What an approval does: number the request's lines. Returns the numbers in date order. */
async function approve(person: { id: string; name: string; email: string }, requestId: string) {
  const res = await db.$transaction((tx) =>
    classifyAndNumber(tx, {
      owner: { userId: person.id, name: person.name, email: person.email },
      requestIds: [requestId],
      cause: "approval",
      actor: { userId: "acct-1", email: "acct-1@welld.ch" },
      reference: null,
    }),
  );
  if (!res.ok) throw new Error(`approval refused: ${res.reason}`);
  return res.lines.map((l) => l.receiptNumber);
}

/** A line numbered directly: an issued number, or one imported from the register. */
async function numbered(person: { id: string }, requestId: string, number: string, seq: number, origin: "issued" | "paper" = "issued", year = 2026) {
  await db.refundLine.create({
    data: {
      requestId,
      date: new Date(`${year}-03-01`),
      type: "office_material",
      motivo: "m",
      entity: "welld_it",
      currency: "CHF",
      requestedAmountCents: 1000,
      receiptNumber: number,
      receiptOwnerUserId: person.id,
      receiptYear: year,
      receiptSeq: seq,
      receiptOrigin: origin,
      receiptSplitPart: 1,
      numberedAt: new Date(),
    },
  });
}

const rowCounts = async () => ({ codes: await db.receiptCode.count(), changes: await db.receiptCodeChange.count() });

describe("the gate: receipt-code:manage on every method (AC-4.9)", () => {
  it("is 403 `forbidden` on all three routes without the capability, whatever else the caller may do, and nothing changes", async () => {
    await request(PEOPLE.luca);
    for (const as of [NOT_MANAGER, asUser(grant("refund", "access"))]) {
      const calls = [list({ as }), put(PEOPLE.luca.id, "LCX", { as }), history(PEOPLE.luca.id, { as })];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expect(res.body["code"]).toBe("forbidden");
      }
    }
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
  });

  it("the capability is checked before the body: a bad body without the capability is 403, not 422", async () => {
    const res = await put(PEOPLE.luca.id, "A", { as: NOT_MANAGER });
    expect(res.status).toBe(403);
    const raw = await call("PUT", `/accounting/receipt-codes/${PEOPLE.luca.id}`, { raw: "{not json", as: NOT_MANAGER });
    expect(raw.status).toBe(403);
  });

  it("is 401 without a token, on all three routes", async () => {
    for (const res of [await list({ token: false }), await put("u", "LCX", { token: false }), await history("u", { token: false })]) {
      expect(res.status).toBe(401);
    }
  });

  it("answers carry no-store and nosniff, the refusals too; the 403 `instance` is the route pattern, with no id", async () => {
    const refused = await put(PEOPLE.luca.id, "LCX", { as: NOT_MANAGER });
    expect(refused.headers.get("Cache-Control")).toBe("private, no-store");
    expect(refused.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(refused.body["instance"]).toBe("/accounting/receipt-codes/{userId}");
    expect(JSON.stringify(refused.body)).not.toContain(PEOPLE.luca.id);
    const ok = await list();
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await history(PEOPLE.luca.id, { as: NOT_MANAGER })).body["instance"]).toBe("/accounting/receipt-codes/{userId}/history");
  });

  it("a body above 1 KiB is 413", async () => {
    const res = await put(PEOPLE.luca.id, "x".repeat(2000));
    expect(res.status).toBe(413);
  });
});

describe("the list (AC-4.1, DS-2, DS-8)", () => {
  it("lists the employees known to Refund, ordered by name then user id, with the newest request's name and email", async () => {
    await request({ id: "u-z", name: "Zeno Zanetti", email: "zeno@welld.ch" });
    await request(PEOPLE.anna);
    await request({ id: "u-b2", name: "Anna Rossi", email: "anna.two@welld.ch" });
    await request({ ...PEOPLE.luca, name: "Old Name" });
    await request(PEOPLE.luca); // the newest request wins
    const res = await list();
    expect(res.status).toBe(200);
    expect((res.body["employees"] as any[]).map((e) => e.userId)).toEqual(["u-anna", "u-b2", "u-luca", "u-z"]);
    expect(rowOf(res, "u-luca")).toEqual({
      userId: "u-luca",
      name: "Luca Conti",
      email: "luca.conti@welld.ch",
      initials: "LC",
      code: null,
      prefix: "LC",
      prefixSource: "initials",
      lastNumber: null,
      changedAt: null,
      changedByEmail: null,
      sharesPrefix: false,
    });
  });

  it("an employee with no request is not listed; the list is empty with no request", async () => {
    expect((await list()).body["employees"]).toEqual([]);
  });

  it("the prefix is the code once set, the last number is the highest (year, sequence) as issued", async () => {
    const r = await request(PEOPLE.luca);
    await numbered(PEOPLE.luca, r.requestId, "LC26/039", 39);
    await numbered(PEOPLE.luca, r.requestId, "LC25/044", 44, "issued", 2025);
    await numbered(PEOPLE.luca, r.requestId, "LC26/012", 12);
    expect(rowOf(await list(), "u-luca").lastNumber).toBe("LC26/039");
    await put("u-luca", "lcx");
    const row = rowOf(await list(), "u-luca");
    expect(row).toMatchObject({ code: "LCX", prefix: "LCX", prefixSource: "code", initials: "LC", lastNumber: "LC26/039" });
  });

  it("`changedAt` is null for an employee never changed, and set after a clear (DS-2)", async () => {
    await request(PEOPLE.luca);
    await request(PEOPLE.anna);
    expect(rowOf(await list(), "u-luca")).toMatchObject({ changedAt: null, changedByEmail: null });
    await put("u-luca", "LCX", { email: "first@welld.ch" });
    await put("u-luca", null, { email: "second@welld.ch" });
    const luca = rowOf(await list(), "u-luca");
    expect(luca.code).toBeNull();
    expect(luca.changedByEmail).toBe("second@welld.ch");
    expect(new Date(luca.changedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(rowOf(await list(), "u-anna")).toMatchObject({ changedAt: null, changedByEmail: null });
  });
});

describe("set, change and clear (AC-4.2, AC-4.4, AC-4.5, AC-4.10)", () => {
  it("a code set takes effect at the next approval; the issued numbers stay as issued", async () => {
    const first = await request(PEOPLE.luca);
    await db.receiptNumberBaseline.create({ data: { emailKey: PEOPLE.luca.email, year: 2026, lastIssuedSeq: 38, createdByUserId: "s", createdByEmail: "s@welld.ch" } });
    expect(await approve(PEOPLE.luca, first.requestId)).toEqual(["LC26/039"]);

    const res = await put("u-luca", " lcx ");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: "u-luca", code: "LCX", prefix: "LCX", prefixSource: "code", lastNumber: "LC26/039", sharesPrefix: false });

    const second = await request(PEOPLE.luca, 1, "2026-03-10");
    expect(await approve(PEOPLE.luca, second.requestId)).toEqual(["LCX26/040"]);
    expect((await db.refundLine.findUniqueOrThrow({ where: { id: first.lineIds[0]! } })).receiptNumber).toBe("LC26/039");
  });

  it("change LCX to LCY, then clear: LCY26/041, then LC26/042; earlier lines unchanged", async () => {
    const r1 = await request(PEOPLE.luca);
    await db.receiptNumberBaseline.create({ data: { emailKey: PEOPLE.luca.email, year: 2026, lastIssuedSeq: 39, createdByUserId: "s", createdByEmail: "s@welld.ch" } });
    await put("u-luca", "LCX");
    expect(await approve(PEOPLE.luca, r1.requestId)).toEqual(["LCX26/040"]);
    expect((await put("u-luca", "LCY")).status).toBe(200);
    const r2 = await request(PEOPLE.luca, 1, "2026-03-10");
    expect(await approve(PEOPLE.luca, r2.requestId)).toEqual(["LCY26/041"]);
    const cleared = await put("u-luca", "");
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ code: null, prefix: "LC", prefixSource: "initials", lastNumber: "LCY26/041" });
    const r3 = await request(PEOPLE.luca, 1, "2026-03-11");
    expect(await approve(PEOPLE.luca, r3.requestId)).toEqual(["LC26/042"]);
    const lines = await db.refundLine.findMany({ where: { receiptOwnerUserId: "u-luca" }, orderBy: { receiptSeq: "asc" } });
    expect(lines.map((l) => l.receiptNumber)).toEqual(["LCX26/040", "LCY26/041", "LC26/042"]);
    expect(await db.receiptCode.count()).toBe(0);
  });

  it("a 2027 number takes the code and restarts at 001 (AC-4.5)", async () => {
    const r = await request(PEOPLE.luca, 1, "2027-01-05");
    await put("u-luca", "LCX");
    expect(await approve(PEOPLE.luca, r.requestId)).toEqual(["LCX27/001"]);
  });

  it("every AC-4.2 vector that is not two or three letters is 422 `receipt_code_invalid`, with no receipt_code or change row", async () => {
    await request(PEOPLE.luca);
    for (const bad of ["A", "ABCD", "A1", "ÀB", "A B", "ßA", "ß", "12", "A-B", "ab\ncd"]) {
      const res = await put("u-luca", bad);
      expect(res.status).toBe(422);
      expect(res.body["code"]).toBe("receipt_code_invalid");
      expect(res.body["detail"]).toBe("A receipt code is two or three letters A–Z");
      expect(res.body["instance"]).toBe("/accounting/receipt-codes/{userId}");
    }
    // a value that is not text, a missing key and another key are the same refusal
    for (const body of [{ code: 12 }, { code: true }, { code: ["LCX"] }, {}, { code: "LCX", extra: 1 }, { codes: "LCX" }, { code: "LCX", userId: "u-anna" }]) {
      const res = await call("PUT", "/accounting/receipt-codes/u-luca", { body });
      expect(res.status).toBe(422);
      expect(res.body["code"]).toBe("receipt_code_invalid");
    }
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
  });

  it("404 `employee_not_found` when no request has that owner, for the PUT and the history; nothing is written", async () => {
    const res = await put("u-nobody", "LCX");
    expect(res.status).toBe(404);
    expect(res.body["code"]).toBe("employee_not_found");
    expect((await history("u-nobody")).status).toBe(404);
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
  });

  it("the actor is the JWT's, never the body's", async () => {
    await request(PEOPLE.luca);
    await call("PUT", "/accounting/receipt-codes/u-luca", { body: { code: "LCX" }, email: "jwt-actor@welld.ch" });
    const change = await db.receiptCodeChange.findFirstOrThrow();
    expect(change).toMatchObject({ ownerUserId: "u-luca", codeBefore: null, codeAfter: "LCX", createdByUserId: "acct-1", createdByEmail: "jwt-actor@welld.ch" });
    expect(await db.receiptCode.findUniqueOrThrow({ where: { ownerUserId: "u-luca" } })).toMatchObject({ updatedByEmail: "jwt-actor@welld.ch" });
  });
});

describe("in use (AC-4.3): 409 `receipt_code_in_use`, naming nobody", () => {
  const expectInUse = (res: { status: number; body: Record<string, any>; text: string }) => {
    expect(res.status).toBe(409);
    expect(res.body["code"]).toBe("receipt_code_in_use");
    expect(res.body["detail"]).toBe("This code is already in use");
    expect(res.body["instance"]).toBe("/accounting/receipt-codes/{userId}");
    for (const other of [PEOPLE.anna, PEOPLE.marco]) {
      expect(res.text).not.toContain(other.name);
      expect(res.text).not.toContain(other.email);
      expect(res.text).not.toContain(other.id);
    }
    expect(res.text).not.toContain("Anna");
  };

  it("another employee's code", async () => {
    await request(PEOPLE.luca);
    await request(PEOPLE.anna);
    expect((await put("u-anna", "LCX")).status).toBe(200);
    expectInUse(await put("u-luca", "lcx"));
    expect(await db.receiptCode.count()).toBe(1);
    expect(await db.receiptCodeChange.count()).toBe(1);
  });

  it("another employee's issued number", async () => {
    await request(PEOPLE.luca);
    const r = await request(PEOPLE.anna);
    await numbered(PEOPLE.anna, r.requestId, "ZZ26/001", 1);
    expectInUse(await put("u-luca", "ZZ"));
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
  });

  it("another employee's imported number", async () => {
    await request(PEOPLE.luca);
    const r = await request(PEOPLE.anna);
    await numbered(PEOPLE.anna, r.requestId, "XYZ26/005", 5, "paper");
    expectInUse(await put("u-luca", "xyz"));
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
  });

  it("my own old numbers do not block my own code, nor does a prefix of a longer prefix", async () => {
    const r = await request(PEOPLE.luca);
    await numbered(PEOPLE.luca, r.requestId, "LC26/039", 39);
    expect((await put("u-luca", "LC")).status).toBe(200);
    const other = await request(PEOPLE.anna);
    await numbered(PEOPLE.anna, other.requestId, "ABC26/001", 1);
    expect((await put("u-luca", "AB")).status).toBe(200); // AB is not ABC
  });

  it("a code equal to a codeless colleague's initials with no number is allowed, and both rows say sharesPrefix (DS-8)", async () => {
    await request(PEOPLE.luca); // LC
    await request(PEOPLE.second); // LC (Lucia Costa), no code, no number
    const res = await put("u-luca", "LC");
    expect(res.status).toBe(200);
    expect(res.body["sharesPrefix"]).toBe(true);
    const all = await list();
    expect(rowOf(all, "u-luca").sharesPrefix).toBe(true);
    expect(rowOf(all, "u-second").sharesPrefix).toBe(true);
  });

  it("two employees with the same initials and no code share a prefix; a code on one of them that differs ends it (DS-8)", async () => {
    await request(PEOPLE.luca);
    await request(PEOPLE.second);
    await request(PEOPLE.anna);
    const before = await list();
    expect([rowOf(before, "u-luca").sharesPrefix, rowOf(before, "u-second").sharesPrefix, rowOf(before, "u-anna").sharesPrefix]).toEqual([true, true, false]);
    await put("u-luca", "LCX");
    const after = await list();
    expect([rowOf(after, "u-luca").sharesPrefix, rowOf(after, "u-second").sharesPrefix]).toEqual([false, false]);
  });

  it("the prefix of a number issued or imported to another employee counts, in any year (DS-8)", async () => {
    await request(PEOPLE.luca);
    const r = await request(PEOPLE.anna);
    await numbered(PEOPLE.anna, r.requestId, "LC25/003", 3, "issued", 2025);
    expect(rowOf(await list(), "u-luca").sharesPrefix).toBe(true);
    // Anna's own row: her prefix AR is nobody's
    expect(rowOf(await list(), "u-anna").sharesPrefix).toBe(false);
  });
});

describe("saving the current value, and the history (AC-4.7)", () => {
  it("saving the current value is a 200 that writes nothing, a clear of no code too", async () => {
    await request(PEOPLE.luca);
    expect((await put("u-luca", "")).status).toBe(200);
    expect((await put("u-luca", null)).status).toBe(200);
    expect(await rowCounts()).toEqual({ codes: 0, changes: 0 });
    await put("u-luca", "LCX");
    const again = await put("u-luca", "lcx");
    expect(again.status).toBe(200);
    expect(again.body["code"]).toBe("LCX");
    expect(await rowCounts()).toEqual({ codes: 1, changes: 1 });
    expect((await history("u-luca")).body["entries"]).toHaveLength(1);
  });

  it("the history is newest first with before, after, who and when; none for a no-op; empty for a never-changed employee", async () => {
    await request(PEOPLE.luca);
    expect((await history("u-luca")).body).toEqual({ entries: [] });
    await put("u-luca", "LCX", { email: "one@welld.ch" });
    await put("u-luca", "LCX", { email: "noop@welld.ch" });
    await put("u-luca", "LCY", { email: "two@welld.ch" });
    await put("u-luca", null, { email: "three@welld.ch" });
    const res = await history("u-luca");
    expect(res.status).toBe(200);
    const entries = res.body["entries"] as any[];
    expect(entries.map((e) => [e.codeBefore, e.codeAfter, e.changedBy.email])).toEqual([
      ["LCY", null, "three@welld.ch"],
      ["LCX", "LCY", "two@welld.ch"],
      [null, "LCX", "one@welld.ch"],
    ]);
    expect(entries[0].changedBy.userId).toBe("acct-1");
    for (const e of entries) expect(new Date(e.changedAt).toISOString()).toBe(e.changedAt);
    expect(entries.map((e) => e.changedAt)).toEqual([...entries.map((e) => e.changedAt)].sort().reverse());
  });

  it("a history belongs to its employee only", async () => {
    await request(PEOPLE.luca);
    await request(PEOPLE.anna);
    await put("u-luca", "LCX");
    expect((await history("u-anna")).body).toEqual({ entries: [] });
  });
});

describe("two employees, one code (AC-4.3)", () => {
  it("two concurrent PUTs of one code for two employees: one 200, one 409", async () => {
    await request(PEOPLE.luca);
    await request(PEOPLE.anna);
    for (let round = 0; round < 10; round++) {
      const [a, b] = await Promise.all([put("u-luca", "QQQ"), put("u-anna", "QQQ")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await db.receiptCode.count({ where: { code: "QQQ" } })).toBe(1);
      expect(await db.receiptCodeChange.count()).toBe(1 + round * 2);
      // clear the winner for the next round
      const winner = a.status === 200 ? "u-luca" : "u-anna";
      expect((await put(winner, null)).status).toBe(200);
    }
  });
});
