import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

describe("contacts (US-2)", () => {
  it("creates a contact linked to a company, lists it by last name (AC-2.1, AC-2.2)", async () => {
    const company = await makeCompany({ name: "Umbrella" });
    const zed = await call("POST", "/contacts", {
      as: "consultant",
      body: { firstName: "Zoe", lastName: "Zed", email: "ZOE@umbrella.example", companyId: company.id },
    });
    expect(zed.status).toBe(201);
    expect(zed.json).toMatchObject({ company: { id: company.id, name: "Umbrella" }, version: 1, email: "ZOE@umbrella.example" });
    await call("POST", "/contacts", { body: { firstName: "Al", lastName: "Abe" } });

    const list = await call("GET", "/contacts");
    expect(list.json.items.map((c: { lastName: string }) => c.lastName)).toEqual(["Abe", "Zed"]);
    expect((await call("GET", "/contacts?q=zoe@")).json.items).toHaveLength(1);
    expect((await call("GET", `/contacts?companyId=${company.id}`)).json.total).toBe(1);
  });

  it("refuses an unknown company and an invalid email", async () => {
    const unknown = await call("POST", "/contacts", { body: { firstName: "A", lastName: "B", companyId: "nope" } });
    expect(unknown.json).toMatchObject({ code: "company_not_found", field: "companyId" });
    const bad = await call("POST", "/contacts", { body: { firstName: "A", lastName: "B", email: "not-an-email" } });
    expect(bad.status).toBe(422);
    expect(bad.json.field).toBe("email");
  });

  it("edits need If-Match and detect a concurrent edit (AC-2.3)", async () => {
    const contact = (await call("POST", "/contacts", { body: { firstName: "A", lastName: "B" } })).json;
    expect((await call("PATCH", `/contacts/${contact.id}`, { body: { phone: "1" } })).status).toBe(428);
    expect((await call("PATCH", `/contacts/${contact.id}`, { ifMatch: 1, body: { phone: "1" } })).json.version).toBe(2);
    expect((await call("PATCH", `/contacts/${contact.id}`, { ifMatch: 1, body: { phone: "2" } })).json.code).toBe(
      "version_conflict",
    );
  });

  it("erasure needs contact:erase and unlinks the contact's activities (AC-2.4, D-13)", async () => {
    const company = await makeCompany();
    const contact = (await call("POST", "/contacts", { body: { firstName: "Eve", lastName: "Doe", companyId: company.id } })).json;
    const activity = await call("POST", "/activities", {
      body: { type: "call", subject: "Intro call", companyId: company.id, contactId: contact.id },
    });
    expect(activity.json.contact).toEqual({ id: contact.id, name: "Eve Doe" });

    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "salesCh" })).status).toBe(403);
    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "admin" })).status).toBe(204);
    expect(await db.contact.count()).toBe(0);
    const after = await call("GET", `/activities?companyId=${company.id}`);
    expect(after.json.items[0]).toMatchObject({ id: activity.json.id, contact: null, subject: "Intro call" });
    expect((await call("DELETE", `/contacts/${contact.id}`)).status).toBe(404);
  });
});

describe("contact sorting (specs/017 US-9)", () => {
  it("sorts by name, company, job title or email; empty values last", async () => {
    const zeta = await makeCompany({ name: "Zeta" });
    const acme = await makeCompany({ name: "Acme" });
    const make = (body: Record<string, unknown>) => call("POST", "/contacts", { body });
    await make({ firstName: "Anna", lastName: "Rossi", companyId: zeta.id, jobTitle: "CEO", email: "a@zeta.ch" });
    await make({ firstName: "Bruno", lastName: "Bianchi", companyId: acme.id, email: "b@acme.ch" });
    await make({ firstName: "Carla", lastName: "Verdi", companyId: acme.id, jobTitle: "CTO" });
    const last = async (query: string) =>
      (await call("GET", `/contacts${query}`)).json.items.map((c: { lastName: string }) => c.lastName);
    expect(await last("")).toEqual(["Bianchi", "Rossi", "Verdi"]);
    expect(await last("?sort=name&order=desc")).toEqual(["Verdi", "Rossi", "Bianchi"]);
    expect(await last("?sort=company")).toEqual(["Bianchi", "Verdi", "Rossi"]);
    expect(await last("?sort=jobTitle")).toEqual(["Rossi", "Verdi", "Bianchi"]);
    expect(await last("?sort=email&order=desc")).toEqual(["Bianchi", "Rossi", "Verdi"]);
  });
});
