/**
 * Participants of a CRM activity (specs/017 US-8) and moving an activity between a company's
 * contacts and deals (specs/017 AC-4.2): crm-api's `participants.test.ts` ported against the
 * crm test host (specs/028 AC-1.1, AC-6.2).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { authStub, call, hosts, makeCompany, makeContact, makeDeal, resetWorld } from "../test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "../lib/notify";
import { renderNotification } from "../lib/notificationCopy";

type Seen = NotifyEvent & { to: string[]; email: boolean; href: string };

describe("activity participants (specs/017 US-8)", () => {
  let events: Seen[];

  beforeEach(async () => {
    await resetWorld();
    events = [];
    setNotifierForTests({
      async notify(event) {
        const text = renderNotification(event.kind, event, event.actorName);
        events.push({ ...event, to: recipientsOf(event), email: text.email, href: text.href });
      },
    });
  });
  afterEach(() => setNotifierForTests(null));

  it("a meeting records who else went; each is told in-app, never the author (AC-8.1, AC-8.3)", async () => {
    const company = makeCompany();
    const deal = makeDeal(company.id);
    events.length = 0;
    const meeting = await call("POST", "/activities", {
      as: "consultant",
      body: {
        type: "meeting",
        subject: "On site at the client",
        companyId: company.id,
        dealId: deal.id,
        participantIds: ["user-colleague", "user-consultant", "user-colleague"],
      },
    });
    expect(meeting.status).toBe(201);
    expect(meeting.json.participants.map((p: { id: string }) => p.id)).toEqual(["user-colleague", "user-consultant"]);
    expect(meeting.json.participants[0]).toMatchObject({ status: "active", name: "Name of user-colleague" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "activity_participant_added", email: false, to: ["user-colleague"], href: `/crm/deals/${deal.id}` });

    // an edit replaces the set and tells only who is new
    events.length = 0;
    const edited = await call("PATCH", `/activities/${meeting.json.id}`, {
      as: "consultant",
      body: { participantIds: ["user-colleague", "user-tech"] },
    });
    expect(edited.json.participants.map((p: { id: string }) => p.id)).toEqual(["user-colleague", "user-tech"]);
    expect(events.map((e) => e.to)).toEqual([["user-tech"]]);
    // only the author edits, as for every other field
    expect((await call("PATCH", `/activities/${meeting.json.id}`, { as: "colleague", body: { participantIds: [] } })).status).toBe(403);
  });

  it("refuses someone who is not a CRM user, and more than ten (AC-8.1)", async () => {
    const company = makeCompany();
    const body = { type: "call", subject: "Call", companyId: company.id };
    expect((await call("POST", "/activities", { body: { ...body, participantIds: ["user-outsider"] } })).json).toMatchObject({
      code: "owner_not_app_user",
      field: "participantIds",
    });
    // A user of the projects tool only is not a CRM user.
    expect((await call("POST", "/activities", { body: { ...body, participantIds: ["user-pm"] } })).json.code).toBe("owner_not_app_user");
    const eleven = Array.from({ length: 11 }, (_, i) => `user-${i}`);
    expect((await call("POST", "/activities", { body: { ...body, participantIds: eleven } })).json.field).toBe("participantIds");
  });

  it("asks auth as the CRM's app, with the caller's token, and never about the caller", async () => {
    const company = makeCompany();
    await call("POST", "/activities", {
      as: "consultant",
      body: { type: "call", subject: "Call", companyId: company.id, participantIds: ["user-consultant", "user-colleague"] },
    });
    expect(authStub.accessChecks).toEqual([{ appId: "crm", userId: "user-colleague" }]);
  });

  it("an identity service that cannot answer refuses the write and changes nothing (fail closed)", async () => {
    const company = makeCompany();
    authStub.down = true;
    const res = await call("POST", "/activities", {
      as: "consultant",
      body: { type: "call", subject: "Call", companyId: company.id, participantIds: ["user-colleague"] },
    });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("identity_unavailable");
    authStub.down = false;
    expect((await call("GET", `/activities?companyId=${company.id}`)).json.total).toBe(0);
  });

  it("hands a task to a colleague: told in-app and by email, linked to their task list (AC-6.1)", async () => {
    const company = makeCompany("Acme SA");
    events.length = 0;
    await call("POST", "/activities", {
      as: "admin",
      body: { type: "task", subject: "Prepare the demo", companyId: company.id, assigneeUserId: "user-tech", dueDate: "2026-12-20" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "task_assigned", to: ["user-tech"], email: true, href: "/crm/tasks" });
    expect(events[0]!.target).toEqual({ host: "crm", company: { id: company.id, name: "Acme SA" }, deal: null });
    expect(events[0]!.actorName).toBe("Name of user-admin");

    // Reassigning tells the new assignee; keeping the assignee tells nobody; assigning yourself nobody.
    events.length = 0;
    const task = (await call("POST", "/activities", { as: "admin", body: { type: "task", subject: "T2", companyId: company.id } })).json;
    expect(events).toHaveLength(0);
    await call("PATCH", `/activities/${task.id}`, { as: "admin", body: { assigneeUserId: "user-colleague" } });
    await call("PATCH", `/activities/${task.id}`, { as: "admin", body: { subject: "T2 renamed" } });
    expect(events.map((e) => e.to)).toEqual([["user-colleague"]]);
  });

  it("a notification outage never undoes the write (AC-6.4)", async () => {
    setNotifierForTests({
      async notify() {
        throw new Error("notify-api is down");
      },
    });
    const company = makeCompany();
    const res = await call("POST", "/activities", {
      as: "admin",
      body: { type: "task", subject: "T", companyId: company.id, assigneeUserId: "user-tech", participantIds: ["user-colleague"] },
    });
    expect(res.status).toBe(201);
  });
});

describe("changing an activity's contact and deal (specs/017 AC-4.2)", () => {
  beforeEach(resetWorld);

  it("the author moves it to another contact or deal of the same company, or clears them", async () => {
    const company = makeCompany();
    const other = makeCompany();
    const deal = makeDeal(company.id, "Website");
    const foreignDeal = makeDeal(other.id);
    const contact = makeContact(company.id, "Ada Rossi");
    const meeting = await call("POST", "/activities", { body: { type: "meeting", subject: "Kick-off", companyId: company.id } });
    expect(meeting.json).toMatchObject({ contact: null, deal: null });

    const linked = await call("PATCH", `/activities/${meeting.json.id}`, {
      body: { contactId: contact.id, dealId: deal.id },
    });
    expect(linked.json).toMatchObject({ contact: { id: contact.id, name: "Ada Rossi" }, deal: { id: deal.id, title: "Website" } });

    const refused = await call("PATCH", `/activities/${meeting.json.id}`, { body: { dealId: foreignDeal.id } });
    expect(refused.json).toMatchObject({ status: 422, code: "deal_not_in_company" });
    const refusedContact = await call("PATCH", `/activities/${meeting.json.id}`, { body: { contactId: "ct-nobody" } });
    expect(refusedContact.json).toMatchObject({ status: 422, code: "contact_not_in_company", field: "contactId" });

    const cleared = await call("PATCH", `/activities/${meeting.json.id}`, { body: { contactId: null, dealId: null } });
    expect(cleared.json).toMatchObject({ contact: null, deal: null });
    // only the author, as for every field
    expect((await call("PATCH", `/activities/${meeting.json.id}`, { as: "colleague", body: { dealId: deal.id } })).status).toBe(403);
  });

  it("a contact the CRM no longer returns still shows by id, with no name", async () => {
    const company = makeCompany();
    const contact = makeContact(company.id, "Ada Rossi");
    const note = (await call("POST", "/activities", { body: { type: "note", subject: "N", companyId: company.id, contactId: contact.id } })).json;
    hosts.crm.reset();
    hosts.crm.setEntity(company.id, { label: company.name, href: `/crm/companies/${company.id}` });
    const list = await call("GET", `/activities?companyId=${company.id}`);
    expect(list.json.items[0]).toMatchObject({ id: note.id, contact: { id: contact.id, name: null } });
  });
});
