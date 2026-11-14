/**
 * Unit tests for the sliding-window rate limiter (specs/20260807-estimate-sharing,
 * T1 — done-when: "a unit test proves the limiter admits N and rejects N+1
 * within the window and re-admits after it"). Uses the injectable `now`
 * clock so the whole suite runs deterministically with no real sleeps.
 */

import { describe, expect, test } from "bun:test";
import { createSlidingWindowRateLimiter } from "./rateLimiter";

describe("createSlidingWindowRateLimiter", () => {
  test("admits up to `limit` attempts within the window", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 3,
      windowMs: 1000,
    });
    const now = 1_000_000;

    expect(limiter.consume("sub-1", now).allowed).toBe(true);
    expect(limiter.consume("sub-1", now + 10).allowed).toBe(true);
    expect(limiter.consume("sub-1", now + 20).allowed).toBe(true);
  });

  test("rejects the (N+1)th attempt within the window with a positive retryAfterMs", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 3,
      windowMs: 1000,
    });
    const now = 2_000_000;

    limiter.consume("sub-2", now);
    limiter.consume("sub-2", now + 10);
    limiter.consume("sub-2", now + 20);

    const fourth = limiter.consume("sub-2", now + 30);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
    expect(fourth.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  test("re-admits once the earliest attempt has aged out of the window", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 2,
      windowMs: 1000,
    });
    const now = 3_000_000;

    expect(limiter.consume("sub-3", now).allowed).toBe(true);
    expect(limiter.consume("sub-3", now + 100).allowed).toBe(true);
    expect(limiter.consume("sub-3", now + 200).allowed).toBe(false);

    // Just past the window for the FIRST attempt only.
    const afterFirstExpires = now + 1001;
    expect(limiter.consume("sub-3", afterFirstExpires).allowed).toBe(true);

    // The second original attempt (now + 100) is still inside its own
    // window relative to afterFirstExpires (900ms old), so limit(2) is hit
    // again immediately.
    expect(limiter.consume("sub-3", afterFirstExpires + 1).allowed).toBe(
      false,
    );

    // Once BOTH original attempts are fully out of the window, it re-admits.
    const wellPastWindow = now + 2000;
    expect(limiter.consume("sub-3", wellPastWindow).allowed).toBe(true);
  });

  test("a rejected attempt is not itself counted as a new occupied slot", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
    });
    const now = 4_000_000;

    expect(limiter.consume("sub-4", now).allowed).toBe(true);
    // Reject several times in a row — none of these should push the
    // recovery point further out than the original single admitted hit.
    limiter.consume("sub-4", now + 10);
    limiter.consume("sub-4", now + 20);
    const rejected = limiter.consume("sub-4", now + 30);
    expect(rejected.allowed).toBe(false);

    // Exactly windowMs after the ORIGINAL admitted attempt, it recovers —
    // not delayed by the rejected probes in between.
    expect(limiter.consume("sub-4", now + 1000).allowed).toBe(true);
  });

  test("different keys are tracked independently", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
    });
    const now = 5_000_000;

    expect(limiter.consume("sub-a", now).allowed).toBe(true);
    expect(limiter.consume("sub-a", now + 1).allowed).toBe(false);
    // A different key is unaffected by sub-a's exhausted window.
    expect(limiter.consume("sub-b", now + 1).allowed).toBe(true);
  });

  test("defaults `now` to the real clock when not supplied", () => {
    const limiter = createSlidingWindowRateLimiter({
      limit: 1,
      windowMs: 1000,
    });
    const result = limiter.consume("sub-real-clock");
    expect(result.allowed).toBe(true);
  });
});

describe("createSlidingWindowRateLimiter — maxKeys (specs/20261111-push-notifications US-7, R13)", () => {
  const make = (maxKeys?: number) =>
    createSlidingWindowRateLimiter({ limit: 2, windowMs: 1000, ...(maxKeys === undefined ? {} : { maxKeys }) });

  test("unset: every key keeps its own count (existing limiters unchanged)", () => {
    const limiter = make();
    const now = 9_000_000;
    for (let i = 0; i < 200; i++) {
      expect(limiter.consume(`k${i}`, now).allowed).toBe(true);
      expect(limiter.consume(`k${i}`, now).allowed).toBe(true);
    }
    expect(limiter.consume("k0", now).allowed).toBe(false);
  });

  test("at the cap a NEW key shares one overflow key; existing keys keep their own counts", () => {
    const limiter = make(3);
    const now = 9_100_000;
    limiter.consume("a", now);
    limiter.consume("b", now);
    limiter.consume("c", now);
    // d, e, f are new: they all count under the one overflow key (limit 2)
    expect(limiter.consume("d", now).allowed).toBe(true);
    expect(limiter.consume("e", now).allowed).toBe(true);
    expect(limiter.consume("f", now).allowed).toBe(false);
    // an existing key is untouched by the overflow
    expect(limiter.consume("a", now).allowed).toBe(true);
    expect(limiter.consume("a", now).allowed).toBe(false);
  });

  test("pruning frees capacity: after the window a new key has its own count again", () => {
    const limiter = make(2);
    const t0 = 9_200_000;
    limiter.consume("a", t0);
    limiter.consume("b", t0);
    limiter.consume("c", t0);
    limiter.consume("c", t0);
    expect(limiter.consume("c", t0).allowed).toBe(false); // overflow exhausted
    const later = t0 + 1500;
    expect(limiter.consume("c", later).allowed).toBe(true);
    expect(limiter.consume("c", later).allowed).toBe(true);
    expect(limiter.consume("c", later).allowed).toBe(false); // own key now, limit 2
    expect(limiter.consume("zz", later).allowed).toBe(true); // other new key not blocked by overflow
  });

  test("a refused attempt at the cap is not recorded (does not extend the refusal)", () => {
    const limiter = make(1);
    const t0 = 9_300_000;
    limiter.consume("a", t0);
    limiter.consume("n1", t0);
    limiter.consume("n2", t0);
    expect(limiter.consume("n3", t0 + 900).allowed).toBe(false);
    expect(limiter.consume("n3", t0 + 1001).allowed).toBe(true);
  });
});
