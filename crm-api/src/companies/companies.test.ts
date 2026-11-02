import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, forgetIdentities, identities, makeCompany, makeDeal, markEstimateReady, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

describe("companies (US-1)", () => {
  it("creates a company owned by its creator, with an ETag and version 1 (AC-1.3)", async () => {
    const res = await call("POST", "/companies", {
      as: "consultant",
      body: { name: "  Acme SA ", status: "prospect", entity: "welld_ch", country: "ch", website: "" },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      name: "Acme SA",
      country: "CH",
      website: null,
      owner: { id: "user-consultant", status: "active", name: "Name of user-consultant" },
      archived: false,
      contactCount: 0,
      openDealCount: 0,
      version: 1,
    });
    expect(res.headers.get("ETag")).toBe('"1"');
  });

  it("keeps the registered name, street and postal code for the offer's client block (specs/020 AC-5.1)", async () => {
    const created = await call("POST", "/companies", {
      as: "consultant",
      body: { name: "Acme", status: "prospect", entity: "welld_ch", legalName: " Acme Holding SA ", street: "Via Roma 1", postalCode: "IT-23807" },
    });
    expect(created.json).toMatchObject({ legalName: "Acme Holding SA", street: "Via Roma 1", postalCode: "IT-23807" });
    const read = await call("GET", `/companies/${created.json.id}`, { as: "consultant" });
    expect(read.json).toMatchObject({ legalName: "Acme Holding SA", street: "Via Roma 1", postalCode: "IT-23807" });
    const edited = await call("PATCH", `/companies/${created.json.id}`, { as: "consultant", ifMatch: 1, body: { street: null, postalCode: "6900" } });
    expect(edited.json).toMatchObject({ legalName: "Acme Holding SA", street: null, postalCode: "6900", version: 2 });
    // the list carries the summary shape only
    const list = await call("GET", "/companies", { as: "consultant" });
    expect(list.json.items[0]).not.toHaveProperty("legalName");
    const tooLong = (field: string, n: number) => call("POST", "/companies", { body: { name: `N${field}`, status: "prospect", entity: "welld_ch", [field]: "x".repeat(n) } });
    expect((await tooLong("legalName", 201)).json.field).toBe("legalName");
    expect((await tooLong("street", 201)).json.field).toBe("street");
    expect((await tooLong("postalCode", 21)).json.field).toBe("postalCode");
    expect((await tooLong("postalCode", 20)).status).toBe(201);
  });

  it("refuses a missing name, a bad country and a javascript: website with a 422 naming the field", async () => {
    const base = { status: "prospect", entity: "welld_ch" };
    expect((await call("POST", "/companies", { body: { ...base, name: "  " } })).json.field).toBe("name");
    expect((await call("POST", "/companies", { body: { ...base, name: "X", country: "CHE" } })).json.field).toBe("country");
    const js = await call("POST", "/companies", { body: { ...base, name: "X", website: "javascript:alert(1)" } });
    expect(js.status).toBe(422);
    expect(js.json.field).toBe("website");
  });

  it("names are unique case-insensitively, archived companies included (AC-1.4, D-11)", async () => {
    const first = await makeCompany({ name: "Globex" });
    await call("POST", `/companies/${first.id}/archive`, { ifMatch: 1 });
    const dup = await call("POST", "/companies", { body: { name: "GLOBEX", status: "prospect", entity: "welld_it" } });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ code: "company_name_taken", companyId: first.id, archived: true });
  });

  it("renaming onto another company's name is a 409; keeping your own name is fine", async () => {
    const a = await makeCompany({ name: "Initech" });
    await makeCompany({ name: "Hooli" });
    expect((await call("PATCH", `/companies/${a.id}`, { ifMatch: 1, body: { name: "hooli" } })).status).toBe(409);
    expect((await call("PATCH", `/companies/${a.id}`, { ifMatch: 1, body: { name: "INITECH" } })).status).toBe(200);
  });

  it("requires If-Match on edits: 428 without, 409 when stale, 200 and version+1 when current (AC-1.6)", async () => {
    const company = await makeCompany();
    expect((await call("PATCH", `/companies/${company.id}`, { body: { city: "Lugano" } })).json.code).toBe(
      "precondition_required",
    );
    const ok = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { city: "Lugano" } });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ city: "Lugano", version: 2 });
    const stale = await call("PATCH", `/companies/${company.id}`, { as: "colleague", ifMatch: 1, body: { city: "Milano" } });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: "version_conflict", currentVersion: 2 });
    expect((await call("GET", `/companies/${company.id}`)).json.city).toBe("Lugano");
  });

  it("null clears an optional field; omitted leaves it", async () => {
    const company = await makeCompany({ industry: "Energy", city: "Bern" });
    const res = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { industry: null } });
    expect(res.json).toMatchObject({ industry: null, city: "Bern" });
  });

  it("an owner must be an active user; an auth outage while checking is a 503 (D-15)", async () => {
    const company = await makeCompany();
    const gone = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { ownerUserId: "user-gone" } });
    expect(gone.status).toBe(422);
    expect(gone.json).toMatchObject({ code: "owner_not_crm_user", field: "ownerUserId" });
    // A system principal can author a record but never own one (OWASP review, D-15).
    const system = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { ownerUserId: "system:anything" } });
    expect(system.status).toBe(422);
    expect(system.json).toMatchObject({ code: "owner_not_crm_user", field: "ownerUserId" });
    identities.down = true;
    const down = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { ownerUserId: "user-colleague" } });
    expect(down.status).toBe(503);
    identities.down = false;
    const ok = await call("PATCH", `/companies/${company.id}`, { ifMatch: 1, body: { ownerUserId: "user-colleague" } });
    expect(ok.json.owner).toMatchObject({ id: "user-colleague", status: "active" });
  });

  it("an auth outage while only DISPLAYING owners degrades names to unknown (fails soft)", async () => {
    const company = await makeCompany();
    forgetIdentities();
    identities.down = true;
    const res = await call("GET", `/companies/${company.id}`);
    expect(res.status).toBe(200);
    expect(res.json.owner).toEqual({ id: "user-admin", name: null, status: "unknown" });
  });

  it("lists by name, paginated, searchable, hiding archived unless asked (AC-1.1, AC-1.2)", async () => {
    for (const name of ["Delta", "alpha", "Charlie", "Bravo"]) await makeCompany({ name });
    const archived = await makeCompany({ name: "Echo", status: "former" });
    await call("POST", `/companies/${archived.id}/archive`, { ifMatch: 1 });

    const page1 = await call("GET", "/companies?pageSize=2", { as: "consultant" });
    expect(page1.json.total).toBe(4);
    expect(page1.json.items.map((c: { name: string }) => c.name)).toEqual(["alpha", "Bravo"]);
    const page2 = await call("GET", "/companies?pageSize=2&page=2");
    expect(page2.json.items.map((c: { name: string }) => c.name)).toEqual(["Charlie", "Delta"]);

    expect((await call("GET", "/companies?q=ARL")).json.items.map((c: { name: string }) => c.name)).toEqual(["Charlie"]);
    expect((await call("GET", "/companies?archived=true")).json.items.map((c: { name: string }) => c.name)).toEqual(["Echo"]);
    expect((await call("GET", "/companies?archived=all")).json.total).toBe(5);
    expect((await call("GET", "/companies?status=former&archived=all")).json.total).toBe(1);
    expect((await call("GET", "/companies?pageSize=101")).status).toBe(422);
    // An unbounded page would overflow Postgres' OFFSET into a 500.
    expect((await call("GET", "/companies?page=100001")).status).toBe(422);
    expect((await call("GET", "/companies?page=100000")).status).toBe(200);
  });

  it("counts non-archived contacts and open deals only", async () => {
    const company = await makeCompany();
    const kept = await call("POST", "/contacts", { body: { firstName: "Ann", lastName: "Lee", companyId: company.id } });
    const archived = await call("POST", "/contacts", { body: { firstName: "Bob", lastName: "Ray", companyId: company.id } });
    await call("POST", `/contacts/${archived.json.id}/archive`, { ifMatch: 1 });
    await makeDeal(company.id);
    const won = await makeDeal(company.id);
    await markEstimateReady(won.id);
    await call("POST", `/deals/${won.id}/stage`, { ifMatch: 1, body: { stage: "won" } });
    expect(kept.status).toBe(201);
    const res = await call("GET", `/companies/${company.id}`);
    expect(res.json).toMatchObject({ contactCount: 1, openDealCount: 1 });
  });

  it("archive and unarchive are versioned writes", async () => {
    const company = await makeCompany();
    const archived = await call("POST", `/companies/${company.id}/archive`, { as: "consultant", ifMatch: 1 });
    expect(archived.json).toMatchObject({ archived: true, version: 2 });
    expect((await call("POST", `/companies/${company.id}/unarchive`, { ifMatch: 1 })).status).toBe(409);
    expect((await call("POST", `/companies/${company.id}/unarchive`, { ifMatch: 2 })).json.archived).toBe(false);
  });

  it("an unknown id is a 404", async () => {
    expect((await call("GET", "/companies/nope")).status).toBe(404);
    expect((await call("PATCH", "/companies/nope", { ifMatch: 1, body: { city: "X" } })).status).toBe(404);
  });
});

