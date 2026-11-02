import { describe, expect, it } from "bun:test";
import "../test-support/testAuth";
import { clip, createNotifier, formatDueDate, recipientsOf, type NotifyEvent } from "./notify";
import type { ServiceTokenProvider } from "./serviceToken";

const event: NotifyEvent = {
  kind: "estimate_requested",
  dealId: "deal-1",
  actorId: "actor",
  recipientIds: ["actor", "a", "b", "a", null, undefined, ""],
  severity: "info",
  title: "Estimate requested: X",
  body: "Body",
  href: "/crm/deals/deal-1",
  email: true,
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

describe("crm-api notifier (specs/019 T6)", () => {
  it("posts one request per recipient with the contract's shape, never to the actor, never twice", async () => {
    const { calls, notifier } = harness();
    await notifier.notify(event);
    expect(calls.map((c) => c.body.recipientId).sort()).toEqual(["a", "b"]);
    expect(calls[0]).toMatchObject({
      url: "http://notify.test/system/notifications",
      headers: { Authorization: "Bearer t1", "Content-Type": "application/json" },
      body: {
        originApp: "crm",
        severity: "info",
        title: "Estimate requested: X",
        body: "Body",
        link: { href: "/crm/deals/deal-1" },
        email: true,
      },
    });
  });

  it("omits the email flag for an in-app notice", async () => {
    const { calls, notifier } = harness();
    await notifier.notify({ ...event, email: false });
    expect("email" in calls[0]!.body).toBe(false);
  });

  it("drops the token and retries once on a 401, then gives up quietly", async () => {
    const retried = harness([401, 201]);
    await retried.notifier.notify({ ...event, recipientIds: ["a"] });
    expect(retried.calls.map((c) => c.headers["Authorization"])).toEqual(["Bearer t1", "Bearer t2"]);
    expect(retried.invalidated).toEqual(["t1"]);

    const refused = harness([401]);
    const original = console.error;
    console.error = () => {};
    try {
      await refused.notifier.notify({ ...event, recipientIds: ["a"] });
    } finally {
      console.error = original;
    }
    expect(refused.calls).toHaveLength(2);
  });

  it("never throws: a non-2xx, a network error and a token failure are swallowed", async () => {
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
    const failing = harness([500]);
    const logs = await quiet(() => failing.notifier.notify(event));
    expect(logs.join("\n")).toContain("HTTP 500");
    expect(logs.join("\n")).not.toContain("Estimate requested");

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

  it("helpers: recipients, clip, due date", () => {
    expect(recipientsOf(event)).toEqual(["a", "b"]);
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(clip("abc", 4)).toBe("abc");
    expect(formatDueDate("2026-12-31")).toBe("31.12.2026");
    expect(formatDueDate(new Date("2026-01-05T00:00:00Z"))).toBe("05.01.2026");
  });
});
