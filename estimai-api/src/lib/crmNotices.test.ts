/**
 * Unit tests for the crm-api estimate notice client (close/reopen push).
 * The network and the token provider are injected stubs — this module IS the
 * boundary under test.
 */

import { describe, it, expect, afterEach } from "bun:test";

process.env["DATABASE_URL"] ??= "postgresql://test:test@localhost:5435/test";
process.env["ALLOWED_ORIGINS"] ??= "http://localhost:5173";
process.env["AUTH_JWKS_URL"] ??= "http://localhost:3001/auth/jwks";
process.env["AUTH_ISSUER"] ??= "http://localhost:3001";
process.env["AUTH_AUDIENCE"] ??= "operai-suite";
process.env["AUTH_BASE_URL"] ??= "http://localhost:3001";
process.env["NODE_ENV"] = "test";
process.env["NOTIFY_INTERNAL_URL"] ??= "http://localhost:8081";
process.env["SERVICE_CLIENT_ID"] ??= "estimai-api";
process.env["SERVICE_CLIENT_SECRET"] ??= "test-service-client-secret-at-least-32-characters";

const { createCrmNoticeClient, sendEstimateNotice: defaultSend } = await import("./crmNotices");
const { ServiceTokenError } = await import("./serviceToken");
type ServiceTokenProvider = import("./serviceToken").ServiceTokenProvider;
type EstimateNotice = import("./crmNotices").EstimateNotice;

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

const TOKEN = "service-jwt-from-provider";

const notice: EstimateNotice = {
  estimateId: "est-1",
  event: "closed",
  version: 4,
  at: "2026-11-05T10:00:00.000Z",
  byUserId: "user-tech",
};

function harness(opts: { baseUrl?: string | undefined; tokens?: Partial<ServiceTokenProvider> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const invalidated: string[] = [];
  let impl: (call: number) => Promise<Response> | Response = () => new Response(null, { status: 204 });
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return impl(calls.length);
  }) as unknown as typeof fetch;
  const provider: ServiceTokenProvider = {
    getToken: opts.tokens?.getToken ?? (async () => TOKEN),
    invalidate: opts.tokens?.invalidate ?? ((t) => void invalidated.push(t)),
  };
  const send = createCrmNoticeClient({
    baseUrl: "baseUrl" in opts ? opts.baseUrl : "http://localhost:8084",
    tokens: provider,
    fetchImpl,
  });
  return { send, calls, invalidated, respond: (fn: typeof impl) => void (impl = fn) };
}

describe("crmNotices — POST /system/estimate-notices", () => {
  it("POSTs exactly the five contract fields with a Bearer service token, JSON, no redirects", async () => {
    const h = harness();

    await h.send(notice);

    expect(h.calls.length).toBe(1);
    const { url, init } = h.calls[0]!;
    expect(url).toBe("http://localhost:8084/system/estimate-notices");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      estimateId: "est-1",
      event: "closed",
      version: 4,
      at: "2026-11-05T10:00:00.000Z",
      byUserId: "user-tech",
    });
  });

  it("strips extra fields a caller might pass", async () => {
    const h = harness();
    await h.send({ ...notice, event: "reopened", name: "Secret client" } as unknown as EstimateNotice);
    const body = JSON.parse(h.calls[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["at", "byUserId", "estimateId", "event", "version"]);
    expect(body["event"]).toBe("reopened");
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const h = harness({ baseUrl: "http://crm-api.railway.internal:8084/" });
    await h.send(notice);
    expect(h.calls[0]!.url).toBe("http://crm-api.railway.internal:8084/system/estimate-notices");
  });

  it("treats any 2xx as success and logs nothing", async () => {
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    const h = harness();
    h.respond(() => new Response("{}", { status: 200 }));
    await h.send(notice);
    expect(logged).toEqual([]);
  });

  it("is a no-op when CRM_INTERNAL_URL is unset: no token, no request", async () => {
    let tokenRequests = 0;
    const h = harness({
      baseUrl: undefined,
      tokens: {
        getToken: async () => {
          tokenRequests++;
          return TOKEN;
        },
      },
    });

    await expect(h.send(notice)).resolves.toBeUndefined();

    expect(h.calls.length).toBe(0);
    expect(tokenRequests).toBe(0);
  });

  it("on one 401 drops the cached token and retries once with a fresh one", async () => {
    let issued = 0;
    const h = harness({ tokens: { getToken: async () => `tok-${++issued}` } });
    h.respond((call) => new Response(null, { status: call === 1 ? 401 : 204 }));

    await h.send(notice);

    expect(h.calls.length).toBe(2);
    expect((h.calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect((h.calls[1]!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-2");
    expect(h.invalidated).toEqual(["tok-1"]);
  });

  it("does not loop on a second 401: logs the status and stops after two requests", async () => {
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    const h = harness();
    h.respond(() => new Response(null, { status: 401 }));

    await expect(h.send(notice)).resolves.toBeUndefined();

    expect(h.calls.length).toBe(2);
    expect(logged.join("\n")).toContain("HTTP 401");
  });

  it("never throws on a non-2xx response, and logs the status only (no body, no token)", async () => {
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    const h = harness();
    h.respond(() => new Response("secret-looking-body", { status: 500 }));

    await expect(h.send(notice)).resolves.toBeUndefined();

    const log = logged.join("\n");
    expect(log).toContain("HTTP 500");
    expect(log).toContain("NOT rolled back");
    expect(log).not.toContain("secret-looking-body");
    expect(log).not.toContain(TOKEN);
  });

  it("never throws on a network failure or timeout", async () => {
    console.error = () => {};
    const h = harness();
    h.respond(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await expect(h.send(notice)).resolves.toBeUndefined();
  });

  it("resolves, logs and sends nothing when the token provider rejects", async () => {
    const logged: string[] = [];
    console.error = (...args: unknown[]) => void logged.push(args.join(" "));
    const h = harness({
      tokens: {
        getToken: async () => {
          throw new ServiceTokenError("auth /system/service-token responded with HTTP 503");
        },
      },
    });

    await expect(h.send(notice)).resolves.toBeUndefined();

    expect(h.calls.length).toBe(0);
    expect(logged.join("\n")).toContain("HTTP 503");
  });

  it("the default instance (provider disabled under NODE_ENV=test, or no URL) makes no request", async () => {
    console.error = () => {};
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(defaultSend(notice)).resolves.toBeUndefined();

    expect(requests).toBe(0);
  });
});
