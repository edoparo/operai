/**
 * Activities notifications (specs/20261110-activities US-6, AC-6.1..6.4; ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired, ADR 20261104-bilingual-system-notifications). The after-write
 * push of `task_assigned`, `activity_participant_added` and `task_unblocked` to notify-api's
 * `POST /system/notifications`, authenticated with the scoped service JWT from
 * `serviceToken.ts` (`notifications.push emails.send`: the two email kinds are sent with
 * `email: true`, which notify-api refuses without `emails.send`, ADR 20261101-notify-api-resolves-email-notice-address-from-auth). notify-api binds
 * `system:activities-api` to the origin apps `crm` and `projects`.
 *
 * Carried over from crm-api's `notify.ts` (same posture, same pattern):
 *
 * STRICTLY BEST-EFFORT: nothing here throws, and the route never awaits the delivery: the
 * activity in this service's own database is authoritative (AC-6.4). Whatever goes wrong is
 * logged as the event kind, the activity id and an HTTP status or error name only: never a
 * token, the secret, a subject, a name or an address.
 *
 * - One request per distinct recipient; the actor is never notified.
 * - One 401 drops the cached token and retries ONCE with a fresh one.
 * - A no-op when the env group is absent (logged once at startup), and under
 *   `NODE_ENV=test` unless a test injects a notifier (`setNotifierForTests`).
 * - BILINGUAL: English `title`/`body` plus `it: { title, body }` from `notificationCopy.ts`.
 *
 * Env names relied on (env.ts, T3): `NOTIFY_INTERNAL_URL`, `SERVICE_CLIENT_ID`,
 * `SERVICE_CLIENT_SECRET` (all-or-none), `AUTH_BASE_URL` (service token + actor name) and
 * `NODE_ENV`.
 */

import { env } from "./env";
import { errorFacts } from "./errorFacts";
import { resolveIdentities } from "./identities";
import { clip, MAX_NAME, renderNotification, type NotifyActivity, type NotifyKind, type NotifyTarget } from "./notificationCopy";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

export { clip, formatDueDate, type NotifyActivity, type NotifyKind, type NotifyTarget } from "./notificationCopy";

const REQUEST_TIMEOUT_MS = 5_000;
const NAME_TIMEOUT_MS = 2_000;
export const FALLBACK_ACTOR = "A colleague";

/** What a route hands over, plus the actor's resolved display name. */
export interface NotifyEvent {
  readonly kind: NotifyKind;
  /** The activity the event is about, for the log only. */
  readonly activityId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly recipientIds: readonly (string | null | undefined)[];
  readonly activity: NotifyActivity;
  readonly target: NotifyTarget;
}

export interface Notifier {
  /** Never throws, never rejects. */
  notify(event: NotifyEvent): Promise<void>;
}

/** The distinct recipients, without the actor and without empty ids. */
export function recipientsOf(event: Pick<NotifyEvent, "actorId" | "recipientIds">): string[] {
  const out = new Set<string>();
  for (const id of event.recipientIds) if (id && id !== event.actorId) out.add(id);
  return [...out];
}

