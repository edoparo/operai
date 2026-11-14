/**
 * crm-api → estimai-api deal-link notice client (specs/20261108-estimate-list-oversight US-3, ADR 20261108-crm-pushes-deal-links-to-estimai;
 * mirror of estimai-api's `crmNotices.ts`).
 *
 * The CRM owns which deal an estimate is linked to; EstimAI shows it as a
 * badge on the estimate list. When a link is made (`linked`) or removed
 * (`unlinked`) this pushes the fact to estimai-api's internal
 * `POST /system/deal-link-notices` as crm-api itself, with the scoped
 * 5-minute service JWT from `serviceToken.ts` (scope `deal-link-notices.send`,
 * granted to this service client in auth's SERVICE_CLIENTS — the scope is
 * configured there, not requested here). The body is exactly
 * `{estimateId, dealId, event, at}`: no title, name or money.
 *
 * NEVER THROWS. One 401 drops the cached token and retries ONCE; a second is a
 * configuration fault, logged and not looped on. Every failure is logged
 * (ids/status only, never a token) and swallowed: callers await this AFTER the
 * CRM transaction committed and the request never fails because of it. The
 * returned boolean (delivered or not) is for the backfill script only.
 *
 * `ESTIMAI_INTERNAL_URL` is optional: unset, every send is a no-op. Under
 * `NODE_ENV=test` the wired instance is a no-op too (a developer's env may
 * hold real credentials); tests inject a recorder with `setDealLinkSenderForTests`.
 */

import { env } from "./env";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

const REQUEST_TIMEOUT_MS = 5_000;

export type DealLinkEvent = "linked" | "unlinked";

/** The exact body estimai-api's `POST /system/deal-link-notices` accepts. */
export interface DealLinkNotice {
  readonly estimateId: string;
  readonly dealId: string;
  readonly event: DealLinkEvent;
  /** ISO 8601 instant of the change, from the CRM's clock. */
  readonly at: string;
}

/** Resolves true when estimai-api answered 2xx; never rejects. */
export type SendDealLinkNotice = (notice: DealLinkNotice) => Promise<boolean>;

export interface DealLinkClientOptions {
  /** estimai-api's base URL; `undefined` makes every send a no-op. */
  readonly baseUrl: string | undefined;
  readonly tokens: ServiceTokenProvider | null;
  /** Looked up per call (default: the global `fetch`). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createDealLinkNoticeClient(options: DealLinkClientOptions): SendDealLinkNotice {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");
  const tokens = options.tokens;

  function post(token: string, notice: DealLinkNotice): Promise<Response> {
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    return doFetch(`${baseUrl}/system/deal-link-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // Exactly the four contract fields, in a fixed shape — nothing else.
      body: JSON.stringify({
        estimateId: notice.estimateId,
        dealId: notice.dealId,
        event: notice.event,
        at: notice.at,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      // The request carries a credential; a redirect would replay it elsewhere.
      redirect: "error",
    });
  }

  return async (notice) => {
    if (baseUrl === undefined || tokens === null) return false;
    const ref = `estimate ${notice.estimateId} deal ${notice.dealId} (${notice.event})`;
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await tokens.getToken();
        const response = await post(token, notice);
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 && attempt === 0) {
          tokens.invalidate(token);
          continue;
        }
        if (!response.ok) {
          console.error(
            `[estimai-notices] POST /system/deal-link-notices responded with HTTP ${response.status} ` +
              `for ${ref} — the CRM change was NOT rolled back`,
          );
        }
        return response.ok;
      }
    } catch (error) {
      // Messages come from our own ServiceTokenError (status only) or the
      // runtime's fetch error; neither can contain the secret or a token.
      console.error(
        `[estimai-notices] failed to push ${ref} — the CRM change was NOT rolled back:`,
        error instanceof Error ? error.message : "unknown error",
      );
      return false;
    }
  };
}

/** True when the wired client can send (ESTIMAI_INTERNAL_URL and a service client). */
export const dealLinkNoticesConfigured = env.ESTIMAI_INTERNAL_URL !== undefined && serviceTokens !== null;

/** The client wired from the environment; the backfill script uses it directly. */
export const envDealLinkNoticeClient: SendDealLinkNotice = createDealLinkNoticeClient({
  baseUrl: env.ESTIMAI_INTERNAL_URL,
  tokens: serviceTokens,
});

const noop: SendDealLinkNotice = async () => false;
let current: SendDealLinkNotice = env.NODE_ENV === "test" ? noop : envDealLinkNoticeClient;

if (env.NODE_ENV !== "test" && !dealLinkNoticesConfigured) {
  console.log("[estimai-notices] ESTIMAI_INTERNAL_URL / SERVICE_CLIENT_* not set — deal-link notices are disabled");
}

/** What routes call, after their transaction committed. Never throws. */
export const sendDealLinkNotice: SendDealLinkNotice = async (notice) => {
  try {
    return await current(notice);
  } catch {
    return false;
  }
};

/** Tests only: swap in a recorder (or `null` for the no-op). */
export function setDealLinkSenderForTests(send: SendDealLinkNotice | null): void {
  current = send ?? noop;
}
