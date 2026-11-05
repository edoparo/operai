/**
 * specs/023 T5 (ADR-0071): the sign-up gate, driven through better-auth's REAL
 * `internalAdapter.createOAuthUser` (the call the OAuth callback makes), so
 * the abort contract (T-INT-1, T-INT-2) is pinned against the pinned version.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runWithEndpointContext } from "@better-auth/core/context";
import { auth } from "../auth/auth.config";
import { getEffectiveAdminUserIds } from "../admin/lastAdminGuard";
import { db } from "../lib/db";
import { env } from "../lib/env";
import { setNotifyTokenProvider } from "../lib/notify";

const TAG = `sg${crypto.randomUUID().slice(0, 8)}`;
const mail = (local: string, domain = "welld.ch") => `${TAG}-${local}@${domain}`;
const realFetch = globalThis.fetch;
const realLog = console.log;
const realBootstrap = env.BOOTSTRAP_ADMIN_EMAIL;
function setBootstrap(value: string | undefined) {
  (env as { BOOTSTRAP_ADMIN_EMAIL?: string | undefined }).BOOTSTRAP_ADMIN_EMAIL = value;
}

let posted: Array<{ body: Record<string, unknown> }> = [];
let logs: string[] = [];
let respond: () => Response | Promise<Response>;

async function signIn(
  email: string,
  opts: { name?: string; emailVerified?: boolean; provider?: string | null } = {},
) {
  const ctx = await auth.$context;
  const run = () =>
    ctx.internalAdapter.createOAuthUser(
      {
        name: opts.name ?? "Test Person",
        email,
        emailVerified: opts.emailVerified ?? true,
        image: null,
      },
      {
        providerId: opts.provider ?? "google",
        accountId: `acc-${crypto.randomUUID()}`,
        accessToken: "t",
        scope: "openid",
      } as never,
    );
  if (opts.provider === null) return run();
  return runWithEndpointContext({ params: { id: opts.provider ?? "google" } } as never, run);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { message?: string }).message ?? "";
  }
  throw new Error("expected the sign-in to be refused");
}

const userCount = (email: string) => db.user.count({ where: { email } });
const requestOf = (email: string) => db.accessRequest.findUnique({ where: { email } });
/** Notifications are fire-and-forget: wait until the posts settle. */
async function settle() {
  await new Promise((r) => setTimeout(r, 150));
}
const noticesFor = (name: string) => posted.filter((p) => String(p.body.title).includes(name));

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.accessRequest.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: uid } }, { actorUserId: { in: uid } }] } });
  await db.invitation.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.userRole.deleteMany({ where: { userId: { in: uid } } });
  await db.userDepartment.deleteMany({ where: { userId: { in: uid } } });
  await db.session.deleteMany({ where: { userId: { in: uid } } });
  await db.account.deleteMany({ where: { userId: { in: uid } } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
}

async function invite(email: string, over: Record<string, unknown> = {}) {
  return db.invitation.create({
    data: {
      email,
      status: "pending",
      roleIds: [],
      departmentIds: [],
      tokenHash: `th-${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      ...over,
    },
  });
}

let adminUserId = "";
beforeAll(async () => {
  await cleanup();
  const role = await db.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin", isSystem: true },
  });
  await db.role.upsert({ where: { name: "employee" }, update: {}, create: { name: "employee", isSystem: true } });
  const admin = await db.user.create({
    data: { email: mail("admin"), name: "Gate Admin", emailVerified: true },
  });
  adminUserId = admin.id;
  await db.userRole.create({ data: { userId: admin.id, roleId: role.id } });
});
afterAll(async () => {
  setBootstrap(realBootstrap);
  await cleanup();
});
beforeEach(() => {
  posted = [];
  logs = [];
  respond = () => Response.json({ id: "n" }, { status: 201 });
  setNotifyTokenProvider({ getToken: async () => "tok", invalidate: () => {} });
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    posted.push({ body: JSON.parse(String(init?.body)) });
    return respond();
  }) as typeof fetch;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  setBootstrap(realBootstrap);
});

describe("AC-1.1 invited sign-in", () => {
  test("a live invitation lets an allowed-domain verified person in with exactly its roles", async () => {
    const role = await db.role.upsert({ where: { name: `${TAG}-r` }, update: {}, create: { name: `${TAG}-r` } });
    const email = mail("invited");
    await invite(email, { roleIds: [role.id] });
    const { user } = await signIn(email);
    expect(user).not.toBeNull();
    const roles = await db.userRole.findMany({ where: { userId: user!.id } });
    expect(roles.map((r) => r.roleId)).toEqual([role.id]);
    expect(await requestOf(email)).toBeNull();
    await db.userRole.deleteMany({ where: { roleId: role.id } });
    await db.role.delete({ where: { id: role.id } });
  });

  test("a no-role invitation keeps the baseline employee", async () => {
    const email = mail("invited-norole");
    await invite(email);
    const { user } = await signIn(email);
    const roles = await db.userRole.findMany({ where: { userId: user!.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(["employee"]);
  });

  test("an invitation for an UNVERIFIED email does not let the person in; they join the waiting list", async () => {
    const email = mail("invited-unverified");
    await invite(email);
    expect(await refusal(signIn(email, { emailVerified: false }))).toBe("access request pending");
    expect(await userCount(email)).toBe(0);
    expect((await requestOf(email))?.status).toBe("pending");
  });
});

describe("AC-1.2 / AC-1.5 uninvited, allowed domain", () => {
  test.each([
    ["no invitation", null],
    ["an expired invitation", { expiresAt: new Date(Date.now() - 1000) }],
    ["a revoked invitation", { status: "revoked" }],
    ["an accepted invitation", { status: "accepted" }],
  ])("%s -> access request pending, and T-INT-1: no user/account/user_role row", async (label, over) => {
    const email = mail(`un-${String(label).replace(/\W/g, "")}`);
    if (over) await invite(email, over);
    expect(await refusal(signIn(email))).toBe("access request pending");
    expect(await userCount(email)).toBe(0);
    expect(await db.account.count({ where: { user: { email } } })).toBe(0);
    expect(await db.userRole.count({ where: { user: { email } } })).toBe(0);
    expect(await db.session.count({ where: { user: { email } } })).toBe(0);
  });
});

describe("AC-1.3 domain not allowed", () => {
  test.each([[false], [true]])("outside domain (invitation: %p) -> refused, no user, no access request", async (withInvite) => {
    const email = mail(`out${withInvite}`, "gmail.com");
    if (withInvite) await invite(email);
    expect(await refusal(signIn(email))).toBe("signup domain not allowed");
    expect(await userCount(email)).toBe(0);
    expect(await requestOf(email)).toBeNull();
    await settle();
    expect(noticesFor("Test Person")).toEqual([]);
  });

  test("a subdomain is not an allowed domain", async () => {
    const email = mail("sub", "sub.welld.ch");
    expect(await refusal(signIn(email))).toBe("signup domain not allowed");
  });
});

describe("AC-1.4 bootstrap admin", () => {
  test("the bootstrap email with no invitation is created with admin and employee", async () => {
    const email = mail("boot");
    setBootstrap(email);
    const { user } = await signIn(email, { name: "Boot Admin" });
    const roles = await db.userRole.findMany({ where: { userId: user!.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name).sort()).toEqual(["admin", "employee"]);
  });

  test("a bootstrap email outside the allowed domains is refused", async () => {
    const email = mail("boot-out", "gmail.com");
    setBootstrap(email);
    expect(await refusal(signIn(email))).toBe("signup domain not allowed");
    expect(await userCount(email)).toBe(0);
  });

  test("an unverified bootstrap email is not exempt", async () => {
    const email = mail("boot-unv");
    setBootstrap(email);
    expect(await refusal(signIn(email, { emailVerified: false }))).toBe("access request pending");
    expect(await userCount(email)).toBe(0);
  });
});

describe("AC-1.6 / AC-1.7 existing users", () => {
  test("an existing user outside the domains and uninvited still gets a session", async () => {
    const email = mail("legacy", "gmail.com");
    const u = await db.user.create({ data: { email, name: "Legacy", emailVerified: true } });
    await db.account.create({
      data: { userId: u.id, providerId: "google", accountId: `legacy-${TAG}`, accessToken: "t" },
    });
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession(u.id)).not.toBeNull();
    expect(await requestOf(email)).toBeNull();
  });

  test("a refused soft-deleted return sign-in records no access request", async () => {
    const email = mail("softdel");
    const u = await db.user.create({
      data: { email, name: "Gone", emailVerified: true, deletedAt: new Date() },
    });
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession(u.id)).toBeNull();
    expect(await requestOf(email)).toBeNull();
  });
});

describe("AC-2.1 / AC-2.2 recording the request", () => {
  test("first attempt: one pending row, lower-cased email, name, provider, and one notice per admin; T-INT-2: it survives the rollback", async () => {
    const email = mail("first");
    const before = Date.now();
    expect(await refusal(signIn(email.replace(TAG, TAG.toUpperCase()), { name: "  Ada First  ", provider: "github" }))).toBe(
      "access request pending",
    );
    const row = await requestOf(email);
    expect(row).toMatchObject({ email, name: "Ada First", provider: "github", status: "pending" });
    expect(row!.requestedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await userCount(email)).toBe(0);
    await settle();
    const admins = await getEffectiveAdminUserIds(db, (await db.role.findUniqueOrThrow({ where: { name: "admin" } })).id);
    const notices = noticesFor("Ada First");
    expect(notices.length).toBe(admins.size);
    expect(new Set(notices.map((n) => n.body.recipientId))).toEqual(new Set(admins));
    expect(notices[0]!.body).toMatchObject({ originApp: "admin", email: true, link: { href: "/admin/users/access-requests" } });
  });

  test("R6: the provider is 'unknown' when the context carries none", async () => {
    const email = mail("noctx");
    await refusal(signIn(email, { provider: null }));
    expect((await requestOf(email))?.provider).toBe("unknown");
  });

  test("a repeat attempt updates the same row and notifies nobody (AC-2.2, AC-4.2)", async () => {
    const email = mail("repeat");
    await refusal(signIn(email, { name: "Repeat One", provider: "google" }));
    await settle();
    const first = await requestOf(email);
    posted = [];
    await new Promise((r) => setTimeout(r, 20));
    expect(await refusal(signIn(email, { name: "Repeat Two", provider: "github" }))).toBe("access request pending");
    await settle();
    const rows = await db.accessRequest.findMany({ where: { email } });
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ id: first!.id, name: "Repeat Two", provider: "github", status: "pending" });
    expect(rows[0]!.requestedAt.getTime()).toBeGreaterThan(first!.requestedAt.getTime());
    expect(rows[0]!.firstRequestedAt.getTime()).toBe(first!.firstRequestedAt.getTime());
    expect(posted).toEqual([]);
  });

  test("concurrent first sign-ins -> one row and one set of notices", async () => {
    const email = mail("race");
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => signIn(email, { name: "Racer Person" })));
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(await db.accessRequest.count({ where: { email } })).toBe(1);
    await settle();
    const admins = await getEffectiveAdminUserIds(db, (await db.role.findUniqueOrThrow({ where: { name: "admin" } })).id);
    expect(noticesFor("Racer Person").length).toBe(admins.size);
  });
});

describe("AC-2.3 rejected / AC-2.4 approved", () => {
  test("a rejected request stays rejected, nobody is notified, and the message says so", async () => {
    const email = mail("rej");
    await db.accessRequest.create({ data: { email, name: "Rej", provider: "google", status: "rejected" } });
    expect(await refusal(signIn(email, { name: "Rej Changed" }))).toBe("access request rejected");
    await settle();
    expect(await requestOf(email)).toMatchObject({ status: "rejected", name: "Rej" });
    expect(posted).toEqual([]);
  });

  test("an approved request whose invitation is dead returns to pending and notifies", async () => {
    const email = mail("appr");
    const inv = await invite(email, { status: "revoked" });
    await db.accessRequest.create({
      data: {
        email, name: "Appr", provider: "google", status: "approved",
        decidedAt: new Date(), decidedByUserId: adminUserId, invitationId: inv.id,
      },
    });
    expect(await refusal(signIn(email, { name: "Appr Again" }))).toBe("access request pending");
    await settle();
    expect(await requestOf(email)).toMatchObject({
      status: "pending", name: "Appr Again", decidedAt: null, decidedByUserId: null, invitationId: null,
    });
    expect(noticesFor("Appr Again").length).toBeGreaterThan(0);
  });
});

describe("AC-3.8 activation closes the pending request", () => {
  test("an invitation created any other way approves the person's pending request at activation", async () => {
    const email = mail("close");
    await refusal(signIn(email, { name: "Close Me" }));
    const inv = await invite(email, { invitedByUserId: adminUserId });
    const { user } = await signIn(email);
    expect(user).not.toBeNull();
    expect(await requestOf(email)).toMatchObject({
      status: "approved", invitationId: inv.id, decidedByUserId: adminUserId,
    });
    expect((await requestOf(email))!.decidedAt).not.toBeNull();
  });
});

describe("AC-4.3 notification failures never undo the request", () => {
  test.each([
    ["a 500", () => new Response("boom", { status: 500 })],
    ["a network error", () => { throw new Error("down"); }],
  ])("notify-api %s -> request recorded, refusal unchanged", async (_l, make) => {
    respond = make as typeof respond;
    const email = mail(`nf${_l.replace(/\W/g, "")}`);
    expect(await refusal(signIn(email))).toBe("access request pending");
    await settle();
    expect((await requestOf(email))?.status).toBe("pending");
  });

  test("a mint failure is the same", async () => {
    setNotifyTokenProvider({ getToken: async () => { throw new Error("mint"); }, invalidate: () => {} });
    const email = mail("nfmint");
    expect(await refusal(signIn(email))).toBe("access request pending");
    await settle();
    expect((await requestOf(email))?.status).toBe("pending");
  });
});

describe("refusal logging", () => {
  test("every refusal logs one auth.signup_refused line without email or name", async () => {
    const email = mail("logme", "gmail.com");
    const spy = spyOn(console, "log");
    await refusal(signIn(email, { name: "Secret Name" }));
    spy.mockRestore();
    const lines = logs.filter((l) => l.includes("auth.signup_refused"));
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "auth.signup_refused", reason: "domain_not_allowed" });
    expect(lines[0]).not.toContain(email);
    expect(lines[0]).not.toContain("Secret Name");
  });
});
