/**
 * Scriptable test hosts for activities-api tests (specs/20261110-activities plan.md § Test strategy;
 * the meetings-api `fakeHost` pattern). ONE `Bun.serve` that plays both real hosts over HTTP,
 * through the same client code as production, with no host-specific path in activities-api:
 *
 *   POST {url}/crm/activity-host/v1/resolve        as crm-api answers it
 *   POST {url}/projects/activity-host/v1/resolve   as projects-api answers it
 *
 * The two hosts keep their REAL differences, because the client must cope with both:
 *   - validation: crm-api strict, 422; projects-api strict, 400 (`related` accepted, ignored)
 *   - a caller who may not read: crm `{reader:false, items:[], related:[]}`;
 *     projects `{reader:false, items:[every id missing]}` (no `related` key at all)
 *   - `assignees` only from projects; `related` only from crm
 *
 * A test scripts it per case: who is a reader, each entity (open/missing, `writable`, `may`
 * per caller, `assignees`), the related contacts/deals, and failures (status, malformed body,
 * delay, redirect, a raw body). `resolves` records every call the client made, with the
 * Authorization it forwarded and the body it sent. `registry` points an activities-api host
 * registry at this server: `setRegistryForTests(testHosts.registry)`.
 */

import { buildRegistry, type HostMay, type HostRegistry, type HostRelated } from "../hosts/registry";

export interface ScriptedEntity {
  readonly label: string;
  readonly href: string;
  /** Default true. projects-api: false for a closed or cancelled project. */
  readonly writable?: boolean;
  /** Default `{write:true, manage:true}`. */
  readonly may?: HostMay;
  /** Per-caller override, keyed by the JWT `sub` (the test host trusts the token, it does not verify it). */
  readonly mayFor?: Readonly<Record<string, HostMay>>;
  /** Sent by the projects host only. Default `[]`. */
  readonly assignees?: readonly string[];
}

/** How the next calls behave. `{}` is normal. */
export interface HostMode {
  /** Answer with this status and a Problem-shaped body. */
  status?: number;
  /** Answer 200 with a body that breaks the contract. */
  malformed?: boolean;
  /** Wait this long before answering (longer than the client's timeout makes it time out). */
  delayMs?: number;
  /** Answer 302 to `{url}/elsewhere`. */
  redirect?: boolean;
  /** Answer 200 with exactly this JSON, for the incomplete / odd answers the real hosts never send. */
  body?: unknown;
  /**
   * The failure above applies only to a call that names ids (the label call); the cheap
   * "may I read at all?" probe (`ids: []`) is answered normally. For a host that answers the
   * probe and then fails (specs/20261110-activities AC-7.5).
   */
  onlyWhenIdsAsked?: boolean;
}

export interface RecordedResolve {
  readonly authorization: string | null;
  readonly body: { entityType: string; ids: string[]; related?: Record<string, string[]> };
}

export interface TestHost {
  readonly app: "crm" | "projects";
  /** An entity the host knows. An id never set is `missing`. */
  setEntity(id: string, entity: ScriptedEntity): void;
  /** A contact or deal (crm only). */
  setRelated(item: HostRelated): void;
  /** Who may read this host's activities. `"*"` (the default is everyone) or a JWT `sub`. */
  setReader(who: string, reader: boolean): void;
  mode: HostMode;
  readonly resolves: RecordedResolve[];
  reset(): void;
}

export interface TestHosts {
  readonly url: string;
  readonly crm: TestHost;
  readonly projects: TestHost;
  /** A registry whose crm and projects hosts are these two. */
  readonly registry: HostRegistry;
  /** What reached `/elsewhere` (the target of `mode.redirect`): a safe client never gets there. */
  readonly elsewhere: Array<{ authorization: string | null }>;
  reset(): void;
  stop(): Promise<void>;
}

/** A JWT-shaped bearer carrying `sub`: enough for the test host, which does not verify tokens. */
export function bearerFor(sub: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `Bearer ${part({ alg: "none" })}.${part({ sub })}.sig`;
}

function subOf(authorization: string | null): string | null {
  const payload = authorization?.startsWith("Bearer ") ? authorization.slice(7).split(".")[1] : undefined;
  if (!payload) return null;
  try {
    const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isIdList = (value: unknown, max: number): value is string[] =>
  Array.isArray(value) && value.length <= max && value.every((v) => typeof v === "string" && v.length >= 1 && v.length <= 64);

/** crm-api: strict body, `related` keys `contact`/`deal` only (≤ 100 each), 25 ids; invalid is 422. */
function crmBodyValid(body: unknown): body is RecordedResolve["body"] {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !["entityType", "ids", "related"].includes(k))) return false;
  if (b["entityType"] !== "company" || !isIdList(b["ids"], 25)) return false;
  if (b["related"] === undefined) return true;
  const related = b["related"] as Record<string, unknown> | null;
  if (typeof related !== "object" || related === null) return false;
  return Object.entries(related).every(([k, v]) => ["contact", "deal"].includes(k) && isIdList(v, 100));
}

