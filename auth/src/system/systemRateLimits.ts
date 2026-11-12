/**
 * The limits of the two internal endpoints every backend calls —
 * `POST /system/service-token` (ADR-0044/0049) and `POST /system/users/contact`
 * (ADR-0056) — as decided by specs/029 US-7 and ADR-0086.
 *
 * THE RULE: a rate limit is keyed by the identity it is meant to bound, and a
 * credential is verified before any count is consulted. The routes verify
 * first, then consult exactly ONE of:
 *
 *   serviceToken     a VALID service-token credential, keyed by the verified
 *                    `system:<clientId>`           (300 per window by default)
 *   usersContact     a VALID contact-lookup credential, keyed by the verified
 *                    JWT `sub`                      (600 per window)
 *   invalidCredentials  an INVALID credential of either endpoint, keyed by
 *                    the source address — the only key available before there
 *                    is an identity. ONE counter shared by both routes (20 per
 *                    window), capped at `INVALID_MAX_KEYS` keys.
 *
 * Why not one address bucket (the old shape): on Railway's private network no
 * forwarded address reaches `auth`, so every service is the same "direct"
 * caller and the suite shared one bucket of 20 (D-1). Why not key the
 * pre-verification count by the claimed client id: anyone could then lock a
 * service out by its guessable name (ADR-0086 option E).
 *
 * Both refusals are the SAME response, built only by `tooManyRequests`: its
 * status, body and headers are a function of the request path and the window,
 * never of which limiter refused or how full it is, and `Retry-After` is the
 * fixed window length (a bucket's remainder would tell a sender whether its
 * credential was valid). A refused attempt is never recorded (the limiter's
 * `consume` semantics), so retrying during a refusal does not extend it.
 *
 * Per process, like the suite's other limiters (ADR-0035): a second `auth`
 * instance would double every allowance (R17). `RateLimiter` is the seam for a
 * shared store.
 */

import type { Context } from "hono";
import { env } from "../lib/env";
import { createSlidingWindowRateLimiter, type RateLimiter } from "../lib/rateLimiter";

/** Distinct source addresses held for the invalid-credential count; past this, new ones share one overflow key. */
export const INVALID_MAX_KEYS = 50_000;

export interface SystemRateLimitConfig {
  /** Service tokens per calling service per window (AC-7.1). */
  serviceTokenLimit: number;
  /** Contact lookups per calling service per window (AC-7.2). */
  usersContactLimit: number;
  /** Invalid-credential requests per source address per window, both routes together (AC-7.5). */
  invalidLimit: number;
  /** The one window of all three limiters, and the source of `Retry-After`. */
  windowMs: number;
}

export type SystemRoute = "service-token" | "users/contact";

export interface SystemRateLimits {
  invalidCredentials: RateLimiter;
  serviceToken: RateLimiter;
  usersContact: RateLimiter;
  windowMs: number;
  /** The ONLY 429 of the two routes. */
  tooManyRequests(c: Context): Response;
  /**
   * Bounded log line for a refusal, at most one per key per window. `invalid`
   * logs no key (an address); `allowance` logs the verified `system:<id>`.
   */
  logRefusal(kind: "invalid" | "allowance", route: SystemRoute, key: string): void;
}

export function createSystemRateLimits(
  options: { now?: () => number; config?: Partial<SystemRateLimitConfig> } = {},
): SystemRateLimits {
  const now = options.now ?? Date.now;
  const config: SystemRateLimitConfig = {
    serviceTokenLimit: env.SERVICE_TOKEN_SERVICE_LIMIT,
    usersContactLimit: env.USERS_CONTACT_SERVICE_LIMIT,
    invalidLimit: env.SYSTEM_INVALID_CREDENTIAL_LIMIT,
    windowMs: env.SYSTEM_RATE_WINDOW_MS,
    ...options.config,
  };
  const { windowMs } = config;

  // The limiter reads the clock from the injected function unless the caller passes one.
  const create = (limit: number, maxKeys?: number): RateLimiter => {
    const inner = createSlidingWindowRateLimiter({
      limit,
      windowMs,
      ...(maxKeys === undefined ? {} : { maxKeys }),
    });
    return { consume: (key, at) => inner.consume(key, at ?? now()) };
  };

  const retryAfter = String(Math.max(1, Math.ceil(windowMs / 1000)));

  const lastLogged = new Map<string, number>();

  return {
    invalidCredentials: create(config.invalidLimit, INVALID_MAX_KEYS),
    serviceToken: create(config.serviceTokenLimit),
    usersContact: create(config.usersContactLimit),
    windowMs,

    tooManyRequests(c) {
      return c.json(
        {
          type: "https://httpstatuses.com/429",
          title: "Too Many Requests",
          status: 429,
          detail: "Too many requests. Try again later.",
          instance: c.req.path,
          code: "rate_limited",
        },
        429,
        { "Retry-After": retryAfter, "Cache-Control": "no-store" },
      );
    },

    logRefusal(kind, route, key) {
      const at = now();
      const id = `${kind}|${route}|${key}`;
      const last = lastLogged.get(id);
      if (last !== undefined && at - last < windowMs) return;
      if (lastLogged.size >= INVALID_MAX_KEYS) {
        for (const [k, t] of lastLogged) if (at - t >= windowMs) lastLogged.delete(k);
        // Still full: stay silent rather than grow (the refusals themselves are already bounded).
        if (lastLogged.size >= INVALID_MAX_KEYS) return;
      }
      lastLogged.set(id, at);
      console.warn(
        kind === "invalid"
          ? `[system/${route}] invalid-credential limit reached`
          : `[system/${route}] allowance exhausted caller=${key}`,
      );
    },
  };
}
