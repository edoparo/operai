/**
 * The system routes (specs/20261110-activities T10; AC-1.2, AC-1.3, AC-1.4, AC-8.4; ADR 20261110-caller-chosen-ids-replace-cross-service-transactions): what crm-api calls,
 * as itself, in place of the transactions it used to share with the activities. Real Postgres
 * (`activities_test`) and the ASSEMBLED app; the service JWTs are signed with a key whose JWKS is
 * injected into the middleware, so no live `auth` is needed.
 *
 * Every route first answers the credential question (one identical 401), then the maintenance-free
 * contract: PUT never overwrites, DELETE `onlyIfOpen` keeps a done task, a completion or a meeting
 * notice applies only a newer `seq`, and an erase is idempotent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { TEST_ISSUER } from "../test-support/testAuth";
import { app, authStub, bearerOf, call, db, env, makeCompany, makeContact, resetWorld, withMaintenance } from "../test-support/world";
import { __setDefaultJwksForTests } from "../auth/systemAuth.middleware";
import { setNotifierForTests, type NotifyEvent } from "../lib/notify";
import { renderNotification } from "../lib/notificationCopy";

const SERVICE_AUD = "operai-system-test";
const KID = "svc-activities-kid";
const SCOPE = "activities.write";
const CRM = "system:crm-api";

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let previousJwks: ReturnType<typeof __setDefaultJwksForTests>;
let previousAudience: string | undefined;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  previousJwks = __setDefaultJwksForTests(createLocalJWKSet({ keys: [jwk] }));
  previousAudience = env.SERVICE_AUDIENCE;
  env.SERVICE_AUDIENCE = SERVICE_AUD;
});
afterAll(() => {
  __setDefaultJwksForTests(previousJwks);
  if (previousAudience === undefined) delete env.SERVICE_AUDIENCE;
  else env.SERVICE_AUDIENCE = previousAudience;
});
beforeEach(resetWorld);

const serviceJwt = (o: { sub?: string; scope?: string | null; aud?: string; exp?: string; signer?: CryptoKey } = {}) =>
  new SignJWT(o.scope === null ? {} : { scope: o.scope ?? SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setSubject(o.sub ?? CRM)
    .setAudience(o.aud ?? SERVICE_AUD)
    .setExpirationTime(o.exp ?? "5m")
    .sign(o.signer ?? signingKey);

/** A system request; `token` defaults to a valid crm-api credential, `null` sends none. */
async function sys(method: string, path: string, opts: { body?: unknown; token?: string | null | undefined } = {}) {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? await serviceJwt() : opts.token;
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.request(path, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const text = await res.text();
  return { status: res.status, text, json: text ? (JSON.parse(text) as any) : undefined };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

let n = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

const putBody = (companyId: string, extra: Record<string, unknown> = {}) => ({
  type: "task",
  subject: "Estimate: Website relaunch",
  occurredAt: "2026-11-10T09:00:00.000Z",
  companyId,
  authorUserId: "user-consultant",
  ...extra,
});

async function seedTask(over: Record<string, unknown> = {}) {
  return db.activity.create({
    data: {
      kind: "pre_sales",
      type: "task",
      hostApp: "crm",
      hostType: "company",
      hostId: "co-seed",
      subject: "A task",
      occurredAt: new Date("2026-11-01T09:00:00Z"),
      authorUserId: "user-consultant",
      assigneeUserId: "user-tech",
      ...over,
    } as never,
  });
}

const events: NotifyEvent[] = [];
beforeEach(() => {
  events.length = 0;
  setNotifierForTests({ notify: async (e) => void events.push(e) });
});

// ─── Credential ──────────────────────────────────────────────────────────────

describe("the system credential (one identical 401)", () => {
  const routes: Array<[string, string, unknown]> = [
    ["PUT", "/system/v1/activities/a1", putBody("co-1")],
    ["DELETE", "/system/v1/activities/a1", undefined],
    ["POST", "/system/v1/activities/a1/completion", { completed: true, at: "2026-11-10T10:00:00Z", byUserId: "u", seq: 1 }],
    [
      "POST",
      "/system/v1/meeting-mirror",
      {
        noticeId: crypto.randomUUID(),
        seq: 1,
        event: "linked",
        meeting: { id: "m1", title: "Kick-off", startsAt: "2026-11-10T10:00:00Z", creatorId: "user-consultant" },
        deal: { id: "d1", companyId: "co-1" },
      },
    ],
    ["POST", "/system/v1/contacts/k1/erase", undefined],
  ];

  const credentials: Array<[string, () => Promise<string | null>]> = [
    ["no credential", async () => null],
    ["a user JWT", async () => (await bearerOf("alice")).slice("Bearer ".length)],
    ["a user JWT shaped like the right sub and scope but the user audience", () => serviceJwt({ aud: "operai-suite" })],
    ["the wrong scope", () => serviceJwt({ scope: "notifications.push" })],
    ["no scope", () => serviceJwt({ scope: null })],
    ["another system sub", () => serviceJwt({ sub: "system:estimai-api" })],
    ["a non-system sub", () => serviceJwt({ sub: "user-alice" })],
    ["another audience", () => serviceJwt({ aud: "somewhere-else" })],
    ["an expired token", () => serviceJwt({ exp: "-1m" })],
    ["a token signed with another key", () => serviceJwt({ signer: otherKey })],
    ["garbage", async () => "not-a-jwt"],
  ];

  for (const [method, path, body] of routes) {
    it(`${method} ${path}: every wrong credential is the same 401 and nothing changes`, async () => {
      const bodies = new Set<string>();
      for (const [label, make] of credentials) {
        const res = await sys(method, path, { token: await make(), body });
        expect(res.status, label).toBe(401);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      expect(await db.activity.count()).toBe(0);
      expect(await db.meetingMirrorState.count()).toBe(0);
    });
  }

  it("answers 401 before it validates the body", async () => {
    expect((await sys("PUT", "/system/v1/activities/a1", { token: null, body: { nonsense: true } })).status).toBe(401);
  });

  it("fails closed when SERVICE_AUDIENCE is not configured", async () => {
    const token = await serviceJwt();
    delete env.SERVICE_AUDIENCE;
    try {
      expect((await sys("POST", "/system/v1/contacts/k1/erase", { token })).status).toBe(401);
    } finally {
      env.SERVICE_AUDIENCE = SERVICE_AUD;
    }
  });

  it("a valid credential with extra scopes is accepted", async () => {
    const token = await serviceJwt({ scope: `notifications.push ${SCOPE}` });
    expect((await sys("POST", "/system/v1/contacts/k1/erase", { token })).status).toBe(200);
  });

  it("respects the maintenance switch: 503 before authentication, credential or not", async () => {
    await withMaintenance(async () => {
      for (const token of [undefined, null]) {
        const res = await sys("PUT", `/system/v1/activities/${nextId("m")}`, { token, body: putBody("co-1") });
        expect(res.status).toBe(503);
        expect(res.json.code).toBe("maintenance");
      }
    });
    expect(await db.activity.count()).toBe(0);
  });
});

// ─── PUT /system/v1/activities/{id} ──────────────────────────────────────────

describe("PUT /system/v1/activities/{id} — create if absent (AC-1.2)", () => {
  it("creates a CRM task on the company with the caller-chosen id → 201", async () => {
    const id = nextId("t");
    const res = await sys("PUT", `/system/v1/activities/${id}`, {
      body: putBody("co-1", { dealId: "dl-1", assigneeUserId: "user-tech", dueDate: "2026-11-20", body: "  Please estimate  " }),
    });
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ id, created: true });
    const row = await db.activity.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      kind: "pre_sales",
      type: "task",
      hostApp: "crm",
      hostType: "company",
      hostId: "co-1",
      dealId: "dl-1",
      contactId: null,
      subject: "Estimate: Website relaunch",
      // A task has one text, its description (ADR 20261113-task-description-files-in-activities-api-bucket): the body crm-api sends becomes paragraphs.
      body: null,
      description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Please estimate" }] }] },
      authorUserId: "user-consultant",
      assigneeUserId: "user-tech",
      completedAt: null,
      completedByUserId: null,
      completionSeq: null,
      meetingId: null,
    });
    expect(row.occurredAt.toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(row.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("creates a note too (the override note)", async () => {
    const id = nextId("n");
    const res = await sys("PUT", `/system/v1/activities/${id}`, { body: putBody("co-1", { type: "note", subject: "Estimate overridden" }) });
    expect(res.status).toBe(201);
    expect(await db.activity.findUniqueOrThrow({ where: { id } })).toMatchObject({ type: "note", assigneeUserId: null, dueDate: null });
  });

  it("a second PUT of the same id answers 200 and never overwrites", async () => {
    const id = nextId("t");
    expect((await sys("PUT", `/system/v1/activities/${id}`, { body: putBody("co-1") })).status).toBe(201);
    const again = await sys("PUT", `/system/v1/activities/${id}`, {
      body: putBody("co-2", { subject: "Something else entirely", assigneeUserId: "user-bob", authorUserId: "user-bob" }),
    });
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ id, created: false });
    expect(await db.activity.findUniqueOrThrow({ where: { id } })).toMatchObject({
      hostId: "co-1",
      subject: "Estimate: Website relaunch",
      assigneeUserId: null,
      authorUserId: "user-consultant",
    });
  });

  it("does not resurrect over a done task: the existing row is left exactly as it is", async () => {
    const row = await seedTask({ id: nextId("t"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-tech" });
    const res = await sys("PUT", `/system/v1/activities/${row.id}`, { body: putBody("co-seed") });
    expect(res.status).toBe(200);
    expect((await db.activity.findUniqueOrThrow({ where: { id: row.id } })).completedAt).not.toBeNull();
  });

  it("concurrent PUTs of one id create exactly one row, one 201", async () => {
    const id = nextId("t");
    const results = await Promise.all(Array.from({ length: 6 }, () => sys("PUT", `/system/v1/activities/${id}`, { body: putBody("co-1") })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    expect(await db.activity.count({ where: { id } })).toBe(1);
  });

  it("sends no notification itself (crm-api announces its own estimate events)", async () => {
    await sys("PUT", `/system/v1/activities/${nextId("t")}`, { body: putBody("co-1", { assigneeUserId: "user-tech" }) });
    await Bun.sleep(10);
    expect(events).toEqual([]);
  });

  it.each([
    ["a note with a due date", { type: "note", dueDate: "2026-11-20" }, "dueDate"],
    ["a note with an assignee", { type: "note", assigneeUserId: "user-tech" }, "assigneeUserId"],
    ["a meeting (those come from the meeting mirror)", { type: "meeting" }, "type"],
    ["an unknown type", { type: "chat" }, "type"],
    ["an empty subject", { subject: "   " }, "subject"],
    ["a 201-character subject", { subject: "x".repeat(201) }, "subject"],
    ["a body over 10000 characters", { body: "x".repeat(10_001) }, "body"],
    ["a date that is not a date", { dueDate: "2026-02-30" }, "dueDate"],
    ["an occurredAt without a time", { occurredAt: "2026-11-10" }, "occurredAt"],
    ["a missing company", { companyId: undefined }, "companyId"],
    ["a missing author", { authorUserId: undefined }, "authorUserId"],
    ["a key the contract does not have", { projectId: "pr-1" }, ""],
  ])("refuses %s with 422 and writes nothing", async (_label, extra, field) => {
    const res = await sys("PUT", `/system/v1/activities/${nextId("t")}`, { body: putBody("co-1", extra) });
    expect(res.status).toBe(422);
    if (field) expect(res.json.field).toBe(field);
    expect(await db.activity.count()).toBe(0);
  });
});

// ─── DELETE /system/v1/activities/{id} ───────────────────────────────────────

describe("DELETE /system/v1/activities/{id}", () => {
  it("deletes the activity → 204, and an absent one is 204 too", async () => {
    const row = await seedTask({ id: nextId("t") });
    expect((await sys("DELETE", `/system/v1/activities/${row.id}`)).status).toBe(204);
    expect(await db.activity.count()).toBe(0);
    expect((await sys("DELETE", `/system/v1/activities/${row.id}`)).status).toBe(204);
  });

  it("onlyIfOpen deletes an open task", async () => {
    const row = await seedTask({ id: nextId("t") });
    expect((await sys("DELETE", `/system/v1/activities/${row.id}?onlyIfOpen=true`)).status).toBe(204);
    expect(await db.activity.count()).toBe(0);
  });

  it("onlyIfOpen keeps a done task (and still answers 204)", async () => {
    const row = await seedTask({ id: nextId("t"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-tech" });
    const res = await sys("DELETE", `/system/v1/activities/${row.id}?onlyIfOpen=true`);
    expect(res.status).toBe(204);
    expect(await db.activity.count({ where: { id: row.id } })).toBe(1);
  });

  it("without onlyIfOpen even a done task goes (the compensation of a failed request)", async () => {
    const row = await seedTask({ id: nextId("t"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-tech" });
    expect((await sys("DELETE", `/system/v1/activities/${row.id}`)).status).toBe(204);
    expect(await db.activity.count()).toBe(0);
  });

  it("onlyIfOpen=false behaves like no flag", async () => {
    const row = await seedTask({ id: nextId("t"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-tech" });
    expect((await sys("DELETE", `/system/v1/activities/${row.id}?onlyIfOpen=false`)).status).toBe(204);
    expect(await db.activity.count()).toBe(0);
  });

  it("refuses an onlyIfOpen that is not true/false with 422 and deletes nothing", async () => {
    const row = await seedTask({ id: nextId("t") });
    expect((await sys("DELETE", `/system/v1/activities/${row.id}?onlyIfOpen=maybe`)).status).toBe(422);
    expect(await db.activity.count()).toBe(1);
  });

  it("never touches a project task: crm-api owns the CRM ones only", async () => {
    const id = nextId("pt");
    await db.activity.create({
      data: { id, kind: "operational", type: "task", hostApp: "projects", hostType: "project", hostId: "pr-1", subject: "Dig", occurredAt: new Date(), authorUserId: "user-pm" },
    });
    expect((await sys("DELETE", `/system/v1/activities/${id}`)).status).toBe(204);
    expect(await db.activity.count({ where: { id } })).toBe(1);
  });

  it("removes the task's blocker links with it", async () => {
    const a = await seedTask({ id: nextId("a") });
    const b = await seedTask({ id: nextId("b") });
    await db.taskBlocker.create({ data: { blockedId: b.id, blockerId: a.id, createdBy: "user-consultant" } });
    await sys("DELETE", `/system/v1/activities/${a.id}`);
    expect(await db.taskBlocker.count()).toBe(0);
    expect(await db.activity.count({ where: { id: b.id } })).toBe(1);
  });
});

// ─── POST /system/v1/activities/{id}/completion ──────────────────────────────

describe("POST /system/v1/activities/{id}/completion — only a newer seq applies (AC-1.3)", () => {
  const complete = (id: string, over: Record<string, unknown> = {}) =>
    sys("POST", `/system/v1/activities/${id}/completion`, { body: { completed: true, at: "2026-11-10T10:00:00.000Z", byUserId: "user-tech", seq: 1, ...over } });
  const reopen = (id: string, seq: number, at = "2026-11-11T08:00:00.000Z") => complete(id, { completed: false, seq, at });
  const state = async (id: string) => db.activity.findUniqueOrThrow({ where: { id } });

  it("completes an open task with who and when, and remembers the seq", async () => {
    const t = await seedTask({ id: nextId("t") });
    const res = await complete(t.id, { seq: 3 });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ applied: true });
    const row = await state(t.id);
    expect(row.completedAt?.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(row.completedByUserId).toBe("user-tech");
    expect(row.completionSeq).toBe(3);
  });

  it("a repeated notice (same seq) and an older one change nothing", async () => {
    const t = await seedTask({ id: nextId("t") });
    await complete(t.id, { seq: 3 });
    const dup = await complete(t.id, { seq: 3, byUserId: "user-bob", at: "2026-11-12T10:00:00.000Z" });
    expect(dup.json).toEqual({ applied: false });
    const older = await reopen(t.id, 2);
    expect(older.json).toEqual({ applied: false });
    const row = await state(t.id);
    expect(row.completedByUserId).toBe("user-tech");
    expect(row.completedAt?.toISOString()).toBe("2026-11-10T10:00:00.000Z");
    expect(row.completionSeq).toBe(3);
  });

  it("a reopen with a newer seq opens the task again; the closed notice that arrives late is then a no-op", async () => {
    const t = await seedTask({ id: nextId("t") });
    await complete(t.id, { seq: 1 });
    expect((await reopen(t.id, 2)).json).toEqual({ applied: true });
    expect(await state(t.id)).toMatchObject({ completedAt: null, completedByUserId: null, completionSeq: 2 });
    expect((await complete(t.id, { seq: 1 })).json).toEqual({ applied: false });
    expect((await state(t.id)).completedAt).toBeNull();
  });

  it("reordering: the reopen (seq 2) arriving before the close (seq 1) leaves the task open", async () => {
    const t = await seedTask({ id: nextId("t") });
    expect((await reopen(t.id, 2)).json).toEqual({ applied: true });
    expect((await complete(t.id, { seq: 1 })).json).toEqual({ applied: false });
    expect(await state(t.id)).toMatchObject({ completedAt: null, completionSeq: 2 });
  });

  it("a task someone already completed keeps who and when, but the seq still advances", async () => {
    const t = await seedTask({ id: nextId("t"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-admin" });
    const res = await complete(t.id, { seq: 4 });
    expect(res.json).toEqual({ applied: true });
    const row = await state(t.id);
    expect(row.completedByUserId).toBe("user-admin");
    expect(row.completedAt?.toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(row.completionSeq).toBe(4);
    // so an older reopen cannot undo it
    expect((await reopen(t.id, 3)).json).toEqual({ applied: false });
  });

  it("an activity that is not there, is not a CRM task or is a note answers 200 applied:false", async () => {
    expect((await complete("nope")).json).toEqual({ applied: false });
    const note = await seedTask({ id: nextId("n"), type: "note", assigneeUserId: null });
    expect((await complete(note.id)).json).toEqual({ applied: false });
    const projectTask = await db.activity.create({
      data: { id: nextId("pt"), kind: "operational", type: "task", hostApp: "projects", hostType: "project", hostId: "pr-1", subject: "Dig", occurredAt: new Date(), authorUserId: "user-pm" },
    });
    expect((await complete(projectTask.id)).json).toEqual({ applied: false });
    expect((await state(projectTask.id)).completedAt).toBeNull();
  });

  it("concurrent identical notices apply once", async () => {
    const t = await seedTask({ id: nextId("t") });
    const results = await Promise.all(Array.from({ length: 5 }, () => complete(t.id, { seq: 7 })));
    expect(results.map((r) => r.json.applied).sort()).toEqual([false, false, false, false, true]);
  });

  it.each([
    ["a missing seq", { seq: undefined }],
    ["a negative seq", { seq: -1 }],
    ["a seq past the integer column", { seq: 2_147_483_648 }],
    ["a fractional seq", { seq: 1.5 }],
    ["a missing completed", { completed: undefined }],
    ["an at that is not a datetime", { at: "yesterday" }],
    ["an empty byUserId", { byUserId: "" }],
    ["an unknown key", { note: "x" }],
  ])("refuses %s with 422 and changes nothing", async (_l, over) => {
    const t = await seedTask({ id: nextId("t") });
    const res = await complete(t.id, over);
    expect(res.status).toBe(422);
    expect((await state(t.id)).completionSeq).toBeNull();
  });

  describe("announces task_unblocked for the tasks this completion frees", () => {
    async function blocked(...blockers: { id: string }[]) {
      const waiting = await seedTask({ id: nextId("w"), subject: "Prepare the offer", assigneeUserId: "user-bob" });
      for (const b of blockers) await db.taskBlocker.create({ data: { blockedId: waiting.id, blockerId: b.id, createdBy: "user-consultant" } });
      return waiting;
    }

    it("tells the assignee of the task that waited on it, without calling any host", async () => {
      const a = await seedTask({ id: nextId("a") });
      const w = await blocked(a);
      await complete(a.id, { byUserId: "user-tech" });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "task_unblocked", activityId: w.id, actorId: "user-tech", recipientIds: ["user-bob"] });
      expect(events[0]!.activity).toMatchObject({ id: w.id, subject: "Prepare the offer" });
      expect(events[0]!.target.host).toBe("crm");
    });

    it("without a context the label degrades to a dash (the host cannot be asked)", async () => {
      const a = await seedTask({ id: nextId("a") });
      await blocked(a);
      await complete(a.id);
      expect(events[0]!.target).toEqual({ host: "crm", company: { id: "co-seed", name: "—" }, deal: null });
    });

    it("names the deal the caller sent when the freed task is on it (US-1: \"Deal: <title>.\")", async () => {
      const a = await seedTask({ id: nextId("a"), dealId: "deal-1" });
      await blocked(a);
      await db.activity.updateMany({ where: { subject: "Prepare the offer" }, data: { dealId: "deal-1" } });
      const res = await complete(a.id, { context: { companyName: "Acme SA", dealId: "deal-1", dealTitle: "Grid analytics" } });
      expect(res.json).toEqual({ applied: true });
      expect(events[0]!.target).toEqual({ host: "crm", company: { id: "co-seed", name: "Acme SA" }, deal: { id: "deal-1", title: "Grid analytics" } });
      expect(renderNotification("task_unblocked", { activity: events[0]!.activity, target: events[0]!.target }, "X").body).toContain("Deal: Grid analytics.");
    });

    it("a freed task on another deal gets the company, never another deal's title", async () => {
      const a = await seedTask({ id: nextId("a"), dealId: "deal-1" });
      const w = await blocked(a);
      await db.activity.update({ where: { id: w.id }, data: { dealId: "deal-2" } });
      await complete(a.id, { context: { companyName: "Acme SA", dealId: "deal-1", dealTitle: "Grid analytics" } });
      expect(events[0]!.target).toEqual({ host: "crm", company: { id: "co-seed", name: "Acme SA" }, deal: null });
    });

    it("a freed task of another company is not labelled with the sender's company", async () => {
      const a = await seedTask({ id: nextId("a") });
      const w = await blocked(a);
      await db.activity.update({ where: { id: w.id }, data: { hostId: "co-other" } });
      await complete(a.id, { context: { companyName: "Acme SA", dealId: null, dealTitle: null } });
      expect(events[0]!.target).toEqual({ host: "crm", company: { id: "co-other", name: "—" }, deal: null });
    });

    it.each([
      ["an unknown key", { companyName: "A", dealId: null, dealTitle: null, extra: 1 }],
      ["an empty company name", { companyName: "", dealId: null, dealTitle: null }],
      ["a company name over 200 characters", { companyName: "x".repeat(201), dealId: null, dealTitle: null }],
      ["a deal title over 200 characters", { companyName: "A", dealId: "d", dealTitle: "x".repeat(201) }],
      ["a deal title without its id", { companyName: "A", dealId: null, dealTitle: "T" }],
      ["a deal id without its title", { companyName: "A", dealId: "d", dealTitle: null }],
      ["a context that is not an object", "Acme"],
    ])("refuses a context with %s (422) and applies nothing", async (_l, context) => {
      const t = await seedTask({ id: nextId("t") });
      const res = await complete(t.id, { context });
      expect(res.status).toBe(422);
      expect((await state(t.id)).completionSeq).toBeNull();
    });

    it("says nothing while another blocker is still open", async () => {
      const a = await seedTask({ id: nextId("a") });
      const other = await seedTask({ id: nextId("o") });
      await blocked(a, other);
      await complete(a.id);
      expect(events).toEqual([]);
    });

    it("says nothing on a reopen, a duplicate notice or a task that was already done", async () => {
      const a = await seedTask({ id: nextId("a") });
      await blocked(a);
      await complete(a.id, { seq: 1 });
      events.length = 0;
      await complete(a.id, { seq: 1 }); // duplicate
      await reopen(a.id, 2);
      expect(events).toEqual([]);

      const done = await seedTask({ id: nextId("d"), completedAt: new Date("2026-11-05T10:00:00Z"), completedByUserId: "user-admin" });
      await blocked(done);
      await complete(done.id, { seq: 1 });
      expect(events).toEqual([]);
    });

    it("never tells the one who completed it", async () => {
      const a = await seedTask({ id: nextId("a") });
      await blocked(a);
      await complete(a.id, { byUserId: "user-bob" });
      expect(events).toEqual([]);
    });
  });
});

// ─── POST /system/v1/meeting-mirror ──────────────────────────────────────────

describe("POST /system/v1/meeting-mirror — the meeting activity of a deal (AC-1.4)", () => {
  type Over = Record<string, unknown>;
  const notice = (event: "linked" | "changed" | "unlinked" | "deleted", seq: number, over: Over = {}) => {
    const carries = event === "linked" || event === "changed";
    return {
      noticeId: crypto.randomUUID(),
      seq,
      event,
      meeting: {
        id: "m-1",
        title: carries ? "Kick-off" : null,
        startsAt: carries ? "2026-11-12T10:00:00.000Z" : null,
        creatorId: "user-consultant",
        ...((over["meeting"] as Over) ?? {}),
      },
      deal: { id: "dl-1", companyId: "co-1", ...((over["deal"] as Over) ?? {}) },
    };
  };
  const send = (body: unknown) => sys("POST", "/system/v1/meeting-mirror", { body });
  const rows = (meetingId = "m-1") => db.activity.findMany({ where: { meetingId } });
  const lastSeq = async (meetingId = "m-1") => (await db.meetingMirrorState.findUnique({ where: { meetingId } }))?.lastSeq;

  it("linked: creates the meeting activity on the deal's company, authored by the creator", async () => {
    const res = await send(notice("linked", 1));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ applied: true });
    const [row] = await rows();
    expect(row).toMatchObject({
      kind: "pre_sales",
      type: "meeting",
      hostApp: "crm",
      hostType: "company",
      hostId: "co-1",
      dealId: "dl-1",
      contactId: null,
      subject: "Kick-off",
      body: null,
      authorUserId: "user-consultant",
      meetingId: "m-1",
      assigneeUserId: null,
      dueDate: null,
    });
    expect(row!.occurredAt.toISOString()).toBe("2026-11-12T10:00:00.000Z");
    expect(await lastSeq()).toBe(1);
  });

  it("a duplicate seq is a no-op: {applied:false}, one row", async () => {
    await send(notice("linked", 1));
    const dup = await send(notice("linked", 1, { meeting: { title: "Different" } }));
    expect(dup.json).toEqual({ applied: false });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.subject).toBe("Kick-off");
  });

  it("reordering: an older changed after a newer one is ignored", async () => {
    await send(notice("linked", 1));
    expect((await send(notice("changed", 3, { meeting: { title: "Third" } }))).json).toEqual({ applied: true });
    expect((await send(notice("changed", 2, { meeting: { title: "Second" } }))).json).toEqual({ applied: false });
    expect((await rows())[0]!.subject).toBe("Third");
    expect(await lastSeq()).toBe(3);
  });

  it("changed updates subject and occurredAt, and never recreates an activity that was deleted by hand", async () => {
    await send(notice("linked", 1));
    await send(notice("changed", 2, { meeting: { title: "Renamed", startsAt: "2026-11-13T09:30:00.000Z" } }));
    const [row] = await rows();
    expect(row).toMatchObject({ subject: "Renamed" });
    expect(row!.occurredAt.toISOString()).toBe("2026-11-13T09:30:00.000Z");
    await db.activity.deleteMany({ where: { meetingId: "m-1" } });
    expect((await send(notice("changed", 3))).json).toEqual({ applied: true });
    expect(await rows()).toHaveLength(0);
  });

  it("relinked to another deal MOVES the activity (same row), and drops a contact of the old company", async () => {
    await send(notice("linked", 1));
    const before = (await rows())[0]!;
    await db.activity.update({ where: { id: before.id }, data: { contactId: "ct-old" } });
    const res = await send(notice("linked", 2, { deal: { id: "dl-9", companyId: "co-9" } }));
    expect(res.json).toEqual({ applied: true });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: before.id, hostId: "co-9", dealId: "dl-9", contactId: null });
  });

  it("relinked to another deal of the SAME company keeps the contact", async () => {
    await send(notice("linked", 1));
    const before = (await rows())[0]!;
    await db.activity.update({ where: { id: before.id }, data: { contactId: "ct-1" } });
    await send(notice("linked", 2, { deal: { id: "dl-2", companyId: "co-1" } }));
    expect((await rows())[0]).toMatchObject({ dealId: "dl-2", contactId: "ct-1" });
  });

  it("unlinked removes the activity only when it is on that deal", async () => {
    await send(notice("linked", 1));
    expect((await send(notice("unlinked", 2, { deal: { id: "dl-other" } }))).json).toEqual({ applied: true });
    expect(await rows()).toHaveLength(1);
    await send(notice("unlinked", 3));
    expect(await rows()).toHaveLength(0);
    expect(await lastSeq()).toBe(3);
  });

  it("deleted removes it wherever it is, and a late lower-seq linked cannot bring it back", async () => {
    await send(notice("linked", 1));
    await send(notice("linked", 2, { deal: { id: "dl-9", companyId: "co-9" } }));
    expect((await send(notice("deleted", 4))).json).toEqual({ applied: true });
    expect(await rows()).toHaveLength(0);
    expect((await send(notice("linked", 3))).json).toEqual({ applied: false });
    expect(await rows()).toHaveLength(0);
    expect(await lastSeq()).toBe(4);
  });

  it("unlinked and deleted do not need the deal's company", async () => {
    await send(notice("linked", 1));
    const body = notice("deleted", 2);
    delete (body.deal as Record<string, unknown>)["companyId"];
    expect((await send(body)).json).toEqual({ applied: true });
    expect(await rows()).toHaveLength(0);
  });

  it("two meetings are independent", async () => {
    await send(notice("linked", 1));
    await send(notice("linked", 1, { meeting: { id: "m-2", title: "Other" } }));
    expect(await rows("m-1")).toHaveLength(1);
    expect(await rows("m-2")).toHaveLength(1);
  });

  it("concurrent deliveries of one notice create one activity and apply once", async () => {
    const body = notice("linked", 1);
    const results = await Promise.all(Array.from({ length: 5 }, () => send(body)));
    expect(results.map((r) => r.json.applied).sort()).toEqual([false, false, false, false, true]);
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    ["linked without a title", () => notice("linked", 1, { meeting: { title: null } })],
    ["linked without a start", () => notice("linked", 1, { meeting: { startsAt: null } })],
    ["changed without a title", () => notice("changed", 1, { meeting: { title: null } })],
    ["unlinked still carrying a title", () => notice("unlinked", 1, { meeting: { title: "Kick-off" } })],
    ["deleted still carrying a start", () => notice("deleted", 1, { meeting: { startsAt: "2026-11-12T10:00:00.000Z" } })],
    ["linked without the deal's company", () => notice("linked", 1, { deal: { companyId: undefined } })],
    ["a noticeId that is not a uuid", () => ({ ...notice("linked", 1), noticeId: "n-1" })],
    ["an unknown event", () => ({ ...notice("linked", 1), event: "moved" })],
    ["a negative seq", () => notice("linked", -1)],
    ["a seq past the integer column", () => notice("linked", 2_147_483_648)],
    ["content beyond the contract (an agenda)", () => ({ ...notice("linked", 1), agenda: "secret" })],
    ["content beyond the contract in the meeting", () => notice("linked", 1, { meeting: { transcript: "secret" } })],
  ])("refuses %s with 422 and records nothing, so the same seq can be retried", async (_l, make) => {
    const res = await send(make());
    expect(res.status).toBe(422);
    expect(await db.activity.count()).toBe(0);
    expect(await db.meetingMirrorState.count()).toBe(0);
    expect((await send(notice("linked", 1))).json).toEqual({ applied: true });
  });
});

// ─── POST /system/v1/contacts/{contactId}/erase ──────────────────────────────

describe("POST /system/v1/contacts/{contactId}/erase — nothing refers to the contact afterwards (AC-8.4)", () => {
  it("nulls the contactId of every activity that has it and counts them", async () => {
    const co = makeCompany();
    const a = await seedTask({ id: nextId("a"), hostId: co.id, contactId: "ct-1" });
    const b = await seedTask({ id: nextId("b"), hostId: co.id, contactId: "ct-1", type: "note", assigneeUserId: null });
    const keep = await seedTask({ id: nextId("k"), hostId: co.id, contactId: "ct-2" });
    const none = await seedTask({ id: nextId("n"), hostId: co.id });
    const res = await sys("POST", "/system/v1/contacts/ct-1/erase");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ unlinked: 2 });
    const get = (id: string) => db.activity.findUniqueOrThrow({ where: { id } });
    expect((await get(a.id)).contactId).toBeNull();
    expect((await get(b.id)).contactId).toBeNull();
    expect((await get(keep.id)).contactId).toBe("ct-2");
    expect((await get(none.id)).contactId).toBeNull();
    // the activities themselves stay, subject and all
    expect((await get(a.id)).subject).toBe("A task");
  });

  it("is idempotent: the second call, and a contact nothing refers to, unlink 0 and succeed", async () => {
    await seedTask({ id: nextId("a"), contactId: "ct-1" });
    expect((await sys("POST", "/system/v1/contacts/ct-1/erase")).json).toEqual({ unlinked: 1 });
    expect((await sys("POST", "/system/v1/contacts/ct-1/erase")).json).toEqual({ unlinked: 0 });
    expect((await sys("POST", "/system/v1/contacts/never-existed/erase")).json).toEqual({ unlinked: 0 });
  });

  it("leaves updatedAt alone: an erasure is not an edit of the activity", async () => {
    const a = await seedTask({ id: nextId("a"), contactId: "ct-1" });
    await sys("POST", "/system/v1/contacts/ct-1/erase");
    expect((await db.activity.findUniqueOrThrow({ where: { id: a.id } })).updatedAt.getTime()).toBe(a.updatedAt.getTime());
  });
});

describe("erasing a contact while a write is in flight (AC-8.4 under concurrency)", () => {
  /** Runs `during` once, when the write under test is mid-validation (its app-access check). */
  const duringValidation = (during: () => Promise<unknown>) => {
    authStub.onAccessCheck = async () => {
      authStub.onAccessCheck = null;
      await during();
    };
  };
  const refersTo = (contactId: string) => db.activity.count({ where: { contactId } });

  it("a create whose validation passed while the contact existed is refused when the erasure lands first, and writes nothing", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    duringValidation(() => sys("POST", `/system/v1/contacts/${contact.id}/erase`));
    const res = await call("POST", "/activities", {
      body: { type: "note", subject: "Raced", companyId: co.id, contactId: contact.id, participantIds: ["user-bob"] },
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "contact_not_in_company", field: "contactId" });
    expect(await db.activity.count()).toBe(0);
    expect(await refersTo(contact.id)).toBe(0);
  });

  it("an edit that links the contact the same way is refused, and the activity keeps no link", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    const made = await call("POST", "/activities", { body: { type: "task", subject: "T", companyId: co.id } });
    duringValidation(() => sys("POST", `/system/v1/contacts/${contact.id}/erase`));
    const res = await call("PATCH", `/activities/${made.json.id}`, { body: { contactId: contact.id, assigneeUserId: "user-bob" } });
    expect(res.status).toBe(422);
    expect(res.json.code).toBe("contact_not_in_company");
    const row = await db.activity.findUniqueOrThrow({ where: { id: made.json.id } });
    expect(row.contactId).toBeNull();
    expect(row.assigneeUserId).toBe("user-alice"); // the whole edit was refused
  });

  it("a write that names an erased contact is refused even though the host still reports it (create and edit)", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    expect((await sys("POST", `/system/v1/contacts/${contact.id}/erase`)).status).toBe(200);
    const created = await call("POST", "/activities", { body: { type: "note", subject: "Late", companyId: co.id, contactId: contact.id } });
    expect(created.status).toBe(422);
    expect(created.json.code).toBe("contact_not_in_company");
    const other = await call("POST", "/activities", { body: { type: "note", subject: "Other", companyId: co.id } });
    const edited = await call("PATCH", `/activities/${other.json.id}`, { body: { contactId: contact.id } });
    expect(edited.status).toBe(422);
    expect(edited.json.code).toBe("contact_not_in_company");
    expect(await refersTo(contact.id)).toBe(0);
  });

  it("clearing a contact, or an edit that leaves it alone, never asks about a tombstone", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    const made = await call("POST", "/activities", { body: { type: "note", subject: "S", companyId: co.id, contactId: contact.id } });
    await sys("POST", `/system/v1/contacts/${contact.id}/erase`);
    expect((await call("PATCH", `/activities/${made.json.id}`, { body: { subject: "S2" } })).status).toBe(200);
    expect((await call("PATCH", `/activities/${made.json.id}`, { body: { contactId: null } })).status).toBe(200);
  });

  it("a link write and the erasure both wait for the contact's lock, and whichever gets it second sees the other's commit", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    const settled = <T>(p: Promise<T>) => {
      const state = { done: false };
      void p.then(() => (state.done = true));
      return state;
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    // Someone else holds the lock for this contact (the key is the contract between writers and the erasure).
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact:${contact.id}`}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await hasLock;
    const create = call("POST", "/activities", { body: { type: "note", subject: "Waits", companyId: co.id, contactId: contact.id } });
    const erase = sys("POST", `/system/v1/contacts/${contact.id}/erase`);
    const [createState, eraseState] = [settled(create), settled(erase)];
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(createState.done).toBe(false);
    expect(eraseState.done).toBe(false);
    release();
    await holder;
    const [created, erased] = await Promise.all([create, erase]);
    expect(erased.status).toBe(200);
    expect([201, 422]).toContain(created.status);
    expect(await refersTo(contact.id)).toBe(0);
  });

  it("a write that sets no contact takes no lock: it is not held up by someone holding the contact's", async () => {
    const co = makeCompany();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"contact:any"}, 0))`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await hasLock;
    expect((await call("POST", "/activities", { body: { type: "note", subject: "No contact", companyId: co.id } })).status).toBe(201);
    release();
    await holder;
  });

  it("keeps the id and nothing else, once, however often the erasure is repeated", async () => {
    await sys("POST", "/system/v1/contacts/ct-gone/erase");
    await sys("POST", "/system/v1/contacts/ct-gone/erase");
    expect(await db.erasedContact.findMany()).toEqual([{ contactId: "ct-gone" }]);
    const columns = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'erased_contact'`;
    expect(columns.map((column) => column.column_name)).toEqual(["contactId"]);
  });

  it("an erasure and a create racing for the same contact never leave a link, whichever commits first", async () => {
    const co = makeCompany();
    const contact = makeContact(co.id);
    for (let i = 0; i < 6; i++) {
      const [erased, created] = await Promise.all([
        sys("POST", `/system/v1/contacts/${contact.id}/erase`),
        call("POST", "/activities", { body: { type: "note", subject: `Race ${i}`, companyId: co.id, contactId: contact.id } }),
      ]);
      expect(erased.status).toBe(200);
      expect([201, 422]).toContain(created.status);
      expect(await refersTo(contact.id)).toBe(0);
    }
  });
});

// ─── The user surface is untouched ───────────────────────────────────────────

describe("a user cannot reach the system routes", () => {
  it("a signed-in user is refused on each of them", async () => {
    expect((await call("POST", "/system/v1/contacts/ct-1/erase")).status).toBe(401);
    expect((await call("PUT", "/system/v1/activities/x", { body: putBody("co-1") })).status).toBe(401);
  });
});
