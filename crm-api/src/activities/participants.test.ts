import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { call, makeCompany, makeDeal, resetWorld } from "../test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "../lib/notify";

/** specs/017 US-8: the wellD colleagues who took part in an activity. */
describe("activity participants (US-8)", () => {
  let events: (NotifyEvent & { to: string[] })[];

  beforeEach(async () => {
    await resetWorld();
    events = [];
    setNotifierForTests({
      async notify(event) {
        events.push({ ...event, to: recipientsOf(event) });
      },
    });
  });
  afterEach(() => setNotifierForTests(null));

  it("a meeting records who else went; each is told in-app, never the author (AC-8.1, AC-8.3)", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id);
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
    const company = await makeCompany();
    const body = { type: "call", subject: "Call", companyId: company.id };
    expect((await call("POST", "/activities", { body: { ...body, participantIds: ["user-outsider"] } })).json).toMatchObject({
      code: "owner_not_crm_user",
      field: "participantIds",
    });
    const eleven = Array.from({ length: 11 }, (_, i) => `user-${i}`);
    expect((await call("POST", "/activities", { body: { ...body, participantIds: eleven } })).json.field).toBe("participantIds");
  });

  it("a task someone takes part in is in their task list (AC-8.2)", async () => {
    const company = await makeCompany();
    await call("POST", "/activities", {
      as: "admin",
      body: { type: "task", subject: "Prepare the demo", companyId: company.id, assigneeUserId: "user-tech", participantIds: ["user-colleague"] },
    });
    const mine = await call("GET", "/tasks", { as: "colleague" });
    expect(mine.json.items.map((t: { subject: string }) => t.subject)).toEqual(["Prepare the demo"]);
    const theirs = await call("GET", "/tasks?assignee=user-colleague", { as: "admin" });
    expect(theirs.json.total).toBe(1);
    expect((await call("GET", "/tasks", { as: "consultant" })).json.total).toBe(0);
  });
});
