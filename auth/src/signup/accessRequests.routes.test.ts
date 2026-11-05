/**
 * Integration tests for the access-request admin API (T7, specs/023-signup-gate —
 * AC-2.5, AC-3.1–3.7, AC-3.9, AC-3.10; plan.md § Test strategy).
 *
 * The real `auth` instance runs (so AC-3.3 can drive better-auth's own
 * `createOAuthUser`); only the session lookup is stubbed with `spyOn`, and the
 * notify-api HTTP calls are stubbed at `fetch`, as `signupGate.test.ts` does.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runWithEndpointContext } from "@better-auth/core/context";
import { auth } from "../auth/auth.config";
import { db } from "../lib/db";
import { setNotifyTokenProvider } from "../lib/notify";
import { accessRequestsRouter } from "./accessRequests.routes";

const TAG = `ar${crypto.randomUUID().slice(0, 8)}`;
const mail = (local: string, domain = "welld.ch") => `${TAG}-${local}@${domain}`;
const realFetch = globalThis.fetch;

type FakeSession = { user: { id: string; email: string; name: string }; session: { id: string } } | null;
let currentSession: FakeSession = null;
spyOn(auth.api, "getSession").mockImplementation((async () => currentSession) as never);

let emailPosts: Array<Record<string, unknown>> = [];
let emailRespond: () => Response;

let adminId = "";
let nonAdminId = "";
let roleId = "";
let otherRoleId = "";
let departmentId = "";

const asAdmin = () => {
  currentSession = { user: { id: adminId, email: mail("admin"), name: "Req Admin" }, session: { id: "s1" } };
};
const asNonAdmin = () => {
  currentSession = { user: { id: nonAdminId, email: mail("plain"), name: "Plain" }, session: { id: "s2" } };
};

function call(path: string, init: RequestInit = {}) {
  return accessRequestsRouter.request(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}
const approve = (id: string, body: unknown = {}) =>
  call(`/admin/access-requests/${id}/approve`, { method: "POST", body: JSON.stringify(body) });
const reject = (id: string) => call(`/admin/access-requests/${id}/reject`, { method: "POST" });

async function makeRequest(
  local: string,
  over: Partial<{
    status: string;
    requestedAt: Date;
    decidedAt: Date | null;
    decidedByUserId: string | null;
    name: string;
  }> = {},
) {
  return db.accessRequest.create({
    data: {
      email: mail(local),
      name: over.name ?? `Name ${local}`,
      provider: "google",
      status: over.status ?? "pending",
      requestedAt: over.requestedAt ?? new Date(),
      ...(over.decidedAt !== undefined ? { decidedAt: over.decidedAt } : {}),
      ...(over.decidedByUserId !== undefined ? { decidedByUserId: over.decidedByUserId } : {}),
    },
  });
}

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.accessRequest.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: uid } }, { actorUserId: null, summary: { contains: TAG } }] } });
  await db.invitation.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.userRole.deleteMany({ where: { userId: { in: uid } } });
  await db.userDepartment.deleteMany({ where: { userId: { in: uid } } });
  await db.session.deleteMany({ where: { userId: { in: uid } } });
  await db.account.deleteMany({ where: { userId: { in: uid } } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
  await db.role.deleteMany({ where: { name: { startsWith: `${TAG}-` } } });
  await db.department.deleteMany({ where: { name: { startsWith: `${TAG}-` } } });
}

beforeAll(async () => {
  await cleanup();
  const admin = await db.role.upsert({ where: { name: "admin" }, update: {}, create: { name: "admin", isSystem: true } });
  await db.role.upsert({ where: { name: "employee" }, update: {}, create: { name: "employee", isSystem: true } });
  roleId = (await db.role.create({ data: { name: `${TAG}-role` } })).id;
  otherRoleId = (await db.role.create({ data: { name: `${TAG}-role2` } })).id;
  departmentId = (await db.department.create({ data: { name: `${TAG}-dept` } })).id;
  const a = await db.user.create({ data: { email: mail("admin"), name: "Req Admin", emailVerified: true } });
  adminId = a.id;
  await db.userRole.create({ data: { userId: a.id, roleId: admin.id } });
  nonAdminId = (await db.user.create({ data: { email: mail("plain"), name: "Plain", emailVerified: true } })).id;
});
afterAll(async () => {
  await cleanup();
});
beforeEach(() => {
  asAdmin();
  emailPosts = [];
  emailRespond = () => Response.json({ status: "sent", deliveryId: "del-1" });
  setNotifyTokenProvider({ getToken: async () => "tok", invalidate: () => {} });
  globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    emailPosts.push(JSON.parse(String(init?.body)));
    return emailRespond();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("AC-3.10 admin only, and only under /admin", () => {
  test("no session -> 401, non-admin -> 403 on all three routes, nothing changes", async () => {
    const r = await makeRequest("guard");
    currentSession = null;
    expect((await call("/admin/access-requests")).status).toBe(401);
    asNonAdmin();
    expect((await call("/admin/access-requests")).status).toBe(403);
    expect((await approve(r.id)).status).toBe(403);
    expect((await reject(r.id)).status).toBe(403);
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(0);
    expect(emailPosts).toHaveLength(0);
  });

  test("route table: every access_request route is under /admin/", () => {
    const paths = accessRequestsRouter.routes.map((route) => route.path);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.startsWith("/admin/access-requests")).toBe(true);
  });
});

describe("AC-3.1 / AC-2.5 listing", () => {
  test("pending by default, newest attempt first, with the wire shape", async () => {
    const old = await makeRequest("l-old", { requestedAt: new Date(Date.now() - 60_000) });
    const fresh = await makeRequest("l-new", { requestedAt: new Date(Date.now() + 60_000) });
    await makeRequest("l-done", { status: "rejected", decidedAt: new Date(), decidedByUserId: adminId });
    const res = await call("/admin/access-requests?pageSize=100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; page: number; pageSize: number; total: number };
    const mine = body.items.filter((i) => String(i.email).startsWith(`${TAG}-l-`));
    expect(mine.map((i) => i.id)).toEqual([fresh.id, old.id]);
    expect(mine.every((i) => i.status === "pending")).toBe(true);
    expect(body).toMatchObject({ page: 1, pageSize: 100 });
    expect(Object.keys(mine[0]!).sort()).toEqual(
      ["decidedAt", "decidedBy", "email", "firstRequestedAt", "id", "invitationId", "name", "provider", "requestedAt", "status"],
    );
    expect(mine[0]!.decidedBy).toBeNull();
  });

  test("a decided filter orders by decidedAt desc and names the decider", async () => {
    const a = await makeRequest("d-a", { status: "rejected", decidedAt: new Date(Date.now() - 5_000), decidedByUserId: adminId });
    const b = await makeRequest("d-b", { status: "rejected", decidedAt: new Date(Date.now() + 5_000), decidedByUserId: adminId });
    const res = await call("/admin/access-requests?status=rejected&pageSize=100");
    const body = (await res.json()) as { items: Array<{ id: string; email: string; decidedBy: unknown }> };
    const mine = body.items.filter((i) => i.email.startsWith(`${TAG}-d-`));
    expect(mine.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(mine[0]!.decidedBy).toEqual({ id: adminId, name: "Req Admin", email: mail("admin") });
  });

  test("paginates and rejects a bad query with 400", async () => {
    const res = await call("/admin/access-requests?status=pending&page=1&pageSize=1");
    const body = (await res.json()) as { items: unknown[]; pageSize: number; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.pageSize).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect((await call("/admin/access-requests?status=bogus")).status).toBe(400);
    expect((await call("/admin/access-requests?pageSize=101")).status).toBe(400);
  });
});

describe("AC-3.2 / AC-3.3 / AC-3.9 approve", () => {
  test("creates exactly the chosen invitation, emails it, records the decision and two audit rows; the person's sign-in then activates with those roles", async () => {
    const r = await makeRequest("ok", { name: "Okay Person" });
    const res = await approve(r.id, { roleIds: [roleId], departmentIds: [departmentId] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      request: { status: string; invitationId: string; decidedBy: { id: string } };
      invitation: { id: string; email: string; status: string; emailDelivery: string; roles: Array<{ id: string }>; departments: Array<{ id: string }> };
    };
    expect(body.request).toMatchObject({ status: "approved", invitationId: body.invitation.id });
    expect(body.request.decidedBy.id).toBe(adminId);
    expect(body.invitation).toMatchObject({ email: r.email, status: "pending", emailDelivery: "sent" });
    expect(body.invitation.roles.map((x) => x.id)).toEqual([roleId]);
    expect(body.invitation.departments.map((x) => x.id)).toEqual([departmentId]);
    expect(emailPosts).toHaveLength(1);
    expect(emailPosts[0]).toMatchObject({ to: r.email, template: "invitation" });

    const row = await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "approved", decidedByUserId: adminId, invitationId: body.invitation.id });
    expect(row.decidedAt).not.toBeNull();

    const audits = await db.auditLog.findMany({
      where: { actorUserId: adminId, targetId: { in: [r.id, body.invitation.id] } },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(["access_request.approve", "invitation.create"]);
    const approveAudit = audits.find((a) => a.action === "access_request.approve")!;
    expect(approveAudit).toMatchObject({ targetType: "access_request", targetId: r.id });
    expect(approveAudit.data).toEqual({
      email: r.email,
      invitationId: body.invitation.id,
      roleIds: [roleId],
      departmentIds: [departmentId],
    });

    // AC-3.3: the person's own first sign-in matches the invitation.
    const ctx = await auth.$context;
    const { user } = await runWithEndpointContext({ params: { id: "google" } } as never, () =>
      ctx.internalAdapter.createOAuthUser(
        { name: "Okay Person", email: r.email, emailVerified: true, image: null },
        { providerId: "google", accountId: `acc-${crypto.randomUUID()}`, accessToken: "t", scope: "openid" } as never,
      ),
    );
    expect(user).not.toBeNull();
    const granted = await db.userRole.findMany({ where: { userId: user!.id } });
    expect(granted.map((g) => g.roleId)).toEqual([roleId]);
    expect(await db.userDepartment.count({ where: { userId: user!.id, departmentId } })).toBe(1);
  });

  test("an empty body is fine (no roles, no departments)", async () => {
    const r = await makeRequest("bare");
    const res = await approve(r.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitation: { roles: unknown[]; departments: unknown[] } };
    expect(body.invitation.roles).toEqual([]);
    expect(body.invitation.departments).toEqual([]);
  });

  test("an unknown id is 404; unknown role or department ids are 422 and leave the request pending", async () => {
    expect((await approve("nope-not-an-id")).status).toBe(404);
    const r = await makeRequest("422");
    const res = await approve(r.id, { roleIds: ["no-such-role"] });
    expect(res.status).toBe(422);
    expect((await approve(r.id, { departmentIds: ["no-such-dept"] })).status).toBe(422);
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(0);
  });

  test("a stored request whose domain is no longer allowed is 422 domain_not_allowed, unchanged", async () => {
    const r = await db.accessRequest.create({
      data: { email: `${TAG}-out@gmail.com`, name: "Out", provider: "google" },
    });
    const res = await approve(r.id);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; allowedDomains: string[] };
    expect(body.code).toBe("domain_not_allowed");
    expect(body.allowedDomains.length).toBeGreaterThan(0);
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
  });
});

describe("AC-3.5 refusals leave the request pending", () => {
  test("an active user with that email -> 409 active_user_exists", async () => {
    const r = await makeRequest("active");
    await db.user.create({ data: { email: r.email, name: "Already", emailVerified: true } });
    const res = await approve(r.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("active_user_exists");
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("pending");
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(0);
    expect(emailPosts).toHaveLength(0);
  });

  test("a live pending invitation -> 409 pending_invitation_exists", async () => {
    const r = await makeRequest("liveinv");
    await db.invitation.create({
      data: {
        email: r.email, status: "pending", roleIds: [], departmentIds: [],
        tokenHash: `th-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000), invitedByUserId: adminId,
      },
    });
    const res = await approve(r.id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("pending_invitation_exists");
    const row = await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ status: "pending", decidedAt: null, invitationId: null });
    expect(emailPosts).toHaveLength(0);
  });
});

describe("AC-3.6 already decided", () => {
  test.each(["approved", "rejected"])("approve and reject a %s request -> 409 already_decided, unchanged", async (status) => {
    const r = await makeRequest(`dec-${status}`, { status, decidedAt: new Date(), decidedByUserId: adminId });
    for (const res of [await approve(r.id), await reject(r.id)]) {
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe("already_decided");
    }
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(status);
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(0);
  });

  test("two concurrent approves -> one 200, one 409, one invitation, one email", async () => {
    const r = await makeRequest("race");
    const results = await Promise.all([approve(r.id), approve(r.id)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const loser = results.find((x) => x.status === 409)!;
    expect(["already_decided", "pending_invitation_exists"]).toContain(((await loser.json()) as { code: string }).code);
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(1);
    expect(emailPosts).toHaveLength(1);
  });

  test("approve racing reject -> exactly one wins and the loser changes nothing", async () => {
    const r = await makeRequest("race2");
    const results = await Promise.all([approve(r.id), reject(r.id)]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    const row = await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(row.status === "approved" ? 1 : 0);
  });
});

describe("AC-3.7 a failed email never undoes the approval", () => {
  test("notify 500 -> 200, request approved, invitation emailDelivery failed", async () => {
    emailRespond = () => new Response("boom", { status: 500 });
    const r = await makeRequest("mailfail");
    const res = await approve(r.id, { roleIds: [otherRoleId] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: { status: string }; invitation: { emailDelivery: string; status: string } };
    expect(body.request.status).toBe("approved");
    expect(body.invitation).toMatchObject({ status: "pending", emailDelivery: "failed" });
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("approved");
  });
});

describe("AC-3.4 / AC-3.9 reject", () => {
  test("rejects with the decider recorded, one audit row, no invitation and nothing sent", async () => {
    const r = await makeRequest("rej");
    const res = await reject(r.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; decidedBy: { id: string }; decidedAt: string; invitationId: string | null };
    expect(body).toMatchObject({ status: "rejected", invitationId: null });
    expect(body.decidedBy.id).toBe(adminId);
    expect(body.decidedAt).not.toBeNull();
    expect(await db.invitation.count({ where: { email: r.email } })).toBe(0);
    expect(emailPosts).toHaveLength(0);
    const audits = await db.auditLog.findMany({ where: { targetId: r.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "access_request.reject", targetType: "access_request", actorUserId: adminId });
  });

  test("an unknown id is 404", async () => {
    expect((await reject("nope-not-an-id")).status).toBe(404);
  });
});
