/**
 * The due-date reminder tick against the test database: the claim, the re-check, the give-back, and what reaches
 * notify-api (through the REAL notifier over a stubbed network, so the request bodies are the ones production sends).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { db, env, resetWorld } from "../test-support/world";
import { createNotifier, setNotifierForTests } from "../lib/notify";
import type { ServiceTokenProvider } from "../lib/serviceToken";
import { dueReminderDeps, dueReminderKey, runDueTaskReminders } from "./dueReminders";

/** 26.11.2026 09:00 Zurich (UTC+1): reminders go for tasks due 27.11.2026. */
const NOW = new Date("2026-11-26T08:00:00Z");
const TOMORROW = "2026-11-27";

type Sent = { recipientId: string; originApp: string; email?: boolean; idempotencyKey?: string; title: string; body: string; link: { href: string }; it: { title: string; body: string } };

let sent: Sent[] = [];
/** Status notify-api answers; `throw` = the network fails. */
let answer: number | "throw" = 201;
/** Keys notify-api has already taken (a repeat answers 200 without notifying again, as notify-api does). */
let taken = new Set<string>();

const tokens: ServiceTokenProvider = { getToken: async () => "service-token", invalidate: () => {} };

function wireNotifier() {
  setNotifierForTests(
    createNotifier({
      baseUrl: "http://notify.test",
      tokens,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (answer === "throw") throw new TypeError("fetch failed");
        const body = JSON.parse(String(init?.body)) as Sent;
        if (answer >= 300) return new Response(null, { status: answer });
        if (body.idempotencyKey && taken.has(body.idempotencyKey)) return new Response(null, { status: 200 });
        if (body.idempotencyKey) taken.add(body.idempotencyKey);
        sent.push(body);
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    }),
  );
}

async function seedTask(over: {
  host?: "crm" | "projects";
  dueDate?: string | null;
  assignee?: string | null;
  participants?: string[];
  completed?: boolean;
  type?: "task" | "note";
  body?: string;
} = {}) {
  const crm = (over.host ?? "crm") === "crm";
  const isTask = (over.type ?? "task") === "task";
  return db.activity.create({
    data: {
      kind: crm ? "pre_sales" : "operational",
      type: over.type ?? "task",
      hostApp: crm ? "crm" : "projects",
      hostType: crm ? "company" : "project",
      hostId: crm ? "co-1" : "pr-1",
      subject: "Send the offer",
      body: over.body ?? null,
      occurredAt: new Date("2026-11-01T09:00:00Z"),
      authorUserId: "user-author",
      ...(isTask
        ? {
            dueDate: over.dueDate === null ? null : new Date(`${over.dueDate ?? TOMORROW}T00:00:00Z`),
            assigneeUserId: over.assignee === undefined ? "user-assignee" : over.assignee,
            ...(over.completed ? { completedAt: new Date("2026-11-25T10:00:00Z"), completedByUserId: "user-assignee" } : {}),
          }
        : {}),
      ...(over.participants ? { participants: { create: over.participants.map((userId) => ({ userId, createdBy: "user-author" })) } } : {}),
    },
  });
}

const sentFor = async (id: string) => (await db.activity.findUniqueOrThrow({ where: { id } })).dueReminderSentFor?.toISOString().slice(0, 10) ?? null;

