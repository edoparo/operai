/**
 * The `OwnerNamePort`: how the accounting release asks `auth` for the NAME of an employee whose requests were stored with
 * `ownerName = null` (specs/20261119-accounting T84; 2026-11-20 live-e2e / eval round 3 finding on specs/20261118 AC-4.2, AC-6.13).
 *
 * WHY. `POST /requests` stored no name until commit 086b92fb (the name is the token's `name` claim). Every request created before
 * that has `ownerName = null`, so the journal Description would fall back to the email (AC-6.13) and the receipt-number initials
 * would come from the email (AC-4.2) while a new request of the same employee gets them from the name: two prefixes in 2026.
 *
 * WHO. refund-api as itself: the 5-minute service JWT of `serviceTokens` (scope `users.contact` in auth's SERVICE_CLIENTS entry of
 * refund-api). ONE user per call, `POST {AUTH_BASE_URL}/system/users/contact` `{ userId }` -> `{ id, email, name }`; an unknown or
 * soft-deleted user is the same 404 ("gone": not an error, the request stays unnamed).
 *
 * ONE FAILURE. Every other way of not getting a clean answer (token mint, network, timeout, 401 after one re-mint, 429, 5xx,
 * an unreadable body) is `OwnerNamesUnavailableError(kind)`, so "could not find out" is never read as "gone". The kind names no
 * URL, host, token, id, email or name.
 */
import { env } from "../lib/env";
import { serviceTokens, type ServiceTokenProvider } from "../lib/serviceToken";

export const OWNER_NAME_FAILURE_KINDS = ["token", "unreachable", "unauthorized", "rate_limited", "server_error", "unexpected"] as const;
export type OwnerNameFailureKind = (typeof OWNER_NAME_FAILURE_KINDS)[number];

export class OwnerNamesUnavailableError extends Error {
  constructor(readonly kind: OwnerNameFailureKind) {
    super(`owner names unavailable (${kind})`);
    this.name = "OwnerNamesUnavailableError";
  }
}

/** `found`: auth knows the user (`name` may be blank: the caller treats that as no name); `gone`: unknown or deleted (404). */
export type OwnerNameAnswer = { readonly state: "found"; readonly name: string } | { readonly state: "gone" };

export interface OwnerNamePort {
  /** One user's name. Throws `OwnerNamesUnavailableError` for anything but a clean 200 or 404. */
  lookup(userId: string): Promise<OwnerNameAnswer>;
}

export interface OwnerNameClientOptions {
  readonly baseUrl: string;
  readonly tokens: ServiceTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const TIMEOUT_MS = 5_000;

export function createOwnerNameClient(options: OwnerNameClientOptions): OwnerNamePort {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  async function attempt(userId: string, token: string): Promise<Response> {
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    try {
      return await doFetch(`${options.baseUrl}/system/users/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new OwnerNamesUnavailableError("unreachable");
    }
  }

  async function mint(): Promise<string> {
    try {
      return await options.tokens.getToken();
    } catch {
      throw new OwnerNamesUnavailableError("token");
    }
  }

  return {
    async lookup(userId) {
      let token = await mint();
      let res = await attempt(userId, token);
      if (res.status === 401) {
        // One re-mint, as every other service client: the token may have been rotated out from under us.
        options.tokens.invalidate(token);
        token = await mint();
        res = await attempt(userId, token);
      }
      if (res.status === 404) return { state: "gone" };
      if (res.status === 401 || res.status === 403) throw new OwnerNamesUnavailableError("unauthorized");
      if (res.status === 429) throw new OwnerNamesUnavailableError("rate_limited");
      if (res.status >= 500) throw new OwnerNamesUnavailableError("server_error");
      if (!res.ok) throw new OwnerNamesUnavailableError("unexpected");
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new OwnerNamesUnavailableError("unexpected");
      }
      const { id, name } = (body ?? {}) as Record<string, unknown>;
      // The answer must be about the user asked for, and carry a name field (blank is allowed: it is "no name").
      if (id !== userId || typeof name !== "string") throw new OwnerNamesUnavailableError("unexpected");
      return { state: "found", name };
    },
  };
}

let current: OwnerNamePort | null = null;

/** The real client of `AUTH_BASE_URL`, built on first use. */
export function ownerNamePort(): OwnerNamePort {
  current ??= createOwnerNameClient({ baseUrl: env.AUTH_BASE_URL, tokens: serviceTokens });
  return current;
}
