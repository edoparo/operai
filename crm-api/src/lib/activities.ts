/**
 * crm-api → activities-api system client (specs/028 T12; AC-1.2 .. AC-1.4, AC-8.4; ADR-0082).
 *
 * The CRM's activities and tasks live in activities-api now. What crm-api used to write inside its
 * own transactions it asks for here, AS ITSELF: the scoped 5-minute service JWT of
 * `serviceToken.ts` (`sub system:crm-api`, scope `activities.write`, `aud` SERVICE_AUDIENCE), on
 * the `/system/v1/*` routes. crm-api has already decided who may do what, as the user, before it
 * calls; no user JWT is ever forwarded.
 *
 * The identity of every write is chosen by the caller (PUT under an id, a seq on a completion), so
 * a call can be repeated and compensated without a shared transaction:
 *
 *   put(id, …)                       create-if-absent, never an overwrite
 *   remove(id, { onlyIfOpen })       absent is fine; a completed task survives `onlyIfOpen`
 *   removeQuietly(id)                the compensation of a put whose commit failed (logged, never thrown)
 *   complete(id, …)                  applies only a newer `seq`
 *   mirrorMeeting(notice)            the meeting activity of a deal; the seq guard lives over there
 *   eraseContact(contactId)          unlinks a contact from every activity, before it is deleted
 *
 * Every failure to get an answer (not configured, no token, network, timeout, maintenance, any
 * non-2xx) is one 503 `activities_unavailable` Problem: a caller that must not proceed without the
 * answer lets it propagate and the CRM changes nothing; only `removeQuietly` swallows it. One 401
 * drops the cached token and retries ONCE; a second is a configuration fault, not looped on.
 * Nothing here logs a token, the secret or a body: statuses and ids only.
 */

import { env } from "./env";
import { ProblemError } from "./problem";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

/** Under Prisma's interactive-transaction budget a caller sets for the calls it makes inside one. */
const REQUEST_TIMEOUT_MS = 4_000;

/**
 * The bound of a call made while a database row lock is held (the estimate notice, plan § Risks):
 * 2 s per attempt, and no more than 4 s in all, the token exchange and the 401 retry included, so
 * the lock is never held for long by this call. A call without it keeps the default timeout.
 */
export interface CallBound {
  readonly timeoutMs: number;
  readonly budgetMs: number;
}
export const LOCKED_CALL: CallBound = { timeoutMs: 2_000, budgetMs: 4_000 };

export const ACTIVITIES_UNAVAILABLE = "activities_unavailable";

const unavailable = (detail = "Activities are unavailable; try again shortly") =>
  new ProblemError({ status: 503, code: ACTIVITIES_UNAVAILABLE, detail });

export interface NewActivity {
  readonly type: "note" | "call" | "email" | "task";
  readonly subject: string;
  readonly body?: string | null;
  /** ISO 8601 with offset. */
  readonly occurredAt: string;
  readonly companyId: string;
  readonly dealId?: string | null;
  readonly authorUserId: string;
  readonly assigneeUserId?: string | null;
  /** `YYYY-MM-DD`, tasks only. */
  readonly dueDate?: string | null;
}

/** Where the completed task lives, so the "You can go ahead" notice can name it (activities-api `context`). */
export interface CompletionContext {
  readonly companyName: string;
  readonly dealId: string | null;
  readonly dealTitle: string | null;
}

export interface Completion {
  readonly completed: boolean;
  readonly at: string;
  readonly byUserId: string;
  /** Monotonic per task: the estimate's EstimAI version. */
  readonly seq: number;
  readonly context?: CompletionContext;
}

/** meetings-api's notice, as activities-api's `meeting-mirror` takes it. */
export interface MeetingMirrorNotice {
  readonly noticeId: string;
  readonly seq: number;
  readonly event: "linked" | "changed" | "unlinked" | "deleted";
  readonly meeting: {
    readonly id: string;
    readonly title: string | null;
    readonly startsAt: string | null;
    readonly creatorId: string;
  };
  /** `companyId` is needed for `linked` only: the other events find the activity by its meeting. */
  readonly deal: { readonly id: string; readonly companyId?: string };
}

export interface ActivitiesClient {
  put(id: string, activity: NewActivity): Promise<{ created: boolean }>;
  remove(id: string, options?: { onlyIfOpen?: boolean }): Promise<void>;
  removeQuietly(id: string): Promise<void>;
  complete(id: string, completion: Completion, bound?: CallBound): Promise<{ applied: boolean }>;
  mirrorMeeting(notice: MeetingMirrorNotice): Promise<{ applied: boolean }>;
  eraseContact(contactId: string): Promise<{ unlinked: number }>;
}

