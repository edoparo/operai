/**
 * A receipt-code change racing an approval of the same employee (T5, specs/20261124-receipt-numbers-from-the-register; AC-4.10;
 * plan D8 "read once per `classifyAndNumber` call, inside the transaction", no new lock).
 *
 * Every number of one approval is wholly under the old prefix or wholly under the new one, never a mixture, and the counter
 * continues without a gap or a repeat. Real Postgres, jwt/authz mocked.
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

// @ts-expect-error -- the query suffix is a runtime-only cache-buster (testAuth.ts: no shared router specifier)
const { receiptCodeRouter } = (await import("./receiptCode.routes?receipt-code-race")) as typeof import("./receiptCode.routes");
const { classifyAndNumber } = await import("./numbering.repo");
const { db } = await import("../lib/db");
const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");

const MANAGER: ResolveResponse = {
  sub: "",
  epoch: 1,
  permissions: [
    { resource: "refund", action: "access", conditions: null },
    { resource: "receipt-code", action: "manage", conditions: null },
  ],
  entity: null,
  jobTitle: null,
};
const OWNER = { userId: "u-luca", name: "Luca Conti", email: "luca.conti@welld.ch" };

beforeEach(async () => {
  await truncateRefundTables();
  __resetAuthzCacheForTests();
  harness.setResolve(async () => MANAGER);
});
afterAll(async () => {
  await truncateRefundTables();
});

async function putCode(code: string | null): Promise<number> {
  __resetAuthzCacheForTests();
  harness.setResolve(async () => MANAGER);
  const token = await harness.signToken({ sub: "acct-1", email: "acct-1@welld.ch" });
  const res = await receiptCodeRouter.request(`/accounting/receipt-codes/${OWNER.userId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  await res.text();
  return res.status;
}

/** A submitted request with `count` WellD Italia lines, dated in order. */
async function request(count: number, month = "03") {
  const created = await db.refundRequest.create({
    data: { ownerUserId: OWNER.userId, ownerEmail: OWNER.email, ownerName: OWNER.name, status: "submitted" },
  });
  for (let i = 0; i < count; i++) {
    await db.refundLine.create({
      data: { requestId: created.id, date: new Date(`2026-${month}-${String(i + 1).padStart(2, "0")}`), type: "office_material", motivo: "m", entity: "welld_it", currency: "CHF", requestedAmountCents: 1000 },
    });
  }
  return created.id;
}

const approve = (requestId: string) =>
  db.$transaction((tx) =>
    classifyAndNumber(tx, { owner: OWNER, requestIds: [requestId], cause: "approval", actor: { userId: "acct-1", email: "acct-1@welld.ch" }, reference: null }),
  );

const prefixOf = (number: string) => /^[A-Z]+/.exec(number)![0];

describe("a PUT racing an approval of the same employee (AC-4.10)", () => {
  it("20 repetitions behind a barrier: each approval's numbers carry one prefix, old or new, and the counter has no gap and no repeat", async () => {
    const REPS = 20;
    const LINES = 3;
    const seen = new Set<string>();
    for (let rep = 0; rep < REPS; rep++) {
      const requestId = await request(LINES);
      const before = rep % 2 === 0 ? null : "LCX"; // the code in force when the round starts
      const after = rep % 2 === 0 ? "LCX" : null; // the PUT of the round
      // Put the database in the "before" state outside the race (a no-op on odd rounds, where the previous round ended with LCX).
      expect(await putCode(before)).toBe(200);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const approval = gate.then(() => approve(requestId));
      const change = gate.then(() => putCode(after));
      release();
      const [numbered, status] = await Promise.all([approval, change]);
      expect(status).toBe(200);
      expect(numbered.ok).toBe(true);
      if (!numbered.ok) continue;
      const prefixes = new Set(numbered.lines.map((l) => prefixOf(l.receiptNumber)));
      expect(prefixes.size).toBe(1); // never a mixture
      const prefix = [...prefixes][0]!;
      expect([prefixOf(before ?? "LC"), prefixOf(after ?? "LC")]).toContain(prefix);
      seen.add(prefix);
    }
    // the counter: seq 1..N, each once, in order of issue, whatever the prefixes
    const lines = await db.refundLine.findMany({ where: { receiptOwnerUserId: OWNER.userId, receiptYear: 2026 }, orderBy: { receiptSeq: "asc" } });
    expect(lines.map((l) => l.receiptSeq)).toEqual(Array.from({ length: REPS * LINES }, (_, i) => i + 1));
    expect((await db.receiptCounter.findUniqueOrThrow({ where: { ownerUserId_year: { ownerUserId: OWNER.userId, year: 2026 } } })).lastSeq).toBe(REPS * LINES);
    expect(seen.size).toBeGreaterThan(0);
  });

  it("a code changed while the approval is running (after its prefix read) is the next approval's: this one is wholly old, the next wholly new", async () => {
    const approvalOne = await request(3, "03");
    let changed = 0;
    const result = await db.$transaction(async (tx) => {
      // The change commits on its own connection right after the approval has read the code.
      const spied = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop !== "receiptCode") return Reflect.get(target, prop, receiver);
          return new Proxy(target.receiptCode, {
            get(codeTarget, codeProp, codeReceiver) {
              const value = Reflect.get(codeTarget, codeProp, codeReceiver);
              if (codeProp !== "findUnique") return value;
              return async (...args: unknown[]) => {
                const seen = await (value as (...a: unknown[]) => Promise<unknown>).apply(codeTarget, args);
                changed = await putCode("LCX");
                return seen;
              };
            },
          });
        },
      });
      return classifyAndNumber(spied, { owner: OWNER, requestIds: [approvalOne], cause: "approval", actor: { userId: "acct-1", email: "acct-1@welld.ch" }, reference: null });
    });
    expect(changed).toBe(200);
    expect(result.ok && result.lines.map((l) => l.receiptNumber)).toEqual(["LC26/001", "LC26/002", "LC26/003"]);
    const approvalTwo = await request(2, "04");
    const next = await approve(approvalTwo);
    expect(next.ok && next.lines.map((l) => l.receiptNumber)).toEqual(["LCX26/004", "LCX26/005"]);
  });
});
