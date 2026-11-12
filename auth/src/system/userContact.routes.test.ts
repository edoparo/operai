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
 * run's ids. Requests of the older rows use their own `X-Forwarded-For` so the
 * shared per-address count never couples tests together; the limit rows (AC-7.x,
 * specs/029 US-7, ADR-0086) build their own router with an injected clock and
 * send NO `X-Forwarded-For` unless the row is about the address.
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { SystemRateLimitConfig } from "./systemRateLimits";
import { db } from "../lib/db";

const { env } = await import("../lib/env");
const { createUserContactRouter, jwksFromAuth } = await import("./userContact.routes");
const { createServiceTokenRouter } = await import("./serviceToken.routes");
const { createSystemRateLimits } = await import("./systemRateLimits");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");
const KID = "test-kid";
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" }] });

const router = createUserContactRouter({ getJwks: async () => jwks, limits: createSystemRateLimits() });

const SERVICE_AUDIENCE = "operai-user-contact-test";
const URL_PATH = "/system/users/contact";
const RUN_ID = crypto.randomUUID().slice(0, 8);

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

// ─── specs/029 US-7 (ADR-0086): verify first, then exactly one count ─────────────────────────────

const WINDOW_MS = 600_000;

/** A router with its own limits and clock; the DB lookup is counted through a spy. */
function limitedRouter(config: Partial<SystemRateLimitConfig> = {}) {
  let t = 8_000_000;
  const limits = createSystemRateLimits({ now: () => t, config });
  // Prisma's model delegates are proxies that hand out a fresh function per access, so a method spy never
  // sees a call; wrap the delegate itself and count reads of `findFirst`.
  const realUser = db.user;
  let lookups = 0;
  Object.defineProperty(db, "user", {
    value: new Proxy(realUser, {
      get(target, key, receiver) {
        if (key === "findFirst") lookups += 1;
        return Reflect.get(target, key, receiver);
      },
    }),
    configurable: true,
    writable: true,
  });
  const r = createUserContactRouter({ getJwks: async () => jwks, limits });
  const call = (body: unknown, token: string | null, ip?: string, raw = false) =>
    r.request(URL_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
      body: raw ? (body as string) : JSON.stringify(body),
    });
  return {
    call,
    limits,
    router: r,
    lookups: () => lookups,
    advance: (ms: number) => (t += ms),
    now: () => t,
    done: () => Object.defineProperty(db, "user", { value: realUser, configurable: true, writable: true }),
  };
}

describe("POST /system/users/contact — per-service allowance (AC-7.2, AC-7.3, AC-7.4)", () => {
  test("AC-7.2: 600 lookups of active users inside one window, no forwarded address — 600 x 200 with {id,email,name}", async () => {
    const r = limitedRouter();
    try {
      const token = await sign();
      for (let i = 0; i < 600; i++) {
        const res = await r.call({ userId: activeId }, token);
        expect(res.status).toBe(200);
        if (i === 0 || i === 599)
          expect(await res.json()).toEqual({ id: activeId, email: activeEmail, name: `T2 Active ${RUN_ID}` });
        r.advance(1);
      }
      expect(r.lookups()).toBe(600);
    } finally {
      r.done();
    }
  });

  test("AC-7.4: the 601st is the shared 429, Retry-After 600, no database read; a malformed body over the allowance is 429, not 400; recovery on its own", async () => {
    const r = limitedRouter();
    try {
      const token = await sign();
      for (let i = 0; i < 600; i++) await r.call({ userId: activeId }, token);
      const first = r.now();
      expect(r.lookups()).toBe(600);

      const over = await r.call({ userId: activeId }, token);
      expect(over.status).toBe(429);
      expect(over.headers.get("Retry-After")).toBe("600");
      expect(((await over.json()) as { code: string }).code).toBe("rate_limited");
      expect((await r.call("{nope", token, undefined, true)).status).toBe(429);
      expect((await r.call({}, token)).status).toBe(429);
      for (let i = 0; i < 10; i++) {
        r.advance(10_000);
        expect((await r.call({ userId: activeId }, token)).status).toBe(429);
      }
      expect(r.lookups()).toBe(600);
      r.advance(first + WINDOW_MS - r.now());
      expect((await r.call({ userId: activeId }, token)).status).toBe(200);
    } finally {
      r.done();
    }
  });

  test("AC-7.3: when principal A has spent its allowance, principal B (also users.contact) is answered exactly as before — 200 and 404", async () => {
    const r = limitedRouter({ usersContactLimit: 3 });
    try {
      const a = await sign({ sub: "system:svc-a" });
      const b = await sign({ sub: "system:svc-b" });
      for (let i = 0; i < 3; i++) expect((await r.call({ userId: activeId }, a)).status).toBe(200);
      expect((await r.call({ userId: activeId }, a)).status).toBe(429);

      const ok = await r.call({ userId: activeId }, b);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ id: activeId, email: activeEmail, name: `T2 Active ${RUN_ID}` });
      const missing = await r.call({ userId: deletedId }, b);
      expect(missing.status).toBe(404);
    } finally {
      r.done();
    }
  });
});

