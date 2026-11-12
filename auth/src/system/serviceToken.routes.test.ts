/**
 * Integration tests for POST /system/service-token (T4, specs/015-hardware-
 * inventory — refs AC-2.8, AC-2.9; ADR-0044).
 *
 * Route logic only, with an injected signer backed by a throwaway in-memory
 * RS256 key: this file must not depend on `auth.config` (see the "WHY A
 * FACTORY" note in serviceToken.routes.ts). The REAL signing path — better-
 * auth's jwt plugin, the published `/auth/jwks`, notify-api's verification
 * options, rejection on user routes — is the R-4 contract test,
 * `src/auth/service-token.contract.test.ts`.
 *
 * `env` is mutated per file and restored in `afterAll` — the module is shared
 * across the whole `bun test` process, so env set at import time would depend
 * on file order. Invalid-credential requests use their own `X-Forwarded-For` so the
 * shared per-address count never couples tests together; the limit rows
 * (AC-7.x, specs/029 US-7, ADR-0086) each build their own router with an injected
 * clock and send NO `X-Forwarded-For` unless the row is about the address.
 *
 * Secrets here are obvious dummies.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import type { ServiceJwtPayload } from "./serviceToken.routes";
import type { SystemRateLimitConfig } from "./systemRateLimits";

const { env } = await import("../lib/env");
const { createServiceTokenRouter } = await import("./serviceToken.routes");
const { createSystemRateLimits } = await import("./systemRateLimits");
const serviceClientsModule = await import("./serviceClients");

// Throwaway key, generated in memory for this file only.
const { publicKey, privateKey } = await generateKeyPair("RS256");
const KID = "test-kid";
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" }] });

/** Signs the way the jwt plugin does: exactly the payload claims, RS256 + kid. */
const signJwt = async (payload: ServiceJwtPayload): Promise<string> =>
  new SignJWT({ scope: payload.scope })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(payload.iss)
    .setSubject(payload.sub)
    .setAudience(payload.aud)
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .setJti(payload.jti)
    .sign(privateKey);

const serviceTokenRouter = createServiceTokenRouter({ signJwt, limits: createSystemRateLimits() });

const SERVICE_AUDIENCE = "operai-service-routes-test";
const SECRET = "dummy-routes-secret-0123456789-abcdefgh";
const URL_PATH = "/system/service-token";

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { audience: env.SERVICE_AUDIENCE, clients: env.SERVICE_CLIENTS };

const configure = (audience: string | undefined, clients: Map<string, unknown>) => {
  mutableEnv["SERVICE_AUDIENCE"] = audience;
  mutableEnv["SERVICE_CLIENTS"] = clients;
};
const validClients = () =>
  new Map([["inventory-api", { secret: SECRET, scopes: ["notifications.push"] }]]);

beforeAll(() => configure(SERVICE_AUDIENCE, validClients()));
afterAll(() => {
  mutableEnv["SERVICE_AUDIENCE"] = saved.audience;
  mutableEnv["SERVICE_CLIENTS"] = saved.clients;
});

