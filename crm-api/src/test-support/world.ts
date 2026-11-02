/**
 * Test world for crm-api route tests (specs/017-crm § Test strategy): personas
 * with literal permission sets, a request helper over the ASSEMBLED app, a
 * stub for `auth POST /authz/users/identities`, and table cleanup.
 *
 * Import order matters: this module imports `testAuth` first, which sets the
 * environment before `src/lib/env` is evaluated.
 */

import { spyOn } from "bun:test";
import { setupTestAuth } from "./testAuth";
import type { ResolvedPermission } from "../authz/resolveClient";

const harness = setupTestAuth();
await harness.init();

const { app } = await import("../index");
const { db } = await import("../lib/db");
const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");
const { __resetIdentityCacheForTests } = await import("../lib/identities");
const { setStorageForTests } = await import("../lib/storage");
type Storage = import("../lib/storage").Storage;

export { app, db };

/** Forgets cached display names (60 s cache), so the next read asks `auth` again. */
export const forgetIdentities = () => __resetIdentityCacheForTests();

const ENTITY_COND = { attributes: [{ key: "entity", match: "user" }] } as const;
const ACCESS: ResolvedPermission = { resource: "crm", action: "access", conditions: null };
const DEALS = (scoped: boolean): ResolvedPermission => ({
  resource: "deal",
  action: "manage",
  conditions: scoped ? ENTITY_COND : null,
});
const ERASE: ResolvedPermission = { resource: "contact", action: "erase", conditions: null };
const MONEY: ResolvedPermission = { resource: "deal", action: "financials", conditions: null };

export interface Persona {
  readonly sub: string;
  readonly entity: string | null;
  readonly permissions: readonly ResolvedPermission[];
}

/** The callers every test file uses. Scopes are literals, not computed by the code under test. */
export const PERSONAS = {
  /** No CRM grant at all. */
  outsider: { sub: "user-outsider", entity: "welld_ch", permissions: [] },
  /**
   * `crm:access` only — the `crm-technical` role (specs/018): reads everything
   * but the money, edits companies/contacts/activities, no deals.
   */
  consultant: { sub: "user-consultant", entity: "welld_ch", permissions: [ACCESS] },
  /** The technical contact of the estimate tests: `crm-technical`, and an EstimAI user. */
  tech: { sub: "user-tech", entity: "welld_ch", permissions: [ACCESS] },
  /** A colleague with the same grant, for author-only and concurrency checks. */
  colleague: { sub: "user-colleague", entity: "welld_it", permissions: [ACCESS] },
  /** `sales` role in wellD CH: deals of welld_ch only. */
  salesCh: { sub: "user-sales-ch", entity: "welld_ch", permissions: [ACCESS, DEALS(true), MONEY] },
  /** deal:manage without deal:financials — unsupported by the seed, tested anyway (specs/018 AC-5.2). */
  managerNoMoney: { sub: "user-manager-no-money", entity: "welld_ch", permissions: [ACCESS, DEALS(true)] },
  /** Admin: everything, both entities. */
  admin: { sub: "user-admin", entity: null, permissions: [ACCESS, DEALS(false), ERASE, MONEY] },
} satisfies Record<string, Persona>;

export type PersonaName = keyof typeof PERSONAS;

const subOf = (authorizationHeader: string): string => {
  const payload = authorizationHeader.slice("Bearer ".length).split(".")[1] ?? "";
  return (JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { sub: string }).sub;
};

harness.setResolve(async (authorizationHeader) => {
  const sub = subOf(authorizationHeader);
  const persona = Object.values(PERSONAS).find((p) => p.sub === sub);
  if (!persona) throw new Error(`no persona for ${sub}`);
  return { sub, epoch: 0, permissions: persona.permissions, entity: persona.entity, jobTitle: null };
});

const tokens = new Map<string, string>();
async function tokenFor(name: PersonaName): Promise<string> {
  const cached = tokens.get(name);
  if (cached) return cached;
  const token = await harness.signToken({ sub: PERSONAS[name].sub, email: `${name}@welld.test` });
  tokens.set(name, token);
  return token;
}

// ─── auth identities stub ────────────────────────────────────────────────────
// Ids starting with "user-" are active people; "user-gone" is deleted; any other
// id is unknown. `identitiesDown` simulates an auth outage.

export const identities = { down: false, calls: 0 };

/**
 * auth's app access, for `POST /authz/app-access-check` and the directory's
 * `?appId=` filter (ADR-0055). CRM users are the personas holding `crm:access`
 * plus `user-tech`; EstimAI users are listed explicitly. Tests may edit both.
 */
export const appAccess = {
  crm: new Set<string>(),
  estimai: new Set<string>(),
};
function resetAppAccess(): void {
  appAccess.crm = new Set([
    ...Object.values(PERSONAS)
      .filter((p) => p.permissions.some((perm) => perm.resource === "crm" && perm.action === "access"))
      .map((p) => p.sub),
    "user-tech",
  ]);
  appAccess.estimai = new Set(["user-tech", "user-admin", "user-sales-ch"]);
}
resetAppAccess();