describe("POST /system/users/contact — invalid credentials by source (AC-7.5, AC-7.6)", () => {
  const invalidTokens: [string, () => Promise<string | null>][] = [
    ["a bad signature", () => sign({ signer: stranger.privateKey })],
    ["an expired token", () => sign({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["a wrong audience", () => sign({ aud: "someone-else" })],
    ["a user JWT", () => sign({ aud: env.AUTH_AUDIENCE })],
    ["a genuine service JWT without users.contact", () => sign({ scope: "notifications.push" })],
    ["no header", async () => null],
  ];

  test("AC-7.5: 20 invalid requests of every kind are the frozen 401; the 21st is 429; at the same instant a valid credential is 200 (also from \"direct\")", async () => {
    for (const ip of ["198.51.100.40", undefined]) {
      const r = limitedRouter();
      try {
        const good = await sign();
        for (let i = 0; i < 20; i++) {
          const [label, make] = invalidTokens[i % invalidTokens.length]!;
          const res = await r.call({ userId: activeId }, await make(), ip);
          expect({ label, status: res.status }).toEqual({ label, status: 401 });
          if (i % 2 === 0) expect((await r.call({ userId: activeId }, good, ip)).status).toBe(200); // valid ones do not count
        }
        for (let i = 0; i < invalidTokens.length; i++) {
          const res = await r.call({ userId: activeId }, await invalidTokens[i]![1](), ip);
          expect(res.status).toBe(429);
        }
        expect((await r.call({ userId: activeId }, good, ip)).status).toBe(200);
        expect((await r.call({ userId: deletedId }, good, ip)).status).toBe(404);
      } finally {
        r.done();
      }
    }
  });

  test("a 429 for an invalid credential reads no user; neither does a 401", async () => {
    const r = limitedRouter({ invalidLimit: 1 });
    try {
      expect((await r.call({ userId: activeId }, "not-a-jwt")).status).toBe(401);
      expect((await r.call({ userId: activeId }, "not-a-jwt")).status).toBe(429);
      expect(r.lookups()).toBe(0);
    } finally {
      r.done();
    }
  });

  test("refused invalid requests do not extend the period", async () => {
    const r = limitedRouter({ invalidLimit: 2 });
    try {
      await r.call({ userId: activeId }, null);
      await r.call({ userId: activeId }, null);
      const first = r.now();
      for (let i = 0; i < 5; i++) {
        r.advance(100_000);
        expect((await r.call({ userId: activeId }, null)).status).toBe(429);
      }
      r.advance(first + WINDOW_MS - r.now());
      expect((await r.call({ userId: activeId }, null)).status).toBe(401);
    } finally {
      r.done();
    }
  });

  test("AC-7.5: ONE invalid count for both endpoints — 10 invalid service-token + 10 invalid lookups from one address make the next invalid request to either a 429", async () => {
    const limits = createSystemRateLimits({ now: () => 9_000_000 });
    const contact = createUserContactRouter({ getJwks: async () => jwks, limits });
    const tokens = createServiceTokenRouter({ signJwt: async () => "x", limits });
    const ip = "198.51.100.50";
    const badToken = (n: number) =>
      tokens.request("/system/service-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ clientId: `nobody-${n}`, clientSecret: "x".repeat(40) }),
      });
    const badLookup = () =>
      contact.request(URL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify({ userId: activeId }),
      });
    for (let i = 0; i < 10; i++) expect((await badToken(i)).status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await badLookup()).status).toBe(401);
    expect((await badLookup()).status).toBe(429);
    expect((await badToken(99)).status).toBe(429);
  });

  test("AC-7.6(a): the invalid-flood 429 and the exhausted-service 429 are identical in status, body bytes and headers", async () => {
    const r = limitedRouter({ usersContactLimit: 1, invalidLimit: 1 });
    try {
      const token = await sign();
      await r.call({ userId: activeId }, token);
      r.advance(300_000); // the two buckets start 5 minutes apart
      await r.call({ userId: activeId }, null);
      const service = await r.call({ userId: activeId }, token);
      const invalid = await r.call({ userId: activeId }, null);
      expect(service.status).toBe(429);
      expect(invalid.status).toBe(429);
      expect(await invalid.text()).toBe(await service.text());
      const headers = (res: Response) => [...res.headers].filter(([k]) => k !== "date").sort();
      expect(headers(invalid)).toEqual(headers(service));
    } finally {
      r.done();
    }
  });

  test("AC-7.6(b): with the service's allowance exhausted, an invalid token is still the frozen 401 (allowance state never decides an invalid answer)", async () => {
    const r = limitedRouter({ usersContactLimit: 1 });
    try {
      const token = await sign();
      await r.call({ userId: activeId }, token);
      expect((await r.call({ userId: activeId }, token)).status).toBe(429);
      const bad = await r.call({ userId: activeId }, await sign({ signer: stranger.privateKey }));
      expect(bad.status).toBe(401);
      expect(await bad.text()).toBe(await (await limitedRouter().call({ userId: activeId }, null)).text());
    } finally {
      r.done();
    }
  });
});

