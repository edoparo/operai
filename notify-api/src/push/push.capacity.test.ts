/**
 * Push under load (T18, specs/20261111-push-notifications, plan rows "AC-2.1 under load",
 * "AC-5.2 (amended) memo" and AC-7.7 integration; QE D-1).
 *
 * Nothing between notify-api's route and auth's contract is stubbed: the REAL
 * `createServiceTokenProvider`, the REAL `createUserContactClient`, the REAL activity check,
 * the REAL push channel and the REAL `POST /system/notifications` router (real Postgres for the
 * notification rows) talk over HTTP to a FAKE AUTH on `Bun.serve` that enforces auth's US-7
 * contract (ADR 20261112-system-endpoints-limited-per-verified-service, auth/src/system/systemRateLimits.ts):
 *
 *   - 300 service tokens and 600 contact lookups per verified calling service per window,
 *   - one invalid-credential count per source ADDRESS (20 per window, both endpoints), and
 *     every request reaches it WITHOUT `X-Forwarded-For`, so the address is always "direct" as
 *     on Railway's private network (the fake fails the test if a forwarded header ever shows up),
 *   - one 429 body with a FIXED `Retry-After`.
 *
 * The whole thing runs on one injected clock (token provider, memo, fake window).
 * The device list and the Web Push sender are in-memory fakes: what is under test is how often
 * auth is asked and whether a push goes out, not the encryption (covered in push.channel.test).
 */

import { describe, it, expect, afterEach, afterAll, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { env } from "@/lib/env";

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: new URL("../../.env", import.meta.url).pathname, override: true });

const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });
mock.module("@/lib/db", () => ({ db: testDb }));

const { createSystemAuthMiddleware } = await import("@/system/systemAuth.middleware");
const { createSystemNotificationsRouter } = await import("@/system/notifications.routes");
const { createServiceTokenProvider } = await import("@/lib/serviceToken");
const { createUserContactClient } = await import("@/lib/userContact");
const { createActivityCheck } = await import("@/push/activityCheck");
const { createPushChannel, ACTIVITY_MEMO_TTL_MS } = await import("@/channels/push.channel");
const { pushChannel } = await import("@/channels/push.channel");
type PushDeviceRow = import("@/push/devices.repo").PushDeviceRow;

// ─── the fake auth ────────────────────────────────────────────────────────────

const WINDOW_MS = 600_000;
const CLIENT_ID = "notify-api";
const CLIENT_SECRET = "capacity-test-secret";

const clock = { t: Date.UTC(2026, 10, 12, 9, 0, 0) };
const now = () => clock.t;

const slidingLimiter = (limit: number) => {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const live = (hits.get(key) ?? []).filter((at) => t - at < WINDOW_MS);
    if (live.length >= limit) {
      hits.set(key, live);
      return false; // a refused attempt is never recorded
    }
    live.push(t);
    hits.set(key, live);
    return true;
  };
};

