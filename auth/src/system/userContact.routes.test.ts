/**
 * Integration tests for POST /system/users/contact (T2, specs/019-crm-
 * notifications — plan.md "auth — POST /system/users/contact"; D-1, D-2).
 *
 * Route logic with an injected key source backed by a throwaway in-memory
 * RS256 key (this file must not depend on `auth.config`; see the "WHY A
 * FACTORY" note in userContact.routes.ts). The REAL key source — better-auth's
 * published key set — is `src/auth/user-contact.contract.test.ts`.
 *
 * DB: user fixtures are created and removed here; assertions look only at this
 * run's ids. Each request uses its own `X-Forwarded-For` so the in-process
 * rate limiter never couples tests together (the limiter test uses its own router).
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { db } from "../lib/db";

const { env } = await import("../lib/env");
const { createUserContactRouter } = await import("./userContact.routes");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");
const KID = "test-kid";
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" }] });

const router = createUserContactRouter({ getJwks: async () => jwks });

const SERVICE_AUDIENCE = "operai-user-contact-test";
const URL_PATH = "/system/users/contact";
const RUN_ID = crypto.randomUUID().slice(0, 8);

// TRANSITIONAL (specs/029 T14): the retired address-keyed default; replaced by the AC-7.x rows in T15/T16.
const LEGACY_ADDRESS_LIMIT = 20;

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { audience: env.SERVICE_AUDIENCE };
const userIds: string[] = [];

let activeId = "";
let deletedId = "";
const activeEmail = `t2-active-${RUN_ID}@operai.test`;

beforeAll(async () => {
  mutableEnv["SERVICE_AUDIENCE"] = SERVICE_AUDIENCE;
  const active = await db.user.create({ data: { name: `T2 Active ${RUN_ID}`, email: activeEmail } });
  const deleted = await db.user.create({
    data: { name: `T2 Deleted ${RUN_ID}`, email: `t2-deleted-${RUN_ID}@operai.test`, deletedAt: new Date() },
  });
  activeId = active.id;
  deletedId = deleted.id;
  userIds.push(active.id, deleted.id);
});
afterAll(async () => {
  mutableEnv["SERVICE_AUDIENCE"] = saved.audience;
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

let logSpy: ReturnType<typeof spyOn<Console, "log">> | undefined;
afterEach(() => logSpy?.mockRestore());

const sign = async (
  opts: {
    sub?: string;
    aud?: string;
    scope?: string | undefined;
    iss?: string;
    signer?: CryptoKey;
    exp?: number;
  } = {},
): Promise<string> => {
  const claims: Record<string, unknown> = {};
  if (!("scope" in opts) || opts.scope !== undefined) claims["scope"] = opts.scope ?? "users.contact";
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(opts.iss ?? env.BETTER_AUTH_URL)
    .setSubject(opts.sub ?? "system:notify-api")
    .setAudience(opts.aud ?? SERVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(opts.signer ?? privateKey);
};

let ipCounter = 0;
const freshIp = () => `203.0.114.${(ipCounter += 1)}`;

const post = async (body: unknown, token?: string | null, ip = freshIp(), raw = false) => {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Forwarded-For": ip };
  const t = token === undefined ? await sign() : token;
  if (t) headers["Authorization"] = `Bearer ${t}`;
  return router.request(URL_PATH, {
    method: "POST",
    headers,
    body: raw ? (body as string) : JSON.stringify(body),
  });
};

describe("POST /system/users/contact — lookup", () => {
  test("200 { id, email, name } for an active user, never cached", async () => {
    const res = await post({ userId: activeId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: activeId, email: activeEmail, name: `T2 Active ${RUN_ID}` });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("404 for an unknown user and for a soft-deleted one, with byte-identical bodies", async () => {
    const unknown = await post({ userId: `nope-${RUN_ID}` });
    const deleted = await post({ userId: deletedId });
    expect(unknown.status).toBe(404);
    expect(deleted.status).toBe(404);
    expect(await deleted.text()).toBe(await unknown.text());
  });
});

describe("POST /system/users/contact — credential (every failure is the same 401)", () => {
  const cases: [string, () => Promise<string | null>][] = [
    ["a missing header", async () => null],
    ["a user JWT (aud AUTH_AUDIENCE)", () => sign({ aud: env.AUTH_AUDIENCE })],
    ["a wrong audience", () => sign({ aud: "someone-else" })],
    ["a missing scope claim", () => sign({ scope: undefined })],
    ["another service scope", () => sign({ scope: "notifications.push emails.send" })],
    ["a sub without the system: prefix", () => sign({ sub: "user-123" })],
    ["a bare system: sub", () => sign({ sub: "system:" })],
    ["a wrong issuer", () => sign({ iss: "https://evil.example" })],
    ["a signature from another keypair", () => sign({ signer: stranger.privateKey })],
    ["an expired token", () => sign({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["garbage", async () => "not-a-jwt"],
  ];

  test("all failures return the same status and body", async () => {
    const bodies = new Set<string>();
    for (const [label, make] of cases) {
      const res = await post({ userId: activeId }, await make());
      expect({ label, status: res.status }).toEqual({ label, status: 401 });
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });

  test("scope is matched as a space-delimited entry, not a substring", async () => {
    const res = await post({ userId: activeId }, await sign({ scope: "emails.send users.contact.extra" }));
    expect(res.status).toBe(401);
    const ok = await post({ userId: activeId }, await sign({ scope: "emails.send users.contact" }));
    expect(ok.status).toBe(200);
  });

  test("with SERVICE_AUDIENCE unset nothing is accepted (fail closed)", async () => {
    const token = await sign();
    mutableEnv["SERVICE_AUDIENCE"] = undefined;
    try {
      expect((await post({ userId: activeId }, token)).status).toBe(401);
    } finally {
      mutableEnv["SERVICE_AUDIENCE"] = SERVICE_AUDIENCE;
    }
  });

  test("a bad body without a credential is a 401, not a 400", async () => {
    expect((await post({}, null)).status).toBe(401);
  });
});

describe("POST /system/users/contact — body validation", () => {
  test.each([
    ["an empty object", {}],
    ["an empty userId", { userId: "" }],
    ["a 201-char userId", { userId: "x".repeat(201) }],
    ["a non-string userId", { userId: 5 }],
    ["an extra field", { userId: "abc", email: "a@b.c" }],
  ])("400 Problem JSON for %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { status: number }).status).toBe(400);
  });

  test("a 200-char userId is accepted (404, unknown)", async () => {
    expect((await post({ userId: "x".repeat(200) })).status).toBe(404);
  });

  test("malformed JSON is a 400", async () => {
    expect((await post("{nope", undefined, freshIp(), true)).status).toBe(400);
  });
});

describe("POST /system/users/contact — logging", () => {
  test("one line per accepted call with caller and found, never id, email or name", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    await post({ userId: activeId });
    await post({ userId: deletedId });
    const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[system]"));
    expect(lines).toEqual([
      "[system] users.contact caller=system:notify-api found=true",
      "[system] users.contact caller=system:notify-api found=false",
    ]);
    const all = JSON.stringify(logSpy.mock.calls);
    for (const secret of [activeId, deletedId, activeEmail, "T2 Active"]) expect(all).not.toContain(secret);
  });

  test("a rejected call logs no [system] line", async () => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    await post({ userId: activeId }, null);
    expect(logSpy.mock.calls.filter((c) => String(c[0]).startsWith("[system]"))).toHaveLength(0);
  });
});

describe("POST /system/users/contact — rate limit", () => {
  test("429 with Retry-After once the per-address limit is spent, like /system/service-token", async () => {
    const limited = createUserContactRouter({ getJwks: async () => jwks });
    const ip = "198.51.100.77";
    const token = await sign();
    const call = () =>
      limited.request(URL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: activeId }),
      });
    for (let i = 0; i < LEGACY_ADDRESS_LIMIT; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(((await res.json()) as { code: string }).code).toBe("rate_limited");
  });
});
