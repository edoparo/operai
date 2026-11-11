/**
 * specs/028 AC-2.1 and AC-2.4, the half the import suite does not reach: rows that CAME from the
 * CRM through the import script still behave. T13's own tests prove the copy is equal field by
 * field; the plan's § Test strategy row "2.1, 2.2, 2.4" also asks that "estimate task + meeting
 * activity still [be] driven by 1.3/1.4 after import". This file drives them:
 *
 *   - the CRM's lists (company timeline, a person's tasks) show the imported rows, in order (AC-2.1);
 *   - an imported estimate task is completed and reopened by crm-api's completion notices, a
 *     duplicate or older `seq` changes nothing, and a task that was already done before the move
 *     can be reopened (AC-1.3 via AC-2.4);
 *   - an imported meeting activity is updated and removed by meeting notices, and the guard that
 *     moved with the data (`meeting_mirror_state`, lastSeq 4 at import) still refuses a duplicate
 *     or older notice and cannot be beaten by a late `linked` (AC-1.4 via AC-2.4).
 *
 * Source: a database this file provisions itself with the pre-T14 shape of the CRM tables the
 * script reads (test-support/crmSource.ts), so it does not depend on crm-api's schema version
 * (QE D4). Target: the activities-api test database through the assembled app.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { runImport } from "./import-crm-activities";
import { TEST_ISSUER } from "../src/test-support/testAuth";
import { __setDefaultJwksForTests } from "../src/auth/systemAuth.middleware";
import { setNotifierForTests } from "../src/lib/notify";
import { app, call, db, env, makeCompany, resetWorld } from "../src/test-support/world";
import { provisionCrmSource } from "./test-support/crmSource";

const targetUrl = process.env["DATABASE_URL"]!;
const source = await provisionCrmSource(targetUrl, "drive");
const sourceUrl = source.url;
const crm = source.sql;
// The pool opens here, with no time limit, not inside the first beforeEach (5 s) (specs/028 QE D9).
await db.$connect();

const SERVICE_AUD = "operai-system-import-test";
const KID = "svc-import-kid";
let signingKey: CryptoKey;
let previousJwks: ReturnType<typeof __setDefaultJwksForTests>;
let previousAudience: string | undefined;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  previousJwks = __setDefaultJwksForTests(createLocalJWKSet({ keys: [jwk] }));
  previousAudience = env.SERVICE_AUDIENCE;
  env.SERVICE_AUDIENCE = SERVICE_AUD;
});
afterAll(async () => {
  __setDefaultJwksForTests(previousJwks);
  if (previousAudience === undefined) delete env.SERVICE_AUDIENCE;
  else env.SERVICE_AUDIENCE = previousAudience;
  await source.dispose();
});

async function sys(method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ scope: "activities.write" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setSubject("system:crm-api")
    .setAudience(SERVICE_AUD)
    .setExpirationTime("5m")
    .sign(signingKey);
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as any) : undefined };
}

let companyId = "";

/** The CRM as it was before the move: a company, a deal, an open estimate task, a task done earlier, a meeting activity. */
async function seedCrmAndImport() {
  await resetWorld();
  setNotifierForTests({ notify: async () => {} });
  companyId = makeCompany("Acme SA").id; // the crm test host knows it, so user routes can read it
  await source.reset();
  await crm.unsafe(`INSERT INTO "activity"
    ("id","type","subject","body","occurredAt","companyId","dealId","authorUserId","dueDate","assigneeUserId","completedAt","completedByUserId","meetingId","createdAt","updatedAt") VALUES
    ('est-open','task','Estimate: Renewal',NULL,'2026-11-01 09:00:00','${companyId}','deal-1','user-consultant','2026-11-20','user-tech',NULL,NULL,NULL,'2026-11-01 09:00:00','2026-11-01 09:00:00'),
    ('est-done','task','Estimate: Older',NULL,'2026-10-01 09:00:00','${companyId}',NULL,'user-consultant','2026-10-10','user-tech','2026-10-05 12:00:00','user-tech',NULL,'2026-10-01 09:00:00','2026-10-05 12:00:00'),
    ('a-meet','meeting','Kick-off',NULL,'2026-11-05 14:00:00','${companyId}','deal-1','user-consultant',NULL,NULL,NULL,NULL,NULL,'2026-11-05 14:00:00','2026-11-05 14:00:00'),
    ('a-note','note','A note','Body','2026-11-03 10:00:00','${companyId}',NULL,'user-colleague',NULL,NULL,NULL,NULL,NULL,'2026-11-03 10:00:00','2026-11-03 10:00:00')`);
  await crm.unsafe(`UPDATE "activity" SET "meetingId" = 'meeting-x' WHERE "id" = 'a-meet'`);
  await crm.unsafe(`INSERT INTO "meeting_host_state" ("meetingId","lastSeq","updatedAt") VALUES ('meeting-x',4,'2026-11-05 14:05:00')`);
  const report = await runImport({ sourceUrl, targetUrl, apply: true });
  expect(report.accountedFor).toBe(true);
}

