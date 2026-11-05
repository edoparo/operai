/**
 * specs/023 T4 (AC-4.1, AC-4.3; ADR-0072): `notifyAdminsOfAccessRequest` posts one
 * notification per EFFECTIVE admin (direct or via department, active only) and
 * never throws or blocks its caller.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "../lib/db";

const { setNotifyTokenProvider } = await import("../lib/notify");
const { notifyAdminsOfAccessRequest } = await import("./notifyAdmins");

const TAG = "notifyadmins-test";
const emails = {
  direct: `${TAG}-direct@welld.test`,
  viaDept: `${TAG}-dept@welld.test`,
  deleted: `${TAG}-deleted@welld.test`,
  plain: `${TAG}-plain@welld.test`,
};
const ids: Record<keyof typeof emails, string> = { direct: "", viaDept: "", deleted: "", plain: "" };
let deptId = "";
let adminRoleId = "";

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
  const uid = users.map((u) => u.id);
  await db.userRole.deleteMany({ where: { userId: { in: uid } } });
  await db.userDepartment.deleteMany({ where: { userId: { in: uid } } });
  await db.departmentRole.deleteMany({ where: { department: { name: TAG } } });
  await db.department.deleteMany({ where: { name: TAG } });
  await db.user.deleteMany({ where: { id: { in: uid } } });
}

beforeAll(async () => {
  await cleanup();
  const role = await db.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin", isSystem: true },
  });
  adminRoleId = role.id;
  for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
    const u = await db.user.create({
      data: {
        email: emails[key],
        name: key,
        emailVerified: true,
        deletedAt: key === "deleted" ? new Date() : null,
      },
    });
    ids[key] = u.id;
  }
  await db.userRole.create({ data: { userId: ids.direct, roleId: adminRoleId } });
  await db.userRole.create({ data: { userId: ids.deleted, roleId: adminRoleId } });
  const dept = await db.department.create({ data: { name: TAG } });
  deptId = dept.id;
  await db.departmentRole.create({ data: { departmentId: deptId, roleId: adminRoleId } });
  await db.userDepartment.create({ data: { userId: ids.viaDept, departmentId: deptId } });
});

afterAll(cleanup);

const realFetch = globalThis.fetch;
let posted: Array<{ url: string; body: Record<string, unknown> }> = [];
let respond: () => Response | Promise<Response>;
let warnings: string[] = [];
const realWarn = console.warn;
const realError = console.error;
const realLog = console.log;

beforeEach(() => {
  posted = [];
  warnings = [];
  respond = () => Response.json({ id: "n" }, { status: 201 });
  setNotifyTokenProvider({ getToken: async () => "tok", invalidate: () => {} });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return respond();
  }) as typeof fetch;
  for (const k of ["warn", "error", "log"] as const) {
    console[k] = (...a: unknown[]) => void warnings.push(a.map(String).join(" "));
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  console.error = realError;
  console.log = realLog;
});

const REQUEST = { id: "ar_1", email: "ada@welld.ch", name: "Ada Lovelace" };

describe("notifyAdminsOfAccessRequest", () => {
  test("one call per effective admin: direct and via department, never a soft-deleted or plain user", async () => {
    await notifyAdminsOfAccessRequest(REQUEST);

    const recipients = posted.map((p) => p.body["recipientId"]);
    expect(recipients).toContain(ids.direct);
    expect(recipients).toContain(ids.viaDept);
    expect(recipients).not.toContain(ids.deleted);
    expect(recipients).not.toContain(ids.plain);
    expect(new Set(recipients).size).toBe(recipients.length);
  });

  test("each body is the plan.md shape: admin origin, email, relative link, no address", async () => {
    await notifyAdminsOfAccessRequest(REQUEST);

    const mine = posted.find((p) => p.body["recipientId"] === ids.direct);
    expect(mine?.url).toEndWith("/system/notifications");
    expect(mine?.body).toEqual({
      recipientId: ids.direct,
      originApp: "admin",
      severity: "info",
      title: "Access request from Ada Lovelace",
      body: "ada@welld.ch asked to join Operai. Review it in Admin › Users › Access requests.",
      link: { href: "/admin/users/access-requests" },
      email: true,
    });
  });

  test("a notify 500 resolves without throwing and logs the failure without the email or name", async () => {
    respond = () => new Response("boom", { status: 500 });
    await notifyAdminsOfAccessRequest(REQUEST);

    const lines = warnings.filter((w) => w.includes("auth.access_request_notify_failed"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join("\n")).toContain("ar_1");
    expect(lines.join("\n")).not.toContain("ada@welld.ch");
    expect(lines.join("\n")).not.toContain("Ada Lovelace");
  });

  test("a mint failure resolves without throwing", async () => {
    setNotifyTokenProvider({
      getToken: async () => {
        throw new Error("signer unavailable");
      },
      invalidate: () => {},
    });
    await expect(notifyAdminsOfAccessRequest(REQUEST)).resolves.toBeUndefined();
    expect(posted).toHaveLength(0);
    expect(warnings.some((w) => w.includes("auth.access_request_notify_failed"))).toBe(true);
  });

  test("a network error resolves without throwing", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(notifyAdminsOfAccessRequest(REQUEST)).resolves.toBeUndefined();
  });

  test("a failure resolving the admins resolves without throwing and logs it", async () => {
    await expect(
      notifyAdminsOfAccessRequest(REQUEST, async () => {
        throw new Error("db down");
      }),
    ).resolves.toBeUndefined();
    expect(warnings.some((w) => w.includes("auth.access_request_notify_failed"))).toBe(true);
    expect(posted).toHaveLength(0);
  });

  test("a long name is truncated into the title", async () => {
    await notifyAdminsOfAccessRequest({ ...REQUEST, name: "N".repeat(500) });
    const title = String(posted[0]?.body["title"]);
    expect(title.length).toBeLessThanOrEqual(200);
  });
});
