/**
 * Repository tests for PushDevice (T3, specs/029-push-notifications).
 * Real Postgres (DATABASE_URL via direnv), like the other repo/route tests.
 * Every row this file creates belongs to a `t3-` prefixed user and is removed in
 * afterEach, so it never touches rows of the running dev stack.
 */

import { describe, it, expect, afterEach, afterAll, mock } from "bun:test";
import { Effect, Exit, Cause, Option } from "effect";

// A fresh Prisma client on the DATABASE_URL present when this file loads, injected
// as `@/lib/db`: other test files overwrite DATABASE_URL (and cache the shared
// client built from it) for their own purposes, so the shared singleton is not
// reliable across the whole `bun test` run (same convention as list.routes.test.ts).
const { PrismaClient } = await import("@/lib/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });
mock.module("@/lib/db", () => ({ db }));

const { upsertByEndpoint, listByUser, deleteByIdForUser, deleteAllForUser, deleteById, countByUser } = await import(
  "./devices.repo"
);

const A = "t3-user-a";
const B = "t3-user-b";
const EP = (n: number) => `https://fcm.googleapis.com/fcm/send/t3-${n}`;
const reg = (userId: string, n: number, extra: Partial<{ p256dh: string; auth: string; label: string }> = {}) => ({
  userId,
  endpoint: EP(n),
  p256dh: extra.p256dh ?? `p256dh-${n}`,
  auth: extra.auth ?? `auth-${n}`,
  label: extra.label ?? "Chrome · macOS",
});
const run = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromise(e);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  await db.pushDevice.deleteMany({ where: { userId: { startsWith: "t3-" } } });
});
afterAll(async () => {
  await db.pushDevice.deleteMany({ where: { userId: { startsWith: "t3-" } } });
  await db.$disconnect();
});

describe("upsertByEndpoint", () => {
  it("creates a row for a new endpoint (outcome created)", async () => {
    const r = await run(upsertByEndpoint(reg(A, 1)));
    expect(r.outcome).toBe("created");
    expect(r.device.userId).toBe(A);
    expect(r.device.endpoint).toBe(EP(1));
    expect(r.device.label).toBe("Chrome · macOS");
    expect(await run(countByUser(A))).toBe(1);
  });

  it("same owner, same endpoint: one row, keys and label replaced, id kept (outcome updated)", async () => {
    const first = await run(upsertByEndpoint(reg(A, 1)));
    const r = await run(upsertByEndpoint(reg(A, 1, { p256dh: "new-p", auth: "new-a", label: "Firefox · Linux" })));
    expect(r.outcome).toBe("updated");
    expect(r.device.id).toBe(first.device.id);
    expect(r.device.p256dh).toBe("new-p");
    expect(r.device.auth).toBe("new-a");
    expect(r.device.label).toBe("Firefox · Linux");
    expect(r.device.createdAt.getTime()).toBe(first.device.createdAt.getTime());
    expect(await run(countByUser(A))).toBe(1);
  });

  it("endpoint owned by another user: the row moves to the caller (outcome moved), previous owner loses it", async () => {
    const first = await run(upsertByEndpoint(reg(A, 1)));
    const r = await run(upsertByEndpoint(reg(B, 1, { p256dh: "b-p", auth: "b-a" })));
    expect(r.outcome).toBe("moved");
    expect(r.device.id).toBe(first.device.id);
    expect(r.device.userId).toBe(B);
    expect(r.device.p256dh).toBe("b-p");
    expect(r.device.auth).toBe("b-a");
    expect(await run(countByUser(A))).toBe(0);
    expect(await run(countByUser(B))).toBe(1);
    // exactly one row for the endpoint in the whole table
    expect(await db.pushDevice.count({ where: { endpoint: EP(1) } })).toBe(1);
  });

  it("a moved row counts as new for its new owner: createdAt is reset", async () => {
    const first = await run(upsertByEndpoint(reg(A, 1)));
    await sleep(15);
    const r = await run(upsertByEndpoint(reg(B, 1)));
    expect(r.device.createdAt.getTime()).toBeGreaterThan(first.device.createdAt.getTime());
  });

  it("concurrent registrations of one endpoint never produce two rows", async () => {
    await Promise.all([
      run(upsertByEndpoint(reg(A, 1))),
      run(upsertByEndpoint(reg(B, 1))),
      run(upsertByEndpoint(reg(A, 1))),
    ]);
    expect(await db.pushDevice.count({ where: { endpoint: EP(1) } })).toBe(1);
  });
});

