/**
 * Route tests for GET /push/config, PUT|GET /push/devices and DELETE /push/devices/{id}
 * (T5, specs/029-push-notifications, plan.md §API contracts, AC-1.2 / 1.5 / 3.1 / 3.2 /
 * 3.3 / 5.3 / 6.1).
 *
 * Strategy mirrors list.routes.test.ts: real Postgres on a fresh Prisma client injected as
 * `@/lib/db`, a jwtMiddleware mock verifying against an in-memory JWKS (same audience
 * rule as the real one: the user audience only). Every row belongs to a `t5-` user and
 * is removed afterwards. `env` is the real singleton; only PUSH_ENABLED and
 * VAPID_PUBLIC_KEY are mutated, and restored.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { env } from "@/lib/env";
import { createTestSubscriber } from "./webPush.testutil";

// ─── jwtMiddleware mock: user audience only, like the real middleware ─────────

const TEST_KID = "operai-auth-rs256-t5";
const TEST_ISSUER = "http://localhost:3001";
const TEST_AUDIENCE = "operai-suite-test";
const SERVICE_AUD = "operai-system-t5";
let jwksProxy: ReturnType<typeof createLocalJWKSet> | null = null;

mock.module("@/auth/jwt.middleware", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createMiddleware } = require("hono/factory") as typeof import("hono/factory");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jose = require("jose") as typeof import("jose");
  const refuse = (path: string) =>
    Response.json(
      { type: "https://httpstatuses.com/401", title: "Unauthorized", status: 401, detail: "refused", instance: path },
      { status: 401 },
    );
  const jwtMiddleware = createMiddleware<{ Variables: { userId: string; email: string } }>(async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) return refuse(c.req.path);
    try {
      if (!jwksProxy) throw new Error("JWKS proxy not initialised");
      const { payload } = await jose.jwtVerify(header.slice(7), jwksProxy, {
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        algorithms: ["RS256"],
      });
      const email = typeof payload.email === "string" ? payload.email : undefined;
      if (!payload.sub || !email) throw new Error("missing claims");
      c.set("userId", payload.sub);
      c.set("email", email);
      return next();
    } catch {
      return refuse(c.req.path);
    }
  });
  return { jwtMiddleware, JwtVariables: {} };
});

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: new URL("../../.env", import.meta.url).pathname, override: true });

const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });
mock.module("@/lib/db", () => ({ db: testDb }));

const { pushDevicesRouter } = await import("./devices.routes");
const { createSystemNotificationsRouter } = await import("@/system/notifications.routes");
const { createSystemAuthMiddleware } = await import("@/system/systemAuth.middleware");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const A = "t5-user-a";
const B = "t5-user-b";
const VAPID = "BOr-test-public-key";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const EP = (n: number) => `https://fcm.googleapis.com/fcm/send/t5-${n}`;

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;

const sign = (subject: string, aud: string, claims: Record<string, unknown> = {}) =>
  new SignJWT({ email: `${subject}@example.com`, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: TEST_KID })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setAudience(aud)
    .setSubject(subject)
    .setExpirationTime("1h")
    .sign(keyPair.privateKey);
const tokenFor = (subject: string) => sign(subject, TEST_AUDIENCE);
const bearer = async (subject: string) => ({ Authorization: `Bearer ${await tokenFor(subject)}` });

const subscriber = () => createTestSubscriber();
const body = (n: number, s = subscriber(), over: Record<string, unknown> = {}) => ({
  endpoint: EP(n),
  keys: { p256dh: s.p256dh, auth: s.auth },
  ...over,
});

const app = () => {
  const a = new Hono();
  a.route("/", pushDevicesRouter);
  return a;
};
const put = async (user: string, payload: unknown, extra: Record<string, string> = {}) =>
  app().request("/push/devices", {
    method: "PUT",
    headers: { ...(await bearer(user)), "Content-Type": "application/json", "User-Agent": CHROME_MAC, ...extra },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
const get = async (user: string, path = "/push/devices") => app().request(path, { headers: await bearer(user) });
const del = async (user: string, id: string) =>
  app().request(`/push/devices/${id}`, { method: "DELETE", headers: await bearer(user) });
const rows = (userId: string) => testDb.pushDevice.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const problemOf = async (res: Response) => (await res.json()) as { status: number; code?: string; detail: string };

const ORIGINAL = { on: env.PUSH_ENABLED, pub: env.VAPID_PUBLIC_KEY };
const setPush = (on: boolean) => {
  (env as { PUSH_ENABLED: boolean }).PUSH_ENABLED = on;
  (env as { VAPID_PUBLIC_KEY: string | undefined }).VAPID_PUBLIC_KEY = on ? VAPID : undefined;
};

beforeAll(async () => {
  keyPair = await generateKeyPair("RS256", { extractable: true });
  jwk = await exportJWK(keyPair.publicKey);
  jwksProxy = createLocalJWKSet({ keys: [{ ...jwk, use: "sig", alg: "RS256", kid: TEST_KID }] });
  setPush(true);
});
const cleanup = () => testDb.pushDevice.deleteMany({ where: { userId: { startsWith: "t5-" } } });
afterEach(async () => {
  setPush(true);
  await cleanup();
  await testDb.notification.deleteMany({ where: { recipientId: { startsWith: "t5-" } } });
});
afterAll(async () => {
  (env as { PUSH_ENABLED: boolean }).PUSH_ENABLED = ORIGINAL.on;
  (env as { VAPID_PUBLIC_KEY: string | undefined }).VAPID_PUBLIC_KEY = ORIGINAL.pub;
  await cleanup();
  await testDb.$disconnect();
});

// ─── GET /push/config ─────────────────────────────────────────────────────────

describe("GET /push/config (AC-1.2, AC-6.1)", () => {
  it("200 enabled with the VAPID public key", async () => {
    setPush(true);
    const res = await get(A, "/push/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, vapidPublicKey: VAPID });
  });

  it("200 { enabled: false } and nothing else while push is off", async () => {
    setPush(false);
    const res = await get(A, "/push/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("401 without a Bearer", async () => {
    const res = await app().request("/push/config");
    expect(res.status).toBe(401);
  });
});

// ─── PUT /push/devices ────────────────────────────────────────────────────────

describe("PUT /push/devices (AC-1.2, AC-5.3, AC-6.1)", () => {
  it("201 creates the caller's row; label from the User-Agent; owner is the JWT sub; response omits endpoint and keys", async () => {
    const s = subscriber();
    const res = await put(A, body(1, s, { userId: B }));
    expect(res.status).toBe(201);
    const dto = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(dto).sort()).toEqual(["createdAt", "id", "label"]);
    expect(dto["label"]).toBe("Chrome · macOS");
    expect(new Date(dto["createdAt"] as string).toISOString()).toBe(dto["createdAt"] as string);

    const stored = await rows(A);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(dto["id"] as string);
    expect(stored[0]!.endpoint).toBe(EP(1));
    expect(stored[0]!.p256dh).toBe(s.p256dh);
    expect(stored[0]!.auth).toBe(s.auth);
    expect(await rows(B)).toHaveLength(0); // a body userId is never the owner
    const text = JSON.stringify(dto);
    expect(text).not.toContain(EP(1));
    expect(text).not.toContain(s.p256dh);
    expect(text).not.toContain(s.auth);
  });

  it("200 on re-registering the same endpoint: same id, one row, keys replaced", async () => {
    const first = (await (await put(A, body(1))).json()) as { id: string };
    const s2 = subscriber();
    const res = await put(A, body(1, s2), { "User-Agent": FIREFOX_LINUX });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as { id: string; label: string };
    expect(dto.id).toBe(first.id);
    expect(dto.label).toBe("Firefox · Linux");
    const stored = await rows(A);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.p256dh).toBe(s2.p256dh);
  });

  it("200 when another account holds the endpoint: the row moves to the caller (AC-5.3)", async () => {
    await put(A, body(1));
    const res = await put(B, body(1));
    expect(res.status).toBe(200);
    expect(await rows(A)).toHaveLength(0);
    expect(await rows(B)).toHaveLength(1);
  });

  it("400 invalid_body: missing endpoint, missing keys, missing a key, wrong type, non-JSON, empty body", async () => {
    const s = subscriber();
    const cases: unknown[] = [
      { keys: { p256dh: s.p256dh, auth: s.auth } },
      { endpoint: EP(1) },
      { endpoint: EP(1), keys: { p256dh: s.p256dh } },
      { endpoint: EP(1), keys: { auth: s.auth } },
      { endpoint: 42, keys: { p256dh: s.p256dh, auth: s.auth } },
      "not json {",
      "",
    ];
    for (const c of cases) {
      const res = await put(A, c as string);
      expect(res.status).toBe(400);
      const p = await problemOf(res);
      expect(p.code).toBe("invalid_body");
      expect(p.status).toBe(400);
    }
    expect(await rows(A)).toHaveLength(0);
  });

  it("400 invalid_body: endpoint over 2000 chars (a schema error, not the allowlist's 422)", async () => {
    const res = await put(A, body(1, subscriber(), { endpoint: `https://fcm.googleapis.com/${"a".repeat(2000)}` }));
    expect(res.status).toBe(400);
    expect((await problemOf(res)).code).toBe("invalid_body");
  });

  it("400 invalid_body: keys that are not base64url of the RFC lengths", async () => {
    const s = subscriber();
    const bad: Array<{ p256dh: string; auth: string }> = [
      { p256dh: s.p256dh.slice(0, -4), auth: s.auth }, // too short
      { p256dh: `${s.p256dh}AAAA`, auth: s.auth }, // too long
      { p256dh: s.p256dh, auth: s.auth.slice(0, -4) },
      { p256dh: s.p256dh, auth: `${s.auth}AAAA` },
      { p256dh: `${s.p256dh}=`, auth: s.auth }, // padded
      { p256dh: s.p256dh.replace(/.$/, "+"), auth: s.auth }, // outside the url alphabet
      { p256dh: s.p256dh, auth: "" },
      { p256dh: Buffer.alloc(65, 7).toString("base64url"), auth: s.auth }, // right length, not a P-256 point
    ];
    for (const keys of bad) {
      const res = await put(A, { endpoint: EP(1), keys });
      expect(res.status).toBe(400);
      expect((await problemOf(res)).code).toBe("invalid_body");
    }
    expect(await rows(A)).toHaveLength(0);
  });

  it("422 endpoint_not_allowed: http, foreign hosts, lookalikes, credentials, port, loopback; the URL is not echoed", async () => {
    const bad = [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://example.com/push",
      "https://fcm.googleapis.com.evil.test/x",
      "https://evilfcm.googleapis.com/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://127.0.0.1/x",
      "https://push.services.mozilla.com/x",
    ];
    for (const endpoint of bad) {
      const res = await put(A, body(1, subscriber(), { endpoint }));
      expect(res.status).toBe(422);
      const p = await problemOf(res);
      expect(p.code).toBe("endpoint_not_allowed");
      expect(p.detail).not.toContain(endpoint);
    }
    expect(await rows(A)).toHaveLength(0);
  });

  it("accepts every allowlisted push service", async () => {
    const ok = [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/x",
      "https://db5p.notify.windows.com/?token=x",
    ];
    for (const endpoint of ok) expect((await put(A, body(1, subscriber(), { endpoint }))).status).toBe(201);
    expect(await rows(A)).toHaveLength(ok.length);
  });

  it("409 device_limit: the 21st new endpoint is refused and nothing is written", async () => {
    for (let i = 0; i < 20; i++) expect((await put(A, body(i))).status).toBe(201);
    const res = await put(A, body(99));
    expect(res.status).toBe(409);
    expect((await problemOf(res)).code).toBe("device_limit");
    expect(await rows(A)).toHaveLength(20);
  });

  it("at the limit, re-registering one of the caller's own endpoints is still 200", async () => {
    for (let i = 0; i < 20; i++) await put(A, body(i));
    const res = await put(A, body(3, subscriber()));
    expect(res.status).toBe(200);
    expect(await rows(A)).toHaveLength(20);
  });

  it("at the limit, taking over another account's endpoint is refused and that row is untouched", async () => {
    await put(B, body(500));
    for (let i = 0; i < 20; i++) await put(A, body(i));
    const res = await put(A, body(500));
    expect(res.status).toBe(409);
    expect(await rows(B)).toHaveLength(1);
    expect(await rows(A)).toHaveLength(20);
  });

  it("503 push_disabled while PUSH_ENABLED is off, even for an invalid body; nothing is written", async () => {
    setPush(false);
    const res = await put(A, body(1));
    expect(res.status).toBe(503);
    expect((await problemOf(res)).code).toBe("push_disabled");
    expect((await put(A, { nonsense: true })).status).toBe(503);
    expect(await rows(A)).toHaveLength(0);
  });

  it("401 without a Bearer, even while push is off; nothing is written", async () => {
    const res = await app().request("/push/devices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body(1)),
    });
    expect(res.status).toBe(401);
    setPush(false);
    const res2 = await app().request("/push/devices", { method: "PUT", body: "{}" });
    expect(res2.status).toBe(401);
    expect(await rows(A)).toHaveLength(0);
  });

  it("413 above the 8 KiB body cap", async () => {
    const res = await put(A, body(1, subscriber(), { padding: "x".repeat(9 * 1024) }));
    expect(res.status).toBe(413);
    expect(await rows(A)).toHaveLength(0);
  });
});

// ─── GET /push/devices ────────────────────────────────────────────────────────

describe("GET /push/devices (AC-3.1, AC-3.3)", () => {
  it("lists only the caller's devices, newest first, without endpoint or keys", async () => {
    const s = subscriber();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(((await (await put(A, body(i, s))).json()) as { id: string }).id);
      await Bun.sleep(5);
    }
    await put(B, body(50));

    const res = await get(A);
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(text) as { items: Array<Record<string, unknown>> };
    expect(json.items.map((i) => i["id"])).toEqual([...ids].reverse());
    for (const item of json.items) expect(Object.keys(item).sort()).toEqual(["createdAt", "id", "label"]);
    expect(text).not.toContain("fcm.googleapis.com");
    expect(text).not.toContain(s.p256dh);
    expect(text).not.toContain(s.auth);

    const other = (await (await get(B)).json()) as { items: unknown[] };
    expect(other.items).toHaveLength(1);
  });

  it("200 { items: [] } for a caller with none, and still answers while push is off", async () => {
    setPush(false);
    const res = await get(A);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("401 without a Bearer", async () => {
    expect((await app().request("/push/devices")).status).toBe(401);
  });
});

// ─── DELETE /push/devices/{id} ────────────────────────────────────────────────

describe("DELETE /push/devices/{id} (AC-1.5, AC-3.2, AC-3.3)", () => {
  it("204 deletes the caller's device and leaves their others", async () => {
    const one = (await (await put(A, body(1))).json()) as { id: string };
    await put(A, body(2));
    const res = await del(A, one.id);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const left = await rows(A);
    expect(left).toHaveLength(1);
    expect(left[0]!.endpoint).toBe(EP(2));
  });

  it("404 for another user's id, identical to an unknown id; the row is intact", async () => {
    const mine = (await (await put(A, body(1))).json()) as { id: string };
    const foreign = await del(B, mine.id);
    const unknown = await del(B, "does-not-exist");
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    const a = (await foreign.json()) as Record<string, unknown>;
    const b = (await unknown.json()) as Record<string, unknown>;
    expect({ ...a, instance: "" }).toEqual({ ...b, instance: "" });
    expect(await rows(A)).toHaveLength(1);
  });

  it("user B cannot see A's device in the list either (AC-3.3)", async () => {
    await put(A, body(1));
    expect(((await (await get(B)).json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it("still works while push is off (a user can always remove a device)", async () => {
    const one = (await (await put(A, body(1))).json()) as { id: string };
    setPush(false);
    expect((await del(A, one.id)).status).toBe(204);
  });

  it("401 without a Bearer; the row is intact", async () => {
    const one = (await (await put(A, body(1))).json()) as { id: string };
    const res = await app().request(`/push/devices/${one.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await rows(A)).toHaveLength(1);
  });
});

// ─── Authentication boundaries (exact-path middleware only) ───────────────────

describe("authentication boundaries", () => {
  it("a service JWT (aud=SERVICE_AUDIENCE) is refused on every /push route", async () => {
    const svc = await sign("system:refund-api", SERVICE_AUD, { scope: "notifications.push" });
    const h = { Authorization: `Bearer ${svc}` };
    expect((await app().request("/push/config", { headers: h })).status).toBe(401);
    expect((await app().request("/push/devices", { headers: h })).status).toBe(401);
    expect(
      (await app().request("/push/devices", { method: "PUT", headers: h, body: JSON.stringify(body(1)) })).status,
    ).toBe(401);
    expect((await app().request("/push/devices/x", { method: "DELETE", headers: h })).status).toBe(401);
    expect(await rows("system:refund-api")).toHaveLength(0);
  });

  it("with the push router mounted: a user JWT is still refused on /system/notifications, a service JWT still works there, and unrelated routes stay open", async () => {
    const svcJwks = createLocalJWKSet({ keys: [{ ...jwk, use: "sig", alg: "RS256", kid: TEST_KID }] });
    const a = new Hono();
    a.route("/", pushDevicesRouter);
    a.route(
      "/",
      createSystemNotificationsRouter(
        createSystemAuthMiddleware({ scope: "notifications.push", jwks: svcJwks, audience: SERVICE_AUD }),
      ),
    );
    a.get("/open-probe", (c) => c.json({ ok: true }));

    const post = (token: string) =>
      a.request("/system/notifications", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: "t5-recipient",
          originApp: "refund",
          severity: "info",
          title: "t",
          body: "b",
        }),
      });

    expect((await post(await tokenFor(A))).status).toBe(401);
    expect(await testDb.notification.count({ where: { recipientId: "t5-recipient" } })).toBe(0);

    const svc = await sign("system:refund-api", SERVICE_AUD, { scope: "notifications.push" });
    expect((await post(svc)).status).toBe(201);

    expect((await a.request("/open-probe")).status).toBe(200);
  });
});

// ─── OpenAPI ──────────────────────────────────────────────────────────────────

describe("OpenAPI", () => {
  it("lists the four routes with their statuses", () => {
    const doc = pushDevicesRouter.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "0" } });
    const paths = doc.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;
    const statuses = (p: string, m: string) => Object.keys(paths[p]![m]!.responses).sort();
    expect(statuses("/push/config", "get")).toEqual(["200", "401"]);
    expect(statuses("/push/devices", "get")).toEqual(["200", "401"]);
    expect(statuses("/push/devices", "put")).toEqual(["200", "201", "400", "401", "409", "413", "422", "503"]);
    expect(statuses("/push/devices/{id}", "delete")).toEqual(["204", "401", "404"]);
  });
});
