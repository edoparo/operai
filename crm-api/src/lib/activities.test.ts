/**
 * The activities-api client on its own (specs/20261110-activities T12; ADR 20261110-caller-chosen-ids-replace-cross-service-transactions): what the route tests cannot see
 * through the world's stub — the shape of each request, the token handling, and that every way of
 * not getting an answer is the same 503. `fetchImpl` and a token provider are injected, so no
 * environment and no database are involved.
 */
import "../test-support/testAuth"; // sets the environment before ../lib/env is read
import { describe, expect, it, spyOn } from "bun:test";
import { createActivitiesClient, LOCKED_CALL, type NewActivity } from "./activities";
import type { ServiceTokenProvider } from "./serviceToken";
import { ProblemError } from "./problem";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: string | undefined;
}

function harness(answer: (seen: Seen, attempt: number) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const invalidated: string[] = [];
  let minted = 0;
  const tokens: ServiceTokenProvider = {
    async getToken() {
      return `tok-${++minted}`;
    },
    invalidate(token) {
      invalidated.push(token);
    },
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const entry: Seen = {
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      redirect: init.redirect,
    };
    seen.push(entry);
    return answer(entry, seen.length - 1);
  }) as unknown as typeof fetch;
  const client = createActivitiesClient({ baseUrl: "http://activities.example/", tokens, fetchImpl, timeoutMs: 200 });
  return { client, seen, invalidated };
}

const note: NewActivity = {
  type: "note",
  subject: "S",
  occurredAt: "2026-11-10T09:00:00.000Z",
  companyId: "co-1",
  authorUserId: "u-1",
};

const unavailable = (error: unknown, code = "activities_unavailable") => {
  expect(error).toBeInstanceOf(ProblemError);
  expect(error).toMatchObject({ status: 503, code });
};

describe("activities client requests", () => {
  it("PUT carries the body and the Bearer, never follows a redirect, and reads 201 vs 200", async () => {
    const { client, seen } = harness((_s, n) => Response.json({}, { status: n === 0 ? 201 : 200 }));
    expect(await client.put("a/b", note)).toEqual({ created: true });
    expect(await client.put("a/b", note)).toEqual({ created: false });
    expect(seen[0]).toMatchObject({ method: "PUT", url: "http://activities.example/system/v1/activities/a%2Fb", body: note, redirect: "error" });
    expect(seen[0]!.headers["Authorization"]).toBe("Bearer tok-1");
    expect(seen[0]!.headers["Content-Type"]).toBe("application/json");
  });

  it("DELETE states onlyIfOpen explicitly and sends no body", async () => {
    const { client, seen } = harness(() => new Response(null, { status: 204 }));
    await client.remove("t1", { onlyIfOpen: true });
    await client.remove("t2");
    expect(seen.map((s) => [s.method, s.url.replace("http://activities.example", ""), s.body])).toEqual([
      ["DELETE", "/system/v1/activities/t1?onlyIfOpen=true", undefined],
      ["DELETE", "/system/v1/activities/t2?onlyIfOpen=false", undefined],
    ]);
    expect(seen[0]!.headers["Content-Type"]).toBeUndefined();
  });

  it("completion, mirror and erase go to their routes and return the answer", async () => {
    const { client, seen } = harness((s) =>
      s.url.endsWith("/erase") ? Response.json({ unlinked: 3 }) : Response.json({ applied: !s.url.endsWith("/completion") }),
    );
    expect(await client.complete("t", { completed: true, at: "2026-11-10T09:00:00.000Z", byUserId: "u", seq: 4 })).toEqual({ applied: false });
    expect(
      await client.mirrorMeeting({
        noticeId: crypto.randomUUID(),
        seq: 1,
        event: "deleted",
        meeting: { id: "m", title: null, startsAt: null, creatorId: "u" },
        deal: { id: "d" },
      }),
    ).toEqual({ applied: true });
    expect(await client.eraseContact("k 1")).toEqual({ unlinked: 3 });
    expect(seen.map((s) => `${s.method} ${s.url.replace("http://activities.example", "")}`)).toEqual([
      "POST /system/v1/activities/t/completion",
      "POST /system/v1/meeting-mirror",
      "POST /system/v1/contacts/k%201/erase",
    ]);
  });
});

describe("activities client failures are one 503", () => {
  it("not configured (no URL, or no token provider)", async () => {
    const tokens = { async getToken() { return "t"; }, invalidate() {} } satisfies ServiceTokenProvider;
    for (const options of [{ baseUrl: undefined, tokens }, { baseUrl: "http://a.example", tokens: null }]) {
      const client = createActivitiesClient(options);
      await client.put("x", note).then(() => expect.unreachable(), (e) => unavailable(e, "activities_unconfigured"));
      await client.eraseContact("k").then(() => expect.unreachable(), (e) => unavailable(e, "activities_unconfigured"));
    }
  });

  it("the token exchange failing, the network failing, any non-2xx and an unreadable body", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const noToken = createActivitiesClient({
        baseUrl: "http://a.example",
        tokens: { async getToken() { throw new Error("auth down"); }, invalidate() {} },
        fetchImpl: (async () => Response.json({})) as unknown as typeof fetch,
      });
      await noToken.complete("t", { completed: true, at: "x", byUserId: "u", seq: 1 }).then(() => expect.unreachable(), unavailable);

      const cases: Array<(s: Seen) => Response | Promise<Response>> = [
        () => { throw new TypeError("fetch failed"); },
        () => Response.json({}, { status: 500 }),
        () => Response.json({ code: "maintenance" }, { status: 503 }),
        () => Response.json({}, { status: 404 }),
        () => new Response("<html>", { status: 200 }),
        () => Response.json({ applied: "yes" }),
        () => Response.json(["applied"]),
      ];
      for (const answer of cases) {
        const { client } = harness(answer);
        await client.complete("t", { completed: true, at: "x", byUserId: "u", seq: 1 }).then(() => expect.unreachable(), unavailable);
      }
    } finally {
      log.mockRestore();
    }
  });

  it("a timeout aborts the request through the signal", async () => {
    let signal: AbortSignal | undefined;
    const client = createActivitiesClient({
      baseUrl: "http://a.example",
      tokens: { async getToken() { return "t"; }, invalidate() {} },
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))));
      }) as unknown as typeof fetch,
    });
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.remove("t").then(() => expect.unreachable(), unavailable);
      expect(signal?.aborted).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("removeQuietly swallows the failure and logs the id, never the token", async () => {
    const { client } = harness(() => Response.json({}, { status: 500 }));
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      await client.removeQuietly("task-9");
      const logged = log.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(logged).toContain("task-9");
      expect(logged).not.toContain("tok-");
    } finally {
      log.mockRestore();
    }
  });
});