describe("listByUser", () => {
  it("returns only the caller's devices, newest first", async () => {
    await run(upsertByEndpoint(reg(A, 1)));
    await sleep(10);
    await run(upsertByEndpoint(reg(B, 2)));
    await sleep(10);
    await run(upsertByEndpoint(reg(A, 3)));
    const rows = await run(listByUser(A));
    expect(rows.map((d) => d.endpoint)).toEqual([EP(3), EP(1)]);
  });

  it("returns [] for a user with no device", async () => {
    expect(await run(listByUser(A))).toEqual([]);
  });
});

describe("deleteByIdForUser", () => {
  it("deletes the caller's device", async () => {
    const { device } = await run(upsertByEndpoint(reg(A, 1)));
    await run(deleteByIdForUser(device.id, A));
    expect(await run(countByUser(A))).toBe(0);
  });

  it("another user's id fails NotFound and leaves the row intact", async () => {
    const { device } = await run(upsertByEndpoint(reg(A, 1)));
    const exit = await Effect.runPromiseExit(deleteByIdForUser(device.id, B));
    expect(Exit.isFailure(exit)).toBe(true);
    const err = Exit.isFailure(exit) ? Option.getOrNull(Cause.failureOption(exit.cause)) : null;
    expect(err?._tag).toBe("NotFoundError");
    expect(await run(countByUser(A))).toBe(1);
  });

  it("an unknown id fails NotFound, identical to another user's", async () => {
    const exit = await Effect.runPromiseExit(deleteByIdForUser("does-not-exist", A));
    const err = Exit.isFailure(exit) ? Option.getOrNull(Cause.failureOption(exit.cause)) : null;
    expect(err?._tag).toBe("NotFoundError");
  });
});

describe("deleteAllForUser", () => {
  it("removes every device of the user and none of anyone else's, returning the count", async () => {
    await run(upsertByEndpoint(reg(A, 1)));
    await run(upsertByEndpoint(reg(A, 2)));
    await run(upsertByEndpoint(reg(B, 3)));
    expect(await run(deleteAllForUser(A))).toBe(2);
    expect(await run(countByUser(A))).toBe(0);
    expect(await run(countByUser(B))).toBe(1);
  });

  it("is idempotent: 0 when there is nothing to delete", async () => {
    expect(await run(deleteAllForUser(A))).toBe(0);
  });
});

describe("deleteById (prune an invalid subscription)", () => {
  it("deletes whatever the owner and reports true", async () => {
    const { device } = await run(upsertByEndpoint(reg(A, 1)));
    expect(await run(deleteById(device.id))).toBe(true);
    expect(await run(countByUser(A))).toBe(0);
  });

  it("an already-gone id is not an error: false", async () => {
    expect(await run(deleteById("does-not-exist"))).toBe(false);
  });
});

describe("countByUser", () => {
  it("counts per user", async () => {
    await run(upsertByEndpoint(reg(A, 1)));
    await run(upsertByEndpoint(reg(A, 2)));
    await run(upsertByEndpoint(reg(B, 3)));
    expect(await run(countByUser(A))).toBe(2);
    expect(await run(countByUser(B))).toBe(1);
    expect(await run(countByUser("t3-nobody"))).toBe(0);
  });
});