beforeEach(seedCrmAndImport);

describe("the CRM's lists show what was moved (AC-2.1)", () => {
  it("the company timeline lists every imported activity, newest first, with its author and task state", async () => {
    const list = await call("GET", `/activities?companyId=${companyId}`, { as: "consultant" });
    expect(list.status).toBe(200);
    expect(list.json.items.map((a: { id: string }) => a.id)).toEqual(["a-meet", "a-note", "est-open", "est-done"]);
    const open = list.json.items.find((a: { id: string }) => a.id === "est-open");
    expect(open).toMatchObject({ kind: "pre_sales", type: "task", subject: "Estimate: Renewal", author: { id: "user-consultant" } });
    expect(open.task).toMatchObject({ assignee: { id: "user-tech" }, completedAt: null });
    const done = list.json.items.find((a: { id: string }) => a.id === "est-done");
    expect(done.task.completedAt).not.toBeNull();
  });

  it("the assignee's Tasks list has the imported open task, and the done one under Done", async () => {
    const open = await call("GET", "/tasks?kind=pre_sales&status=open&assignee=me", { as: "tech" });
    expect(open.json.items.map((a: { id: string }) => a.id)).toEqual(["est-open"]);
    const done = await call("GET", "/tasks?kind=pre_sales&status=done&assignee=me", { as: "tech" });
    expect(done.json.items.map((a: { id: string }) => a.id)).toEqual(["est-done"]);
  });
});

describe("an imported estimate task still follows EstimAI (AC-1.3 for a moved row, AC-2.4)", () => {
  const notice = (id: string, completed: boolean, seq: number) =>
    sys("POST", `/system/v1/activities/${id}/completion`, { completed, at: "2026-11-11T08:00:00.000Z", byUserId: "user-tech", seq });

  it("closed completes it, a repeat or an older notice changes nothing, reopened opens it again", async () => {
    expect((await notice("est-open", true, 2)).json).toEqual({ applied: true });
    expect((await db.activity.findUniqueOrThrow({ where: { id: "est-open" } })).completedAt).not.toBeNull();
    expect((await notice("est-open", true, 2)).json).toEqual({ applied: false });
    expect((await notice("est-open", false, 1)).json).toEqual({ applied: false }); // reordered: older reopen
    expect((await db.activity.findUniqueOrThrow({ where: { id: "est-open" } })).completedAt).not.toBeNull();
    expect((await notice("est-open", false, 3)).json).toEqual({ applied: true });
    const row = await db.activity.findUniqueOrThrow({ where: { id: "est-open" } });
    expect(row.completedAt).toBeNull();
    expect(row.completedByUserId).toBeNull();
  });

  it("a task that was already done before the move can be reopened by EstimAI", async () => {
    expect((await notice("est-done", false, 1)).json).toEqual({ applied: true });
    expect((await db.activity.findUniqueOrThrow({ where: { id: "est-done" } })).completedAt).toBeNull();
  });
});

describe("an imported meeting activity still follows Meetings (AC-1.4 for a moved row, AC-2.4)", () => {
  const notice = (event: "linked" | "changed" | "unlinked" | "deleted", seq: number, title: string | null = "Kick-off (moved)") =>
    sys("POST", "/system/v1/meeting-mirror", {
      noticeId: crypto.randomUUID(),
      seq,
      event,
      meeting: {
        id: "meeting-x",
        title: event === "linked" || event === "changed" ? title : null,
        startsAt: event === "linked" || event === "changed" ? "2026-11-06T10:00:00.000Z" : null,
        creatorId: "user-consultant",
      },
      deal: { id: "deal-1", companyId },
    });

  it("the guard moved with the data: a duplicate or older notice is a no-op on the imported row", async () => {
    expect((await notice("changed", 4)).json).toEqual({ applied: false });
    expect((await notice("changed", 2)).json).toEqual({ applied: false });
    expect((await db.activity.findUniqueOrThrow({ where: { id: "a-meet" } })).subject).toBe("Kick-off");
  });

  it("a newer change updates the SAME row (no second activity), then unlinked removes it", async () => {
    expect((await notice("changed", 5)).json).toEqual({ applied: true });
    const rows = await db.activity.findMany({ where: { meetingId: "meeting-x" } });
    expect(rows.map((r) => r.id)).toEqual(["a-meet"]);
    expect(rows[0]!.subject).toBe("Kick-off (moved)");
    expect((await notice("unlinked", 6)).json).toEqual({ applied: true });
    expect(await db.activity.findMany({ where: { meetingId: "meeting-x" } })).toEqual([]);
    // a late, lower-numbered linked cannot bring it back
    expect((await notice("linked", 3)).json).toEqual({ applied: false });
    expect(await db.activity.findMany({ where: { meetingId: "meeting-x" } })).toEqual([]);
  });
});