type FakeAuth = ReturnType<typeof startFakeAuth>;
const startFakeAuth = () => {
  const state = {
    tokens: new Set<string>(),
    mints: 0,
    lookups: [] as string[],
    refusals429: 0,
    forwardedHeaders: 0,
    deactivated: new Set<string>(),
    forceRateLimit: false,
    /** When set, a lookup is answered only once this resolves (its decision is taken at request time). */
    gate: null as Promise<void> | null,
  };
  const invalid = slidingLimiter(20); // per source address, both endpoints
  const mintAllowance = slidingLimiter(300); // per verified calling service
  const lookupAllowance = slidingLimiter(600); // per verified calling service
  const tooMany = () => {
    state.refusals429++;
    return Response.json(
      { type: "https://httpstatuses.com/429", title: "Too Many Requests", status: 429, code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(WINDOW_MS / 1000) } },
    );
  };
  const unauthorized = () => Response.json({ title: "Unauthorized", status: 401 }, { status: 401 });
  const ADDRESS = "direct"; // no forwarded address ever arrives

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.headers.has("x-forwarded-for") || req.headers.has("forwarded")) state.forwardedHeaders++;
      const path = new URL(req.url).pathname;
      if (req.method !== "POST") return new Response("nope", { status: 404 });

      if (path === "/system/service-token") {
        const body = (await req.json().catch(() => null)) as { clientId?: string; clientSecret?: string } | null;
        if (body?.clientId !== CLIENT_ID || body.clientSecret !== CLIENT_SECRET) {
          return invalid(ADDRESS) ? unauthorized() : tooMany();
        }
        if (!mintAllowance(`system:${CLIENT_ID}`)) return tooMany();
        const token = `tok-${++state.mints}`;
        state.tokens.add(token);
        return Response.json({ token, expiresInSeconds: 300 });
      }

      if (path === "/system/users/contact") {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!state.tokens.has(token)) return invalid(ADDRESS) ? unauthorized() : tooMany();
        if (state.forceRateLimit || !lookupAllowance(`system:${CLIENT_ID}`)) return tooMany();
        const { userId } = (await req.json()) as { userId: string };
        state.lookups.push(userId);
        const found = !state.deactivated.has(userId);
        if (state.gate !== null) await state.gate;
        return found
          ? Response.json({ id: userId, email: `${userId}@example.test`, name: "N" })
          : Response.json({ title: "Not Found", status: 404 }, { status: 404 });
      }
      return new Response("nope", { status: 404 });
    },
  });
  return { state, server, baseUrl: `http://localhost:${server.port}` };
};

// ─── notify-api side: real client chain, real router ──────────────────────────

