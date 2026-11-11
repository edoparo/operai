import { beforeEach, describe, expect, it } from "bun:test";
import { activitiesApi, call, db, makeCompany, resetWorld } from "../test-support/world";

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

  it("erasure needs contact:erase and unlinks the contact's activities in activities-api BEFORE deleting it (AC-2.4, D-13, AC-8.4)", async () => {
    const company = await makeCompany();
    const contact = (await call("POST", "/contacts", { body: { firstName: "Eve", lastName: "Doe", companyId: company.id } })).json;
    activitiesApi.unlinked = 2;

    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "salesCh" })).status).toBe(403);
    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "consultant" })).status).toBe(403);
    expect(activitiesApi.calls).toHaveLength(0);

    // At the moment activities-api is asked, the contact is still here: unlink first, delete after.
    const asked: { present: boolean | null } = { present: null };
    activitiesApi.onCall = async (seen) => {
      if (seen.op === "erase") asked.present = (await db.contact.count({ where: { id: contact.id } })) === 1;
    };
    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "admin" })).status).toBe(204);
    expect(asked.present).toBe(true);
    expect(activitiesApi.calls).toHaveLength(1);
    expect(activitiesApi.calls[0]).toMatchObject({ op: "erase", id: contact.id });
    expect(activitiesApi.calls[0]!.authorization).toMatch(/^Bearer svc-token-/);
    expect(await db.contact.count()).toBe(0);
    // Nothing left to erase: a second erase is a 404 and does not ask activities-api again.
    expect((await call("DELETE", `/contacts/${contact.id}`)).status).toBe(404);
    expect(activitiesApi.calls).toHaveLength(1);
  });

  it.each([
    ["is unreachable", () => (activitiesApi.down = true)],
    ["is in maintenance (503)", () => (activitiesApi.fail = { erase: 503 })],
    ["answers 500", () => (activitiesApi.fail = { erase: 500 })],
  ])("when activities-api %s the erasure is a 503 activities_unavailable and the contact is untouched (AC-8.4)", async (_label, setup) => {
    const company = await makeCompany();
    const contact = (await call("POST", "/contacts", { body: { firstName: "Eve", lastName: "Doe", companyId: company.id } })).json;
    setup();
    const res = await call("DELETE", `/contacts/${contact.id}`, { as: "admin" });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("activities_unavailable");
    expect(await db.contact.count()).toBe(1);

    // Once it is back, the same erase completes.
    activitiesApi.down = false;
    activitiesApi.fail = {};
    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "admin" })).status).toBe(204);
    expect(await db.contact.count()).toBe(0);
  });

  it("a malformed answer from activities-api is a 503 too, never a silent success", async () => {
    const company = await makeCompany();
    const contact = (await call("POST", "/contacts", { body: { firstName: "Eve", lastName: "Doe", companyId: company.id } })).json;
    activitiesApi.malformed = true;
    expect((await call("DELETE", `/contacts/${contact.id}`, { as: "admin" })).status).toBe(503);
    expect(await db.contact.count()).toBe(1);
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