export interface ActivitiesClientOptions {
  /** activities-api's base URL; `undefined` makes every call a 503 `activities_unconfigured`. */
  readonly baseUrl: string | undefined;
  readonly tokens: ServiceTokenProvider | null;
  /** Looked up per call (default: the global `fetch`). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const segment = encodeURIComponent;

/** `promise`, or a rejection once `ms` have passed (the promise is left to settle on its own). */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createActivitiesClient(options: ActivitiesClientOptions): ActivitiesClient {
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");
  const tokens = options.tokens;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  /** The 2xx response, or a thrown 503. `ref` names the call in the log (method, path, never a body). */
  async function send(method: string, path: string, body?: unknown, bound?: CallBound): Promise<Response> {
    if (baseUrl === undefined || tokens === null) {
      throw new ProblemError({ status: 503, code: "activities_unconfigured", detail: "Activities are not configured for the CRM" });
    }
    const ref = `${method} ${path.split("?")[0]}`;
    const deadline = bound === undefined ? Number.POSITIVE_INFINITY : Date.now() + bound.budgetMs;
    for (let attempt = 0; ; attempt++) {
      const left = deadline - Date.now();
      if (left <= 0) {
        console.error(`[activities] ${ref} ran out of its ${bound?.budgetMs} ms budget`);
        throw unavailable();
      }
      let token: string;
      try {
        token = await (bound === undefined ? tokens.getToken() : within(tokens.getToken(), left));
      } catch (error) {
        console.error(`[activities] no service token for ${ref}:`, error instanceof Error ? error.message : "unknown error");
        throw unavailable();
      }
      let res: Response;
      try {
        const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
        res = await doFetch(`${baseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(bound === undefined ? timeoutMs : Math.max(1, Math.min(bound.timeoutMs, deadline - Date.now()))),
          // The request carries a credential; a redirect would replay it elsewhere.
          redirect: "error",
        });
      } catch (error) {
        console.error(`[activities] ${ref} failed:`, error instanceof Error ? error.name : "unknown error");
        throw unavailable();
      }
      if (res.status === 401 && attempt === 0) {
        await res.body?.cancel().catch(() => {});
        tokens.invalidate(token);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        console.error(`[activities] ${ref} answered HTTP ${res.status}`);
        throw unavailable();
      }
      return res;
    }
  }

  async function json(res: Response, ref: string): Promise<Record<string, unknown>> {
    try {
      const body = (await res.json()) as unknown;
      if (typeof body === "object" && body !== null) return body as Record<string, unknown>;
    } catch {
      // falls through
    }
    console.error(`[activities] ${ref} returned an unreadable body`);
    throw unavailable();
  }

  async function applied(res: Response, ref: string): Promise<{ applied: boolean }> {
    const body = await json(res, ref);
    if (typeof body["applied"] !== "boolean") {
      console.error(`[activities] ${ref} returned an unexpected body`);
      throw unavailable();
    }
    return { applied: body["applied"] };
  }

  async function remove(id: string, { onlyIfOpen = false }: { onlyIfOpen?: boolean } = {}): Promise<void> {
    const res = await send("DELETE", `/system/v1/activities/${segment(id)}?onlyIfOpen=${onlyIfOpen}`);
    await res.body?.cancel().catch(() => {});
  }

  return {
    async put(id, activity) {
      const res = await send("PUT", `/system/v1/activities/${segment(id)}`, activity);
      return { created: res.status === 201 };
    },
    remove,
    async removeQuietly(id) {
      try {
        await remove(id);
      } catch (error) {
        console.error(`[activities] could not remove the activity ${id} a failed request left behind:`, error instanceof Error ? error.message : "unknown error");
      }
    },
    async complete(id, completion, bound) {
      const res = await send("POST", `/system/v1/activities/${segment(id)}/completion`, completion, bound);
      return applied(res, "POST /system/v1/activities/{id}/completion");
    },
    async mirrorMeeting(notice) {
      const res = await send("POST", "/system/v1/meeting-mirror", notice);
      return applied(res, "POST /system/v1/meeting-mirror");
    },
    async eraseContact(contactId) {
      const res = await send("POST", `/system/v1/contacts/${segment(contactId)}/erase`);
      const body = await json(res, "POST /system/v1/contacts/{id}/erase");
      const unlinked = body["unlinked"];
      if (typeof unlinked !== "number") {
        console.error("[activities] POST /system/v1/contacts/{id}/erase returned an unexpected body");
        throw unavailable();
      }
      return { unlinked };
    },
  };
}

/** The client wired from the environment: what the routes call. */
export const activities: ActivitiesClient = createActivitiesClient({
  baseUrl: env.ACTIVITIES_API_URL,
  tokens: serviceTokens,
});
