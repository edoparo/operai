import { describe, expect, it } from "bun:test";
import type { ServiceTokenProvider } from "../src/lib/serviceToken";
import { runSwitchCheck } from "./check-letterhead-service";

/** specs/20261116-letterhead-service T30 (AC-10.12): the release check before the switch. No database, no bucket: a stubbed `fetch`. */
const TOKEN = "SECRET-SERVICE-TOKEN";

function harness(answers: (Response | "network-error" | "hang")[], tokens: Partial<ServiceTokenProvider> = {}) {
  const calls: { url: string; method: string | undefined; authorization: string | null }[] = [];
  const invalidated: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let served = 0;
  const provider: ServiceTokenProvider = {
    getToken: async () => TOKEN,
    invalidate: (token) => void invalidated.push(token),
    ...tokens,
  };
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method, authorization: new Headers(init?.headers).get("Authorization") });
    const answer = answers[Math.min(served, answers.length - 1)]!;
    served += 1;
    if (answer === "network-error") throw new TypeError("fetch failed SECRET-HOST-DETAIL");
    if (answer === "hang") return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    return answer.clone();
  }) as typeof fetch;
  const io = { log: (l: string) => void out.push(l), error: (l: string) => void err.push(l) };
  return {
    calls,
    invalidated,
    out,
    err,
    run: (over: { baseUrl?: string | undefined; tokens?: ServiceTokenProvider | null; timeoutMs?: number } = {}) =>
      runSwitchCheck({
        baseUrl: "baseUrl" in over ? over.baseUrl : "http://letterhead.test/",
        tokens: "tokens" in over ? (over.tokens ?? null) : provider,
        fetchImpl,
        io,
        ...(over.timeoutMs !== undefined ? { timeoutMs: over.timeoutMs } : {}),
      }),
  };
}

const status = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

describe("check-letterhead-service (AC-10.12)", () => {
  it("exits 0 when both entities have an active letterhead, one line each, asking GET /v1/letterheads/status as the service", async () => {
    const h = harness([status({ welld_it: { activeVersion: 3 }, welld_ch: { activeVersion: 12 } })]);
    expect(await h.run()).toBe(0);
    expect(h.out).toEqual(["welld_ch  active v12", "welld_it  active v3"]);
    expect(h.err).toEqual([]);
    expect(h.calls).toEqual([{ url: "http://letterhead.test/v1/letterheads/status", method: "GET", authorization: `Bearer ${TOKEN}` }]);
  });

  it("refuses (exit 1) when an entity has none, naming it, and still lists the other", async () => {
    const h = harness([status({ welld_it: { activeVersion: 3 }, welld_ch: null })]);
    expect(await h.run()).toBe(1);
    expect(h.out).toEqual(["welld_ch  NONE", "welld_it  active v3"]);
    expect(h.err.join("\n")).toContain("welld_ch has no usable active letterhead");
    expect(h.err.join("\n")).toContain("The switch stays off");
  });

  it("refuses when both have none, or an entity is missing from the answer or is not the contract's shape", async () => {
    for (const body of [
      { welld_it: null, welld_ch: null },
      { welld_it: { activeVersion: 3 } },
      { welld_it: { activeVersion: 0 }, welld_ch: { activeVersion: 1 } },
      { welld_it: { activeVersion: "3" }, welld_ch: { activeVersion: 1 } },
      { welld_it: {}, welld_ch: { activeVersion: 1 } },
    ]) {
      const h = harness([status(body)]);
      expect(await h.run()).toBe(1);
      expect(h.err.length).toBeGreaterThan(0);
    }
    for (const body of [[], null, "ok", 3]) {
      const h = harness([status(body)]);
      expect(await h.run()).toBe(1);
    }
  });

  it("refuses when the service cannot be asked or answers something else, and never prints the token or the service's words", async () => {
    const cases: (Response | "network-error" | "hang")[] = [
      "network-error",
      new Response(JSON.stringify({ code: "x", detail: "SECRET-SERVICE-DETAIL" }), { status: 500 }),
      new Response("<html>SECRET-GATEWAY</html>", { status: 502 }),
      new Response("not json SECRET-BODY", { status: 200 }),
      new Response(null, { status: 302, headers: { Location: "http://elsewhere.test/" } }),
      "hang",
    ];
    for (const answer of cases) {
      const h = harness([answer]);
      expect(await h.run({ timeoutMs: 50 })).toBe(1);
      const printed = [...h.out, ...h.err].join("\n");
      expect(printed).not.toContain("SECRET");
      expect(printed).toContain("The switch stays off");
    }
  });

  it("takes a fresh token once on a 401, and refuses on a second", async () => {
    const h = harness([new Response(null, { status: 401 }), status({ welld_it: { activeVersion: 1 }, welld_ch: { activeVersion: 1 } })]);
    expect(await h.run()).toBe(0);
    expect(h.invalidated).toEqual([TOKEN]);
    expect(h.calls).toHaveLength(2);

    const again = harness([new Response(null, { status: 401 })]);
    expect(await again.run()).toBe(1);
    expect(again.calls).toHaveLength(2);
    expect(again.err.join("\n")).toContain("HTTP 401");
  });

  it("refuses when no token can be had, without asking the service", async () => {
    const h = harness([status({})], {
      getToken: async () => {
        throw new Error("SECRET-AUTH-DETAIL");
      },
    });
    expect(await h.run()).toBe(1);
    expect(h.calls).toHaveLength(0);
    expect([...h.out, ...h.err].join("\n")).not.toContain("SECRET");
  });

  it("exits 2 when the CRM is not configured for the service", async () => {
    const noUrl = harness([status({})]);
    expect(await noUrl.run({ baseUrl: undefined })).toBe(2);
    const noClient = harness([status({})]);
    expect(await noClient.run({ tokens: null })).toBe(2);
    expect(noUrl.calls).toHaveLength(0);
    expect(noClient.calls).toHaveLength(0);
  });
});
