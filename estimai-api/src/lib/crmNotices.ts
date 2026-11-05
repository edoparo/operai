/**
 * estimai-api → crm-api estimate notice client (close/reopen push).
 *
 * In the CRM a salesperson requests a technical estimate; crm-api creates the
 * EstimAI estimate and shares it with the technician as `editor`. When the
 * technician (or the owner) CLOSES the estimate here, the CRM learns it is
 * ready from this push; a REOPEN tells it the estimate is being worked on
 * again. The estimate's state lives here — the notice only carries the event,
 * the estimate's version AFTER the change (so crm-api can drop a reordered,
 * older notice), the instant of the change and who made it. No estimate
 * content, name or figures leave estimai-api through it.
 *
 * Same module shape as `notify.ts`: isolated so routes inject it (see
 * lifecycle.routes.ts's deps) instead of mocking global `fetch`, and it NEVER
 * THROWS. It calls crm-api's internal `POST /system/estimate-notices` as
 * estimai-api itself, with the scoped 5-minute service JWT from
 * `serviceToken.ts` (`Authorization: Bearer`, scope `estimate-notices.send`,
 * configured in auth's SERVICE_CLIENTS) — never the caller's JWT. One 401
 * drops the cached token and retries ONCE; a second 401 is a configuration
 * fault, logged and not looped on. Every failure (token refused, non-2xx,
 * network, timeout) is logged — status/ids only, never a token — and
 * swallowed: callers await this AFTER their transaction committed and the
 * request never fails or rolls back because of it.
 *
 * crm-api answers 204, also for an estimate it does not know; any 2xx is
 * success. `CRM_INTERNAL_URL` is optional: unset, the notifier is a no-op
 * (index.ts logs one startup line).
 */

import { env } from "./env";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

const REQUEST_TIMEOUT_MS = 5_000;

export type EstimateNoticeEvent = "closed" | "reopened";

/** The exact body crm-api's `POST /system/estimate-notices` accepts. */
export interface EstimateNotice {
  readonly estimateId: string;
  readonly event: EstimateNoticeEvent;
  /** The estimate's version AFTER the change. */
  readonly version: number;
  /** ISO 8601 instant of the change. */
  readonly at: string;
  /** `sub` of the user who closed/reopened it. */
  readonly byUserId: string;
}

export type SendEstimateNotice = (notice: EstimateNotice) => Promise<void>;

export interface CrmNoticeClientOptions {
  /** crm-api's base URL; `undefined` makes every send a no-op. */
  readonly baseUrl: string | undefined;
  readonly tokens: ServiceTokenProvider;
  /** Looked up per call (default: the global `fetch`) so a spied global is honoured. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createCrmNoticeClient(options: CrmNoticeClientOptions): SendEstimateNotice {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");

  function post(token: string, notice: EstimateNotice): Promise<Response> {
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    return doFetch(`${baseUrl}/system/estimate-notices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      // Exactly the five contract fields, in a fixed shape — nothing else.
      body: JSON.stringify({
        estimateId: notice.estimateId,
        event: notice.event,
        version: notice.version,
        at: notice.at,
        byUserId: notice.byUserId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
      // The request carries a credential; a redirect would replay it elsewhere.
      redirect: "error",
    });
  }

  return async (notice) => {
    if (baseUrl === undefined) return;
    const logContext = `estimate ${notice.estimateId} (${notice.event}, v${notice.version})`;
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await options.tokens.getToken();
        const response = await post(token, notice);
        await response.body?.cancel().catch(() => {});
        if (response.status === 401 && attempt === 0) {
          options.tokens.invalidate(token);
          continue;
        }
        if (!response.ok) {
          console.error(
            `[crm-notices] POST /system/estimate-notices responded with HTTP ${response.status} ` +
              `for ${logContext} — the estimai-api change was NOT rolled back`,
          );
        }
        return;
      }
    } catch (error) {
      // Messages here come from our own ServiceTokenError (status only) or the
      // runtime's fetch error; neither can contain the secret or a token.
      console.error(
        `[crm-notices] failed to push ${logContext} — the estimai-api change was NOT rolled back:`,
        error instanceof Error ? error.message : "unknown error",
      );
    }
  };
}

/** True when `CRM_INTERNAL_URL` is configured (index.ts logs the disabled case once). */
export const crmNoticesEnabled = env.CRM_INTERNAL_URL !== undefined;

/**
 * The instance wired from the environment. Under `NODE_ENV=test` its token
 * provider is the disabled one (serviceToken.ts), so a test can never push to
 * a real crm-api; route tests inject their own double.
 */
export const sendEstimateNotice: SendEstimateNotice = createCrmNoticeClient({
  baseUrl: env.CRM_INTERNAL_URL,
  tokens: serviceTokens,
});
