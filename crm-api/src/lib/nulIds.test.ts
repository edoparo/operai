/**
 * A U+0000 in an id or a filter that reaches Prisma is a 4xx, never a 500 (QE D7 for template ids, QE D9 for the rest;
 * specs/20261115-crm-offer-wizard). Postgres text cannot hold NUL, so a NUL that reached a `findUnique`, a `where` or an
 * `insert` was a driver error: a 500 and a raw message in the log. One sweep over every route with a string path param,
 * query value or body id; each answers a 4xx whose reason NAMES the NUL (so the refusal is the NUL and not some other
 * field), without echoing it. The mechanism is the one of D7: a refine on the schema (`IdParams`, `idText`).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { app, call, makeCompany, makeDeal, readyDealWithProfiles, resetWorld, signServiceToken, storedPdfAttachment } from "../test-support/world";

const NUL = "\u0000";
const enc = encodeURIComponent(`x${NUL}`);

beforeEach(resetWorld);

/** A legacy (sections) template of the entity: the classic offer routes refuse a wizard one with a 409. */
const legacyTemplate = async () => (await call("GET", "/offer-templates?entity=welld_ch&formats=sections")).json.items[0] as { id: string };

type Result = { status: number; json: any };
type Case = [name: string, run: () => Promise<Result>];

