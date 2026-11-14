/**
 * `POST /activity-host/v1/resolve` (specs/20261110-activities T4; AC-8.1, AC-8.3; ADR 20261110-activities-service-access-delegated-to-host): the host half of
 * "may THIS caller read the activities of these companies?", answered live from the caller's own
 * forwarded JWT. A `crm:access` holder gets `reader:true`, each company `open` (label, href,
 * `writable`, `may`) or `missing`, and the related contacts/deals OF THOSE COMPANIES only; anyone
 * else gets `reader:false` and nothing about any record. An `auth` outage is a 503 (fail closed).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { setupTestAuth } from "../test-support/testAuth";
import { PERSONAS, app, call, db, makeCompany, makeDeal, resetWorld, type PersonaName } from "../test-support/world";

beforeEach(resetWorld);

const URL = "/activity-host/v1/resolve";
const resolve = (as: PersonaName | null, ids: string[], related?: Record<string, string[]>) =>
  call("POST", URL, { as, body: { entityType: "company", ids, ...(related ? { related } : {}) } });

const makeContact = (companyId: string | null, firstName = "Ada", lastName = "Rossi") =>
  db.contact.create({ data: { companyId, firstName, lastName, createdBy: "seed", updatedBy: "seed" } });

const subOf = (header: string): string =>
  (JSON.parse(Buffer.from(header.split(".")[1] ?? "", "base64url").toString("utf-8")) as { sub: string }).sub;

describe("a caller who holds crm:access", () => {
  it("opens an existing company with label, href, writable and may (AC-8.1)", async () => {
    const company = await makeCompany({ name: "Acme SA" });
    const res = await resolve("consultant", [company.id]);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      reader: true,
      items: [
        {
          id: company.id,
          state: "open",
          writable: true,
          label: "Acme SA",
          href: `/crm/companies/${company.id}`,
          may: { write: true, manage: true },
        },
      ],
      related: [],
    });
  });

  it("answers `missing` for an unknown company, with no label or href (AC-8.3)", async () => {
    const res = await resolve("consultant", ["nope"]);
    expect(res.json).toEqual({ reader: true, items: [{ id: "nope", state: "missing" }], related: [] });
  });

  it("answers a mixed batch in the order asked, once per distinct id", async () => {
    const a = await makeCompany({ name: "A" });
    const b = await makeCompany({ name: "B" });
    const res = await resolve("consultant", [b.id, "nope", a.id, b.id]);
    expect(res.json.items.map((i: { id: string; state: string }) => [i.id, i.state])).toEqual([
      [b.id, "open"],
      ["nope", "missing"],
      [a.id, "open"],
    ]);
  });

  it("reads are open to every holder: a company outside the caller's entity still opens (ADR 20261101-crm-tool-shape-and-authorization)", async () => {
    const company = await makeCompany({ entity: "welld_it" });
    expect(PERSONAS.salesCh.entity).toBe("welld_ch");
    expect((await resolve("salesCh", [company.id])).json.items[0].state).toBe("open");
  });

  it("returns the related contacts and deals of the asked companies, with parentId, label and href", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id, { title: "Website" });
    const contact = await makeContact(company.id);
    const res = await resolve("consultant", [company.id], { contact: [contact.id], deal: [deal.id] });
    expect(res.json.related).toHaveLength(2);
    expect(res.json.related).toContainEqual({
      type: "deal",
      id: deal.id,
      parentId: company.id,
      label: "Website",
      href: `/crm/deals/${deal.id}`,
    });
    expect(res.json.related).toContainEqual({
      type: "contact",
      id: contact.id,
      parentId: company.id,
      label: "Ada Rossi",
      href: `/crm/contacts/${contact.id}`,
    });
  });

  it("omits a contact or deal of ANOTHER company, one without a company and one that does not exist", async () => {
    const mine = await makeCompany();
    const other = await makeCompany();
    const foreignDeal = await makeDeal(other.id);
    const foreignContact = await makeContact(other.id);
    const orphan = await makeContact(null);
    const res = await resolve("consultant", [mine.id], {
      contact: [foreignContact.id, orphan.id, "nope"],
      deal: [foreignDeal.id, "nope"],
    });
    expect(res.status).toBe(200);
    expect(res.json.related).toEqual([]);
  });

  it("omits related rows when the asked company is missing", async () => {
    const other = await makeCompany();
    const deal = await makeDeal(other.id);
    const res = await resolve("consultant", ["nope"], { deal: [deal.id] });
    expect(res.json.related).toEqual([]);
  });

  it("`ids: []` answers only `reader`, even when related ids are sent", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id);
    const res = await resolve("consultant", [], { deal: [deal.id] });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reader: true, items: [], related: [] });
  });
});

describe("a caller without crm:access", () => {
  it("gets `reader:false` and nothing about any record (AC-8.3)", async () => {
    const company = await makeCompany({ name: "Secret SA" });
    const deal = await makeDeal(company.id, { title: "Secret deal" });
    const res = await resolve("outsider", [company.id, "nope"], { deal: [deal.id] });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reader: false, items: [], related: [] });
    expect(JSON.stringify(res.json)).not.toContain("Secret");
  });

  it("`ids: []` still answers `reader:false`", async () => {
    expect((await resolve("outsider", [])).json).toEqual({ reader: false, items: [], related: [] });
  });

  it("stops being a reader the moment the grant goes: a new perm_epoch is a fresh live resolve", async () => {
    const company = await makeCompany();
    expect((await resolve("consultant", [company.id])).json.reader).toBe(true);
    const harness = setupTestAuth();
    try {
      harness.setResolve(async (header) => ({ sub: subOf(header), epoch: 1, permissions: [], entity: "welld_ch", jobTitle: null }));
      const token = await harness.signToken({ sub: PERSONAS.consultant.sub, email: "c@welld.test", permEpoch: 1 });
      const res = await app.request(URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "company", ids: [company.id] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ reader: false, items: [], related: [] });
    } finally {
      harness.setResolve(async (header) => {
        const persona = Object.values(PERSONAS).find((p) => p.sub === subOf(header))!;
        return { sub: persona.sub, epoch: 0, permissions: persona.permissions, entity: persona.entity, jobTitle: null };
      });
    }
  });
});

describe("failure modes", () => {
  it("401 without a token", async () => {
    expect((await resolve(null, ["x"])).status).toBe(401);
  });

  it("503 when `auth` cannot resolve the caller: fail closed, never a reader", async () => {
    const company = await makeCompany();
    const { __resetAuthzCacheForTests } = await import("../auth/authz.middleware");
    __resetAuthzCacheForTests();
    const harness = setupTestAuth();
    try {
      harness.setResolve(async () => {
        throw new Error("auth down");
      });
      const res = await resolve("admin", [company.id]);
      expect(res.status).toBe(503);
      expect(res.json.reader).toBeUndefined();
    } finally {
      harness.setResolve(async (header) => {
        const persona = Object.values(PERSONAS).find((p) => p.sub === subOf(header))!;
        return { sub: persona.sub, epoch: 0, permissions: persona.permissions, entity: persona.entity, jobTitle: null };
      });
    }
  });

  it("422 for 26 ids, 25 are fine", async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    const over = await resolve("consultant", ids(26));
    expect(over.status).toBe(422);
    expect(over.json.field).toBe("ids");
    const ok = await resolve("consultant", ids(25));
    expect(ok.status).toBe(200);
    expect(ok.json.items).toHaveLength(25);
  });

  it("422 for more than 100 related ids of a type, 100 are fine", async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    expect((await resolve("consultant", ["x"], { contact: ids(101) })).status).toBe(422);
    expect((await resolve("consultant", ["x"], { deal: ids(101) })).status).toBe(422);
    expect((await resolve("consultant", ["x"], { contact: ids(100), deal: ids(100) })).status).toBe(200);
  });

  it("422 for an empty or oversized id, an unknown entity type, a missing field or an extra key", async () => {
    expect((await resolve("consultant", [""])).status).toBe(422);
    expect((await resolve("consultant", ["x".repeat(65)])).status).toBe(422);
    expect((await resolve("consultant", ["x"], { project: ["p"] })).status).toBe(422);
    expect((await call("POST", URL, { as: "consultant", body: { entityType: "deal", ids: ["x"] } })).status).toBe(422);
    expect((await call("POST", URL, { as: "consultant", body: { ids: ["x"] } })).status).toBe(422);
    expect((await call("POST", URL, { as: "consultant", body: { entityType: "company" } })).status).toBe(422);
    expect((await call("POST", URL, { as: "consultant", body: { entityType: "company", ids: [], extra: 1 } })).status).toBe(422);
  });

  it("422 for a NUL character in any id: Postgres text cannot hold it, so it is refused before the lookup, never a 500 (security re-review)", async () => {
    const nul = "co\u0000mpany";
    const asked = await resolve("consultant", [nul]);
    expect(asked.status).toBe(422);
    expect(asked.json.field).toBe("ids.0");
    expect((await resolve("consultant", ["x"], { contact: [nul] })).status).toBe(422);
    expect((await resolve("consultant", ["x"], { deal: ["ok", nul] })).status).toBe(422);
    // A caller without the grant is refused the same way: validation runs before the grant is read.
    expect((await resolve("outsider", [nul])).status).toBe(422);
  });

  it("a validation failure for a caller without crm:access still reveals nothing", async () => {
    const res = await resolve("outsider", Array.from({ length: 26 }, (_, i) => `id-${i}`));
    expect(res.status).toBe(422);
    expect(res.json.items).toBeUndefined();
  });
});