describe("company status automations (specs/017 AC-1.8, AC-1.9)", () => {
  async function winDeal(companyId: string) {
    const deal = await makeDeal(companyId);
    await markEstimateReady(deal.id);
    const won = await call("POST", `/deals/${deal.id}/stage`, { ifMatch: 1, body: { stage: "won" } });
    expect(won.status).toBe(200);
    return deal;
  }

  it("winning a deal makes a prospect or a former client a customer, with version+1 (AC-1.8)", async () => {
    for (const status of ["prospect", "former"]) {
      const company = await makeCompany({ status });
      await winDeal(company.id);
      const read = await call("GET", `/companies/${company.id}`);
      expect(read.json).toMatchObject({ status: "customer", statusLapsed: false, version: 2 });
    }
  });

  it("winning a deal leaves a customer's record untouched", async () => {
    const company = await makeCompany({ status: "customer" });
    await winDeal(company.id);
    expect((await call("GET", `/companies/${company.id}`)).json).toMatchObject({ status: "customer", version: 1 });
  });

  it("a customer with no win in twelve months and no open deal reads former, and lists as former (AC-1.9)", async () => {
    const lapsed = await makeCompany({ status: "customer" });
    const deal = await winDeal(lapsed.id);
    await db.deal.update({ where: { id: deal.id }, data: { closedAt: new Date(Date.now() - 400 * 86_400_000) } });
    const active = await makeCompany({ status: "customer" });
    await winDeal(active.id);
    const byHand = await makeCompany({ status: "customer" });

    expect((await call("GET", `/companies/${lapsed.id}`)).json).toMatchObject({ status: "former", statusLapsed: true });
    const former = await call("GET", "/companies?status=former");
    expect(former.json.items.map((c: { id: string }) => c.id)).toEqual([lapsed.id]);
    const customers = await call("GET", "/companies?status=customer");
    expect(customers.json.items.map((c: { id: string }) => c.id).sort()).toEqual([active.id, byHand.id].sort());

    // a new open deal makes it a customer again, with no write
    await makeDeal(lapsed.id);
    expect((await call("GET", `/companies/${lapsed.id}`)).json).toMatchObject({ status: "customer", statusLapsed: false });
  });
});
