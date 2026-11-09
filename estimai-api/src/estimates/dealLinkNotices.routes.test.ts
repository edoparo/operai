/**
 * Integration tests for POST /system/deal-link-notices (specs/024 T4, AC-3.3,
 * AC-3.5, AC-3.6; ADR-0076) against the real Postgres. Keys and JWKS are
 * generated in memory and injected into the router, so nothing needs a live
 * `auth`. The credential matrix itself is systemAuth.middleware.test.ts; here
 * the route proves it is wired to the right scope/sub/audience, and the
 * ordering rules of the conditional update.
 */

import { describe, it, expect, beforeAll, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { TEST_DATABASE_URL } from "@/lib/testDatabaseUrl";

const TEST_ISSUER = "http://localhost:3001";
process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5435/estimai";
process.env["ALLOWED_ORIGINS"] ??= "http://localhost:5173";
process.env["AUTH_JWKS_URL"] ??= "http://localhost:3001/auth/jwks";
process.env["AUTH_ISSUER"] ??= TEST_ISSUER;
process.env["AUTH_AUDIENCE"] ??= "operai-suite";
process.env["NODE_ENV"] = "test";
process.env["AUTH_BASE_URL"] ??= "http://localhost:3001";
process.env["SERVICE_CLIENT_ID"] ??= "estimai-api";
process.env["SERVICE_CLIENT_SECRET"] ??= "test-service-client-secret-at-least-32-characters";
process.env["NOTIFY_INTERNAL_URL"] ??= "http://localhost:8081";

// The DATABASE_URL the process started with: an earlier test file in the same
// bun process may have replaced process.env's value (src/lib/testDatabaseUrl.ts).

const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL ?? process.env["DATABASE_URL"]! }),
});
mock.module("@/lib/db", () => ({ db: testDb }));

const { createDealLinkNoticesRouter } = await import("./dealLinkNotices.routes");

// ─── Harness ─────────────────────────────────────────────────────────────────

const SERVICE_AUD = "operai-system-test";
const KID = "svc-deal-link-kid";
const SUB = "system:crm-api";
const SCOPE = "deal-link-notices.send";

let signingKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" }] });
});

