import { afterEach, describe, expect, it } from "bun:test";
import "../test-support/testAuth";
import {
  announce,
  clip,
  createNotifier,
  FALLBACK_ACTOR,
  recipientsOf,
  setNotifierForTests,
  type Notifier,
  type NotifyEvent,
} from "./notify";
import { __resetIdentityCacheForTests } from "./identities";
import { NOTIFY_KINDS, renderNotification, type NotifyTarget } from "./notificationCopy";
import type { ServiceTokenProvider } from "./serviceToken";

const crmDeal: NotifyTarget = { host: "crm", company: { id: "co-1", name: "Acme AG" }, deal: { id: "deal-1", title: "Grid analytics" } };
const crmCompany: NotifyTarget = { host: "crm", company: { id: "co-1", name: "Acme AG" }, deal: null };
const project: NotifyTarget = { host: "projects", project: { id: "pr-1", name: "Smart meter rollout" } };

const task = { id: "act-1", type: "task", subject: "Call the client", dueDate: "2026-12-31" } as const;

describe("copy catalog (specs/20261110-activities US-6, ADR 20261104-bilingual-system-notifications)", () => {
  it("CRM task_assigned is byte-for-byte what crm-api sends today", () => {
    const n = renderNotification("task_assigned", { activity: task, target: crmDeal }, "Ada");
    expect(n).toMatchObject({
      originApp: "crm",
      severity: "info",
      email: true,
      href: "/crm/tasks",
      title: "New task: Call the client",
      body: "Ada assigned you a task, due 31.12.2026. Deal: Grid analytics.",
    });
    const noDue = renderNotification("task_assigned", { activity: { ...task, dueDate: null }, target: crmCompany }, "Ada");
    expect(noDue.body).toBe("Ada assigned you a task. Company: Acme AG.");
  });

  it("CRM participant_added is in-app with today's hrefs: tasks list, else the deal, else the company", () => {
    const onTask = renderNotification("activity_participant_added", { activity: task, target: crmDeal }, "Ada");
    expect(onTask).toMatchObject({ originApp: "crm", email: false, href: "/crm/tasks", title: "You take part in: Call the client" });
    expect(onTask.body).toBe("Ada added you to this task. Deal: Grid analytics.");
    const call = { ...task, type: "call" } as const;
    expect(renderNotification("activity_participant_added", { activity: call, target: crmDeal }, "Ada").href).toBe("/crm/deals/deal-1");
    const note = renderNotification("activity_participant_added", { activity: { ...task, type: "note" }, target: crmCompany }, "Ada");
    expect(note.href).toBe("/crm/companies/co-1");
    expect(note.body).toBe("Ada added you to this note. Company: Acme AG.");
  });

  it("CRM task_unblocked emails and links to the tasks list", () => {
    const n = renderNotification("task_unblocked", { activity: task, target: crmDeal }, "Ada");
    expect(n).toMatchObject({ originApp: "crm", email: true, href: "/crm/tasks", title: "You can go ahead: Call the client" });
    expect(n.body).toBe("Ada completed the last task this one was waiting on. Deal: Grid analytics.");
  });

  it("project copy uses originApp projects and opens the project, email on the two email kinds only", () => {
    const assigned = renderNotification("task_assigned", { activity: task, target: project }, "Ada");
    expect(assigned).toMatchObject({ originApp: "projects", email: true, href: "/projects/pr-1", title: "New task: Call the client" });
    expect(assigned.body).toBe("Ada assigned you a task, due 31.12.2026. Project: Smart meter rollout.");
    const added = renderNotification("activity_participant_added", { activity: task, target: project }, "Ada");
    expect(added).toMatchObject({ originApp: "projects", email: false, href: "/projects/pr-1" });
    expect(added.body).toBe("Ada added you to this task. Project: Smart meter rollout.");
    const freed = renderNotification("task_unblocked", { activity: task, target: project }, "Ada");
    expect(freed).toMatchObject({ originApp: "projects", email: true, href: "/projects/pr-1" });
    expect(freed.body).toBe("Ada completed the last task this one was waiting on. Project: Smart meter rollout.");
  });

  it("every kind x host carries a complete Italian variant that differs from English", () => {
    for (const target of [crmDeal, crmCompany, project]) {
      for (const kind of NOTIFY_KINDS) {
        const n = renderNotification(kind, { activity: task, target }, "Ada");
        expect(n.it.title.length).toBeGreaterThan(0);
        expect(n.it.body.length).toBeGreaterThan(0);
        expect(n.it.title).not.toBe(n.title);
        expect(n.it.body).not.toBe(n.body);
        expect(n.it.body).toContain("Ada");
      }
    }
    const it = renderNotification("task_assigned", { activity: task, target: project }, "Ada").it;
    expect(it.title).toBe("Nuova attività: Call the client");
    expect(it.body).toBe("Ada ti ha assegnato un'attività, da completare entro 31.12.2026. Progetto: Smart meter rollout.");
    expect(renderNotification("task_assigned", { activity: task, target: crmDeal }, "Ada").it.body).toContain("Opportunità: Grid analytics.");
    expect(renderNotification("task_assigned", { activity: task, target: crmCompany }, "Ada").it.body).toContain("Azienda: Acme AG.");
  });

  it("user text is clipped inside notify-api's 200/2000 limits, in both languages", () => {
    const long = "x".repeat(5000);
    for (const kind of NOTIFY_KINDS) {
      const n = renderNotification(
        kind,
        { activity: { ...task, subject: long }, target: { host: "projects", project: { id: "p", name: long } } },
        long,
      );
      expect(n.title.length).toBeLessThanOrEqual(200);
      expect(n.it.title.length).toBeLessThanOrEqual(200);
      expect(n.body.length).toBeLessThanOrEqual(2000);
      expect(n.it.body.length).toBeLessThanOrEqual(2000);
      expect(n.title.endsWith("…")).toBe(true);
    }
  });
});

