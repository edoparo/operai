/**
 * Unit tests for the invitation email client (T7, specs/20261013-notify-service-credentials — refs AC-1.4,
 * AC-4.3, AC-5.2; ADR 20261013-auth-mints-own-service-credential-in-process): the call carries `auth`'s own service JWT as a
 * Bearer token, never the retired shared token, and every failure is
 * surfaced as `{ status: "failed" }` instead of a throw.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const { env } = await import("./env");
const { sendInvitationEmail, setNotifyTokenProvider } = await import("./notify");

const INPUT = {
  to: "new.hire@example.com",
  template: "invitation",
  inviteUrl: "https://auth.example/invite?token=abc",
  inviterName: "Ada Admin",
  expiresAt: "2026-11-01T00:00:00.000Z",
} as const;

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(respond: () => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
}

const sentResponse = () => Response.json({ deliveryId: "del_1", status: "sent" });

beforeEach(() => {
  setNotifyTokenProvider({ getToken: async () => "provider-token", invalidate: () => {} });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("sendInvitationEmail", () => {
  test("sends Authorization: Bearer <provider token> and no X-Internal-Token", async () => {
    stubFetch(sentResponse);
    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "sent", deliveryId: "del_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${env.NOTIFY_INTERNAL_URL}/system/emails`);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer provider-token");
    expect(headers.has("x-internal-token")).toBe(false);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      to: INPUT.to,
      template: INPUT.template,
      data: { inviteUrl: INPUT.inviteUrl, inviterName: INPUT.inviterName, expiresAt: INPUT.expiresAt },
    });
  });

  test("a provider failure returns failed and never calls notify-api", async () => {
    setNotifyTokenProvider({
      getToken: async () => {
        throw new Error("signer unavailable");
      },
      invalidate: () => {},
    });
    stubFetch(sentResponse);

    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "failed", error: "Error" });
    expect(calls).toHaveLength(0);
  });

  test("no configured provider returns failed and never calls notify-api", async () => {
    setNotifyTokenProvider(undefined);
    stubFetch(sentResponse);

    const result = await sendInvitationEmail(INPUT);

    expect(result.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  test("a non-2xx response returns failed with the status code", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    expect(await sendInvitationEmail(INPUT)).toEqual({
      status: "failed",
      error: "notify-api responded with HTTP 401",
    });
  });

  test("a network error returns failed", async () => {
    stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(await sendInvitationEmail(INPUT)).toEqual({ status: "failed", error: "Error" });
  });

  test("an unexpected 200 body returns failed", async () => {
    stubFetch(() => Response.json({ status: "queued" }));
    const result = await sendInvitationEmail(INPUT);
    expect(result.status).toBe("failed");
  });
});

describe("sendInvitationEmail — one retry on 401 (AC-4.3, ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired)", () => {
  function sequencedProvider() {
    const issued: string[] = [];
    const invalidated: string[] = [];
    let n = 0;
    setNotifyTokenProvider({
      getToken: async () => {
        const token = `token-${++n}`;
        issued.push(token);
        return token;
      },
      invalidate: (token) => void invalidated.push(token),
    });
    return { issued, invalidated };
  }

  test("a 401 drops the cached token and retries once with a fresh one", async () => {
    const { issued, invalidated } = sequencedProvider();
    let attempt = 0;
    stubFetch(() => (++attempt === 1 ? new Response("expired", { status: 401 }) : sentResponse()));

    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "sent", deliveryId: "del_1" });
    expect(calls).toHaveLength(2);
    expect(invalidated).toEqual(["token-1"]);
    expect(issued).toEqual(["token-1", "token-2"]);
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer token-1");
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer token-2");
  });

  test("two 401s stay failed after exactly two requests, and the token is never in the error", async () => {
    const { invalidated } = sequencedProvider();
    stubFetch(() => new Response("nope", { status: 401 }));

    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "failed", error: "notify-api responded with HTTP 401" });
    expect(calls).toHaveLength(2);
    expect(invalidated).toEqual(["token-1"]);
    expect(JSON.stringify(result)).not.toContain("token-");
  });

  test("a non-401 failure is never retried", async () => {
    const { invalidated } = sequencedProvider();
    stubFetch(() => new Response("boom", { status: 503 }));

    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "failed", error: "notify-api responded with HTTP 503" });
    expect(calls).toHaveLength(1);
    expect(invalidated).toEqual([]);
  });

  test("a provider failure on the retry mint is a failed result, not a throw", async () => {
    let n = 0;
    setNotifyTokenProvider({
      getToken: async () => {
        if (++n === 2) throw new Error("signer unavailable");
        return "token-1";
      },
      invalidate: () => {},
    });
    stubFetch(() => new Response("expired", { status: 401 }));

    const result = await sendInvitationEmail(INPUT);

    expect(result).toEqual({ status: "failed", error: "Error" });
    expect(calls).toHaveLength(1);
  });
});

// ─── pushSystemNotification (specs/20261105-signup-gate T4, AC-4.1, AC-4.3; ADR 20261105-auth-pushes-admin-notifications) ─────────

const { pushSystemNotification } = await import("./notify");

const PUSH = {
  recipientId: "usr_admin_1",
  originApp: "admin",
  severity: "info",
  title: "Access request from Ada",
  body: "ada@welld.ch asked to join Operai.",
  link: { href: "/admin/users/access-requests" },
  email: true,
} as const;

describe("pushSystemNotification", () => {
  test("POSTs the body to /system/notifications with the provider's Bearer token", async () => {
    stubFetch(() => Response.json({ id: "n1" }, { status: 201 }));
    const result = await pushSystemNotification(PUSH);

    expect(result).toEqual({ status: "sent" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${env.NOTIFY_INTERNAL_URL}/system/notifications`);
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer provider-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(PUSH);
  });

  test("a 500 resolves to failed with the status, never throws", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    expect(await pushSystemNotification(PUSH)).toEqual({ status: "failed", error: "notify-api responded with HTTP 500" });
    expect(calls).toHaveLength(1);
  });

  test("a network error resolves to failed", async () => {
    stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    expect(await pushSystemNotification(PUSH)).toEqual({ status: "failed", error: "Error" });
  });

  test("a timeout resolves to failed instead of hanging", async () => {
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
      })) as typeof fetch;
    const result = await pushSystemNotification(PUSH, { timeoutMs: 20 });
    expect(result.status).toBe("failed");
  });

  test("a mint failure resolves to failed and never calls notify-api", async () => {
    setNotifyTokenProvider({
      getToken: async () => {
        throw new Error("signer unavailable");
      },
      invalidate: () => {},
    });
    stubFetch(() => Response.json({}, { status: 201 }));
    expect(await pushSystemNotification(PUSH)).toEqual({ status: "failed", error: "Error" });
    expect(calls).toHaveLength(0);
  });

  test("a 401 drops the token and retries once with a fresh one", async () => {
    const invalidated: string[] = [];
    let n = 0;
    setNotifyTokenProvider({ getToken: async () => `token-${++n}`, invalidate: (t) => void invalidated.push(t) });
    let attempt = 0;
    stubFetch(() => (++attempt === 1 ? new Response("expired", { status: 401 }) : Response.json({}, { status: 201 })));

    expect(await pushSystemNotification(PUSH)).toEqual({ status: "sent" });
    expect(calls).toHaveLength(2);
    expect(invalidated).toEqual(["token-1"]);
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe("Bearer token-2");
  });
});

describe("notify client never returns a raw error message (specs/20261105-signup-gate T14)", () => {
  test("a network error carrying the internal host reports only the error name", async () => {
    setNotifyTokenProvider({ getToken: async () => "tok", invalidate: () => {} });
    stubFetch(() => {
      throw new TypeError("Unable to connect to http://notify.railway.internal:8081/system/emails");
    });
    const email = await sendInvitationEmail(INPUT);
    const push = await pushSystemNotification(PUSH);
    for (const result of [email, push]) {
      expect(result).toEqual({ status: "failed", error: "TypeError" });
      expect(JSON.stringify(result)).not.toContain("railway.internal");
    }
  });
});
