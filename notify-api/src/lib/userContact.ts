/**
 * Recipient lookup (specs/20261101-crm-notifications, ADR 20261101-notify-api-resolves-email-notice-address-from-auth; also read by the push
 * channel's activity check, specs/20261111-push-notifications, which puts a 30 s memo of `found` in front of
 * it — push/activityCheck.ts, ADR 20261112-push-liveness-answer-reused-30-seconds; the email notice path calls this client directly,
 * a fresh lookup every time): `POST ${AUTH_BASE_URL}/system/users/contact` with the caller's
 * own service JWT (scope `users.contact`) and `{ userId }`.
 *
 *   200 -> { id, email, name }  => "found"
 *   404 -> the user is unknown or deleted => "inactive" (not an error: there is
 *          nobody to mail, so the notice is skipped)
 *   401 -> the cached token is no good: drop it and retry ONCE with a fresh one
 *   anything else, a network error or the 5 s timeout => "failed"
 *
 * Never throws. Never logs, and never puts in a message, the address, the name,
 * the user id, a token or the secret — a failure is named by HTTP status or
 * error class only. The request refuses redirects: the Authorization header
 * would otherwise follow them.
 */

import { env } from "./env";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

const REQUEST_TIMEOUT_MS = 5_000;

export type ContactLookupResult =
  | { readonly status: "found"; readonly email: string; readonly name: string }
  | { readonly status: "inactive" }
  | { readonly status: "failed" };

export interface UserContactClient {
  lookup(userId: string): Promise<ContactLookupResult>;
}

export interface UserContactClientOptions {
  readonly baseUrl: string;
  readonly tokens: ServiceTokenProvider;
  /** Looked up per call (default: the global `fetch`) so a spied global is honoured. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createUserContactClient(options: UserContactClientOptions): UserContactClient {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post(token: string, userId: string): Promise<Response> {
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    return doFetch(`${options.baseUrl}/system/users/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  }

  return {
    async lookup(userId) {
      try {
        for (let attempt = 0; ; attempt++) {
          const token = await options.tokens.getToken();
          const res = await post(token, userId);
          if (res.status === 401 && attempt === 0) {
            await res.body?.cancel().catch(() => {});
            options.tokens.invalidate(token);
            continue;
          }
          if (res.status === 404) {
            await res.body?.cancel().catch(() => {});
            return { status: "inactive" };
          }
          if (!res.ok) {
            await res.body?.cancel().catch(() => {});
            console.error(`[user-contact] auth answered HTTP ${res.status} — lookup failed`);
            return { status: "failed" };
          }
          const body = (await res.json()) as Record<string, unknown> | null;
          const { email, name } = body ?? {};
          if (typeof email !== "string" || email === "") {
            console.error("[user-contact] auth returned an unexpected body — lookup failed");
            return { status: "failed" };
          }
          return { status: "found", email, name: typeof name === "string" ? name : "" };
        }
      } catch (error) {
        // Our own ServiceTokenError (status only) or the runtime's fetch/abort
        // error; neither carries the secret, a token or the address.
        console.error(
          "[user-contact] lookup failed:",
          error instanceof Error ? error.name : "unknown error",
        );
        return { status: "failed" };
      }
    },
  };
}

/** The client wired from the environment; `null` when the email-notice group is not configured. */
export const userContact: UserContactClient | null =
  env.AUTH_BASE_URL !== undefined && serviceTokens !== null
    ? createUserContactClient({ baseUrl: env.AUTH_BASE_URL, tokens: serviceTokens })
    : null;