describe("POST /system/users/contact — key set cache and token cap (AC-7.5 bound on the work, R12/R16)", () => {
  const publicJwk = async (kid: string) => ({ ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" });
  const signWithKid = (kid: string, scope = "users.contact") =>
    new SignJWT({ scope })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(env.BETTER_AUTH_URL)
      .setSubject("system:notify-api")
      .setAudience(SERVICE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
      .sign(privateKey);

  function cachedRouter(keys: () => Promise<unknown[]>) {
    let reads = 0;
    let t = 1_000_000;
    const getJwks = jwksFromAuth(
      {
        api: {
          getJwks: async () => {
            reads += 1;
            return { keys: await keys() };
          },
        },
      },
      { now: () => t },
    );
    const limits = createSystemRateLimits({ now: () => t, config: { invalidLimit: 1_000_000 } });
    const r = createUserContactRouter({ getJwks, limits });
    const call = (token: string) =>
      r.request(URL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: `nope-${RUN_ID}` }),
      });
    return { call, reads: () => reads, advance: (ms: number) => (t += ms) };
  }

  test("100 verifications read the key set once", async () => {
    const c = cachedRouter(async () => [await publicJwk(KID)]);
    for (let i = 0; i < 100; i++) expect((await c.call(await signWithKid(KID))).status).toBe(404);
    expect(c.reads()).toBe(1);
  });

  test("an unknown kid re-reads once; a flood of unknown kids re-reads at most once per 30 s", async () => {
    const c = cachedRouter(async () => [await publicJwk(KID)]);
    await c.call(await signWithKid(KID));
    expect(c.reads()).toBe(1);
    for (let i = 0; i < 50; i++) expect((await c.call(await signWithKid(`unknown-${i}`))).status).toBe(401);
    expect(c.reads()).toBe(1); // within the cooldown of the first read: no re-read at all
    c.advance(30_000);
    for (let i = 0; i < 50; i++) expect((await c.call(await signWithKid(`unknown-b${i}`))).status).toBe(401);
    expect(c.reads()).toBe(2);
    c.advance(10_000);
    await c.call(await signWithKid("unknown-c"));
    expect(c.reads()).toBe(2);
    c.advance(20_000);
    await c.call(await signWithKid("unknown-d"));
    expect(c.reads()).toBe(3);
  });

  test("a key added later is picked up at the first token that uses it after the cooldown", async () => {
    let rotated = false;
    const c = cachedRouter(async () => (rotated ? [await publicJwk(KID), await publicJwk("kid-2")] : [await publicJwk(KID)]));
    expect((await c.call(await signWithKid(KID))).status).toBe(404);
    rotated = true;
    c.advance(31_000);
    expect((await c.call(await signWithKid("kid-2"))).status).toBe(404); // verified: 404 = the lookup ran
    expect(c.reads()).toBe(2);
    expect((await c.call(await signWithKid("kid-2"))).status).toBe(404);
    expect(c.reads()).toBe(2);
  });

  test("a failed read is not retried per request: the cooldown applies, requests are 401, and it recovers", async () => {
    let failing = true;
    const c = cachedRouter(async () => {
      if (failing) throw new Error("db down");
      return [await publicJwk(KID)];
    });
    const token = await signWithKid(KID);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 20; i++) expect((await c.call(token)).status).toBe(401);
      expect(c.reads()).toBe(1);
      failing = false;
      c.advance(30_000);
      expect((await c.call(token)).status).toBe(404);
      expect(c.reads()).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  test("a token over 4 096 characters is a 401 with no key-set read", async () => {
    const c = cachedRouter(async () => [await publicJwk(KID)]);
    const res = await c.call("a".repeat(4097));
    expect(res.status).toBe(401);
    expect(c.reads()).toBe(0);
    // exactly at the cap is still examined (then fails as garbage)
    expect((await c.call("a".repeat(4096))).status).toBe(401);
  });
});
