/**
 * Integration tests for POST /estimates/{id}/close and /reopen
 * (lifecycle.routes.ts) against the real Postgres, plus the closed-state
 * refusal of the write path (estimates.repo.ts `updateEstimate`).
 *
 * Same harness as collaborators.routes.test.ts: a test-only auth middleware
 * (`Bearer test|<userId>|<email>`) instead of mocking the real jwtMiddleware —
 * estimates.routes.test.ts owns that mock — and injected doubles for the CRM
 * notifier and identity resolver, so nothing leaks across test files through
 * `mock.module()`.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { Effect } from "effect";
import type { JwtVariables } from "@/auth/jwt.middleware";

process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5435/estimai";
process.env["ALLOWED_ORIGINS"] ??= "http://localhost:5173";
process.env["AUTH_JWKS_URL"] ??= "http://localhost:3001/auth/jwks";
process.env["AUTH_ISSUER"] ??= "http://localhost:3001";
process.env["AUTH_AUDIENCE"] ??= "operai-suite";
process.env["NODE_ENV"] = "test";
process.env["AUTH_BASE_URL"] ??= "http://localhost:3001";
process.env["SERVICE_CLIENT_ID"] ??= "estimai-api";
process.env["SERVICE_CLIENT_SECRET"] ??= "test-service-client-secret-at-least-32-characters";
process.env["NOTIFY_INTERNAL_URL"] ??= "http://localhost:8081";

// DATABASE_URL from the dotenv file, PARSED (never loaded into process.env) —
// same technique and reason as collaborators.routes.test.ts.
import { parse as dotenvParse } from "dotenv";
import { readFileSync } from "node:fs";

const dotenvDatabaseUrl = (() => {
  try {
    return dotenvParse(readFileSync(new URL("../../.env", import.meta.url).pathname))[
      "DATABASE_URL"
    ];
  } catch {
    return undefined;
  }
})();

const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const freshDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: dotenvDatabaseUrl ?? process.env["DATABASE_URL"]! }),
});
mock.module("@/lib/db", () => ({ db: freshDb }));
const testDb = freshDb;

const { registerEstimateLifecycleRoutes } = await import("./lifecycle.routes");
const { updateEstimate } = await import("./estimates.repo");
type SendEstimateNotice = import("@/lib/crmNotices").SendEstimateNotice;
type EstimateNotice = import("@/lib/crmNotices").EstimateNotice;
type ResolveIdentitiesFn = typeof import("@/lib/authClient").resolveIdentities;

// ─── Harness ─────────────────────────────────────────────────────────────────

const TEST_BEARER_PREFIX = "Bearer test|";

const testAuthMiddleware = createMiddleware<{ Variables: JwtVariables }>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith(TEST_BEARER_PREFIX)) {
    return c.json({ type: "about:blank", title: "Unauthorized", status: 401, detail: "", instance: c.req.path }, 401);
  }
  const [userId, email] = header.slice(TEST_BEARER_PREFIX.length).split("|");
  c.set("userId", userId!);
  c.set("email", email!);
  return next();
});

interface Harness {
  readonly app: Hono;
  readonly notices: EstimateNotice[];
}

const identitiesOf =
  (names: Record<string, string>): ResolveIdentitiesFn =>
  async (_auth, ids) =>
    new Map(
      ids
        .filter((id) => names[id] !== undefined)
        .map((id) => [id, { id, status: "active" as const, name: names[id]! }]),
    );

function buildApp(
  opts: { send?: SendEstimateNotice; resolveIdentities?: ResolveIdentitiesFn } = {},
): Harness {
  const notices: EstimateNotice[] = [];
  const router = new OpenAPIHono<{ Variables: JwtVariables }>();
  router.use("*", testAuthMiddleware);
  registerEstimateLifecycleRoutes(router, {
    sendEstimateNotice:
      opts.send ??
      (async (n) => {
        notices.push(n);
      }),
    resolveIdentities: opts.resolveIdentities ?? (async () => new Map()),
  });
  const app = new Hono();
  app.route("/", router);
  return { app, notices };
}

const auth = (userId: string) => ({ Authorization: `Bearer test|${userId}|${userId}@example.com` });

let counter = 0;
const ownersToClean = new Set<string>();
const freshOwner = () => {
  counter += 1;
  const id = `lc-owner-${counter}-${Date.now()}`;
  ownersToClean.add(id);
  return id;
};

const content = { params: {}, releases: [], acts: [] };

const seed = async (ownerId: string, extra: { closedAt?: Date; closedByUserId?: string } = {}) =>
  testDb.estimate.create({
    data: {
      userId: ownerId,
      name: "Lifecycle fixture",
      author: "",
      sizeBytes: JSON.stringify(content).length,
      content,
      ...extra,
    },
  });

const grant = (estimateId: string, userId: string, accessLevel: "viewer" | "editor") =>
  testDb.estimateCollaborator.create({
    data: { estimateId, userId, email: `${userId}@example.com`, accessLevel, grantedByUserId: "x" },
  });

const post = (h: Harness, id: string, action: "close" | "reopen", userId: string, ifMatch?: string) =>
  h.app.request(`/estimates/${id}/${action}`, {
    method: "POST",
    headers: { ...auth(userId), ...(ifMatch !== undefined ? { "If-Match": ifMatch } : {}) },
  });

afterEach(async () => {
  if (ownersToClean.size > 0) {
    await testDb.estimate.deleteMany({ where: { userId: { in: Array.from(ownersToClean) } } });
    ownersToClean.clear();
  }
});

interface FullBody {
  id: string;
  version: number;
  access: string;
  closedAt: string | null;
  closedBy: { status: string; name: string | null } | null;
  owner: { status: string; name: string | null } | null;
  collaboratorCount?: number;
}

// ─── Happy paths ─────────────────────────────────────────────────────────────

describe("POST /estimates/{id}/close — happy path", () => {
  it("owner closes: 200, version+1, ETag, closedAt/closedBy set, DB stamped, notice sent with the exact body", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp({ resolveIdentities: identitiesOf({ [owner]: "Olivia Owner" }) });

    const res = await post(h, est.id, "close", owner, '"1"');

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2"');
    const body = (await res.json()) as FullBody;
    expect(body.version).toBe(2);
    expect(body.access).toBe("owner");
    expect(body.owner).toBeNull();
    expect(body.closedAt).not.toBeNull();
    expect(body.closedBy).toEqual({ status: "active", name: "Olivia Owner" });
    expect(body.collaboratorCount).toBe(0);

    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.version).toBe(2);
    expect(row.closedByUserId).toBe(owner);
    expect(row.lastModifiedByUserId).toBe(owner);
    expect(row.closedAt?.toISOString()).toBe(body.closedAt!);

    expect(h.notices).toEqual([
      { estimateId: est.id, event: "closed", version: 2, at: body.closedAt!, byUserId: owner },
    ]);
  });

  it("an editor collaborator may close; the owner identity is resolved for them", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    await grant(est.id, "lc-editor", "editor");
    const h = buildApp({
      resolveIdentities: identitiesOf({ [owner]: "Olivia Owner", "lc-editor": "Ed Editor" }),
    });

    const res = await post(h, est.id, "close", "lc-editor", '"1"');

    expect(res.status).toBe(200);
    const body = (await res.json()) as FullBody;
    expect(body.access).toBe("editor");
    expect(body.owner).toEqual({ status: "active", name: "Olivia Owner" });
    expect(body.closedBy).toEqual({ status: "active", name: "Ed Editor" });
    expect(body.collaboratorCount).toBeUndefined();
    expect(h.notices.map((n) => [n.event, n.byUserId, n.version])).toEqual([["closed", "lc-editor", 2]]);
  });

  it("closedBy fails soft to unknown when auth cannot resolve it — the close still succeeds", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp({ resolveIdentities: async () => new Map() });

    const res = await post(h, est.id, "close", owner, '"1"');

    expect(res.status).toBe(200);
    expect(((await res.json()) as FullBody).closedBy).toEqual({ status: "unknown", name: null });
  });

  it("a notice that throws never fails or rolls back the close", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const originalError = console.error;
    console.error = () => {};
    try {
      const h = buildApp({
        send: async () => {
          throw new Error("crm-api down (test double)");
        },
      });
      const res = await post(h, est.id, "close", owner, '"1"');
      expect(res.status).toBe(200);
    } finally {
      console.error = originalError;
    }
    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.closedAt).not.toBeNull();
  });
});

describe("POST /estimates/{id}/reopen — happy path", () => {
  it("reopens a closed estimate: 200, version+1, closedAt/closedBy cleared, reopened notice", async () => {
    const owner = freshOwner();
    const h = buildApp();
    const est = await seed(owner);
    expect((await post(h, est.id, "close", owner, '"1"')).status).toBe(200);
    await grant(est.id, "lc-editor-2", "editor");

    const res = await post(h, est.id, "reopen", "lc-editor-2", '"2"');

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"3"');
    const body = (await res.json()) as FullBody & { updatedAt: string };
    expect(body.version).toBe(3);
    expect(body.closedAt).toBeNull();
    expect(body.closedBy).toBeNull();

    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.closedAt).toBeNull();
    expect(row.closedByUserId).toBeNull();
    expect(row.lastModifiedByUserId).toBe("lc-editor-2");

    expect(h.notices[1]).toEqual({
      estimateId: est.id,
      event: "reopened",
      version: 3,
      at: body.updatedAt,
      byUserId: "lc-editor-2",
    });
  });
});

// ─── Denials ─────────────────────────────────────────────────────────────────

describe("close/reopen — denial taxonomy and preconditions (no notice on any refusal)", () => {
  for (const action of ["close", "reopen"] as const) {
    it(`${action}: a viewer gets 403 insufficient_access even with a correct If-Match`, async () => {
      const owner = freshOwner();
      const est = await seed(owner, action === "reopen" ? { closedAt: new Date(), closedByUserId: owner } : {});
      await grant(est.id, "lc-viewer", "viewer");
      const h = buildApp();

      const res = await post(h, est.id, action, "lc-viewer", '"1"');

      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("insufficient_access");
      expect(h.notices).toEqual([]);
      expect((await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } })).version).toBe(1);
    });

    it(`${action}: a stranger gets 404, identical to an absent id`, async () => {
      const owner = freshOwner();
      const est = await seed(owner);
      const h = buildApp();

      const stranger = await post(h, est.id, action, "lc-stranger", '"1"');
      const absent = await post(h, "does-not-exist", action, "lc-stranger", '"1"');

      expect(stranger.status).toBe(404);
      expect(absent.status).toBe(404);
      const a = (await stranger.json()) as { detail: string; title: string };
      const b = (await absent.json()) as { detail: string; title: string };
      expect(a.title).toBe(b.title);
      expect(h.notices).toEqual([]);
    });

    it(`${action}: missing or malformed If-Match → 428 precondition_required, nothing written`, async () => {
      const owner = freshOwner();
      const est = await seed(owner, action === "reopen" ? { closedAt: new Date(), closedByUserId: owner } : {});
      const h = buildApp();

      for (const ifMatch of [undefined, "1", '"0"', "*", '"abc"']) {
        const res = await post(h, est.id, action, owner, ifMatch);
        expect(res.status).toBe(428);
        expect(((await res.json()) as { code: string }).code).toBe("precondition_required");
      }
      expect(h.notices).toEqual([]);
      expect((await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } })).version).toBe(1);
    });

    it(`${action}: 428 comes before 404 — a stranger without If-Match learns nothing`, async () => {
      const h = buildApp();
      const res = await post(h, "does-not-exist", action, "lc-stranger");
      expect(res.status).toBe(428);
    });
  }

  it("close with a stale If-Match → 409 estimate_version_conflict (PUT's shape), nothing written", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    await testDb.estimate.update({
      where: { id: est.id },
      data: { version: 3, lastModifiedByUserId: "lc-someone" },
    });
    const h = buildApp({ resolveIdentities: identitiesOf({ "lc-someone": "Sam Someone" }) });

    const res = await post(h, est.id, "close", owner, '"2"');

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      currentVersion: number;
      updatedAt: string;
      lastModifiedBy: { status: string; name: string | null };
    };
    expect(body.code).toBe("estimate_version_conflict");
    expect(body.currentVersion).toBe(3);
    expect(typeof body.updatedAt).toBe("string");
    expect(body.lastModifiedBy).toEqual({ status: "active", name: "Sam Someone" });
    expect(h.notices).toEqual([]);
    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.closedAt).toBeNull();
    expect(row.version).toBe(3);
  });

  it("closing an already closed estimate → 409 estimate_already_closed (even with the current version)", async () => {
    const owner = freshOwner();
    const est = await seed(owner, { closedAt: new Date(), closedByUserId: owner });
    const h = buildApp();

    const res = await post(h, est.id, "close", owner, '"1"');

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("estimate_already_closed");
    expect(h.notices).toEqual([]);
    expect((await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } })).version).toBe(1);
  });

  it("reopening an open estimate → 409 estimate_not_closed", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp();

    const res = await post(h, est.id, "reopen", owner, '"1"');

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("estimate_not_closed");
    expect(h.notices).toEqual([]);
  });

  it("two concurrent closes with the same version: exactly one wins, one notice", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    await grant(est.id, "lc-editor-3", "editor");
    const h = buildApp();

    const [a, b] = await Promise.all([
      post(h, est.id, "close", owner, '"1"'),
      post(h, est.id, "close", "lc-editor-3", '"1"'),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h.notices.length).toBe(1);
    expect((await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } })).version).toBe(2);
  });
});

// ─── The write path refuses a closed estimate ───────────────────────────────

describe("a closed estimate is read-only (updateEstimate)", () => {
  it("a PUT-equivalent write with the CURRENT version fails with estimate_closed and writes nothing", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp();
    expect((await post(h, est.id, "close", owner, '"1"')).status).toBe(200);

    const exit = await Effect.runPromiseExit(updateEstimate(est.id, owner, 2, "changed", "", content));

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("EstimateStateError");
      expect((exit.cause.error as { code: string }).code).toBe("estimate_closed");
    } else {
      throw new Error("expected a typed failure");
    }
    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.name).toBe("Lifecycle fixture");
    expect(row.version).toBe(2);
  });

  it("after reopen, a write with the new version succeeds again", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp();
    await post(h, est.id, "close", owner, '"1"');
    await post(h, est.id, "reopen", owner, '"2"');

    const exit = await Effect.runPromiseExit(updateEstimate(est.id, owner, 3, "changed", "", content));

    expect(exit._tag).toBe("Success");
  });
});

// ─── specs/024 — oversight: a read-all holder with no relationship may not close/reopen ──

describe("close/reopen by an oversight-only caller (specs/024, AC-1.4)", () => {
  const REAL_FETCH = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = REAL_FETCH;
  });

  /** Stubs `auth GET /authz/resolve`: holds `estimate:read-all`, holds nothing, or is down. */
  const stubResolve = (answer: "holds" | "none" | "down") => {
    globalThis.fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
      if (!String(url).endsWith("/authz/resolve")) return REAL_FETCH(url, init);
      if (answer === "down") throw new Error("simulated auth outage");
      return new Response(
        JSON.stringify({
          sub: "x",
          epoch: 1,
          permissions: answer === "holds" ? [{ resource: "estimate", action: "read-all", conditions: null }] : [],
          entity: null,
          jobTitle: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
  };

  it.each(["close", "reopen"] as const)("%s → 403 oversight_read_only, nothing written, no notice", async (action) => {
    const owner = freshOwner();
    const est = await seed(owner, action === "reopen" ? { closedAt: new Date(), closedByUserId: owner } : {});
    stubResolve("holds");
    const h = buildApp();

    const res = await post(h, est.id, action, "lc-admin", '"1"');

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("oversight_read_only");
    const row = await testDb.estimate.findUniqueOrThrow({ where: { id: est.id } });
    expect(row.version).toBe(1);
    expect((row.closedAt !== null)).toBe(action === "reopen");
    expect(h.notices).toEqual([]);
  });

  it("a stranger without the permission still gets 404, and so does a holder when auth is down or the id is absent", async () => {
    const owner = freshOwner();
    const est = await seed(owner);
    const h = buildApp();

    stubResolve("none");
    expect((await post(h, est.id, "close", "lc-stranger", '"1"')).status).toBe(404);
    stubResolve("down");
    const spy = console.error;
    console.error = () => {};
    try {
      expect((await post(h, est.id, "close", "lc-admin", '"1"')).status).toBe(404);
    } finally {
      console.error = spy;
    }
    stubResolve("holds");
    expect((await post(h, "does-not-exist", "close", "lc-admin", '"1"')).status).toBe(404);
  });
});
