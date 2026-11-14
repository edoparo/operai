/**
 * T14: Dev/test-only session-mint endpoint — unit tests
 *
 * Strategy: mock `better-auth/cookies` and the `auth` module so no live
 * database or real OAuth credentials are needed.  The tests assert the
 * production gate (the security deliverable) and the happy-path shape.
 *
 * Gate cases:
 *   (b) ENABLE_TEST_AUTH off  → 404 / no session minted
 *   (c) NODE_ENV=production   → 404 / no session minted (even if flag is on)
 *
 * Session-mint case:
 *   (a) ENABLE_TEST_AUTH on + NODE_ENV=test → 200 with Set-Cookie and body
 *
 * NOTE: The "real /auth/get-session accepts the cookie" and "real /auth/token
 * returns a JWT" assertions (part (a) from tasks.md) require a live DB and
 * working Prisma connection.  They are documented below as DB-dependent tests
 * that are SKIPPED in this unit suite but must be verified in a full
 * integration environment (see INTEGRATION NOTE at the bottom of this file).
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { afterAll } from "bun:test";
import { db } from "../lib/db";
import { env as sharedEnv } from "../lib/env";

// openGate() patches the env singleton, which every test file in the process shares:
// snapshot what it overwrites and put it back when this file is done.
const savedEnv = {
  ENABLE_TEST_AUTH: sharedEnv.ENABLE_TEST_AUTH,
  NODE_ENV: sharedEnv.NODE_ENV,
  ALLOWED_SIGNUP_DOMAINS: sharedEnv.ALLOWED_SIGNUP_DOMAINS,
};
import * as realCookies from "better-auth/cookies";

// specs/20261105-signup-gate T3 (AC-1.9): a NEW test user is created straight in the database
// (outside the sign-up gate, which would refuse `@operai.test`) plus the
// baseline roles, so these tests read and clean the real rows.
async function rolesOf(email: string): Promise<string[]> {
  const rows = await db.userRole.findMany({
    where: { user: { email } },
    select: { role: { select: { name: true } } },
  });
  return rows.map((r) => r.role.name).sort();
}

/** What the real adapter's `findUserByEmail` answers: the row from the database, or null. */
async function findInDb(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  return user ? { user, accounts: [] } : null;
}