const SERVICE_AUD = "operai-push-capacity-test";
const KID = "push-capacity-kid";
const keyPair = await generateKeyPair("RS256");
const localJwks = createLocalJWKSet({
  keys: [{ ...(await exportJWK(keyPair.publicKey)), kid: KID, alg: "RS256", use: "sig" }],
});
const callerToken = () =>
  new SignJWT({ scope: "notifications.push emails.send" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(env.AUTH_ISSUER)
    .setAudience(SERVICE_AUD)
    .setSubject("system:crm-api")
    .setExpirationTime("30m")
    .sign(keyPair.privateKey);

const PREFIX = "push-capacity-";
type Rig = Awaited<ReturnType<typeof rig>>;

const rig = async (usersWithDevices: Set<string>) => {
  const auth = startFakeAuth();
  const tokens = createServiceTokenProvider({
    baseUrl: auth.baseUrl,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    now,
  });
  const contacts = createUserContactClient({ baseUrl: auth.baseUrl, tokens });
  const sends: string[] = [];
  const deletedFor: string[] = [];
  const logs: string[] = [];
  const channel = createPushChannel({
    enabled: true,
    excludedOrigins: [],
    devices: {
      listByUser: async (userId) =>
        usersWithDevices.has(userId)
          ? [
              {
                id: `dev-${userId}`,
                userId,
                endpoint: "https://fcm.googleapis.com/fcm/send/e",
                p256dh: "x",
                auth: "y",
                label: "Chrome · macOS",
                createdAt: new Date(),
                updatedAt: new Date(),
              } satisfies PushDeviceRow,
            ]
          : [],
      deleteAllForUser: async (userId) => {
        deletedFor.push(userId);
      },
      deleteById: async () => {},
    },
    activity: createActivityCheck(contacts, { ttlMs: ACTIVITY_MEMO_TTL_MS, now }),
    sender: {
      send: async (target) => {
        sends.push(target.endpoint);
        return { status: 201 };
      },
    },
    log: (m) => logs.push(m),
  });

  // pushChannel.dispatch is fire-and-forget in the route; collect the promises to await them.
  const dispatches: Promise<void>[] = [];
  const spy = spyOn(pushChannel, "dispatch").mockImplementation((recipientId, notification) => {
    const p = channel.dispatch(recipientId, notification);
    dispatches.push(p);
    return p;
  });

  const emails: { to: string }[] = [];
  const app = new Hono();
  app.route(
    "/",
    createSystemNotificationsRouter(
      createSystemAuthMiddleware({ scope: "notifications.push", jwks: localJwks, audience: SERVICE_AUD }),
      {
        contacts,
        appBaseUrl: "https://operai.example.test",
        channel: {
          send: async (input) => {
            emails.push({ to: input.to });
            return { deliveryId: "d", status: "sent" };
          },
        },
      },
    ),
  );

  const raise = async (recipientId: string, extra: Record<string, unknown> = {}) =>
    app.request("/system/notifications", {
      method: "POST",
      headers: { Authorization: `Bearer ${await callerToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientId,
        originApp: "crm",
        severity: "info",
        title: "Estimate requested",
        body: "Acme asked for an estimate.",
        link: { href: "/crm/deals/d_1" },
        ...extra,
      }),
    });
  const settle = async () => {
    await Promise.all(dispatches.splice(0));
  };
  const stop = () => {
    spy.mockRestore();
    void auth.server.stop(true);
  };
  return { auth, sends, deletedFor, logs, emails, raise, settle, stop };
};

let current: Rig | null = null;
const users = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `${PREFIX}u${from + i}`);

afterEach(async () => {
  current?.stop();
  current = null;
  await testDb.notification.deleteMany({ where: { recipientId: { startsWith: PREFIX } } });
});
afterAll(async () => {
  await testDb.$disconnect();
});

/** `fn` for each item, `size` at a time. */
const inBatches = async <T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) => {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
};

describe("AC-2.1 under load — the real client against auth's US-7 contract (D-1)", () => {
  it("(a) 100 notifications for 5 recipients inside 30 s: every device is sent to 20 times and auth is asked exactly 5 times", async () => {
    const five = users(5);
    current = await rig(new Set(five));
    const jobs = Array.from({ length: 100 }, (_, i) => five[i % 5]!);
    for (let i = 0; i < jobs.length; i += 20) {
      await Promise.all(jobs.slice(i, i + 20).map(async (u) => expect((await current!.raise(u)).status).toBe(201)));
      clock.t += 4_000; // 5 batches: 20 s in all
    }
    await current.settle();
    expect(current.sends).toHaveLength(100);
    expect(current.auth.state.lookups).toHaveLength(5);
    expect(new Set(current.auth.state.lookups).size).toBe(5);
    expect(current.auth.state.refusals429).toBe(0);
    expect(current.auth.state.mints).toBe(1);
    expect(current.auth.state.forwardedHeaders).toBe(0);
  });

  it("(b) 40 distinct recipients with a device in one window: all pushed, auth never refuses (the 20-per-address rule would have refused #21)", async () => {
    const forty = users(40);
    current = await rig(new Set(forty));
    await inBatches(forty, 10, async (u) => expect((await current!.raise(u)).status).toBe(201));
    await current.settle();
    expect(current.sends).toHaveLength(40);
    expect(current.auth.state.lookups).toHaveLength(40);
    expect(current.auth.state.refusals429).toBe(0);
  });

  it("(c) auth answering 429 fails closed: nothing sent, devices kept, the 429 is logged, the notification is still 201", async () => {
    const [u] = users(1) as [string];
    current = await rig(new Set([u]));
    current.auth.state.forceRateLimit = true;
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await current.raise(u);
      await current.settle();
      expect(res.status).toBe(201);
      const logged = errors.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain("[user-contact]");
      expect(logged).toContain("HTTP 429");
    } finally {
      errors.mockRestore();
    }
    expect(current.sends).toEqual([]);
    expect(current.deletedFor).toEqual([]);
    expect(await testDb.notification.count({ where: { recipientId: u } })).toBe(1);
  });
});

describe("AC-5.2 memo against the real client (ADR 20261112-push-liveness-answer-reused-30-seconds)", () => {
  it("a user deactivated at d: a notification at d + 10 s may still push (memo), at d + 30 s nothing is sent and every device is deleted", async () => {
    const [u] = users(1) as [string];
    current = await rig(new Set([u]));
    await current.raise(u);
    await current.settle();
    expect(current.sends).toHaveLength(1);
    clock.t += 5_000;
    current.auth.state.deactivated.add(u); // d = first lookup + 5 s
    clock.t += 10_000;
    await current.raise(u);
    await current.settle();
    expect(current.sends).toHaveLength(2); // allowed by AC-5.2: within 30 s of the lookup
    clock.t += 15_000; // 30 s after the lookup was sent (d + 25 s)
    await current.raise(u);
    await current.settle();
    expect(current.sends).toHaveLength(2);
    expect(current.deletedFor).toEqual([u]);
  });

  it("a found lookup in flight across the deactivation does not stretch the bound: 30 s after it was SENT the next one asks again", async () => {
    const [u] = users(1) as [string];
    current = await rig(new Set([u]));
    let release!: () => void;
    current.auth.state.gate = new Promise<void>((resolve) => (release = resolve));
    const first = current.raise(u); // lookup sent at t0; auth decided "found", the answer is held
    await Bun.sleep(50);
    clock.t += 1_000;
    current.auth.state.deactivated.add(u); // deactivation while the answer is in flight
    clock.t += 1_000;
    current.auth.state.gate = null;
    release();
    expect((await first).status).toBe(201);
    await current.settle();
    expect(current.sends).toHaveLength(1);
    clock.t += 28_000; // t0 + 30 s exactly
    await current.raise(u);
    await current.settle();
    expect(current.sends).toHaveLength(1);
    expect(current.deletedFor).toEqual([u]);
  });

  it("the email path never uses the memo: three email notices for a user with a device are three lookups, plus ONE for the push", async () => {
    const [u] = users(1) as [string];
    current = await rig(new Set([u]));
    for (let i = 0; i < 3; i++) {
      const res = await current.raise(u, { email: true });
      expect(((await res.json()) as { emailStatus: string }).emailStatus).toBe("sent");
    }
    await current.settle();
    expect(current.emails).toHaveLength(3);
    expect(current.auth.state.lookups).toHaveLength(4);
    expect(current.sends).toHaveLength(3);
  });
});

describe("AC-7.7 — the suite's traffic shape stays inside the contract (integration)", () => {
  it("120 notifications for 120 recipients, 60 with an email notice, 80 with a device: every email attempted, no push check failed, <= 140 lookups, no 429", async () => {
    const everyone = users(120);
    const withEmail = new Set(everyone.slice(0, 60));
    const withDevice = new Set(everyone.slice(40, 120)); // 20 recipients have both
    current = await rig(withDevice);
    const statuses: string[] = [];
    await inBatches(everyone, 30, async (u) => {
      const res = await current!.raise(u, withEmail.has(u) ? { email: true } : {});
      expect(res.status).toBe(201);
      const status = ((await res.json()) as { emailStatus?: string }).emailStatus;
      if (withEmail.has(u)) statuses.push(status ?? "none");
    });
    await current.settle();
    expect(statuses).toHaveLength(60);
    expect(statuses.every((s) => s === "sent")).toBe(true); // never "failed", never "skipped" for a configured channel
    expect(current.emails).toHaveLength(60);
    expect(current.sends).toHaveLength(80); // every activity check answered active
    expect(current.logs.filter((l) => l.includes("failed"))).toEqual([]);
    expect(current.auth.state.lookups.length).toBeLessThanOrEqual(140);
    expect(current.auth.state.refusals429).toBe(0);
    expect(current.auth.state.forwardedHeaders).toBe(0);
  });
});