/**
 * A fake estimai-api (specs/018): estimates by id, their editors by email, and
 * switches to make it refuse the caller or a collaborator.
 */
export const estimai = {
  estimates: new Map<string, { id: string; name: string; owner: string; content: unknown; editors: string[] }>(),
  /** Callers estimai-api answers 403 (no EstimAI access). */
  forbidden: new Set<string>(),
  /** Answer the collaborator grant with this status instead of 201. */
  shareStatus: 201,
  down: false,
  deletes: [] as string[],
};

const realFetch = globalThis.fetch;
spyOn(globalThis, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
  const href = String(url);
  const method = init?.method ?? "GET";
  const caller = () => subOf(String((init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? ""));

  if (href.endsWith("/authz/app-access-check")) {
    if (identities.down) return new Response("down", { status: 503 });
    const { appId, userId } = JSON.parse(String(init?.body)) as { appId: "crm" | "estimai"; userId: string };
    const eligible = appAccess[appId]?.has(userId) ?? false;
    return Response.json(eligible ? { eligible: true, userId } : { eligible: false });
  }
  if (href.includes("/authz/users/directory")) {
    if (identities.down) return new Response("down", { status: 503 });
    const appId = new URL(href).searchParams.get("appId") as "crm" | "estimai" | null;
    const ids = appId ? [...(appAccess[appId] ?? [])] : [...appAccess.crm];
    return Response.json({
      users: ids.map((id) => ({ id, name: `Name of ${id}`, email: `${id}@welld.test`, entity: "welld_ch" })),
    });
  }
  if (href.startsWith("http://estimai.test/")) {
    if (estimai.down) return new Response("down", { status: 503 });
    if (estimai.forbidden.has(caller())) return Response.json({ status: 403 }, { status: 403 });
    const path = new URL(href).pathname;
    if (method === "POST" && path === "/estimates") {
      const body = JSON.parse(String(init?.body)) as { name: string; content: unknown };
      const id = `est-${estimai.estimates.size + 1}-${crypto.randomUUID().slice(0, 6)}`;
      estimai.estimates.set(id, { id, name: body.name, owner: caller(), content: body.content, editors: [] });
      return Response.json({ id, name: body.name }, { status: 201 });
    }
    const match = /^\/estimates\/([^/]+)(\/collaborators)?$/.exec(path);
    const estimate = match ? estimai.estimates.get(decodeURIComponent(match[1]!)) : undefined;
    if (!estimate) return Response.json({ status: 404 }, { status: 404 });
    if (match![2] && method === "POST") {
      if (estimai.shareStatus !== 201) return Response.json({ status: estimai.shareStatus }, { status: estimai.shareStatus });
      estimate.editors.push((JSON.parse(String(init?.body)) as { email: string }).email);
      return Response.json({}, { status: 201 });
    }
    if (method === "DELETE") {
      estimai.estimates.delete(estimate.id);
      estimai.deletes.push(estimate.id);
      return new Response(null, { status: 204 });
    }
    if (method === "GET") return Response.json({ id: estimate.id, name: estimate.name, content: estimate.content });
  }
  if (href.endsWith("/authz/users/identities")) {
    identities.calls++;
    if (identities.down) return new Response("down", { status: 503 });
    const ids = (JSON.parse(String(init?.body)) as { ids: string[] }).ids;
    return Response.json({
      users: ids.map((id) =>
        id === "user-gone"
          ? { id, status: "deleted", name: null }
          : id.startsWith("user-")
            ? { id, status: "active", name: `Name of ${id}` }
            : { id, status: "unknown", name: null },
      ),
    });
  }
  return realFetch(url as string, init);
}) as typeof fetch);

// ─── Requests ────────────────────────────────────────────────────────────────

export interface CallOptions {
  readonly as?: PersonaName | null;
  readonly body?: unknown;
  readonly ifMatch?: number | string;
}