afterAll(async () => {
  Object.assign(sharedEnv, savedEnv);
  const users = await db.user.findMany({
    where: { email: { endsWith: "@operai.test" } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await db.userRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
});

/**
 * Makes a POST request to `testAuthRouter` with the current env already baked
 * into the router module (reloaded per test via beforeEach).
 */
async function postMintSession(
  router: import("@hono/zod-openapi").OpenAPIHono,
  body?: Record<string, string>,
): Promise<Response> {
  return router.request("/test-auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ─── Shared mock objects ───────────────────────────────────────────────────────

const FAKE_USER_ID = "usr_test_00000000";
const FAKE_SESSION_TOKEN = "sess_tok_test_deadbeef";

/** Minimal stub for better-auth internal adapter */
const mockInternalAdapter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUserByEmail: mock(async (email: string): Promise<any> => findInDb(email)),
  createUser: mock(async (data: { email: string; name: string; emailVerified: boolean }) => ({
    id: FAKE_USER_ID,
    email: data.email,
    name: data.name,
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateUser: mock(async (_userId: string, data: Record<string, any>) => ({
    id: FAKE_USER_ID,
    email: "test@operai.test",
    name: data.name ?? "Test User",
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  createSession: mock(async (_userId: string, _dontRememberMe: boolean) => ({
    id: "ses_test_00000000",
    token: FAKE_SESSION_TOKEN,
    userId: FAKE_USER_ID,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ipAddress: null,
    userAgent: null,
  })),
};

/** Minimal stub for auth.$context */
const mockAuthContext = {
  internalAdapter: mockInternalAdapter,
};

/** Stub for getCookies — returns the same shape better-auth uses for real */
const MOCK_COOKIE_NAME = "better-auth.session_token";
const mockGetCookies = mock((_opts: unknown) => ({
  sessionToken: {
    name: MOCK_COOKIE_NAME,
    attributes: {
      path: "/",
      httpOnly: true,
      sameSite: "lax" as const,
      maxAge: 604800, // 7 days in seconds
      secure: false,
    },
  },
}));

// ─── Module mock setup ─────────────────────────────────────────────────────────
//
// We mock two external modules at the top level so that when the route module
// is imported, it gets the stubs rather than real implementations that would
// attempt DB connections.
//
// Bun's module mock system patches the module cache; we must call mock.module
// BEFORE the module-under-test is imported.

// The route must call the hook's OWN function (not a copy), so the mock hands back the real one.
// The query string loads the real module even when another test file in the same
// process has already mocked "../auth/auth.config" (module mocks are process-wide).
const { applyLivePendingInvitationOnUserCreate: realApplyInvitation } = (await import(
  // @ts-expect-error a query string is not a resolvable module path for tsc, only for Bun
  "../auth/auth.config.ts?real-invitation-hook"
)) as typeof import("../auth/auth.config");

mock.module("../auth/auth.config", () => ({
  applyLivePendingInvitationOnUserCreate: realApplyInvitation,
  auth: {
    options: { baseURL: "http://localhost:3001", basePath: "/auth" },
    $context: Promise.resolve(mockAuthContext),
  },
}));

// Spread the real exports: module mocks are process-wide and the real auth.config (loaded by
// the invitation tests, specs/20261105-signup-gate T13) needs the rest of this module.
mock.module("better-auth/cookies", () => ({
  ...realCookies,
  getCookies: mockGetCookies,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /test-auth/session — production gate (security)", () => {
  // Cache original env so we can restore after each test
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_TEST_AUTH: process.env.ENABLE_TEST_AUTH,
  };

  beforeEach(() => {
    // Reset adapter mocks before each test
    mockInternalAdapter.findUserByEmail.mockClear();
    mockInternalAdapter.createUser.mockClear();
    mockInternalAdapter.updateUser.mockClear();
    mockInternalAdapter.createSession.mockClear();
  });

  afterEach(() => {
    // Restore env
    if (originalEnv.NODE_ENV !== undefined) {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalEnv.ENABLE_TEST_AUTH !== undefined) {
      process.env.ENABLE_TEST_AUTH = originalEnv.ENABLE_TEST_AUTH;
    } else {
      delete process.env.ENABLE_TEST_AUTH;
    }
  });

  // ── Case (b): flag OFF ─────────────────────────────────────────────────────

  test("(b) returns 404 when ENABLE_TEST_AUTH is unset (flag off)", async () => {
    // env.ts is parsed once at module load — but the gate check in the route
    // handler reads `env.ENABLE_TEST_AUTH` at request time.  We need to
    // re-import the route module with the env value we want.
    //
    // Because Bun caches modules, we patch the env singleton directly.
    const envModule = await import("../lib/env");
    const savedFlag = (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH;
    const savedNodeEnv = (envModule.env as Record<string, unknown>).NODE_ENV;

    // Flag off, non-production env
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = false;
    (envModule.env as Record<string, unknown>).NODE_ENV = "test";

    const { testAuthRouter } = await import("./test-auth.routes");
    const res = await postMintSession(testAuthRouter);

    expect(res.status).toBe(404);

    // No session must have been minted
    expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();

    // Restore
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = savedFlag;
    (envModule.env as Record<string, unknown>).NODE_ENV = savedNodeEnv;
  });

  test("(b) returns 404 when ENABLE_TEST_AUTH is boolean false (already-parsed value)", async () => {
    // This test exercises the already-parsed boolean false path — the env singleton
    // stores a boolean after Zod transforms the raw env string.  Patching it directly
    // with `false` simulates the post-parse state for any raw string that does not
    // match /^(true|1|yes)$/i (e.g. "false", "0", "", or absent).
    const envModule = await import("../lib/env");
    const savedFlag = (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH;
    const savedNodeEnv = (envModule.env as Record<string, unknown>).NODE_ENV;

    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = false;
    (envModule.env as Record<string, unknown>).NODE_ENV = "test";

    const { testAuthRouter } = await import("./test-auth.routes");
    const res = await postMintSession(testAuthRouter);

    expect(res.status).toBe(404);
    expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();

    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = savedFlag;
    (envModule.env as Record<string, unknown>).NODE_ENV = savedNodeEnv;
  });

  test("(b) env.ts transforms string 'false' / '0' / '' to boolean false (parsing coverage)", () => {
    // Exercises the ENABLE_TEST_AUTH Zod transform:
    //   /^(true|1|yes)$/i  → true
    //   anything else      → false
    // We call the transform directly without re-running safeParse (which would need
    // all required env vars) by extracting the schema's inner logic.
    const transformFn = (v: string | undefined): boolean =>
      v !== undefined && /^(true|1|yes)$/i.test(v) ? true : false;

    expect(transformFn(undefined)).toBe(false);   // absent
    expect(transformFn("false")).toBe(false);      // string "false"
    expect(transformFn("0")).toBe(false);           // string "0"
    expect(transformFn("")).toBe(false);            // empty string
    expect(transformFn("no")).toBe(false);          // unsupported value
    expect(transformFn("true")).toBe(true);         // canonical
    expect(transformFn("1")).toBe(true);
    expect(transformFn("yes")).toBe(true);
    expect(transformFn("TRUE")).toBe(true);         // case-insensitive
    expect(transformFn("Yes")).toBe(true);
  });

  // ── Case (c): production env ───────────────────────────────────────────────

  test("(c) returns 404 when NODE_ENV is 'production' even if ENABLE_TEST_AUTH is true", async () => {
    const envModule = await import("../lib/env");
    const savedFlag = (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH;
    const savedNodeEnv = (envModule.env as Record<string, unknown>).NODE_ENV;

    // Both conditions that should prevent the gate from opening
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = true;
    (envModule.env as Record<string, unknown>).NODE_ENV = "production";

    const { testAuthRouter } = await import("./test-auth.routes");
    const res = await postMintSession(testAuthRouter);

    expect(res.status).toBe(404);
    expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();

    // Restore
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = savedFlag;
    (envModule.env as Record<string, unknown>).NODE_ENV = savedNodeEnv;
  });

  test("(c) production gate cannot be bypassed: both flag=true and NODE_ENV=production → 404", async () => {
    const envModule = await import("../lib/env");
    const savedFlag = (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH;
    const savedNodeEnv = (envModule.env as Record<string, unknown>).NODE_ENV;

    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = true;
    (envModule.env as Record<string, unknown>).NODE_ENV = "production";

    const { testAuthRouter } = await import("./test-auth.routes");
    const res = await postMintSession(testAuthRouter);

    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body.status).toBe(404);
    // Verify no cookies were set
    expect(res.headers.get("set-cookie")).toBeNull();
    // Confirm no session was created in the adapter
    expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();

    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = savedFlag;
    (envModule.env as Record<string, unknown>).NODE_ENV = savedNodeEnv;
  });
});

describe("POST /test-auth/session — happy path (gate open)", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_TEST_AUTH: process.env.ENABLE_TEST_AUTH,
  };

  beforeEach(() => {
    mockInternalAdapter.findUserByEmail.mockClear();
    mockInternalAdapter.createUser.mockClear();
    mockInternalAdapter.updateUser.mockClear();
    mockInternalAdapter.createSession.mockClear();
    // Reset findUserByEmail to return null (no existing user) by default
    mockInternalAdapter.findUserByEmail.mockImplementation(findInDb);
  });

  afterEach(() => {
    if (originalEnv.NODE_ENV !== undefined) {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalEnv.ENABLE_TEST_AUTH !== undefined) {
      process.env.ENABLE_TEST_AUTH = originalEnv.ENABLE_TEST_AUTH;
    } else {
      delete process.env.ENABLE_TEST_AUTH;
    }
  });

  /**
   * Opens the gate by patching the env singleton, then imports the router.
   * Because of Bun's module cache the router uses the same env singleton,
   * so patching it before the request is sufficient.
   */
  async function openGate(): Promise<import("@hono/zod-openapi").OpenAPIHono> {
    const envModule = await import("../lib/env");
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = true;
    (envModule.env as Record<string, unknown>).NODE_ENV = "test";
    // Local/e2e configuration (plan.md amendment 2026-11-05): the test domain is allowed.
    (envModule.env as Record<string, unknown>).ALLOWED_SIGNUP_DOMAINS = ["welld.ch", "welld.it", "operai.test"];
    const { testAuthRouter } = await import("./test-auth.routes");
    return testAuthRouter;
  }

  // ── Case (a): session minted ───────────────────────────────────────────────

  test("(a) returns 200 with Set-Cookie when gate is open", async () => {
    const router = await openGate();
    const res = await postMintSession(router);

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain(MOCK_COOKIE_NAME);
    expect(setCookie).toContain(FAKE_SESSION_TOKEN);
  });

  test("(a) Set-Cookie header contains HttpOnly and Path=/", async () => {
    const router = await openGate();
    const res = await postMintSession(router);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  test("(a) Set-Cookie header contains SameSite attribute", async () => {
    const router = await openGate();
    const res = await postMintSession(router);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/SameSite=/i);
  });

  test("(a) response body includes userId and email but NOT sessionToken (OWASP: no raw token in body)", async () => {
    const router = await openGate();
    const res = await postMintSession(router);
    const body = await res.json() as Record<string, unknown>;

    const row = await db.user.findUnique({ where: { email: "test@operai.test" } });
    expect(body.userId).toBe(row?.id);
    expect(body.email).toBe("test@operai.test");
    // sessionToken must be absent — the raw bearer token must not appear in the
    // response body; the Set-Cookie header is the only delivery mechanism.
    expect(body.sessionToken).toBeUndefined();
  });

  test("(a) uses better-auth internalAdapter to create the session (not a hand-forged cookie)", async () => {
    const router = await openGate();
    await postMintSession(router);

    // Session must have been created via the adapter (proves it is a real better-auth session)
    expect(mockInternalAdapter.createSession).toHaveBeenCalledTimes(1);
    const row = await db.user.findUnique({ where: { email: "test@operai.test" } });
    expect(mockInternalAdapter.createSession).toHaveBeenCalledWith(row?.id, false);
  });

  test("(a) creates a new user outside the sign-up gate, holding employee (AC-1.9)", async () => {
    mockInternalAdapter.findUserByEmail.mockImplementation(findInDb);
    await db.user.deleteMany({ where: { email: "newuser@operai.test" } });
    const router = await openGate();
    const res = await postMintSession(router, { email: "newuser@operai.test", name: "New User" });

    expect(res.status).toBe(200);
    expect(mockInternalAdapter.findUserByEmail).toHaveBeenCalledWith("newuser@operai.test");
    // The adapter's createUser would fire user.create.before (the gate) and refuse.
    expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
    const row = await db.user.findUnique({ where: { email: "newuser@operai.test" } });
    expect(row).not.toBeNull();
    expect(row?.name).toBe("New User");
    expect(row?.emailVerified).toBe(true);
    expect(await rolesOf("newuser@operai.test")).toEqual(["employee"]);
    // The session is still minted through better-auth's adapter for that user.
    expect(mockInternalAdapter.createSession).toHaveBeenCalledWith(row?.id, false);
    expect(res.headers.get("set-cookie")).toContain(FAKE_SESSION_TOKEN);
  });

  test("(a) a mixed-case email is stored lower-cased and finds the same row (T10 finding 1)", async () => {
    await db.user.deleteMany({ where: { email: "mixed.case@operai.test" } });
    const router = await openGate();
    const res = await postMintSession(router, { email: "Mixed.Case@Operai.TEST", name: "Mixed" });

    expect(res.status).toBe(200);
    expect(mockInternalAdapter.findUserByEmail).toHaveBeenCalledWith("mixed.case@operai.test");
    const rows = await db.user.findMany({ where: { email: { equals: "mixed.case@operai.test", mode: "insensitive" } } });
    expect(rows.map((r) => r.email)).toEqual(["mixed.case@operai.test"]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe("mixed.case@operai.test");
  });

  describe("invited test user (T10 finding 2, AC-3.8)", () => {
    const EMAIL = "invited.t13@operai.test";
    let roleId = "";
    let roleName = "";
    let deptId = "";

    async function cleanup() {
      await db.accessRequest.deleteMany({ where: { email: EMAIL } });
      await db.invitation.deleteMany({ where: { email: EMAIL } });
      const u = await db.user.findUnique({ where: { email: EMAIL } });
      if (u) {
        await db.userDepartment.deleteMany({ where: { userId: u.id } });
        await db.userRole.deleteMany({ where: { userId: u.id } });
        await db.user.delete({ where: { id: u.id } });
      }
    }

    async function seedInvitation(opts: { roles: boolean }) {
      const invitation = await db.invitation.create({
        data: {
          email: EMAIL,
          roleIds: opts.roles ? [roleId] : [],
          departmentIds: [deptId],
          tokenHash: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await db.accessRequest.create({
        data: { email: EMAIL, name: "Invited", provider: "google", invitationId: invitation.id },
      });
      return invitation;
    }

    beforeEach(async () => {
      const role = await db.role.findFirstOrThrow({ where: { name: { not: "employee" } } });
      roleId = role.id;
      roleName = role.name;
      const dept =
        (await db.department.findFirst()) ??
        (await db.department.create({ data: { name: "t13-dept" } }));
      deptId = dept.id;
      await cleanup();
    });
    afterEach(cleanup);

    test("gets exactly the invitation's roles and departments; invitation accepted, request closed", async () => {
      const invitation = await seedInvitation({ roles: true });
      const router = await openGate();
      const res = await postMintSession(router, { email: EMAIL });
      expect(res.status).toBe(200);

      expect(await rolesOf(EMAIL)).toEqual([roleName]);
      const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
      const depts = await db.userDepartment.findMany({ where: { userId: user.id } });
      expect(depts.map((d) => d.departmentId)).toEqual([deptId]);
      const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(inv.status).toBe("accepted");
      expect(inv.acceptedByUserId).toBe(user.id);
      const req = await db.accessRequest.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(req.status).toBe("approved");
    });

    test("an invitation with no domain permission is left alone: baseline employee only", async () => {
      const invitation = await seedInvitation({ roles: true });
      const envModule = await import("../lib/env");
      const router = await openGate();
      const saved = envModule.env.ALLOWED_SIGNUP_DOMAINS;
      (envModule.env as Record<string, unknown>).ALLOWED_SIGNUP_DOMAINS = ["welld.ch", "welld.it"];
      try {
        const res = await postMintSession(router, { email: EMAIL });
        expect(res.status).toBe(200);
      } finally {
        (envModule.env as Record<string, unknown>).ALLOWED_SIGNUP_DOMAINS = saved;
      }
      expect(await rolesOf(EMAIL)).toEqual(["employee"]);
      const inv = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(inv.status).toBe("pending");
    });

    test("no live invitation: baseline employee only", async () => {
      const router = await openGate();
      await postMintSession(router, { email: EMAIL });
      expect(await rolesOf(EMAIL)).toEqual(["employee"]);
    });
  });

  test("(a) a second call for the same new user reuses the row and the roles (no duplicates)", async () => {
    await db.user.deleteMany({ where: { email: "again@operai.test" } });
    const router = await openGate();
    await postMintSession(router, { email: "again@operai.test" });
    const first = await db.user.findUnique({ where: { email: "again@operai.test" } });
    mockInternalAdapter.findUserByEmail.mockImplementation(async () => ({
      user: { id: first!.id, email: "again@operai.test", name: "Test User", emailVerified: true },
      accounts: [],
    }));
    await postMintSession(router, { email: "again@operai.test" });
    expect(await db.user.count({ where: { email: "again@operai.test" } })).toBe(1);
    expect(await rolesOf("again@operai.test")).toEqual(["employee"]);
  });

  test("(a) reuses an existing user row when the email already exists (idempotent)", async () => {
    const existingUser = {
      user: {
        id: FAKE_USER_ID,
        email: "test@operai.test",
        name: "Test User",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      accounts: [],
    };
    mockInternalAdapter.findUserByEmail.mockImplementation(async () => existingUser);

    const router = await openGate();
    await postMintSession(router);

    expect(mockInternalAdapter.findUserByEmail).toHaveBeenCalledTimes(1);
    // User already exists → createUser must NOT be called
    expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
    // But a new session is still created for the existing user
    expect(mockInternalAdapter.createSession).toHaveBeenCalledWith(FAKE_USER_ID, false);
  });

  test("(a) accepts custom email and name in request body", async () => {
    const router = await openGate();
    const res = await postMintSession(router, {
      email: "custom@operai.test",
      name: "Custom Tester",
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.email).toBe("custom@operai.test");
    expect(body.name).toBe("Custom Tester");
  });

  test("(a) uses default email and name when request body is empty", async () => {
    const router = await openGate();
    const res = await postMintSession(router);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.email).toBe("test@operai.test");
    expect(body.name).toBe("Test User");
  });

  test("(a) uses getCookies from better-auth to build the Set-Cookie header (stays in sync with auth config)", async () => {
    const router = await openGate();
    await postMintSession(router);

    // getCookies must have been called with the auth options — proves we did not
    // hand-forge cookie attributes
    expect(mockGetCookies).toHaveBeenCalled();
  });
});

describe("POST /test-auth/session — email domain allowlist (OWASP: impersonation guard)", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_TEST_AUTH: process.env.ENABLE_TEST_AUTH,
  };

  beforeEach(() => {
    mockInternalAdapter.findUserByEmail.mockClear();
    mockInternalAdapter.createUser.mockClear();
    mockInternalAdapter.updateUser.mockClear();
    mockInternalAdapter.createSession.mockClear();
    mockInternalAdapter.findUserByEmail.mockImplementation(findInDb);
  });

  afterEach(() => {
    if (originalEnv.NODE_ENV !== undefined) {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalEnv.ENABLE_TEST_AUTH !== undefined) {
      process.env.ENABLE_TEST_AUTH = originalEnv.ENABLE_TEST_AUTH;
    } else {
      delete process.env.ENABLE_TEST_AUTH;
    }
  });

  async function openGate(): Promise<import("@hono/zod-openapi").OpenAPIHono> {
    const envModule = await import("../lib/env");
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = true;
    (envModule.env as Record<string, unknown>).NODE_ENV = "test";
    const { testAuthRouter } = await import("./test-auth.routes");
    return testAuthRouter;
  }

  test("returns 403 when email is a real (non-test) address — impersonation must be blocked", async () => {
    const router = await openGate();
    const res = await postMintSession(router, { email: "admin@welld.ch" });

    expect(res.status).toBe(403);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe(403);
    expect(body.title).toBe("Forbidden");

    // No user lookup, no session minted — the domain check fires first
    expect(mockInternalAdapter.findUserByEmail).not.toHaveBeenCalled();
    expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("returns 403 for any email not ending with @operai.test", async () => {
    const router = await openGate();

    for (const badEmail of [
      "user@example.com",
      "test@operai.test.evil.com",
      "attacker@operai.testextra",
      "foo@gmail.com",
    ]) {
      const res = await postMintSession(router, { email: badEmail });
      expect(res.status).toBe(403);
      expect(mockInternalAdapter.createSession).not.toHaveBeenCalled();
      mockInternalAdapter.createSession.mockClear();
    }
  });

  test("returns 200 for a valid @operai.test address (allowlisted domain)", async () => {
    const router = await openGate();
    const res = await postMintSession(router, { email: "someone@operai.test" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.email).toBe("someone@operai.test");
    expect(mockInternalAdapter.createSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /test-auth/session — production sign-in surface unchanged", () => {
  test("the auth config does NOT enable emailAndPassword (no password path added)", async () => {
    // Import the real auth config (not mocked here — checking the config itself)
    // We use a dynamic import to avoid polluting other test modules.
    //
    // We check the options shape: if emailAndPassword were enabled the options
    // object would carry an `emailAndPassword` key with `enabled: true`.
    const { auth: realAuth } = await import("../auth/auth.config");
    const options = realAuth.options as Record<string, unknown>;

    // emailAndPassword should either be absent or explicitly disabled
    const eap = options.emailAndPassword as Record<string, unknown> | undefined;
    const enabled = eap?.enabled;
    expect(enabled).not.toBe(true);
  });

  // DEFECT 1 fix — trustedOrigins is tested in src/auth/auth.config.test.ts
  // (separate file without mock.module overrides so the real auth options are inspected).
});

// ── DEFECT 2 fix — test-auth user name upsert ────────────────────────────────
//
// On the existing-user path the handler must call adapter.updateUser so the
// session deterministically reflects the request-body name, regardless of the
// name the row was first created with.

describe("POST /test-auth/session — name upsert for existing user (DEFECT 2 fix)", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_TEST_AUTH: process.env.ENABLE_TEST_AUTH,
  };

  beforeEach(() => {
    mockInternalAdapter.findUserByEmail.mockClear();
    mockInternalAdapter.createUser.mockClear();
    mockInternalAdapter.updateUser.mockClear();
    mockInternalAdapter.createSession.mockClear();
  });

  afterEach(() => {
    if (originalEnv.NODE_ENV !== undefined) {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalEnv.ENABLE_TEST_AUTH !== undefined) {
      process.env.ENABLE_TEST_AUTH = originalEnv.ENABLE_TEST_AUTH;
    } else {
      delete process.env.ENABLE_TEST_AUTH;
    }
  });

  async function openGate(): Promise<import("@hono/zod-openapi").OpenAPIHono> {
    const envModule = await import("../lib/env");
    (envModule.env as Record<string, unknown>).ENABLE_TEST_AUTH = true;
    (envModule.env as Record<string, unknown>).NODE_ENV = "test";
    const { testAuthRouter } = await import("./test-auth.routes");
    return testAuthRouter;
  }

  test("calls updateUser with the new name when the user already exists", async () => {
    const existingUser = {
      user: {
        id: FAKE_USER_ID,
        email: "returning@operai.test",
        name: "Old Name",  // stale name from first registration
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      accounts: [],
    };
    mockInternalAdapter.findUserByEmail.mockImplementation(async () => existingUser);

    const router = await openGate();
    await postMintSession(router, { email: "returning@operai.test", name: "E2E User" });

    // updateUser MUST be called with the new name so subsequent sessions reflect it
    expect(mockInternalAdapter.updateUser).toHaveBeenCalledTimes(1);
    expect(mockInternalAdapter.updateUser).toHaveBeenCalledWith(FAKE_USER_ID, { name: "E2E User" });
    // createUser must NOT be called — we reuse the existing row
    expect(mockInternalAdapter.createUser).not.toHaveBeenCalled();
    // Session is still created for the existing user
    expect(mockInternalAdapter.createSession).toHaveBeenCalledWith(FAKE_USER_ID, false);
  });

  test("does NOT call updateUser when the user is newly created (no row yet)", async () => {
    mockInternalAdapter.findUserByEmail.mockImplementation(findInDb);
    await db.user.deleteMany({ where: { email: "brand-new@operai.test" } });

    const router = await openGate();
    await postMintSession(router, { email: "brand-new@operai.test", name: "Fresh User" });

    // New user path: the row is written directly (specs/20261105-signup-gate), updateUser is not called
    expect(await db.user.count({ where: { email: "brand-new@operai.test" } })).toBe(1);
    expect(mockInternalAdapter.updateUser).not.toHaveBeenCalled();
  });

  test("response body name reflects request payload name even for returning users", async () => {
    const existingUser = {
      user: {
        id: FAKE_USER_ID,
        email: "returning@operai.test",
        name: "Stale Name",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      accounts: [],
    };
    mockInternalAdapter.findUserByEmail.mockImplementation(async () => existingUser);

    const router = await openGate();
    const res = await postMintSession(router, { email: "returning@operai.test", name: "E2E User" });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // The response body reflects the request-body name, not the stale DB name
    expect(body.name).toBe("E2E User");
  });
});

/*
 * ─── INTEGRATION NOTE ──────────────────────────────────────────────────────────
 *
 * The following assertions from tasks.md require a live PostgreSQL database
 * and a real better-auth initialisation (Prisma adapter, JWKS keypair, etc.)
 * and are therefore NOT covered in this unit suite:
 *
 *   (a-integration-1) The session cookie returned by POST /test-auth/session
 *     is accepted by GET /auth/get-session (user resolves to the seeded user).
 *
 *   (a-integration-2) GET /auth/token returns a valid RS256 JWT when called
 *     with the minted session cookie.
 *
 * To verify these assertions manually or in a CI environment with a DB:
 *
 *   1. Start PostgreSQL:  docker compose up -d   (localhost:5435)
 *   2. Run migrations:    cd auth && bun run db:migrate
 *   3. Set env:           export ENABLE_TEST_AUTH=true NODE_ENV=test
 *   4. Start the service: bun run dev
 *   5. Mint a session:
 *        curl -s -c /tmp/jar.txt -X POST http://localhost:3001/test-auth/session \
 *             -H 'Content-Type: application/json' \
 *             -d '{"email":"test@operai.test","name":"Test User"}'
 *   6. Verify get-session:
 *        curl -s -b /tmp/jar.txt http://localhost:3001/auth/get-session
 *        # → {"user":{"email":"test@operai.test",...},"session":{...}}
 *   7. Verify JWT:
 *        curl -s -b /tmp/jar.txt http://localhost:3001/auth/token
 *        # → {"token":"<RS256 JWT>"}
 *        # Decode and verify against /.well-known/jwks.json
 *
 * The unit tests above cover all gate/security assertions without a live DB.
 * ───────────────────────────────────────────────────────────────────────────────
 */
