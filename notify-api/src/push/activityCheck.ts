/**
 * The push channel's recipient liveness check (T18, specs/20261111-push-notifications,
 * ADR 20261112-push-liveness-answer-reused-30-seconds, AC-5.2 as amended 2026-11-12).
 *
 * Wraps the ADR 20261101-notify-api-resolves-email-notice-address-from-auth `UserContactClient` for the PUSH channel only. Asking auth once per
 * notification spends an allowance shared with every email notice (D-1), so:
 *
 *  - a `found` answer is remembered for `ttlMs` (30 s) per user, counted from the moment the
 *    request was SENT, not from its answer: a lookup in flight across a deactivation can never
 *    stretch the staleness bound past 30 s;
 *  - ONLY `found` is remembered. `inactive` and `failed` are asked again next time, so a
 *    transient auth failure is retried instead of turning into a standing refusal;
 *  - concurrent checks for one user share one in-flight lookup (single flight);
 *  - the memo holds the user id and an expiry, never the address or name, and entries exist
 *    only for users auth said are active. Expired entries are dropped on access.
 *
 * The email-notice path does NOT use this: it calls the client directly, so every email notice
 * is a fresh lookup (ADR 20261101-notify-api-resolves-email-notice-address-from-auth). notify-api is one process (ADR 20260713-sse-stream-auth-short-lived-ticket), so the memo is coherent.
 */

import type { UserContactClient } from "@/lib/userContact";

export type ActivityAnswer = "active" | "inactive" | "failed";

export interface ActivityCheck {
  /** Never rejects. */
  isActive(userId: string): Promise<ActivityAnswer>;
}

export type ActivityCheckOptions = {
  ttlMs: number;
  now?: () => number;
};

export function createActivityCheck(contacts: UserContactClient, options: ActivityCheckOptions): ActivityCheck {
  const now = options.now ?? Date.now;
  /** userId -> the instant (ms) until which a `found` may be reused. */
  const memo = new Map<string, number>();
  const inflight = new Map<string, Promise<ActivityAnswer>>();

  const lookup = async (userId: string): Promise<ActivityAnswer> => {
    const sentAt = now();
    let answer: ActivityAnswer;
    try {
      const result = await contacts.lookup(userId);
      answer = result.status === "found" ? "active" : result.status;
    } catch {
      answer = "failed";
    }
    if (answer === "active") memo.set(userId, sentAt + options.ttlMs);
    else memo.delete(userId);
    return answer;
  };

  return {
    isActive(userId) {
      const until = memo.get(userId);
      if (until !== undefined) {
        if (now() < until) return Promise.resolve("active");
        memo.delete(userId);
      }
      const shared = inflight.get(userId);
      if (shared !== undefined) return shared;
      const pending = lookup(userId).finally(() => {
        inflight.delete(userId);
      });
      inflight.set(userId, pending);
      return pending;
    },
  };
}