export async function call(method: string, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = {};
  const as = options.as === undefined ? "admin" : options.as;
  if (as) headers["Authorization"] = `Bearer ${await tokenFor(as)}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.ifMatch !== undefined) {
    headers["If-Match"] = typeof options.ifMatch === "number" ? `"${options.ifMatch}"` : options.ifMatch;
  }
  const res = await app.request(path, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : undefined;
  return { status: res.status, json, headers: res.headers };
}

/** An in-memory bucket: what was put, minted and deleted (specs/018). */
export const bucket = {
  objects: new Map<string, { bytes: Uint8Array | null; contentType: string; sizeBytes: number }>(),
  deleted: [] as string[],
  /** Keys read through `getObject`, in order (ADR-0057: nothing is read before the size check). */
  reads: [] as string[],
  /** The `maxBytes` of the last presigned POST (letterhead 5 MiB, attachments 20 MiB). */
  lastPostMaxBytes: 0,
};
export const memoryStorage: Storage = {
  async mintPresignedPost(objectKey, contentType, maxBytes = 20 * 1024 * 1024) {
    bucket.lastPostMaxBytes = maxBytes;
    return { url: "http://bucket.test/upload", fields: { key: objectKey, "Content-Type": contentType } };
  },
  async getObject(objectKey) {
    bucket.reads.push(objectKey);
    const object = bucket.objects.get(objectKey);
    if (!object?.bytes) throw new Error(`no bytes for ${objectKey}`);
    return object.bytes;
  },
  async headObject(objectKey) {
    const object = bucket.objects.get(objectKey);
    return object ? { sizeBytes: object.sizeBytes, contentType: object.contentType } : null;
  },
  async mintPresignedGet(objectKey) {
    return `http://bucket.test/${objectKey}?signed`;
  },
  async putObject(objectKey, bytes, contentType) {
    bucket.objects.set(objectKey, { bytes, contentType, sizeBytes: bytes.byteLength });
  },
  async deleteObject(objectKey) {
    bucket.objects.delete(objectKey);
    bucket.deleted.push(objectKey);
  },
};

export async function resetWorld(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "offer_template", "offer_sequence", "deal_offer", "deal_attachment", "deal_estimate", "entity_profile", "activity", "deal", "contact", "company" RESTART IDENTITY CASCADE',
  );
  __resetAuthzCacheForTests();
  __resetIdentityCacheForTests();
  identities.down = false;
  identities.calls = 0;
  resetAppAccess();
  estimai.estimates.clear();
  estimai.forbidden.clear();
  estimai.shareStatus = 201;
  estimai.down = false;
  estimai.deletes = [];
  bucket.objects.clear();
  bucket.deleted = [];
  bucket.reads = [];
  bucket.lastPostMaxBytes = 0;
  setStorageForTests(memoryStorage);
}

/** Creates a company through the API and returns its body. */
export async function makeCompany(overrides: Record<string, unknown> = {}, as: PersonaName = "admin") {
  const res = await call("POST", "/companies", {
    as,
    body: { name: `Acme ${crypto.randomUUID().slice(0, 8)}`, status: "prospect", entity: "welld_ch", ...overrides },
  });
  if (res.status !== 201) throw new Error(`makeCompany: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

/**
 * Links a ready estimate to a deal straight in the database, for tests about
 * something other than the estimate flow (specs/018 gate, AC-3.4).
 */
export async function markEstimateReady(dealId: string, technicalUserId = "user-tech") {
  const now = new Date();
  await db.dealEstimate.upsert({
    where: { dealId },
    create: {
      dealId,
      estimateId: `est-fixture-${dealId}`,
      estimateName: "Fixture estimate",
      technicalUserId,
      state: "ready",
      requestedBy: "user-admin",
      readyBy: technicalUserId,
      readyAt: now,
    },
    update: { state: "ready", readyBy: technicalUserId, readyAt: now },
  });
}

export async function makeDeal(companyId: string, overrides: Record<string, unknown> = {}, as: PersonaName = "admin") {
  const res = await call("POST", "/deals", {
    as,
    body: { companyId, title: "Platform rebuild", amountCents: 10_000_00, currency: "CHF", ...overrides },
  });
  if (res.status !== 201) throw new Error(`makeDeal: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

/**
 * The generate body a dialog would send after loading the draft of `templateName`
 * (specs/020): the entity's seeded templates are listed, the draft fetched, the
 * draft's fields mapped onto the body, and `overrides` applied last.
 */
export async function offerBody(
  dealId: string,
  entity: "welld_ch" | "welld_it",
  templateName: string,
  overrides: Record<string, unknown> = {},
  as: PersonaName = "admin",
) {
  const list = await call("GET", `/offer-templates?entity=${entity}`, { as });
  const template = list.json.items.find((t: { name: string }) => t.name === templateName);
  if (!template) throw new Error(`offerBody: no template "${templateName}"`);
  const res = await call("GET", `/deals/${dealId}/offers/draft?templateId=${template.id}`, { as });
  if (res.status !== 200) throw new Error(`offerBody: draft ${res.status} ${JSON.stringify(res.json)}`);
  const d = res.json;
  return {
    templateId: d.templateId,
    salutation: d.salutation,
    clientLines: d.clientLines,
    opening: d.opening,
    sections: d.sections,
    costColumns: d.costColumns,
    showTotal: d.showTotal,
    costLines: d.costLines.map((l: { description: string; kind: string; unitCents: number | null; percentBp: number | null; quantity: number }) => ({
      description: l.description,
      kind: l.kind,
      ...(l.unitCents !== null ? { unitCents: l.unitCents } : {}),
      ...(l.percentBp !== null ? { percentBp: l.percentBp } : {}),
      quantity: l.quantity,
    })),
    acceptanceLabel: d.acceptanceLabel,
    annex: d.annex,
    validityDays: d.validityDays,
    aiAssisted: d.aiAssisted,
    ...overrides,
  };
}
