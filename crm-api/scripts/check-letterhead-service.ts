/**
 * Release check before the CRM switch (specs/20261116-letterhead-service T30; AC-10.12, plan R2).
 *
 *   bun scripts/check-letterhead-service.ts
 *
 * The switch (`LETTERHEAD_SERVICE_ENABLED`) may be turned on only when BOTH entities have an active letterhead in the layout
 * service: otherwise every offer of the entity without one would be refused with 409 `letterhead_not_configured`, and
 * there is no way back to the uploaded PDF once it is retired (owner, O5). This asks the service, as crm-api, for
 * `GET /v1/letterheads/status` (service credential, scope `letterhead:render`) and prints one line per entity: `active vN`
 * or `NONE`.
 *
 * READ-ONLY: it changes nothing here or in the service, and it never prints the token, the secret or the service's text.
 *
 *   exit 0  both entities have an active letterhead: the switch may be enabled
 *   exit 1  an entity has none, or the service cannot be asked or answered something unreadable: the switch stays off
 *   exit 2  not configured here (LETTERHEAD_API_URL, SERVICE_CLIENT_ID or SERVICE_CLIENT_SECRET)
 *
 * `scripts/retire-uploaded-letterheads.ts` runs this same check first and refuses unless it exits 0.
 */

import { ENTITIES } from "../src/authz/conditions";
import type { ServiceTokenProvider } from "../src/lib/serviceToken";

export interface Io {
  log(line: string): void;
  error(line: string): void;
}

export interface SwitchCheckOptions {
  /** letterhead-api's base URL; undefined: not configured (exit 2). */
  readonly baseUrl: string | undefined;
  /** The service credential of crm-api; null: not configured (exit 2). */
  readonly tokens: ServiceTokenProvider | null;
  readonly fetchImpl?: typeof fetch;
  /** The whole call, in milliseconds (default 10 000). */
  readonly timeoutMs?: number;
  readonly io: Io;
}

const pad = (entity: string) => entity.padEnd(9);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

type Verdict = { readonly state: "active"; readonly version: number } | { readonly state: "none" } | { readonly state: "invalid" };

/** What the service says of one entity: `{ activeVersion: n }`, `null` (none), anything else is not its contract. */
function verdictOf(value: unknown): Verdict {
  if (value === null) return { state: "none" };
  if (isObject(value) && typeof value["activeVersion"] === "number" && Number.isInteger(value["activeVersion"]) && value["activeVersion"] >= 1) {
    return { state: "active", version: value["activeVersion"] };
  }
  return { state: "invalid" };
}

/** Returns the exit code: 0 both entities are active, 1 the switch must stay off, 2 not configured. */
export async function runSwitchCheck(options: SwitchCheckOptions): Promise<number> {
  const { io } = options;
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");
  if (baseUrl === undefined || options.tokens === null) {
    io.error("LETTERHEAD_API_URL or the service client (SERVICE_CLIENT_ID / SERVICE_CLIENT_SECRET) is not set: nothing was checked.");
    return 2;
  }
  const tokens = options.tokens;
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);

  let body: unknown = undefined;
  let retried = false;
  for (;;) {
    let token: string;
    try {
      token = await tokens.getToken();
    } catch (error) {
      io.error(`No service token (${error instanceof Error ? error.name : "error"}): the service was not asked. The switch stays off.`);
      return 1;
    }
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}/v1/letterheads/status`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        redirect: "error",
      });
    } catch (error) {
      // The class only: a network error's message may carry the address.
      io.error(`The layout service could not be reached (${error instanceof Error ? error.name : "error"}). The switch stays off.`);
      return 1;
    }
    if (res.status === 401 && !retried) {
      await res.body?.cancel().catch(() => {});
      tokens.invalidate(token);
      retried = true;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      io.error(`The layout service answered HTTP ${res.status} to GET /v1/letterheads/status. The switch stays off.`);
      return 1;
    }
    try {
      body = await res.json();
    } catch {
      io.error("The layout service's status answer is not JSON. The switch stays off.");
      return 1;
    }
    break;
  }
  if (!isObject(body)) {
    io.error("The layout service's status answer is not the contract's. The switch stays off.");
    return 1;
  }

  const blocking: string[] = [];
  for (const entity of ENTITIES) {
    const verdict = verdictOf(body[entity]);
    if (verdict.state === "active") {
      io.log(`${pad(entity)} active v${verdict.version}`);
    } else {
      io.log(`${pad(entity)} ${verdict.state === "none" ? "NONE" : "INVALID"}`);
      blocking.push(entity);
    }
  }
  if (blocking.length > 0) {
    io.error(
      `${blocking.join(", ")} ${blocking.length === 1 ? "has" : "have"} no usable active letterhead in the layout service. ` +
        "Configure it in Letterheads (save a version), then re-run this check. The switch stays off.",
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  const { env } = await import("../src/lib/env");
  const { createServiceTokenProvider } = await import("../src/lib/serviceToken");
  const tokens =
    env.LETTERHEAD_API_URL && env.SERVICE_CLIENT_ID && env.SERVICE_CLIENT_SECRET
      ? createServiceTokenProvider({ baseUrl: env.AUTH_BASE_URL, clientId: env.SERVICE_CLIENT_ID, clientSecret: env.SERVICE_CLIENT_SECRET })
      : null;
  const code = await runSwitchCheck({ baseUrl: env.LETTERHEAD_API_URL, tokens, io: { log: (l) => console.log(l), error: (l) => console.error(l) } });
  process.exit(code);
}