describe("due-date reminders: the day before, 08:00 Europe/Zurich", () => {
  const realSend = dueReminderDeps.send;
  const realAfterClaim = dueReminderDeps.afterClaim;

  beforeEach(async () => {
    await resetWorld();
    sent = [];
    answer = 201;
    taken = new Set();
    wireNotifier();
  });
  afterEach(() => {
    dueReminderDeps.send = realSend;
    dueReminderDeps.afterClaim = realAfterClaim;
    env.ACTIVITIES_MAINTENANCE = false;
  });

  it("emails the assignee and every participant once (deduplicated), origin crm, nothing of the body", async () => {
    const t = await seedTask({ participants: ["user-p1", "user-assignee", "user-p2"], body: "Secret client note" });

    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 1, failed: 0 });

    expect(sent.map((s) => s.recipientId).sort()).toEqual(["user-assignee", "user-p1", "user-p2"]);
    for (const s of sent) {
      expect(s).toMatchObject({
        originApp: "crm",
        email: true,
        link: { href: "/crm/tasks" },
        title: "Due tomorrow: Send the offer",
        body: "This task is due tomorrow, 27.11.2026. Open it in the CRM.",
        it: { title: "In scadenza domani: Send the offer", body: "Questa attività scade domani, 27.11.2026. Aprila nel CRM." },
        idempotencyKey: dueReminderKey(t.id, TOMORROW, s.recipientId),
      });
      expect(JSON.stringify(s)).not.toContain("Secret");
    }
    expect(await sentFor(t.id)).toBe(TOMORROW);
  });

  it("a project task goes as origin projects and opens the project", async () => {
    await seedTask({ host: "projects" });
    await runDueTaskReminders(NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ originApp: "projects", email: true, link: { href: "/projects/pr-1" }, body: "This task is due tomorrow, 27.11.2026. Open it in Projects." });
  });

  it("a second tick sends nothing", async () => {
    await seedTask();
    await runDueTaskReminders(NOW);
    expect(await runDueTaskReminders(new Date(NOW.getTime() + 15 * 60_000))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(1);
  });

  it("a new due date gets its own reminder", async () => {
    const t = await seedTask();
    await runDueTaskReminders(NOW);
    await db.activity.update({ where: { id: t.id }, data: { dueDate: new Date("2026-11-30T00:00:00Z") } });
    // Not yet: 30.11 is not tomorrow on the 26th.
    await runDueTaskReminders(NOW);
    expect(sent).toHaveLength(1);
    await runDueTaskReminders(new Date("2026-11-29T07:00:00Z"));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toContain("30.11.2026");
    expect(await sentFor(t.id)).toBe("2026-11-30");
  });

  it("nothing for a done task, a task due today or in the past, one without a due date, or a note", async () => {
    await seedTask({ completed: true });
    await seedTask({ dueDate: "2026-11-26" });
    await seedTask({ dueDate: "2026-11-20" });
    await seedTask({ dueDate: null });
    await seedTask({ type: "note" });
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("nothing before 08:00 Zurich; the first tick from 08:00 sends", async () => {
    const t = await seedTask();
    await runDueTaskReminders(new Date("2026-11-26T06:59:00Z")); // 07:59 Zurich
    expect(sent).toHaveLength(0);
    expect(await sentFor(t.id)).toBeNull();
    await runDueTaskReminders(new Date("2026-11-26T07:00:00Z")); // 08:00 Zurich
    expect(sent).toHaveLength(1);
  });

  it("a task with nobody to tell keeps its claim and sends nothing", async () => {
    const t = await seedTask({ assignee: null });
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(0);
    expect(await sentFor(t.id)).toBe(TOMORROW);
  });

  it("notify-api refusing or unreachable: the claim is given back and the next tick retries", async () => {
    const t = await seedTask({ participants: ["user-p1"] });
    answer = 503;
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 1 });
    expect(await sentFor(t.id)).toBeNull();
    answer = "throw";
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 1 });
    expect(await sentFor(t.id)).toBeNull();
    answer = 201;
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(2);
    expect(await sentFor(t.id)).toBe(TOMORROW);
  });

  it("a partial failure retries everyone, and the keys keep whoever already got it from getting it twice", async () => {
    await seedTask({ participants: ["user-p1"] });
    let calls = 0;
    // The first request of the first tick fails, every other one goes.
    setNotifierForTests(
      createNotifier({
        baseUrl: "http://notify.test",
        tokens,
        fetchImpl: (async (_u: string | URL | Request, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as Sent;
          if (calls++ === 0) return new Response(null, { status: 502 });
          if (taken.has(body.idempotencyKey!)) return new Response(null, { status: 200 });
          taken.add(body.idempotencyKey!);
          sent.push(body);
          return new Response(null, { status: 201 });
        }) as typeof fetch,
      }),
    );
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 1 });
    expect(sent).toHaveLength(1);
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 1, failed: 0 });
    expect(sent.map((s) => s.recipientId).sort()).toEqual(["user-assignee", "user-p1"]);
  });

  it("no notifier wired: nothing is claimed", async () => {
    const t = await seedTask();
    setNotifierForTests(null);
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 0 });
    expect(await sentFor(t.id)).toBeNull();
  });

  it("in maintenance nothing is claimed", async () => {
    const t = await seedTask();
    env.ACTIVITIES_MAINTENANCE = true;
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 0 });
    expect(await sentFor(t.id)).toBeNull();
  });

  it("completed or re-dated after the claim, before the send: not sent, claim given back", async () => {
    const done = await seedTask();
    const moved = await seedTask();
    dueReminderDeps.send = async () => {
      throw new Error("must not send");
    };
    let claims = 0;
    dueReminderDeps.afterClaim = async (id) => {
      claims++;
      if (id === done.id) await db.activity.update({ where: { id }, data: { completedAt: new Date(), completedByUserId: "user-assignee" } });
      if (id === moved.id) await db.activity.update({ where: { id }, data: { dueDate: new Date("2026-12-05T00:00:00Z") } });
    };
    expect(await runDueTaskReminders(NOW)).toEqual({ sent: 0, failed: 0 });
    expect(claims).toBe(2);
    expect(await sentFor(done.id)).toBeNull();
    expect(await sentFor(moved.id)).toBeNull();
  });

  it("two concurrent ticks send one reminder", async () => {
    await seedTask({ participants: ["user-p1"] });
    const results = await Promise.all([runDueTaskReminders(NOW), runDueTaskReminders(NOW), runDueTaskReminders(NOW)]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(sent).toHaveLength(2);
  });
});

describe("dueReminderKey", () => {
  it("is readable when the ids fit notify-api's rule, a hash otherwise, and always within it", () => {
    expect(dueReminderKey("act-1", TOMORROW, "user-1")).toBe("task-due:act-1:2026-11-27:user-1");
    const hashed = dueReminderKey("act 1", TOMORROW, "user/1");
    expect(hashed).toMatch(/^task-due:[0-9a-f]{64}$/);
    expect(dueReminderKey("a".repeat(300), TOMORROW, "u")).toMatch(/^[A-Za-z0-9._:-]{1,200}$/);
  });
});
