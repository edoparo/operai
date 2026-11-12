/**
 * The push channel's liveness check (T18, specs/029-push-notifications, ADR-0087, AC-5.2 amended):
 * a `found` answer is reused for 30 s counted from when the lookup was SENT, concurrent checks for
 * one user share one lookup, and nothing but `found` is ever remembered.
 */

import { describe, it, expect } from "bun:test";
import type { ContactLookupResult, UserContactClient } from "@/lib/userContact";
import { createActivityCheck } from "./activityCheck";

const FOUND: ContactLookupResult = { status: "found", email: "a@b.test", name: "A" };

type Script = {
  client: UserContactClient;
  calls: string[];
  clock: { t: number };
  /** Lookups waiting for `release`, in order. */
  pending: ((r: ContactLookupResult) => void)[];
};

/** A client whose answers are decided by the test: immediate by default, held when `hold` is set. */
const script = (answers: ContactLookupResult[] | "found", hold = false): Script => {
  const s: Script = { calls: [], clock: { t: 1_000_000 }, pending: [], client: undefined! };
  let i = 0;
  s.client = {
    lookup: (userId) => {
      s.calls.push(userId);
      const answer = answers === "found" ? FOUND : (answers[Math.min(i++, answers.length - 1)] as ContactLookupResult);
      if (!hold) return Promise.resolve(answer);
      return new Promise((resolve) => s.pending.push(() => resolve(answer)));
    },
  };
  return s;
};

const check = (s: Script) => createActivityCheck(s.client, { ttlMs: 30_000, now: () => s.clock.t });

describe("activityCheck — memo of found (ADR-0087)", () => {
  it("maps found / inactive / failed to active / inactive / failed", async () => {
    for (const [answer, expected] of [
      [FOUND, "active"],
      [{ status: "inactive" }, "inactive"],
      [{ status: "failed" }, "failed"],
    ] as const) {
      const s = script([answer]);
      expect(await check(s).isActive("u1")).toBe(expected);
    }
  });

  it("reuses a found for 29 999 ms and asks again at 30 000 ms", async () => {
    const s = script("found");
    const c = check(s);
    expect(await c.isActive("u1")).toBe("active");
    s.clock.t += 29_999;
    expect(await c.isActive("u1")).toBe("active");
    expect(s.calls).toHaveLength(1);
    s.clock.t += 1;
    expect(await c.isActive("u1")).toBe("active");
    expect(s.calls).toHaveLength(2);
  });

  it("counts the 30 s from when the lookup was SENT, not from its answer", async () => {
    const s = script("found", true);
    const c = check(s);
    const first = c.isActive("u1");
    s.clock.t += 2_000; // the answer arrives 2 s after the request left
    s.pending[0]!(FOUND);
    expect(await first).toBe("active");
    s.clock.t += 27_999; // t0 + 29 999
    expect(await c.isActive("u1")).toBe("active");
    expect(s.calls).toHaveLength(1);
    s.clock.t += 1; // t0 + 30 000: the lookup that was in flight across a change can not reach further
    const again = c.isActive("u1");
    expect(s.calls).toHaveLength(2);
    s.pending[1]!(FOUND);
    expect(await again).toBe("active");
  });

  it("never reuses inactive: the next call asks again", async () => {
    const s = script([{ status: "inactive" }, FOUND]);
    const c = check(s);
    expect(await c.isActive("u1")).toBe("inactive");
    expect(await c.isActive("u1")).toBe("active");
    expect(s.calls).toHaveLength(2);
  });

  it("never reuses failed: a transient failure is retried by the next call", async () => {
    const s = script([{ status: "failed" }, FOUND]);
    const c = check(s);
    expect(await c.isActive("u1")).toBe("failed");
    expect(await c.isActive("u1")).toBe("active");
    expect(s.calls).toHaveLength(2);
  });

  it("a found memo is dropped once the user is reported inactive", async () => {
    const s = script([FOUND, { status: "inactive" }, { status: "inactive" }]);
    const c = check(s);
    expect(await c.isActive("u1")).toBe("active");
    s.clock.t += 30_000;
    expect(await c.isActive("u1")).toBe("inactive");
    expect(await c.isActive("u1")).toBe("inactive");
    expect(s.calls).toHaveLength(3);
  });

  it("keeps one entry per user: another user is looked up on its own", async () => {
    const s = script("found");
    const c = check(s);
    await c.isActive("u1");
    await c.isActive("u2");
    await c.isActive("u1");
    expect(s.calls).toEqual(["u1", "u2"]);
  });

  it("10 concurrent checks for one user share ONE lookup and all get its answer", async () => {
    const s = script("found", true);
    const c = check(s);
    const all = Array.from({ length: 10 }, () => c.isActive("u1"));
    expect(s.calls).toHaveLength(1);
    s.pending[0]!(FOUND);
    expect(await Promise.all(all)).toEqual(Array(10).fill("active"));
  });

  it("a shared lookup that failed is not reused by the next call", async () => {
    const s = script([{ status: "failed" }, FOUND], true);
    const c = check(s);
    const a = c.isActive("u1");
    const b = c.isActive("u1");
    s.pending[0]!({ status: "failed" });
    expect(await Promise.all([a, b])).toEqual(["failed", "failed"]);
    const next = c.isActive("u1");
    expect(s.calls).toHaveLength(2);
    s.pending[1]!(FOUND);
    expect(await next).toBe("active");
  });

  it("a client that rejects is a failed answer, not a throw, and is not remembered", async () => {
    let n = 0;
    const client: UserContactClient = {
      lookup: async () => {
        if (n++ === 0) throw new Error("boom");
        return FOUND;
      },
    };
    const c = createActivityCheck(client, { ttlMs: 30_000, now: () => 0 });
    expect(await c.isActive("u1")).toBe("failed");
    expect(await c.isActive("u1")).toBe("active");
  });
});