describe("activities client token handling", () => {
  it("one 401 invalidates the token and retries once with a fresh one; a second 401 is a 503, not a loop", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const retried = harness((_s, n) => (n === 0 ? new Response(null, { status: 401 }) : Response.json({ applied: true })));
      expect(await retried.client.complete("t", { completed: true, at: "x", byUserId: "u", seq: 1 })).toEqual({ applied: true });
      expect(retried.invalidated).toEqual(["tok-1"]);
      expect(retried.seen.map((s) => s.headers["Authorization"])).toEqual(["Bearer tok-1", "Bearer tok-2"]);

      const refused = harness(() => new Response(null, { status: 401 }));
      await refused.client.complete("t", { completed: true, at: "x", byUserId: "u", seq: 1 }).then(() => expect.unreachable(), unavailable);
      expect(refused.seen).toHaveLength(2);
    } finally {
      log.mockRestore();
    }
  });
});

describe("a call made under a row lock is bounded (specs/20261110-activities plan § Risks: 2 s, the lock is never held for long)", () => {
  const completion = { completed: true, at: "2026-11-10T09:00:00.000Z", byUserId: "u", seq: 1 } as const;
  const hangUntilAborted = (signal: AbortSignal) =>
    new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError"))));

  it("the bound the notice route uses is 2 s per attempt and at most 4 s in all", () => {
    expect(LOCKED_CALL).toEqual({ timeoutMs: 2_000, budgetMs: 4_000 });
  });

  it("each attempt gets the call's own timeout, not the client's default", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = createActivitiesClient({
        baseUrl: "http://a.example",
        tokens: { async getToken() { return "t"; }, invalidate() {} },
        timeoutMs: 5_000,
        fetchImpl: ((_url: string, init: RequestInit) => hangUntilAborted(init.signal as AbortSignal)) as unknown as typeof fetch,
      });
      const started = Date.now();
      await client.complete("t", completion, { timeoutMs: 30, budgetMs: 1_000 }).then(() => expect.unreachable(), unavailable);
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      log.mockRestore();
    }
  });

  it("the 401 retry is inside the budget: two hanging attempts never exceed it", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      let attempts = 0;
      const client = createActivitiesClient({
        baseUrl: "http://a.example",
        tokens: { async getToken() { return "t"; }, invalidate() {} },
        fetchImpl: ((_url: string, init: RequestInit) => {
          attempts++;
          // The first attempt is slow and then 401; the second would hang for the whole default.
          if (attempts === 1) return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(null, { status: 401 })), 60));
          return hangUntilAborted(init.signal as AbortSignal);
        }) as unknown as typeof fetch,
      });
      const started = Date.now();
      await client.complete("t", completion, { timeoutMs: 100, budgetMs: 120 }).then(() => expect.unreachable(), unavailable);
      expect(attempts).toBe(2);
      // 60 ms spent on the first attempt: the second gets what is left of 120, not another 100.
      expect(Date.now() - started).toBeLessThan(170);
    } finally {
      log.mockRestore();
    }
  });

  it("an exhausted budget does not start another attempt", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      let attempts = 0;
      const client = createActivitiesClient({
        baseUrl: "http://a.example",
        tokens: { async getToken() { return "t"; }, invalidate() {} },
        fetchImpl: (() => {
          attempts++;
          return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(null, { status: 401 })), 40));
        }) as unknown as typeof fetch,
      });
      await client.complete("t", completion, { timeoutMs: 100, budgetMs: 30 }).then(() => expect.unreachable(), unavailable);
      expect(attempts).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it("a slow token exchange counts against the budget", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      let fetched = 0;
      const client = createActivitiesClient({
        baseUrl: "http://a.example",
        tokens: { getToken: () => new Promise<string>(() => {}), invalidate() {} },
        fetchImpl: (async () => { fetched++; return Response.json({ applied: true }); }) as unknown as typeof fetch,
      });
      const started = Date.now();
      await client.complete("t", completion, { timeoutMs: 100, budgetMs: 50 }).then(() => expect.unreachable(), unavailable);
      expect(fetched).toBe(0);
      expect(Date.now() - started).toBeLessThan(300);
    } finally {
      log.mockRestore();
    }
  });

  it("without a bound the default timeout and the single 401 retry are unchanged", async () => {
    const { client, seen, invalidated } = harness((_s, n) => (n === 0 ? new Response(null, { status: 401 }) : Response.json({ applied: true })));
    expect(await client.complete("t", completion)).toEqual({ applied: true });
    expect(seen).toHaveLength(2);
    expect(invalidated).toEqual(["tok-1"]);
  });
});