const sign = (o: { sub?: string; aud?: string; scope?: string } = {}) =>
  new SignJWT({ scope: o.scope ?? SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setSubject(o.sub ?? SUB)
    .setAudience(o.aud ?? SERVICE_AUD)
    .setExpirationTime("5m")
    .sign(signingKey);

const buildApp = (opts: { audience?: string | undefined } = { audience: SERVICE_AUD }) => {
  const app = new Hono();
  app.route("/", createDealLinkNoticesRouter({ jwks, audience: "audience" in opts ? opts.audience : SERVICE_AUD }));
  return app;
};

const send = async (body: unknown, token?: string, app = buildApp()) =>
  app.request("/system/deal-link-notices", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? (await sign())}`,
    },
    body: JSON.stringify(body),
  });

const ownersToClean = new Set<string>();
afterEach(async () => {
  await testDb.estimate.deleteMany({ where: { userId: { in: Array.from(ownersToClean) } } });
  ownersToClean.clear();
});

let counter = 0;
const seed = async () => {
  counter += 1;
  const userId = `dl-owner-${counter}-${Date.now()}`;
  ownersToClean.add(userId);
  return testDb.estimate.create({
    data: { userId, name: "Deal link fixture", author: "", sizeBytes: 2, content: {} },
  });
};
const reload = (id: string) => testDb.estimate.findUniqueOrThrow({ where: { id } });

const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";
const T3 = "2026-11-03T10:00:00.000Z";
const notice = (estimateId: string, event: "linked" | "unlinked", at: string, dealId = "deal-A") => ({
  estimateId,
  dealId,
  event,
  at,
});

// ─── Applying a notice ───────────────────────────────────────────────────────

describe("applying a notice (AC-3.5)", () => {
  it("linked sets crmDealId and crmLinkAt; 204 with no body", async () => {
    const est = await seed();
    const res = await send(notice(est.id, "linked", T1));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const row = await reload(est.id);
    expect(row.crmDealId).toBe("deal-A");
    expect(row.crmLinkAt?.toISOString()).toBe(T1);
  });

  it("unlinked after linked clears crmDealId and advances crmLinkAt", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T1));
    expect((await send(notice(est.id, "unlinked", T2))).status).toBe(204);
    const row = await reload(est.id);
    expect(row.crmDealId).toBeNull();
    expect(row.crmLinkAt?.toISOString()).toBe(T2);
  });

  it("an unknown estimate is 204 as well — nothing is learnt from it", async () => {
    const res = await send(notice("does-not-exist", "linked", T1));
    expect(res.status).toBe(204);
  });

  it("applying a notice does not touch the estimate's own updatedAt or version", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T1));
    const row = await reload(est.id);
    expect(row.version).toBe(est.version);
    expect(row.updatedAt.toISOString()).toBe(est.updatedAt.toISOString());
  });
});

// ─── Ordering (AC-3.6) ───────────────────────────────────────────────────────

describe("ordering by the CRM instant (AC-3.6)", () => {
  it("a repeat changes nothing", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T1));
    const before = await reload(est.id);
    expect((await send(notice(est.id, "linked", T1))).status).toBe(204);
    const after = await reload(est.id);
    expect([after.crmDealId, after.crmLinkAt]).toEqual([before.crmDealId, before.crmLinkAt]);
  });

  it("an older notice is ignored", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T2));
    await send(notice(est.id, "unlinked", T1)); // older than the applied link
    const row = await reload(est.id);
    expect(row.crmDealId).toBe("deal-A");
    expect(row.crmLinkAt?.toISOString()).toBe(T2);
  });

  it("unlinked, then a late linked: the estimate stays unlinked", async () => {
    const est = await seed();
    await send(notice(est.id, "unlinked", T2)); // arrives first
    await send(notice(est.id, "linked", T1)); // the link it undoes, delivered late
    const row = await reload(est.id);
    expect(row.crmDealId).toBeNull();
    expect(row.crmLinkAt?.toISOString()).toBe(T2);
  });

  it("equal instants: unlinked wins, whichever arrives first", async () => {
    const a = await seed();
    await send(notice(a.id, "linked", T1));
    await send(notice(a.id, "unlinked", T1));
    expect((await reload(a.id)).crmDealId).toBeNull();

    const b = await seed();
    await send(notice(b.id, "unlinked", T1));
    await send(notice(b.id, "linked", T1));
    expect((await reload(b.id)).crmDealId).toBeNull();
  });

  it("an unlink of a deal the estimate is not linked to keeps the current link and its instant", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T1, "deal-B"));
    await send(notice(est.id, "unlinked", T3, "deal-A"));
    const row = await reload(est.id);
    expect(row.crmDealId).toBe("deal-B");
    expect(row.crmLinkAt?.toISOString()).toBe(T1);
  });

  it("a newer link replaces an older one", async () => {
    const est = await seed();
    await send(notice(est.id, "linked", T1, "deal-A"));
    await send(notice(est.id, "linked", T2, "deal-B"));
    expect((await reload(est.id)).crmDealId).toBe("deal-B");
  });
});

// ─── Body (AC-3.3) ───────────────────────────────────────────────────────────

describe("the body is strict (AC-3.3)", () => {
  it("an extra field is 400 and nothing is written", async () => {
    const est = await seed();
    const res = await send({ ...notice(est.id, "linked", T1), title: "Deal title" });
    expect(res.status).toBe(400);
    expect((await reload(est.id)).crmDealId).toBeNull();
  });

  it.each([
    ["a missing dealId", { estimateId: "e", event: "linked", at: T1 }],
    ["an unknown event", { estimateId: "e", dealId: "d", event: "moved", at: T1 }],
    ["a non-ISO instant", { estimateId: "e", dealId: "d", event: "linked", at: "yesterday" }],
    ["an empty estimateId", { estimateId: "", dealId: "d", event: "linked", at: T1 }],
    ["an over-long dealId", { estimateId: "e", dealId: "d".repeat(65), event: "linked", at: T1 }],
  ])("%s is 400", async (_name, body) => {
    expect((await send(body)).status).toBe(400);
  });
});

// ─── Credential wiring (AC-3.5) ──────────────────────────────────────────────

describe("only crm-api's service credential is accepted", () => {
  it("refuses a user JWT, the wrong sub, the wrong scope and the wrong audience — and writes nothing", async () => {
    const est = await seed();
    const refused = [
      await sign({ aud: "operai-suite", sub: "user-1" }),
      await sign({ sub: "system:estimai-api" }),
      await sign({ scope: "notifications.push" }),
      await sign({ aud: "somewhere-else" }),
    ];
    for (const token of refused) {
      expect((await send(notice(est.id, "linked", T1), token)).status).toBe(401);
    }
    expect((await reload(est.id)).crmDealId).toBeNull();
  });

  it("with SERVICE_AUDIENCE unset the route refuses even a validly signed token", async () => {
    const est = await seed();
    const res = await send(notice(est.id, "linked", T1), undefined, buildApp({ audience: undefined }));
    expect(res.status).toBe(401);
    expect((await reload(est.id)).crmDealId).toBeNull();
  });

  it("no credential at all is 401", async () => {
    const res = await buildApp().request("/system/deal-link-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(notice("e", "linked", T1)),
    });
    expect(res.status).toBe(401);
  });
});

describe("mounted the way index.ts mounts it", () => {
  it("a service token reaches the route although estimatesRouter carries a wildcard user-JWT middleware", async () => {
    const { estimatesRouter, importEstimatesRouter } = await import("./estimates.routes");
    const est = await seed();
    const app = new Hono();
    // index.ts order: the system route FIRST, then the jwt-gated routers.
    app.route("/", createDealLinkNoticesRouter({ jwks, audience: SERVICE_AUD }));
    app.route("/", importEstimatesRouter);
    app.route("/", estimatesRouter);

    const res = await send(notice(est.id, "linked", T1), undefined, app);
    expect(res.status).toBe(204);
    expect((await reload(est.id)).crmDealId).toBe("deal-A");
  });
});