/** projects-api: strict body, `related` any keys (≤ 100 each, accepted and ignored), 25 ids; invalid is 400. */
function projectsBodyValid(body: unknown): body is RecordedResolve["body"] {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => !["entityType", "ids", "related"].includes(k))) return false;
  if (b["entityType"] !== "project" || !isIdList(b["ids"], 25)) return false;
  if (b["related"] === undefined) return true;
  const related = b["related"] as Record<string, unknown> | null;
  if (typeof related !== "object" || related === null) return false;
  return Object.values(related).every((v) => isIdList(v, 100));
}

function createHost(app: "crm" | "projects") {
  const entities = new Map<string, ScriptedEntity>();
  const relatedItems: HostRelated[] = [];
  const readers = new Map<string, boolean>();
  const resolves: RecordedResolve[] = [];
  const state = { mode: {} as HostMode };

  const isReader = (sub: string | null) => (sub !== null && readers.has(sub) ? readers.get(sub)! : (readers.get("*") ?? true));

  async function answer(req: Request, elsewhereUrl: string): Promise<Response> {
    const authorization = req.headers.get("Authorization");
    const body: unknown = await req.json().catch(() => null);
    const askedIds = (body as { ids?: unknown } | null)?.ids;
    const mode: HostMode = state.mode.onlyWhenIdsAsked && !(Array.isArray(askedIds) && askedIds.length > 0) ? {} : state.mode;
    if (mode.delayMs) await sleep(mode.delayMs);
    if (mode.redirect) return new Response(null, { status: 302, headers: { Location: elsewhereUrl } });
    if (mode.status) return Response.json({ status: mode.status, title: "scripted" }, { status: mode.status });
    if (!authorization) return Response.json({ status: 401 }, { status: 401 });
    if (!(app === "crm" ? crmBodyValid(body) : projectsBodyValid(body))) {
      const status = app === "crm" ? 422 : 400;
      return Response.json({ status, code: app === "crm" ? "validation_error" : "validation_failed" }, { status });
    }
    const asked = body as RecordedResolve["body"];
    resolves.push({ authorization, body: asked });
    if (mode.malformed) return Response.json({ reader: "yes", items: "nope" });
    if (mode.body !== undefined) return Response.json(mode.body);

    const sub = subOf(authorization);
    const distinct = [...new Set(asked.ids)];
    if (!isReader(sub)) {
      return Response.json(
        app === "crm"
          ? { reader: false, items: [], related: [] }
          : { reader: false, items: distinct.map((id) => ({ id, state: "missing" })) },
      );
    }

    const items = distinct.map((id) => {
      const entity = entities.get(id);
      if (!entity) return { id, state: "missing" };
      return {
        id,
        state: "open",
        writable: entity.writable ?? true,
        label: entity.label,
        href: entity.href,
        may: (sub !== null && entity.mayFor?.[sub]) || entity.may || { write: true, manage: true },
        ...(app === "projects" ? { assignees: [...(entity.assignees ?? [])] } : {}),
      };
    });
    if (app === "projects") return Response.json({ reader: true, items });

    const askedByType = asked.related ?? {};
    const related = relatedItems.filter(
      (r) => (askedByType[r.type] ?? []).includes(r.id) && distinct.includes(r.parentId) && entities.has(r.parentId),
    );
    return Response.json({ reader: true, items, related });
  }

  const host: TestHost = {
    app,
    setEntity: (id, entity) => void entities.set(id, entity),
    setRelated: (item) => void relatedItems.push(item),
    setReader: (who, reader) => void readers.set(who, reader),
    get mode() {
      return state.mode;
    },
    set mode(value: HostMode) {
      state.mode = value;
    },
    resolves,
    reset() {
      entities.clear();
      relatedItems.length = 0;
      readers.clear();
      resolves.length = 0;
      state.mode = {};
    },
  };
  return { host, answer };
}

export function startTestHosts(): TestHosts {
  const crm = createHost("crm");
  const projects = createHost("projects");
  const elsewhere: Array<{ authorization: string | null }> = [];

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const elsewhereUrl = `${new URL(req.url).origin}/elsewhere`;
      if (path === "/elsewhere") {
        elsewhere.push({ authorization: req.headers.get("Authorization") });
        return Response.json({ reader: true, items: [] });
      }
      if (req.method !== "POST") return Response.json({ status: 405 }, { status: 405 });
      if (path === "/crm/activity-host/v1/resolve") return crm.answer(req, elsewhereUrl);
      if (path === "/projects/activity-host/v1/resolve") return projects.answer(req, elsewhereUrl);
      return Response.json({ status: 404 }, { status: 404 });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  return {
    url,
    crm: crm.host,
    projects: projects.host,
    registry: buildRegistry({ crmApiUrl: `${url}/crm`, projectsApiUrl: `${url}/projects` }),
    elsewhere,
    reset() {
      crm.host.reset();
      projects.host.reset();
      elsewhere.length = 0;
    },
    async stop() {
      await server.stop(true);
    },
  };
}