const event: NotifyEvent = {
  kind: "task_assigned",
  activityId: "act-1",
  actorId: "actor",
  actorName: "Ada",
  recipientIds: ["actor", "a", "b", "a", null, undefined, ""],
  activity: task,
  target: project,
};

function harness(statuses: number[] = [201], tokensIssued: string[] = ["t1", "t2"]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const invalidated: string[] = [];
  let issued = 0;
  const tokens: ServiceTokenProvider = {
    async getToken() {
      return tokensIssued[Math.min(issued++, tokensIssued.length - 1)]!;
    },
    invalidate(token) {
      invalidated.push(token);
    },
  };
  const queue = [...statuses];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: queue.length > 1 ? queue.shift()! : queue[0]! });
  }) as typeof fetch;
  return { calls, invalidated, notifier: createNotifier({ baseUrl: "http://notify.test", tokens, fetchImpl }) };
}

const quiet = async (fn: () => Promise<void>) => {
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => void logged.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logged;
};

describe("notifier (specs/20261110-activities AC-6.1..6.4)", () => {
  it("posts one request per recipient with the contract's shape (en + it, link, email flag), never to the actor", async () => {
    const { calls, notifier } = harness();
    await notifier.notify(event);
    expect(calls.map((c) => c.body["recipientId"]).sort()).toEqual(["a", "b"]);
    expect(calls[0]).toMatchObject({
      url: "http://notify.test/system/notifications",
      headers: { Authorization: "Bearer t1", "Content-Type": "application/json" },
      body: {
        originApp: "projects",
        severity: "info",
        title: "New task: Call the client",
        body: "Ada assigned you a task, due 31.12.2026. Project: Smart meter rollout.",
        link: { href: "/projects/pr-1" },
        it: { title: "Nuova attività: Call the client" },
        email: true,
      },
    });
  });

  it("omits the email flag for the in-app kind", async () => {
    const { calls, notifier } = harness();
    await notifier.notify({ ...event, kind: "activity_participant_added" });
    expect("email" in calls[0]!.body).toBe(false);
  });

  it("drops the token and retries once on a 401, then gives up quietly", async () => {
    const retried = harness([401, 201]);
    await retried.notifier.notify({ ...event, recipientIds: ["a"] });
    expect(retried.calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer t1", "Bearer t2"]);
    expect(retried.invalidated).toEqual(["t1"]);

    const refused = harness([401]);
    await quiet(() => refused.notifier.notify({ ...event, recipientIds: ["a"] }));
    expect(refused.calls).toHaveLength(2);
  });

  it("never throws: a non-2xx, a network error and a token failure are swallowed, and logs carry no copy", async () => {
    const failing = harness([500]);
    const logs = await quiet(() => failing.notifier.notify(event));
    expect(logs.join("\n")).toContain("HTTP 500");
    expect(logs.join("\n")).toContain("task_assigned activity=act-1");
    expect(logs.join("\n")).not.toContain("Call the client");
    expect(logs.join("\n")).not.toContain("Ada");

    const network = createNotifier({
      baseUrl: "http://notify.test",
      tokens: { async getToken() { return "t"; }, invalidate() {} },
      fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch,
    });
    await quiet(() => network.notify(event));

    const noToken = createNotifier({
      baseUrl: "http://notify.test",
      tokens: { async getToken() { throw new Error("no token"); }, invalidate() {} },
      fetchImpl: (async () => new Response(null, { status: 201 })) as unknown as typeof fetch,
    });
    await quiet(() => noToken.notify(event));
  });

  it("sends nothing when only the actor would be told", async () => {
    const { calls, notifier } = harness();
    await notifier.notify({ ...event, recipientIds: ["actor", "actor"] });
    expect(calls).toHaveLength(0);
  });

  it("helpers: recipients and clip", () => {
    expect(recipientsOf(event)).toEqual(["a", "b"]);
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
  });
});

describe("announce (fire-and-forget after the write, AC-6.4)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    setNotifierForTests(null);
    globalThis.fetch = realFetch;
    // The actor's name is cached by the shared resolver for 60 s: each case starts cold.
    __resetIdentityCacheForTests();
  });

  const ctx = (authorization: string | undefined, userId = "actor") => ({
    get: (_key: "userId") => userId,
    req: { header: (name: string) => (name === "Authorization" ? authorization : undefined) },
  });
  const spec = {
    kind: "task_assigned",
    activityId: "act-1",
    recipientIds: ["a"],
    activity: task,
    target: project,
  } as const;

  function recorder() {
    const events: NotifyEvent[] = [];
    const notifier: Notifier = {
      async notify(e) {
        events.push(e);
      },
    };
    return { events, notifier };
  }

  function stubIdentities(name: string | null, status = 200) {
    const calls: { url: string; auth: string | null; ids: unknown }[] = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization"), ids: JSON.parse(String(init?.body)).ids });
      return Response.json({ users: name === null ? [] : [{ id: "actor", status: "active", name }] }, { status });
    }) as unknown as typeof fetch;
    return calls;
  }

  it("resolves the actor's name live with the caller's JWT and hands the notifier the event", async () => {
    const { events, notifier } = recorder();
    setNotifierForTests(notifier);
    const calls = stubIdentities("  Ada Lovelace ");
    await announce(ctx("Bearer user-jwt"), spec);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "http://localhost:3001/authz/users/identities", auth: "Bearer user-jwt", ids: ["actor"] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "task_assigned", actorId: "actor", actorName: "Ada Lovelace", recipientIds: ["a"], target: project });
  });

  it("falls back to 'A colleague' when auth cannot name the actor, answers badly, or there is no user JWT", async () => {
    const { events, notifier } = recorder();
    setNotifierForTests(notifier);
    stubIdentities(null);
    await announce(ctx("Bearer user-jwt"), spec);
    stubIdentities(null, 503);
    await quiet(() => announce(ctx("Bearer user-jwt"), spec));
    const calls = stubIdentities("Ada");
    await announce(ctx(undefined), spec); // a service call: no user JWT, no lookup
    expect(calls).toHaveLength(0);
    expect(events.map((e) => e.actorName)).toEqual([FALLBACK_ACTOR, FALLBACK_ACTOR, FALLBACK_ACTOR]);
  });

  it("skips the name lookup and the notifier when nobody would be told", async () => {
    const { events, notifier } = recorder();
    setNotifierForTests(notifier);
    const calls = stubIdentities("Ada");
    await announce(ctx("Bearer user-jwt"), { ...spec, recipientIds: ["actor", null, undefined] });
    expect(calls).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("does not wait for delivery and never throws, whatever the notifier does", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let delivered = false;
    setNotifierForTests({
      async notify() {
        await gate;
        delivered = true;
      },
    });
    stubIdentities("Ada");
    await announce(ctx("Bearer user-jwt"), spec);
    expect(delivered).toBe(false);
    release();

    setNotifierForTests({ notify: () => Promise.reject(new Error("boom")) });
    await announce(ctx("Bearer user-jwt"), spec);

    setNotifierForTests({
      notify: () => {
        throw new Error("sync boom");
      },
    });
    await quiet(() => announce(ctx("Bearer user-jwt"), spec));

    globalThis.fetch = (async () => {
      throw new Error("auth down");
    }) as unknown as typeof fetch;
    await quiet(() => announce(ctx("Bearer user-jwt"), spec));
  });

  it("is a no-op while no notifier is wired (env group absent, or under test)", async () => {
    const calls = stubIdentities("Ada");
    await announce(ctx("Bearer user-jwt"), spec);
    expect(calls).toHaveLength(0);
  });
});
