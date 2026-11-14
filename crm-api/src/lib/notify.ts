/**
 * CRM notifications (specs/20261101-crm-notifications; ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired). The after-commit
 * push of the nine events in plan.md to notify-api's `POST /system/notifications`,
 * authenticated with the scoped service JWT from `serviceToken.ts`
 * (`notifications.push emails.send`). notify-api binds `system:crm-api` to
 * `originApp: "crm"`.
 *
 * STRICTLY BEST-EFFORT (same posture as inventory-api's notify.ts): nothing
 * here throws, and the route never awaits the delivery — the CRM record in this
 * service's own database is authoritative. Whatever goes wrong is logged as the
 * event kind, the deal id and an HTTP status or error name only: never a token,
 * the secret, a title, a name, an address or any money.
 *
 * - One request per distinct recipient; the actor is never notified.
 * - One 401 drops the cached token and retries ONCE with a fresh one.
 * - A no-op when the env group is absent (logged once at startup), and under
 *   `NODE_ENV=test` unless a test injects a notifier (`setNotifierForTests`).
 *
 * Copy is English only and carries no money. The deal title and company name
 * are user-entered, so they are clipped (`clip`) to keep title/body inside
 * notify-api's 200/2000-character limits.
 */

import type { HeaderSource } from "./http";
import { resolveIdentities } from "./identities";
import { env } from "./env";
import { serviceTokens, type ServiceTokenProvider } from "./serviceToken";

const REQUEST_TIMEOUT_MS = 5_000;
export const MAX_NAME = 100;
export const MAX_REASON = 300;
export const FALLBACK_ACTOR = "A colleague";

export type NotifySeverity = "info" | "success" | "warning";

/** What a route hands over: who did it, who to tell, and the copy. */
export interface NotifyEvent {
  /** Event kind for the log, e.g. `estimate_requested`. */
  readonly kind: string;
  /** The deal the event is about, for the log only. */
  readonly dealId: string | null;
  readonly actorId: string;
  readonly recipientIds: readonly (string | null | undefined)[];
  readonly severity: NotifySeverity;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly email: boolean;
}

export interface Notifier {
  /** Never throws, never rejects. */
  notify(event: NotifyEvent): Promise<void>;
}

export const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** `YYYY-MM-DD` (or a Date) as `dd.mm.yyyy`, the suite's display format. */
export function formatDueDate(value: string | Date): string {
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
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
    return doFetch(`${options.baseUrl}/system/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recipientId,
        originApp: "crm",
        severity: event.severity,
        title: event.title,
        body: event.body,
        link: { href: event.href },
        ...(event.email ? { email: true } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  }

  async function pushOne(recipientId: string, event: NotifyEvent): Promise<void> {
    const ref = `${event.kind} deal=${event.dealId ?? "-"}`;
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
        error instanceof Error ? error.message : "unknown error",
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
 * From the environment; a no-op when the group is absent. Disabled under
 * `NODE_ENV=test` too: `bun test` shares one process and a developer's env may
 * hold real `SERVICE_CLIENT_*`, so route tests must never push for real. Tests
 * of the push build their own notifier over a stubbed network.
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
 * Fire-and-forget, called after the commit: resolves the actor's display name
 * live (fail soft, "A colleague" when unknown), builds the copy with it, and
 * hands it to the notifier WITHOUT awaiting delivery. Never throws. Skips even
 * the name lookup when nobody would be told.
 */
export async function announce(
  c: HeaderSource & { get(key: "userId"): string },
  spec: Omit<NotifyEvent, "actorId" | "title" | "body"> & {
    readonly copy: (actor: string) => { readonly title: string; readonly body: string };
  },
): Promise<void> {
  try {
    if (!active) return;
    const actorId = c.get("userId");
    if (recipientsOf({ actorId, recipientIds: spec.recipientIds }).length === 0) return;
    // A service call (specs/20261101-crm-sales-flow AC-3.3) carries no user JWT to resolve the actor's name with.
    const authorization = c.req.header("Authorization");
    const name = authorization ? (await resolveIdentities(authorization, [actorId])).get(actorId)?.name?.trim() : undefined;
    const { copy, ...rest } = spec;
    const event: NotifyEvent = { ...rest, actorId, ...copy(clip(name || FALLBACK_ACTOR, MAX_NAME)) };
    void current.notify(event).catch(() => {});
  } catch (error) {
    console.error(`[notify] could not prepare ${spec.kind} — change NOT rolled back:`, error instanceof Error ? error.message : "unknown error");
  }
}