async function serviceCall(sub: string, scope: string, method: string, path: string, body?: unknown): Promise<Result> {
  const token = await signServiceToken({ sub, scope });
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

async function verdict(cases: readonly Case[]): Promise<string[]> {
  const wrong: string[] = [];
  for (const [name, run] of cases) {
    const res = await run();
    const body = JSON.stringify(res.json ?? {});
    const refused = res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 401 && res.status !== 403;
    if (!refused || !/NUL/.test(body) || body.includes(NUL)) wrong.push(`${name}: ${res.status} ${res.status >= 500 ? "" : String(res.json?.detail ?? "").slice(0, 90)}`);
  }
  return wrong;
}

describe("a NUL in an id or a filter is a 4xx naming the NUL, never a 500 (QE D9)", () => {
  it("offers, attachments and the offer draft: path ids, template id and the ids of a body", async () => {
    const { deal } = await readyDealWithProfiles({ entity: "welld_ch" });
    const t = await legacyTemplate();
    const d = `/deals/${deal.id}`;
    const generate = (over: Record<string, unknown>) => ({
      templateId: t.id,
      salutation: "To",
      clientLines: ["Client"],
      opening: "Opening",
      sections: [{ heading: "Costs", body: "Notes", costs: true }],
      costColumns: { position: true, unit: false },
      showTotal: false,
      costLines: [{ description: "Work", kind: "one_off", unitCents: 100, quantity: 1 }],
      annex: false,
      ...over,
    });
    const wrong = await verdict([
      ["draft?templateId", () => call("GET", `${d}/offers/draft?templateId=${enc}`)],
      ["POST offers templateId", () => call("POST", `${d}/offers`, { body: generate({ templateId: `x${NUL}` }) })],
      ["POST offers contactIds", () => call("POST", `${d}/offers`, { body: generate({ contactIds: [`x${NUL}`] }) })],
      ["POST offers attachmentIds", () => call("POST", `${d}/offers`, { body: generate({ attachmentIds: [`x${NUL}`] }) })],
      ["PUT offers templateId", () => call("PUT", `${d}/offers/someid`, { ifMatch: 1, body: generate({ templateId: `x${NUL}` }) })],
      ["download offerId", () => call("GET", `${d}/offers/${enc}/download`)],
      ["form offerId", () => call("GET", `${d}/offers/${enc}/form`)],
      ["DELETE offerId", () => call("DELETE", `${d}/offers/${enc}`)],
      ["sent offerId", () => call("POST", `${d}/offers/${enc}/sent`, { ifMatch: 1 })],
      ["PUT offerId", () => call("PUT", `${d}/offers/${enc}`, { ifMatch: 1, body: generate({}) })],
      ["attachment download aid", () => call("GET", `${d}/attachments/${enc}/download`)],
      ["attachment confirm aid", () => call("POST", `${d}/attachments/${enc}/confirm`, { body: {} })],
      ["attachment delete aid", () => call("DELETE", `${d}/attachments/${enc}`)],
    ]);
    expect(wrong).toEqual([]);
  });

  it("deals, contacts, companies: the id filters and the ids of a body", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id, { title: "Platform" });
    const wrong = await verdict([
      ["GET deals companyId", () => call("GET", `/deals?companyId=${enc}`)],
      ["GET deals ownerId", () => call("GET", `/deals?ownerId=${enc}`)],
      ["GET deals q", () => call("GET", `/deals?q=${enc}`)],
      ["GET pipeline companyId", () => call("GET", `/pipeline?companyId=${enc}`)],
      ["POST deals companyId", () => call("POST", "/deals", { body: { title: "T", companyId: `x${NUL}`, currency: "CHF" } })],
      ["POST deals ownerUserId", () => call("POST", "/deals", { body: { title: "T", companyId: company.id, currency: "CHF", ownerUserId: `x${NUL}` } })],
      ["PATCH deals ownerUserId", () => call("PATCH", `/deals/${deal.id}`, { ifMatch: 1, body: { ownerUserId: `x${NUL}` } })],
      ["GET contacts companyId", () => call("GET", `/contacts?companyId=${enc}`)],
      ["GET contacts q", () => call("GET", `/contacts?q=${enc}`)],
      ["POST contacts companyId", () => call("POST", "/contacts", { body: { firstName: "A", lastName: "B", companyId: `x${NUL}` } })],
      ["GET companies ownerId", () => call("GET", `/companies?ownerId=${enc}`)],
      ["GET companies q", () => call("GET", `/companies?q=${enc}`)],
      ["POST companies ownerUserId", () => call("POST", "/companies", { body: { name: "Acme", status: "prospect", entity: "welld_ch", ownerUserId: `x${NUL}` } })],
      ["POST estimate technicalUserId", () => call("POST", `/deals/${deal.id}/estimate`, { body: { technicalUserId: `x${NUL}` } })],
    ]);
    expect(wrong).toEqual([]);
  });

  it("the service routes: query ids and body ids", async () => {
    const dealId = (await makeDeal((await makeCompany()).id, { title: "Platform" })).id;
    const valid = (over: Record<string, unknown>) => ({
      noticeId: crypto.randomUUID(),
      seq: 1,
      event: "linked",
      meeting: { id: crypto.randomUUID(), title: "Call", startsAt: new Date().toISOString(), creatorId: "user-admin" },
      entity: { type: "deal", id: dealId },
      ...over,
    });
    const wrong = await verdict([
      ["system/contacts companyId", () => serviceCall("system:projects-api", "crm.contacts.read", "GET", `/system/contacts?companyId=${enc}`)],
      ["system/contacts ids", () => serviceCall("system:projects-api", "crm.contacts.read", "GET", `/system/contacts?ids=${enc}`)],
      ["system/deals ids", () => serviceCall("system:projects-api", "crm.deals.read", "GET", `/system/deals?ids=${enc}`)],
      ["system/companies ids", () => serviceCall("system:projects-api", "crm.companies.read", "GET", `/system/companies?ids=${enc}`)],
      ["system/companies q", () => serviceCall("system:projects-api", "crm.companies.read", "GET", `/system/companies?q=${enc}`)],
      [
        "estimate-notices estimateId",
        () => serviceCall("system:estimai-api", "estimate-notices.send", "POST", "/system/estimate-notices", { estimateId: `x${NUL}`, event: "closed", version: 2, at: new Date().toISOString(), byUserId: "user-tech" }),
      ],
      [
        "estimate-notices byUserId",
        () => serviceCall("system:estimai-api", "estimate-notices.send", "POST", "/system/estimate-notices", { estimateId: "e1", event: "closed", version: 2, at: new Date().toISOString(), byUserId: `x${NUL}` }),
      ],
      ["meeting-host resolve ids", () => call("POST", "/meeting-host/v1/resolve", { body: { entityType: "deal", ids: [`x${NUL}`] } })],
      ["meeting-host notices entity id", () => serviceCall("system:meetings-api", "host-notices.send", "POST", "/system/meeting-host/v1/notices", valid({ entity: { type: "deal", id: `x${NUL}` } }))],
      ["meeting-host notices meeting id", () => serviceCall("system:meetings-api", "host-notices.send", "POST", "/system/meeting-host/v1/notices", valid({ meeting: { id: `x${NUL}`, title: "Call", startsAt: new Date().toISOString(), creatorId: "user-admin" } }))],
      ["meeting-host notices creatorId", () => serviceCall("system:meetings-api", "host-notices.send", "POST", "/system/meeting-host/v1/notices", valid({ meeting: { id: "m1", title: "Call", startsAt: new Date().toISOString(), creatorId: `x${NUL}` } }))],
    ]);
    expect(wrong).toEqual([]);
  });

  it("controls: the same requests without a NUL are not refused for one", async () => {
    const { deal } = await readyDealWithProfiles({ entity: "welld_ch" });
    const t = await legacyTemplate();
    const att = await storedPdfAttachment(deal.id);
    const ok = [
      await call("GET", `/deals/${deal.id}/offers/draft?templateId=${t.id}`),
      await call("GET", `/deals?q=x&companyId=none&ownerId=none`),
      await call("DELETE", `/deals/${deal.id}/attachments/${att.id}`),
    ];
    for (const res of ok) expect(JSON.stringify(res.json ?? {})).not.toMatch(/NUL/);
    expect(ok[0]!.status).toBe(200);
  });
});
