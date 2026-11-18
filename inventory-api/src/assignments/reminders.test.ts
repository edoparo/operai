/**
 * Reminders to confirm a pending assignment (specs/20261006-hardware-inventory US-15). Real Postgres; the push is the
 * `reminderDeps.send` seam, and one test drives the real notifier over a stubbed network for the email flag.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, spyOn } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { setupTestAuth } from "../test-support/testAuth";
import type { ResolvedPermission } from "../authz/resolveClient";
import { truncateInventoryTables } from "../test-support/dbCleanup";

const harness = setupTestAuth();
await harness.init();

const { db } = await import("../lib/db");
const { handleProblemError } = await import("../lib/problem");
const { assignmentsRouter } = await import("./assignments.routes");
const { reminderDeps, runDueReminders, isDue, nextReminderAt } = await import("./reminders");
const { createNotifier } = await import("../lib/notify");
const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");
const { __resetIdentityCacheForTests } = await import("../lib/identities");

const app = new OpenAPIHono();
app.route("/", assignmentsRouter);
app.onError((err, c) => handleProblemError(err, c.req.path) ?? c.json({ error: String(err) }, 500));

const MANAGER: ResolvedPermission[] = [{ resource: "asset", action: "manage", conditions: { attributes: [{ key: "entity", match: "user" }] } }];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let token: string;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let sent: { assignmentId: string; assigneeUserId: string; assetDescription: string }[];
let accept: boolean;
const originalSend = reminderDeps.send;

beforeAll(async () => {
  token = await harness.signToken({ sub: "mgr-1", email: "mgr1@welld.ch", permEpoch: 1 });
});
beforeEach(async () => {
  await truncateInventoryTables();
  __resetAuthzCacheForTests();
  __resetIdentityCacheForTests();
  harness.setResolve(async () => ({ sub: "u", epoch: 1, permissions: MANAGER, entity: "welld_ch", jobTitle: null }));
  fetchSpy = spyOn(globalThis, "fetch");
  fetchSpy.mockImplementation((async (_url: unknown, init?: RequestInit) => {
    const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
    return Response.json({ users: ids.map((id) => ({ id, status: "active", name: `Name of ${id}` })) });
  }) as unknown as typeof fetch);
  sent = [];
  accept = true;
  reminderDeps.send = async (event) => {
    sent.push(event);
    return accept;
  };
});
afterEach(() => {
  reminderDeps.send = originalSend;
  fetchSpy?.mockRestore();
});
afterAll(async () => {
  await truncateInventoryTables();
});

let seq = 0;
async function offer(createdAt: Date, over: Record<string, unknown> = {}) {
  seq++;
  const asset = await db.asset.create({
    data: {
      entity: "welld_ch",
      currency: "CHF",
      category: "laptop",
      description: `Laptop ${seq}`,
      purchaseDate: new Date("2026-03-01"),
      purchasePriceCents: 150000,
      status: "in_stock",
      createdByUserId: "seed",
    } as never,
  });
  return db.assignment.create({ data: { assetId: asset.id, assigneeUserId: "emp-1", createdByUserId: "mgr-1", createdAt, ...over } as never });
}
const remind = (id: string) => app.request(`/assignments/${id}/remind`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
const reload = (id: string) => db.assignment.findUniqueOrThrow({ where: { id } });

describe("the clock", () => {
  it("first reminder 24 h after the offer, then every 7 days after the last one; nothing once answered", () => {
    const at = new Date("2026-11-01T10:00:00Z");
    expect(nextReminderAt({ status: "pending", createdAt: at, lastReminderAt: null })).toEqual(new Date(at.getTime() + DAY));
    const last = new Date("2026-11-03T08:00:00Z");
    expect(nextReminderAt({ status: "pending", createdAt: at, lastReminderAt: last })).toEqual(new Date(last.getTime() + 7 * DAY));
    expect(nextReminderAt({ status: "confirmed", createdAt: at, lastReminderAt: null })).toBeNull();
    expect(isDue({ status: "pending", createdAt: at, lastReminderAt: null }, new Date(at.getTime() + DAY - 1))).toBe(false);
  });
});

describe("the tick", () => {
  it("reminds what is due, once, and records it in the asset's history", async () => {
    const now = new Date();
    const old = await offer(new Date(now.getTime() - 25 * HOUR));
    const fresh = await offer(new Date(now.getTime() - 2 * HOUR));
    const remindedLately = await offer(new Date(now.getTime() - 10 * DAY), { lastReminderAt: new Date(now.getTime() - 3 * DAY), reminderCount: 1 });
    const remindedWeekAgo = await offer(new Date(now.getTime() - 20 * DAY), { lastReminderAt: new Date(now.getTime() - 7 * DAY - HOUR), reminderCount: 2 });
    const answered = await offer(new Date(now.getTime() - 30 * DAY), { status: "confirmed" });

    expect(await runDueReminders(now)).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((s) => s.assignmentId).sort()).toEqual([old.id, remindedWeekAgo.id].sort());
    expect((await reload(old.id)).reminderCount).toBe(1);
    expect((await reload(remindedWeekAgo.id)).reminderCount).toBe(3);
    for (const untouched of [fresh, remindedLately, answered]) expect((await reload(untouched.id)).lastReminderAt?.getTime() ?? null).toBe(untouched.lastReminderAt?.getTime() ?? null);
    const events = await db.assetEvent.findMany({ where: { action: "assignment_reminded" } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actorUserId === "system:reminders")).toBe(true);

    // The same tick again sends nothing: the clock moved.
    expect(await runDueReminders(now)).toEqual({ sent: 0, failed: 0 });
  });

  it("two ticks at once send each reminder once (the CAS claim)", async () => {
    const now = new Date();
    await offer(new Date(now.getTime() - 2 * DAY));
    const [a, b] = await Promise.all([runDueReminders(now), runDueReminders(now)]);
    expect(a.sent + b.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a push notify-api did not take gives the claim back, and the next tick tries again", async () => {
    const now = new Date();
    const due = await offer(new Date(now.getTime() - 2 * DAY));
    accept = false;
    expect(await runDueReminders(now)).toEqual({ sent: 0, failed: 1 });
    expect(await reload(due.id)).toMatchObject({ lastReminderAt: null, reminderCount: 0 });
    expect(await db.assetEvent.count({ where: { action: "assignment_reminded" } })).toBe(0);
    accept = true;
    expect((await runDueReminders(now)).sent).toBe(1);
  });
});

describe("POST /assignments/{id}/remind", () => {
  it("sends now, restarts the week and returns the asset with the reminder", async () => {
    const a = await offer(new Date(Date.now() - 2 * HOUR));
    const res = await remind(a.id);
    expect(res.status).toBe(200);
    const view = (await res.json()) as Record<string, any>;
    expect(view["pendingAssignment"]).toMatchObject({ id: a.id, reminderCount: 1 });
    const last = new Date(view["pendingAssignment"]["lastReminderAt"]).getTime();
    expect(new Date(view["pendingAssignment"]["nextReminderAt"]).getTime()).toBe(last + 7 * DAY);
    expect(sent).toHaveLength(1);
    const [event] = await db.assetEvent.findMany({ where: { action: "assignment_reminded" } });
    expect(event!.actorUserId).toBe("mgr-1");
  });

  it("refuses a second one within the hour, with when to try again", async () => {
    const a = await offer(new Date(Date.now() - 2 * HOUR));
    await remind(a.id);
    const res = await remind(a.id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, any>;
    expect(body["code"]).toBe("reminder_too_soon");
    expect(body["retryAfterSeconds"]).toBeGreaterThan(3500);
  });

  it("refuses an answered assignment, and says so when notify-api did not take it (nothing changed)", async () => {
    const done = await offer(new Date(Date.now() - 2 * DAY), { status: "declined" });
    expect(((await (await remind(done.id)).json()) as Record<string, any>)["code"]).toBe("assignment_not_pending");

    const a = await offer(new Date(Date.now() - 2 * HOUR));
    accept = false;
    const res = await remind(a.id);
    expect(res.status).toBe(502);
    expect(((await res.json()) as Record<string, any>)["code"]).toBe("reminder_not_sent");
    expect(await reload(a.id)).toMatchObject({ lastReminderAt: null, reminderCount: 0 });
  });
});

describe("the push", () => {
  it("is an in-app notification AND an email notice to the employee, linking to My devices", async () => {
    const bodies: Record<string, unknown>[] = [];
    const notifier = createNotifier({
      baseUrl: "http://notify.test",
      tokens: { getToken: async () => "t", invalidate: () => {} },
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch,
    });
    const ok = await notifier.notifyReminder({ assignmentId: "as1", assetDescription: "MacBook Pro 14", assigneeUserId: "emp-1", offeredAt: new Date("2026-11-02T09:00:00Z") });
    expect(ok).toBe(true);
    expect(bodies[0]).toMatchObject({ recipientId: "emp-1", originApp: "inventory", email: true, link: { href: "/devices" } });
    expect(String(bodies[0]!["body"])).toContain("MacBook Pro 14 was assigned to you on 02.11.2026");
  });
});
