/**
 * Integration tests for the `withAudit()` transactional helper (T7).
 *
 * These run against the real local Postgres (DATABASE_URL from `.env`, the
 * shared dev DB on localhost:5435) via the real Prisma client — no mocks.
 * Every fixture (users, roles) is created with a per-run unique marker
 * (`RUN_ID`) and cleaned up in `afterAll` so this file can run concurrently
 * with other auth-service test files against the same database without
 * unique-constraint collisions (see task DB-ISOLATION note).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { db } from "../lib/db";
import { withAudit } from "./audit";

const RUN_ID = crypto.randomUUID().slice(0, 8);

const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];

async function createTestUser(label: string) {
  const user = await db.user.create({
    data: {
      email: `t7-audit-${label}-${RUN_ID}@operai.test`,
      name: `T7 Audit Fixture ${label}`,
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

describe("withAudit — transactional audit + epoch bump (T7, AC-5.1/AC-4.3)", () => {
  afterAll(async () => {
    // FK order: audit_log.actorUserId is SetNull-on-delete (safe to delete
    // users first), but delete audit rows explicitly first anyway so the
    // cleanup doesn't depend on that behaviour.
    await db.auditLog.deleteMany({
      where: { actorUserId: { in: createdUserIds } },
    });
    if (createdRoleIds.length > 0) {
      await db.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
    if (createdUserIds.length > 0) {
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  test("writes an immutable audit_log row and bumps the affected user's permissionEpoch in one transaction", async () => {
    const actor = await createTestUser("actor-1");
    const target = await createTestUser("target-1");
    expect(target.permissionEpoch).toBe(0);

    const roleName = `t7-role-${RUN_ID}-1`;

    const role = await withAudit({
      affectedUserIds: [target.id],
      mutate: (tx) =>
        tx.role.create({ data: { name: roleName, isSystem: false } }),
      entry: (createdRole) => ({
        actorUserId: actor.id,
        action: "role.create",
        targetType: "role",
        targetId: createdRole.id,
        summary: `Created role "${createdRole.name}"`,
        data: { before: null, after: { name: createdRole.name } },
      }),
    });
    createdRoleIds.push(role.id);
    expect(role.name).toBe(roleName);

    const auditRow = await db.auditLog.findFirst({
      where: { targetType: "role", targetId: role.id, action: "role.create" },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow?.actorUserId).toBe(actor.id);
    expect(auditRow?.summary).toBe(`Created role "${roleName}"`);
    expect(auditRow?.data).toEqual({
      before: null,
      after: { name: roleName },
    });

    const refreshedTarget = await db.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(refreshedTarget.permissionEpoch).toBe(1);

    // The actor itself was not in affectedUserIds — its epoch must be untouched.
    const refreshedActor = await db.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(refreshedActor.permissionEpoch).toBe(0);
  });

  test("bumps epoch by exactly one for every unique affected user, even with duplicate ids in the list", async () => {
    const actor = await createTestUser("actor-2");
    const targetA = await createTestUser("target-2a");
    const targetB = await createTestUser("target-2b");

    const roleName = `t7-role-${RUN_ID}-2`;

    const role = await withAudit({
      affectedUserIds: [targetA.id, targetB.id, targetA.id, targetA.id],
      mutate: (tx) => tx.role.create({ data: { name: roleName } }),
      entry: (createdRole) => ({
        actorUserId: actor.id,
        action: "role.create",
        targetType: "role",
        targetId: createdRole.id,
        summary: `Created role "${createdRole.name}"`,
      }),
    });
    createdRoleIds.push(role.id);

    const refreshedA = await db.user.findUniqueOrThrow({
      where: { id: targetA.id },
    });
    const refreshedB = await db.user.findUniqueOrThrow({
      where: { id: targetB.id },
    });
    expect(refreshedA.permissionEpoch).toBe(1);
    expect(refreshedB.permissionEpoch).toBe(1);
  });

  test("rolls back the whole transaction when the mutation throws — no audit row, no epoch bump", async () => {
    const actor = await createTestUser("actor-3");
    const target = await createTestUser("target-3");

    const marker = `t7-rollback-marker-${RUN_ID}`;

    await expect(
      withAudit({
        affectedUserIds: [target.id],
        mutate: async (): Promise<{ id: string }> => {
          throw new Error("simulated domain-mutation failure");
        },
        entry: {
          actorUserId: actor.id,
          action: "role.create",
          targetType: "role",
          summary: marker,
        },
      }),
    ).rejects.toThrow("simulated domain-mutation failure");

    const auditRow = await db.auditLog.findFirst({
      where: { summary: marker },
    });
    expect(auditRow).toBeNull();

    const refreshedTarget = await db.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(refreshedTarget.permissionEpoch).toBe(0);
  });

  test("an array of entries writes every row in the one transaction (specs/20261105-signup-gate T6)", async () => {
    const actor = await createTestUser("actor-multi");
    const marker = `t6-multi-${RUN_ID}`;

    const result = await withAudit({
      affectedUserIds: [],
      mutate: async () => ({ id: "x" }),
      entry: (r) => [
        { actorUserId: actor.id, action: "invitation.create", targetType: "invitation", targetId: r.id, summary: `${marker}-a` },
        { actorUserId: actor.id, action: "access_request.approve", targetType: "access_request", targetId: r.id, summary: `${marker}-b` },
      ],
    });
    expect(result).toEqual({ id: "x" });

    const rows = await db.auditLog.findMany({ where: { summary: { startsWith: marker } }, orderBy: { summary: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["invitation.create", "access_request.approve"]);
  });

  test("a fixed array of entries is accepted too", async () => {
    const actor = await createTestUser("actor-fixed-arr");
    const marker = `t6-fixed-${RUN_ID}`;
    await withAudit({
      affectedUserIds: [],
      mutate: async () => null,
      entry: [
        { actorUserId: actor.id, action: "a.one", targetType: "a", summary: `${marker}-1` },
        { actorUserId: actor.id, action: "a.two", targetType: "a", summary: `${marker}-2` },
      ],
    });
    expect(await db.auditLog.count({ where: { summary: { startsWith: marker } } })).toBe(2);
  });

  test("rolls back every row of an array when a later write throws", async () => {
    const actor = await createTestUser("actor-multi-rb");
    const target = await createTestUser("target-multi-rb");
    const marker = `t6-multi-rb-${RUN_ID}`;

    await expect(
      withAudit({
        affectedUserIds: [target.id],
        mutate: async () => ({ id: "y" }),
        entry: () => [
          { actorUserId: actor.id, action: "x.one", targetType: "x", summary: `${marker}-1` },
          // the second row violates the actor FK -> the transaction aborts after the first insert
          { actorUserId: "no-such-user", action: "x.two", targetType: "x", summary: `${marker}-2` },
        ],
      }),
    ).rejects.toThrow();

    expect(await db.auditLog.count({ where: { summary: { startsWith: marker } } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).permissionEpoch).toBe(0);
  });

  test("stores NULL in the data column when no diff is supplied, and bumps no users when affectedUserIds is empty", async () => {
    const actor = await createTestUser("actor-4");
    const roleName = `t7-role-${RUN_ID}-4`;

    const role = await withAudit({
      affectedUserIds: [],
      mutate: (tx) => tx.role.create({ data: { name: roleName } }),
      entry: (createdRole) => ({
        actorUserId: actor.id,
        action: "role.create",
        targetType: "role",
        targetId: createdRole.id,
        summary: `Created role "${createdRole.name}"`,
      }),
    });
    createdRoleIds.push(role.id);

    const auditRow = await db.auditLog.findFirstOrThrow({
      where: { targetType: "role", targetId: role.id },
    });
    expect(auditRow.data).toBeNull();

    // No user should have been touched (no error, no-op update).
    const refreshedActor = await db.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    expect(refreshedActor.permissionEpoch).toBe(0);
  });

  test("supports a null actorUserId for system-initiated mutations", async () => {
    const roleName = `t7-role-${RUN_ID}-5`;

    const role = await withAudit({
      affectedUserIds: [],
      mutate: (tx) => tx.role.create({ data: { name: roleName } }),
      entry: (createdRole) => ({
        actorUserId: null,
        action: "role.create",
        targetType: "role",
        targetId: createdRole.id,
        summary: `Seed-created role "${createdRole.name}"`,
      }),
    });
    createdRoleIds.push(role.id);

    const auditRow = await db.auditLog.findFirstOrThrow({
      where: { targetType: "role", targetId: role.id },
    });
    expect(auditRow.actorUserId).toBeNull();
  });
});