export interface NotifierOptions {
  readonly baseUrl: string;
  readonly tokens: ServiceTokenProvider;
  /** Looked up per call (default: the global `fetch`). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createNotifier(options: NotifierOptions): Notifier {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function post(token: string, recipientId: string, event: NotifyEvent): Promise<Response> {
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const text = renderNotification(event.kind, event, event.actorName);
    return doFetch(`${options.baseUrl}/system/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipientId,
        originApp: text.originApp,
        severity: text.severity,
        title: text.title,
        body: text.body,
        link: { href: text.href },
        it: text.it,
        ...(text.email ? { email: true } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  }

  async function pushOne(recipientId: string, event: NotifyEvent): Promise<void> {
    const ref = `${event.kind} activity=${event.activityId}`;
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await options.tokens.getToken();
        const res = await post(token, recipientId, event);
        await res.body?.cancel().catch(() => {});
        if (res.status === 401 && attempt === 0) {
          options.tokens.invalidate(token);
          continue;
        }
        if (!res.ok) console.error(`[notify] notify-api answered HTTP ${res.status} for ${ref} — change NOT rolled back`);
        return;
      }
    } catch (error) {
      // Messages come from our own ServiceTokenError (status only) or the
      // runtime's fetch error; neither can contain the secret or a token.
      console.error(
        `[notify] could not push ${ref} — change NOT rolled back:`,
        errorFacts(error),
      );
    }
  }

  return {
    async notify(event) {
      try {
        await Promise.all(recipientsOf(event).map((id) => pushOne(id, event)));
      } catch {
        // pushOne already catches; this is the belt to its braces.
      }
    },
  };
}

// ─── The wired instance ──────────────────────────────────────────────────────

const noop: Notifier = { async notify() {} };

/**
 * From the environment; a no-op when the group is absent. Disabled under `NODE_ENV=test`
 * too: `bun test` shares one process and a developer's env may hold real `SERVICE_CLIENT_*`,
 * so route tests must never push for real. Tests of the push build their own notifier over a
 * stubbed network.
 */
let current: Notifier =
  env.NODE_ENV !== "test" && env.NOTIFY_INTERNAL_URL && serviceTokens
    ? createNotifier({ baseUrl: env.NOTIFY_INTERNAL_URL, tokens: serviceTokens })
    : noop;
let active = current !== noop;

if (env.NODE_ENV !== "test" && !active) {
  console.log("[notify] NOTIFY_INTERNAL_URL / SERVICE_CLIENT_* not set — notifications are disabled");
}

/** Tests only: swap in a recording notifier (or `null` for the no-op). */
export function setNotifierForTests(notifier: Notifier | null): void {
  current = notifier ?? noop;
  active = notifier !== null;
}

/**
 * The actor's display name, resolved LIVE with the caller's own JWT from
 * `auth POST /authz/users/identities` (ADR 20260807-live-identity-resolution-by-id-fail-soft) through the shared resolver (60 s cache,
 * fail soft). Any problem, or a user who is not active, is `undefined`.
 */
async function resolveActorName(authorization: string, actorId: string): Promise<string | undefined> {
  // The route awaits this lookup (crm-api's posture), so it is bounded tighter than a push.
  const identity = (await resolveIdentities(authorization, [actorId], { timeoutMs: NAME_TIMEOUT_MS })).get(actorId);
  // A name is surfaced for an active user only.
  return identity?.status === "active" ? (identity.name?.trim() || undefined) : undefined;
}

/**
 * Fire-and-forget, called after the write: resolves the actor's display name live (fail soft,
 * "A colleague" when unknown), builds the event with it, and hands it to the notifier WITHOUT
 * awaiting delivery. Never throws. Skips even the name lookup when nobody would be told.
 */
export async function announce(
  c: { get(key: "userId"): string; req: { header(name: string): string | undefined } },
  spec: Omit<NotifyEvent, "actorId" | "actorName">,
): Promise<void> {
  try {
    if (!active) return;
    const actorId = c.get("userId");
    if (recipientsOf({ actorId, recipientIds: spec.recipientIds }).length === 0) return;
    // A service call carries no user JWT to resolve the actor's name with.
    const authorization = c.req.header("Authorization");
    const name = authorization ? await resolveActorName(authorization, actorId) : undefined;
    const event: NotifyEvent = { ...spec, actorId, actorName: clip(name || FALLBACK_ACTOR, MAX_NAME) };
    try {
      void current.notify(event).catch(() => {});
    } catch {
      // A notifier that throws synchronously must not reach the route.
    }
  } catch (error) {
    console.error(`[notify] could not prepare ${spec.kind} — change NOT rolled back:`, errorFacts(error));
  }
}