let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter += 1)}`;

const post = (body: unknown, ip = freshIp(), raw = false) =>
  serviceTokenRouter.request(URL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: raw ? (body as string) : JSON.stringify(body),
  });

const good = { clientId: "inventory-api", clientSecret: SECRET };

describe("POST /system/service-token — success (AC-2.8)", () => {
  test("returns { token, expiresInSeconds: 300 } and never lets the response be cached", async () => {
    const res = await post(good);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(300);
    expect(typeof body.token).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["expiresInSeconds", "token"]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("claims: sub system:<client>, aud SERVICE_AUDIENCE (not AUTH_AUDIENCE), scope, iss, 5-minute exp, unique jti", async () => {
    const before = Math.floor(Date.now() / 1000);
    const a = decodeJwt(((await (await post(good)).json()) as { token: string }).token);
    const b = decodeJwt(((await (await post(good)).json()) as { token: string }).token);
    const after = Math.floor(Date.now() / 1000);

    expect(a.sub).toBe("system:inventory-api");
    expect(a.aud).toBe(SERVICE_AUDIENCE);
    expect(a.aud).not.toBe(env.AUTH_AUDIENCE);
    expect(a["scope"]).toBe("notifications.push");
    expect(a.iss).toBe(env.BETTER_AUTH_URL);
    expect(a.iat).toBeGreaterThanOrEqual(before);
    expect(a.iat).toBeLessThanOrEqual(after);
    expect((a.exp as number) - (a.iat as number)).toBe(300);
    expect(a.jti).toBeTruthy();
    expect(a.jti).not.toBe(b.jti);
    // No user identity claims leak into a service token.
    for (const claim of ["email", "name", "image", "perm_epoch"]) {
      expect(claim in a).toBe(false);
    }
  });

  test("the token expires: verification fails once its exp has passed", async () => {
    const { token } = (await (await post(good)).json()) as { token: string };
    const exp = decodeJwt(token).exp as number;
    await expect(
      jwtVerify(token, jwks, {
        issuer: env.BETTER_AUTH_URL,
        audience: SERVICE_AUDIENCE,
        currentDate: new Date((exp + 1) * 1000),
      }),
    ).rejects.toThrow();
  });

  test("the scope comes from the client's own entry", async () => {
    // A second, differently-scoped-by-construction client: same allowlist, own entry.
    configure(SERVICE_AUDIENCE, new Map([["other-svc", { secret: SECRET, scopes: ["notifications.push"] }]]));
    try {
      const res = await post({ clientId: "other-svc", clientSecret: SECRET });
      const claims = decodeJwt(((await res.json()) as { token: string }).token);
      expect(claims.sub).toBe("system:other-svc");
    } finally {
      configure(SERVICE_AUDIENCE, validClients());
    }
  });
});

describe("POST /system/service-token — revoking one client (AC-1.6)", () => {
  test("with two clients configured, removing one gives 401 for it and 200 for the other", async () => {
    const other = { secret: "dummy-routes-other-0123456789-abcdefgh", scopes: ["emails.send"] };
    const both = () => new Map([...validClients(), ["refund-api", other]]);
    const otherCreds = { clientId: "refund-api", clientSecret: other.secret };

    configure(SERVICE_AUDIENCE, both());
    try {
      expect((await post(good)).status).toBe(200);
      expect((await post(otherCreds)).status).toBe(200);

      const remaining = both();
      remaining.delete("inventory-api");
      configure(SERVICE_AUDIENCE, remaining);

      expect((await post(good)).status).toBe(401);
      const stillThere = await post(otherCreds);
      expect(stillThere.status).toBe(200);
      const claims = decodeJwt(((await stillThere.json()) as { token: string }).token);
      expect(claims.sub).toBe("system:refund-api");
      expect(claims["scope"]).toBe("emails.send");
    } finally {
      configure(SERVICE_AUDIENCE, validClients());
    }
  });
});

describe("POST /system/service-token — authentication failures (AC-2.9)", () => {
  test("unknown client and wrong secret return the byte-identical 401 (status, headers that matter, body)", async () => {
    const unknown = await post({ clientId: "nobody", clientSecret: SECRET });
    const wrong = await post({ clientId: "inventory-api", clientSecret: "x".repeat(40) });
    const wrongShort = await post({ clientId: "inventory-api", clientSecret: "a" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrongShort.status).toBe(401);

    const [u, w, s] = await Promise.all([unknown.text(), wrong.text(), wrongShort.text()]);
    expect(u).toBe(w);
    expect(w).toBe(s);
    expect(unknown.headers.get("Content-Type")).toBe(wrong.headers.get("Content-Type"));
    expect(u).not.toContain("inventory-api");
    expect(u).not.toContain(SECRET);
    expect(u).not.toContain("token\":");
  });

  test("ids that exist on Object.prototype are just unknown clients", async () => {
    const reference = await (await post({ clientId: "nobody", clientSecret: SECRET })).text();
    for (const clientId of ["__proto__", "constructor", "toString"]) {
      const res = await post({ clientId, clientSecret: SECRET });
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(reference);
    }
  });

  test("with no clients configured every call is that same 401 — the endpoint authenticates nobody", async () => {
    const reference = await (await post({ clientId: "nobody", clientSecret: SECRET })).text();
    configure(undefined, new Map());
    try {
      const res = await post(good);
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(reference);
    } finally {
      configure(SERVICE_AUDIENCE, validClients());
    }
  });

  test("refuses to mint if the audience ever equals the user audience (defence in depth) — never a user-audience token", async () => {
    configure(env.AUTH_AUDIENCE, validClients());
    try {
      const res = await post(good);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await res.text()).not.toContain("eyJ");
    } finally {
      configure(SERVICE_AUDIENCE, validClients());
    }
  });

  test("a malformed body is a 400 Problem JSON, not a 401, and reveals nothing about clients", async () => {
    for (const body of [{}, { clientId: "inventory-api" }, { clientSecret: SECRET }, { clientId: 1, clientSecret: 2 }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json["status"]).toBe(400);
      expect(JSON.stringify(json)).not.toContain(SECRET);
    }
    expect((await post("{not json", freshIp(), true)).status).toBe(400);
  });

  test("oversized credentials are refused before any comparison (bounded work)", async () => {
    const res = await post({ clientId: "inventory-api", clientSecret: "z".repeat(5000) });
    expect(res.status).toBe(400);
  });
});


// ─── specs/029 US-7 (ADR-0086): verify first, then exactly one count ─────────────────────────────

const WINDOW_MS = 600_000;
const OTHER_SECRET = "dummy-routes-other-0123456789-abcdefgh";

/** A router with its own limits and clock, a counting signer, and no forwarded address unless asked. */
function limitedRouter(config: Partial<SystemRateLimitConfig> = {}) {
  let t = 7_000_000;
  const limits = createSystemRateLimits({ now: () => t, config });
  let signed = 0;
  const router = createServiceTokenRouter({
    signJwt: async (payload) => {
      signed += 1;
      return signJwt(payload);
    },
    limits,
  });
  const call = (body: unknown, ip?: string, raw = false) =>
    router.request(URL_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ip ? { "X-Forwarded-For": ip } : {}) },
      body: raw ? (body as string) : JSON.stringify(body),
    });
  return { call, limits, signed: () => signed, advance: (ms: number) => (t += ms), now: () => t };
}

const twoClients = () =>
  new Map([
    ["inventory-api", { secret: SECRET, scopes: ["notifications.push"] }],
    ["refund-api", { secret: OTHER_SECRET, scopes: ["emails.send"] }],
  ]);
const refundCreds = { clientId: "refund-api", clientSecret: OTHER_SECRET };

describe("POST /system/service-token — per-service allowance (AC-7.1, AC-7.3, AC-7.4)", () => {
  beforeAll(() => configure(SERVICE_AUDIENCE, twoClients()));
  afterAll(() => configure(SERVICE_AUDIENCE, validClients()));

  test("AC-7.1: a service mints 300 times inside one window with no forwarded address — 300 x 200, each a token", async () => {
    const r = limitedRouter();
    for (let i = 0; i < 300; i++) {
      const res = await r.call(good);
      expect(res.status).toBe(200);
      const { token } = (await res.json()) as { token: string };
      if (i === 0 || i === 299) expect(decodeJwt(token).sub).toBe("system:inventory-api");
      r.advance(1);
    }
    expect(r.signed()).toBe(300);
  });

  test("AC-7.4: the 301st is the shared 429 with Retry-After 600, nothing minted; retries do not extend it; recovery on its own", async () => {
    const r = limitedRouter();
    for (let i = 0; i < 300; i++) expect((await r.call(good)).status).toBe(200);
    const first = r.now();
    expect(r.signed()).toBe(300);

    const over = await r.call(good);
    expect(over.status).toBe(429);
    expect(over.headers.get("Retry-After")).toBe("600");
    expect(r.signed()).toBe(300);
    for (let i = 0; i < 10; i++) {
      r.advance(10_000);
      expect((await r.call(good)).status).toBe(429);
    }
    expect(r.signed()).toBe(300);
    // the 300 admitted attempts were all at `first`: one window later the allowance is back
    r.advance(first + WINDOW_MS - r.now());
    expect((await r.call(good)).status).toBe(200);
  });

  test("AC-7.3: when A has used its whole allowance, B's call is answered exactly as on a fresh router", async () => {
    const r = limitedRouter();
    for (let i = 0; i < 300; i++) await r.call(good);
    expect((await r.call(good)).status).toBe(429);

    const fresh = limitedRouter();
    const b = await r.call(refundCreds);
    const reference = await fresh.call(refundCreds);
    expect(b.status).toBe(200);
    const shape = (res: { token: string; expiresInSeconds: number }) => ({
      keys: Object.keys(res).sort(),
      expiresInSeconds: res.expiresInSeconds,
      claims: (({ sub, aud, iss, scope }) => ({ sub, aud, iss, scope }))(decodeJwt(res.token) as Record<string, unknown>),
    });
    expect(shape((await b.json()) as never)).toEqual(shape((await reference.json()) as never));
  });

  test("a service's own allowance is configurable (SERVICE_TOKEN_SERVICE_LIMIT)", async () => {
    const r = limitedRouter({ serviceTokenLimit: 2 });
    expect((await r.call(good)).status).toBe(200);
    expect((await r.call(good)).status).toBe(200);
    expect((await r.call(good)).status).toBe(429);
    expect((await r.call(refundCreds)).status).toBe(200);
  });
});

describe("POST /system/service-token — invalid credentials by source (AC-7.5, AC-7.6)", () => {
  beforeAll(() => configure(SERVICE_AUDIENCE, twoClients()));
  afterAll(() => configure(SERVICE_AUDIENCE, validClients()));

  const invalidKinds = [
    ["unknown client", { clientId: "nobody", clientSecret: SECRET }, 401],
    ["wrong secret", { clientId: "inventory-api", clientSecret: "x".repeat(40) }, 401],
    ["malformed body", {}, 400],
  ] as const;

  test("20 invalid requests are answered as today (401 / 400); the 21st is 429; nothing is minted for any of them", async () => {
    for (const ip of ["198.51.100.7", undefined]) {
      const r = limitedRouter();
      for (let i = 0; i < 20; i++) {
        const [, body, status] = invalidKinds[i % invalidKinds.length]!;
        expect((await r.call(body, ip)).status).toBe(status);
      }
      expect((await r.call(invalidKinds[0][1], ip)).status).toBe(429);
      expect((await r.call({}, ip)).status).toBe(429);
      expect(r.signed()).toBe(0);
    }
  });

  test("AC-7.5: at the same instant a valid credential from that source is 200 — also from \"direct\" — and is not counted", async () => {
    for (const ip of ["198.51.100.8", undefined]) {
      const r = limitedRouter();
      for (let i = 0; i < 19; i++) {
        expect((await r.call(invalidKinds[0][1], ip)).status).toBe(401);
        if (i % 2 === 0) expect((await r.call(good, ip)).status).toBe(200); // valid ones interleaved
      }
      // 50 valid in total from this source must not have eaten the invalid budget
      for (let i = 0; i < 40; i++) expect((await r.call(good, ip)).status).toBe(200);
      expect((await r.call(invalidKinds[0][1], ip)).status).toBe(401); // the 20th
      expect((await r.call(invalidKinds[0][1], ip)).status).toBe(429); // the 21st
      expect((await r.call(good, ip)).status).toBe(200); // still passes from the flooded source
      expect((await r.call(refundCreds, ip)).status).toBe(200);
    }
  });

  test("another source's invalid requests never refuse this source's invalid requests below 20", async () => {
    const r = limitedRouter();
    for (let i = 0; i < 25; i++) await r.call(invalidKinds[0][1], "198.51.100.20");
    expect((await r.call(invalidKinds[0][1], "198.51.100.21")).status).toBe(401);
  });

  test("refused invalid requests do not extend the period: it ends 10 minutes after the first", async () => {
    const r = limitedRouter();
    for (let i = 0; i < 20; i++) await r.call(invalidKinds[0][1]);
    const first = r.now();
    for (let i = 0; i < 5; i++) {
      r.advance(100_000);
      expect((await r.call(invalidKinds[0][1])).status).toBe(429);
    }
    r.advance(first + WINDOW_MS - r.now());
    expect((await r.call(invalidKinds[0][1])).status).toBe(401);
  });

  test("AC-7.6(a): the invalid-flood 429 and the exhausted-service 429 are identical in status, body bytes and headers", async () => {
    const r = limitedRouter({ serviceTokenLimit: 1 });
    // the two buckets start 5 minutes apart
    await r.call(good);
    r.advance(300_000);
    for (let i = 0; i < 20; i++) await r.call(invalidKinds[0][1]);
    const service = await r.call(good);
    const invalid = await r.call(invalidKinds[0][1]);
    expect(service.status).toBe(429);
    expect(invalid.status).toBe(429);
    expect(await invalid.text()).toBe(await service.text());
    const headers = (res: Response) => [...res.headers].filter(([k]) => k !== "date").sort();
    expect(headers(invalid)).toEqual(headers(service));
    expect(invalid.headers.get("Retry-After")).toBe("600");
  });

  test("AC-7.6(b): with A's allowance exhausted, a wrong secret for A is the frozen 401, not a 429", async () => {
    const r = limitedRouter({ serviceTokenLimit: 1 });
    await r.call(good);
    expect((await r.call(good)).status).toBe(429);
    const wrong = await r.call({ clientId: "inventory-api", clientSecret: "y".repeat(40) });
    expect(wrong.status).toBe(401);
    const reference = await limitedRouter().call({ clientId: "inventory-api", clientSecret: "y".repeat(40) });
    expect(await wrong.text()).toBe(await reference.text());
  });

  test("AC-7.6(c): unknown client, wrong secret and a near-miss secret are identical 401s, and identical 429s past 20", async () => {
    const nearMiss = SECRET.slice(0, -1) + (SECRET.endsWith("h") ? "i" : "h");
    const attempts = [
      { clientId: "nobody", clientSecret: SECRET },
      { clientId: "inventory-api", clientSecret: "z".repeat(40) },
      { clientId: "inventory-api", clientSecret: nearMiss },
    ];
    const r = limitedRouter();
    const bodies: string[] = [];
    for (const a of attempts) {
      const res = await r.call(a);
      expect(res.status).toBe(401);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    for (let i = 3; i < 20; i++) await r.call(attempts[0]);
    const refused: string[] = [];
    for (const a of attempts) {
      const res = await r.call(a);
      expect(res.status).toBe(429);
      refused.push(await res.text());
    }
    expect(new Set(refused).size).toBe(1);
  });

  test("AC-7.6(d): the credential comparison runs exactly once per request on the valid, 401 and both 429 paths", async () => {
    const spy = spyOn(serviceClientsModule, "authenticateServiceClient");
    try {
      const r = limitedRouter({ serviceTokenLimit: 1, invalidLimit: 1 });
      await r.call(good); // valid
      expect(spy).toHaveBeenCalledTimes(1);
      await r.call(good); // valid, service allowance refused (429)
      expect(spy).toHaveBeenCalledTimes(2);
      await r.call({ clientId: "nobody", clientSecret: SECRET }); // invalid, admitted (401)
      expect(spy).toHaveBeenCalledTimes(3);
      expect((await r.call({ clientId: "nobody", clientSecret: SECRET })).status).toBe(429); // invalid, refused
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });

  test("AC-7.4/7.5: neither a 401 nor a 429 reaches the signer", async () => {
    const r = limitedRouter({ serviceTokenLimit: 1, invalidLimit: 1 });
    await r.call(good);
    const before = r.signed();
    await r.call(good); // 429 (service)
    await r.call(invalidKinds[0][1]); // 401
    await r.call(invalidKinds[0][1]); // 429 (invalid)
    expect(r.signed()).toBe(before);
  });

  test("a body over 4 KiB is an invalid credential: 400 'body: too large', counted against the source, never parsed", async () => {
    const r = limitedRouter({ invalidLimit: 1 });
    const huge = JSON.stringify({ clientId: "inventory-api", clientSecret: SECRET, pad: "p".repeat(5000) });
    const res = await r.call(huge, undefined, true);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { detail: string }).detail).toBe("body: too large");
    expect((await r.call(huge, undefined, true)).status).toBe(429);
  });

  test("a body that is not JSON is the 400 of today and counts as invalid", async () => {
    const r = limitedRouter({ invalidLimit: 1 });
    expect((await r.call("{nope", undefined, true)).status).toBe(400);
    expect((await r.call("{nope", undefined, true)).status).toBe(429);
  });
});
