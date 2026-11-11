/**
 * Activities and tasks on a CRM company (specs/028 AC-1.1, AC-8.1, AC-8.3): crm-api's
 * `activities.test.ts` scenarios (specs/017 US-4, specs/021 US-14) ported to activities-api,
 * against the crm test host. The CRM must behave exactly as it did when crm-api served these
 * routes. What is new is asserted too: the view's `kind` and `may`, the labels that now come
 * from the host, and that the host's answer, not a role, decides who reads.
 *
 * The task LISTS (`/tasks`, `/tasks/assignees`) of the crm tests are T9's.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { newBlockerRows } from "./blockers";
import { appAccess, authStub, bearerOf, call, db, hosts, makeCompany, makeContact, makeDeal, resetWorld } from "../test-support/world";

beforeEach(resetWorld);

describe("activities and tasks (specs/017 US-4)", () => {
  it("logs an activity on a company, newest first, with live author names and the host's label (AC-4.1, AC-4.5)", async () => {
    const company = await makeCompany("Acme SA");
    await call("POST", "/activities", {
      as: "consultant",
      body: { type: "meeting", subject: "Kick-off", companyId: company.id, occurredAt: "2026-10-01T09:00:00Z" },
    });
    await call("POST", "/activities", {
      as: "colleague",
      body: { type: "note", subject: "Follow-up", body: "Sent the deck", companyId: company.id, occurredAt: "2026-10-05T09:00:00+02:00" },
    });
    const list = await call("GET", `/activities?companyId=${company.id}`);
    expect(list.json.total).toBe(2);
    expect(list.json.items.map((a: { subject: string }) => a.subject)).toEqual(["Follow-up", "Kick-off"]);
    expect(list.json.items[1]).toMatchObject({
      kind: "pre_sales",
      author: { id: "user-consultant", status: "active" },
      task: null,
      company: { id: company.id, name: "Acme SA" },
      project: null,
    });
  });

  it("needs exactly one filter", async () => {
    expect((await call("GET", "/activities")).status).toBe(422);
    expect((await call("GET", "/activities?companyId=a&dealId=b")).status).toBe(422);
    expect((await call("GET", "/activities?companyId=a&projectId=b")).status).toBe(422);
  });

  it("lists by contact and by deal, across the companies the CRM lets the caller read", async () => {
    const company = await makeCompany();
    const contact = makeContact(company.id, "Ada Rossi");
    const deal = makeDeal(company.id, "Grid analytics");
    const other = await makeCompany("Other");
    await call("POST", "/activities", { as: "consultant", body: { type: "call", subject: "About Ada", companyId: company.id, contactId: contact.id } });
    await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "About the deal", companyId: company.id, dealId: deal.id } });
    await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "Elsewhere", companyId: other.id } });

    const byContact = await call("GET", `/activities?contactId=${contact.id}`);
    expect(byContact.json.items).toHaveLength(1);
    expect(byContact.json.items[0]).toMatchObject({ subject: "About Ada", contact: { id: contact.id, name: "Ada Rossi" } });
    const byDeal = await call("GET", `/activities?dealId=${deal.id}`);
    expect(byDeal.json.items).toHaveLength(1);
    expect(byDeal.json.items[0]).toMatchObject({ subject: "About the deal", deal: { id: deal.id, title: "Grid analytics" } });
  });

  it("refuses a contact or deal of another company (AC-4.1)", async () => {
    const mine = await makeCompany();
    const other = await makeCompany();
    const contact = makeContact(other.id);
    const deal = makeDeal(other.id);
    const base = { type: "call", subject: "S", companyId: mine.id };
    expect((await call("POST", "/activities", { body: { ...base, contactId: contact.id } })).json.code).toBe("contact_not_in_company");
    expect((await call("POST", "/activities", { body: { ...base, dealId: deal.id } })).json.code).toBe("deal_not_in_company");
    expect((await call("POST", "/activities", { body: { ...base, dueDate: "2026-12-01" } })).json.code).toBe("task_fields_on_non_task");
    expect((await call("POST", "/activities", { body: { ...base, blockedByIds: [] } })).json.code).toBe("task_fields_on_non_task");
    expect((await call("POST", "/activities", { body: { ...base, assigneeUserId: "user-tech" } })).json.code).toBe("task_fields_on_non_task");
  });

  it("only the author edits or deletes (AC-4.2)", async () => {
    const company = await makeCompany();
    const note = (await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "Mine", companyId: company.id } })).json;
    expect(note.may).toEqual({ edit: true, delete: true, complete: false });
    const notMine = await call("PATCH", `/activities/${note.id}`, { as: "colleague", body: { subject: "Theirs" } });
    expect(notMine.status).toBe(403);
    expect(notMine.json.code).toBe("author_only");
    expect((await call("DELETE", `/activities/${note.id}`, { as: "admin" })).status).toBe(403);
    expect((await call("PATCH", `/activities/${note.id}`, { as: "consultant", body: { body: "More" } })).json.body).toBe("More");
    expect((await call("DELETE", `/activities/${note.id}`, { as: "consultant" })).status).toBe(204);
    expect((await call("GET", `/activities?companyId=${company.id}`)).json.total).toBe(0);
  });

  it("a reader who is not the author sees what they may do (the view's `may`)", async () => {
    const company = await makeCompany();
    await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "T", companyId: company.id } });
    const asColleague = await call("GET", `/activities?companyId=${company.id}`, { as: "colleague" });
    expect(asColleague.json.items[0].may).toEqual({ edit: false, delete: false, complete: true });
    const asAuthor = await call("GET", `/activities?companyId=${company.id}`, { as: "consultant" });
    expect(asAuthor.json.items[0].may).toEqual({ edit: true, delete: true, complete: true });
  });

  it("tasks: default assignee is the author, anyone completes or reopens (AC-4.3, AC-4.4)", async () => {
    const company = await makeCompany();
    const task = (body: Record<string, unknown>) =>
      call("POST", "/activities", { as: "consultant", body: { type: "task", companyId: company.id, ...body } });
    const noDate = (await task({ subject: "Whenever" })).json;
    const later = (await task({ subject: "Later", dueDate: "2026-12-20" })).json;
    const forColleague = (await task({ subject: "For colleague", assigneeUserId: "user-colleague" })).json;
    expect(noDate.task).toMatchObject({ assignee: { id: "user-consultant" }, completedAt: null, dueDate: null, blocked: false, blockedBy: [] });
    expect(later.task.dueDate).toBe("2026-12-20");
    expect(forColleague.task.assignee).toMatchObject({ id: "user-colleague", name: "Name of user-colleague" });

    const done = await call("POST", `/activities/${later.id}/complete`, { as: "colleague" });
    expect(done.status).toBe(200);
    expect(done.json.task).toMatchObject({ completedBy: { id: "user-colleague" } });
    // Completing again keeps who completed it, and when.
    const again = await call("POST", `/activities/${later.id}/complete`, { as: "admin" });
    expect(again.json.task.completedBy.id).toBe("user-colleague");
    expect(again.json.task.completedAt).toBe(done.json.task.completedAt);

    const reopened = await call("POST", `/activities/${later.id}/reopen`);
    expect(reopened.json.task).toMatchObject({ completedAt: null, completedBy: null });

    const note = (await call("POST", "/activities", { body: { type: "note", subject: "N", companyId: company.id } })).json;
    const refused = await call("POST", `/activities/${note.id}/complete`);
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "not_a_task", field: "type" });
  });

  it("an assignee must be a CRM user (specs/018 AC-2.2)", async () => {
    const company = await makeCompany();
    const task = (assigneeUserId: string) =>
      call("POST", "/activities", { body: { type: "task", subject: "T", companyId: company.id, assigneeUserId } });
    // Deleted, or active but without crm access: both refused, the same way.
    expect((await task("user-gone")).json).toMatchObject({ code: "owner_not_app_user", field: "assigneeUserId" });
    expect((await task("user-outsider")).json).toMatchObject({ code: "owner_not_app_user", field: "assigneeUserId" });
    expect((await task("user-tech")).status).toBe(201);
    // The check is the CRM's access, not the projects tool's.
    expect((await call("POST", "/activities", { body: { type: "task", subject: "T", companyId: company.id, assigneeUserId: "user-pm" } })).status).toBe(422);
  });

  it("naming yourself as the assignee needs no check: you are using the CRM right now", async () => {
    const company = makeCompany();
    const own = await call("POST", "/activities", {
      as: "consultant",
      body: { type: "task", subject: "T", companyId: company.id, assigneeUserId: "user-consultant" },
    });
    expect(own.status).toBe(201);
    const patched = await call("PATCH", `/activities/${own.json.id}`, { as: "consultant", body: { assigneeUserId: "user-consultant" } });
    expect(patched.status).toBe(200);
    expect(authStub.accessChecks).toEqual([]);
  });

  it("an assignee changed by a later edit is checked; the CRM's author may reassign (specs/018 AC-2.2)", async () => {
    const company = await makeCompany();
    const task = (await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "T", companyId: company.id } })).json;
    const bad = await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { assigneeUserId: "user-outsider" } });
    expect(bad.json).toMatchObject({ status: 422, code: "owner_not_app_user", field: "assigneeUserId" });
    const good = await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { assigneeUserId: "user-tech", dueDate: "2027-01-05" } });
    expect(good.json.task).toMatchObject({ assignee: { id: "user-tech" }, dueDate: "2027-01-05" });
    const cleared = await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { dueDate: null } });
    expect(cleared.json.task.dueDate).toBeNull();
  });

  it("the CRM re-checks the assignee on EVERY edit that names one, changed or not, as crm-api did (specs/028 US-1)", async () => {
    const company = makeCompany();
    const task = (
      await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "T", companyId: company.id, assigneeUserId: "user-tech" } })
    ).json;
    authStub.accessChecks.length = 0;
    // Resent unchanged while user-tech still has CRM access: asked, and accepted.
    const same = await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { subject: "Renamed", assigneeUserId: "user-tech" } });
    expect(same.status).toBe(200);
    expect(authStub.accessChecks).toEqual([{ appId: "crm", userId: "user-tech" }]);
    // The colleague then loses CRM access: the same unchanged resend is now refused, nothing changes.
    appAccess.crm.delete("user-tech");
    const refused = await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { subject: "Again", assigneeUserId: "user-tech" } });
    expect(refused.json).toMatchObject({ status: 422, code: "owner_not_app_user", field: "assigneeUserId" });
    expect((await db.activity.findUniqueOrThrow({ where: { id: task.id } })).subject).toBe("Renamed");
    // An edit that does not name an assignee asks nobody, so the task stays editable.
    authStub.accessChecks.length = 0;
    expect((await call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { subject: "Fine" } })).status).toBe(200);
    expect(authStub.accessChecks).toEqual([]);
  });

  it("does not take a field it does not know (a client cannot name a kind, a host or a meeting)", async () => {
    const company = await makeCompany();
    const base = { type: "note", subject: "S", companyId: company.id };
    for (const extra of [{ kind: "operational" }, { hostApp: "projects" }, { authorUserId: "user-admin" }, { meetingId: "m" }]) {
      expect((await call("POST", "/activities", { body: { ...base, ...extra } })).status).toBe(422);
    }
  });

  it("a company the CRM does not know, or the caller cannot read, is a 404 (AC-8.3)", async () => {
    const company = await makeCompany();
    await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "S", companyId: company.id } });
    const unknown = await call("GET", "/activities?companyId=co-nobody", { as: "consultant" });
    hosts.crm.setReader("user-outsider", false);
    const unreadable = await call("GET", `/activities?companyId=${company.id}`, { as: "outsider" });
    expect(unknown.status).toBe(404);
    expect(unreadable.status).toBe(404);
    // Byte for byte, apart from the path that was asked.
    const { instance: _a, ...a } = unknown.json;
    const { instance: _b, ...b } = unreadable.json;
    expect(a).toEqual(b);
    expect((await call("POST", "/activities", { as: "outsider", body: { type: "note", subject: "S", companyId: company.id } })).status).toBe(404);
  });
});

describe("a task that waits on an open task cannot be completed (specs/017 US-6; the rules to set blockers are T8's)", () => {
  it("is refused as task_blocked naming the open blockers, and goes through once they are done", async () => {
    const company = makeCompany();
    const mk = async (subject: string) =>
      (await call("POST", "/activities", { as: "consultant", body: { type: "task", subject, companyId: company.id } })).json;
    const waiting = await mk("Waiting");
    const first = await mk("First");
    const second = await mk("Second");
    // Written the way the service writes them: one millisecond apart, in the order given. A bare
    // `createMany` gives both rows the same `createdAt`, and the order of tied rows is whatever the
    // query plan happens to return (this test failed 1 run in 8 on it).
    await db.taskBlocker.createMany({
      data: newBlockerRows([first.id, second.id], "user-consultant").map((row) => ({ blockedId: waiting.id, ...row })),
    });

    const view = (await call("GET", `/activities?companyId=${company.id}&type=task&open=true`, { as: "consultant" })).json.items.find(
      (t: { id: string }) => t.id === waiting.id,
    );
    expect(view.task).toMatchObject({
      blocked: true,
      blockedBy: [
        { id: first.id, subject: "First", completed: false },
        { id: second.id, subject: "Second", completed: false },
      ],
    });

    const refused = await call("POST", `/activities/${waiting.id}/complete`, { as: "consultant" });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("task_blocked");
    expect(refused.json.blockers).toEqual([
      { id: first.id, subject: "First" },
      { id: second.id, subject: "Second" },
    ]);
    expect((await db.activity.findUniqueOrThrow({ where: { id: waiting.id } })).completedAt).toBeNull();

    await call("POST", `/activities/${first.id}/complete`, { as: "consultant" });
    await call("POST", `/activities/${second.id}/complete`, { as: "consultant" });
    expect((await call("POST", `/activities/${waiting.id}/complete`, { as: "consultant" })).status).toBe(200);
  });
});

describe("a contact's or deal's activities are listed only under companies the CRM lets the caller read", () => {
  it("leaves out the ones whose company the host no longer knows", async () => {
    const kept = makeCompany("Kept");
    const gone = makeCompany("Gone");
    const contact = makeContact(kept.id);
    for (const company of [kept, gone]) {
      await db.activity.create({
        data: {
          kind: "pre_sales",
          type: "note",
          subject: `Under ${company.name}`,
          occurredAt: new Date(),
          hostApp: "crm",
          hostType: "company",
          hostId: company.id,
          contactId: contact.id,
          authorUserId: "user-consultant",
        },
      });
    }
    hosts.crm.reset();
    hosts.crm.setEntity(kept.id, { label: "Kept", href: `/crm/companies/${kept.id}` });
    const res = await call("GET", `/activities?contactId=${contact.id}`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(1);
    expect(res.json.items.map((a: { subject: string }) => a.subject)).toEqual(["Under Kept"]);
  });

  it("is a 404 for a caller who cannot read the CRM, even when nothing refers to the record", async () => {
    hosts.crm.setReader("user-outsider", false);
    expect((await call("GET", "/activities?contactId=ct-nothing", { as: "outsider" })).status).toBe(404);
    expect((await call("GET", "/activities?dealId=dl-nothing", { as: "outsider" })).status).toBe(404);
    expect((await call("GET", "/activities?dealId=dl-nothing", { as: "consultant" })).status).toBe(200);
  });
});

describe("a meeting activity (specs/021 US-14, AC-14.2, AC-14.4)", () => {
  // What the notices reconciler writes, inserted directly: this file is about how it READS.
  async function meetingActivity(companyId: string, dealId: string, extra: { body?: string } = {}) {
    const meetingId = crypto.randomUUID();
    const row = await db.activity.create({
      data: {
        kind: "pre_sales",
        type: "meeting",
        subject: "Discovery call",
        body: extra.body ?? null,
        occurredAt: new Date("2026-11-10T09:30:00Z"),
        hostApp: "crm",
        hostType: "company",
        hostId: companyId,
        dealId,
        authorUserId: "user-consultant",
        meetingId,
      },
    });
    return { row, meetingId };
  }

  it("shows subject, occurredAt, no body and the meeting link on the deal's and the company's timeline", async () => {
    const company = await makeCompany();
    const deal = makeDeal(company.id);
    const { row, meetingId } = await meetingActivity(company.id, deal.id);
    const expected = {
      id: row.id,
      type: "meeting",
      subject: "Discovery call",
      occurredAt: "2026-11-10T09:30:00.000Z",
      body: null,
      meeting: { id: meetingId, href: `/my-meetings/m/${meetingId}` },
      deal: { id: deal.id },
      author: { id: "user-consultant", status: "active" },
    };
    for (const url of [`/activities?dealId=${deal.id}`, `/activities?companyId=${company.id}`]) {
      const res = await call("GET", url, { as: "colleague" });
      expect(res.status).toBe(200);
      expect(res.json.items).toHaveLength(1);
      expect(res.json.items[0]).toMatchObject(expected);
    }
  });

  it("never exposes a body on it, even one the row holds", async () => {
    const company = await makeCompany();
    const deal = makeDeal(company.id);
    await meetingActivity(company.id, deal.id, { body: "Transcript excerpt that must not leak" });
    const res = await call("GET", `/activities?dealId=${deal.id}`, { as: "consultant" });
    expect(res.json.items[0].body).toBeNull();
    expect(JSON.stringify(res.json)).not.toContain("must not leak");
  });

  it("an ordinary activity has meeting: null and keeps its body; a client cannot set a meeting id", async () => {
    const company = await makeCompany();
    const created = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "N", body: "Kept", companyId: company.id } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ body: "Kept", meeting: null });
    const forged = await call("POST", "/activities", {
      as: "consultant",
      body: { type: "meeting", subject: "M", companyId: company.id, meetingId: "forged" },
    });
    expect(forged.status).toBe(422);
    expect((await call("PATCH", `/activities/${created.json.id}`, { as: "consultant", body: { meetingId: "forged" } })).status).toBe(422);
  });

  it("a PATCH response shows it the same way", async () => {
    const company = await makeCompany();
    const deal = makeDeal(company.id);
    const { row, meetingId } = await meetingActivity(company.id, deal.id);
    const res = await call("PATCH", `/activities/${row.id}`, { as: "consultant", body: { body: "mine" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ body: null, meeting: { id: meetingId } });
  });
});

describe("filters, paging and the document", () => {
  it("lists open tasks of a company for the blocker picker, pages newest first", async () => {
    const company = makeCompany();
    const mk = (body: Record<string, unknown>) =>
      call("POST", "/activities", { as: "consultant", body: { companyId: company.id, ...body } });
    const open = (await mk({ type: "task", subject: "Open", occurredAt: "2026-10-01T00:00:00Z" })).json;
    const done = (await mk({ type: "task", subject: "Done", occurredAt: "2026-10-02T00:00:00Z" })).json;
    await mk({ type: "note", subject: "Note", occurredAt: "2026-10-03T00:00:00Z" });
    await call("POST", `/activities/${done.id}/complete`, { as: "consultant" });

    const pickable = await call("GET", `/activities?companyId=${company.id}&type=task&open=true`);
    expect(pickable.json.items.map((a: { id: string }) => a.id)).toEqual([open.id]);

    const page1 = await call("GET", `/activities?companyId=${company.id}&pageSize=2`);
    const page2 = await call("GET", `/activities?companyId=${company.id}&pageSize=2&page=2`);
    expect(page1.json).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(page1.json.items.map((a: { subject: string }) => a.subject)).toEqual(["Note", "Done"]);
    expect(page2.json.items.map((a: { subject: string }) => a.subject)).toEqual(["Open"]);
    expect((await call("GET", `/activities?companyId=${company.id}&pageSize=101`)).status).toBe(422);
  });

  it("serves its OpenAPI document with the activity routes", async () => {
    const res = await call("GET", "/openapi.json", { as: null });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.paths)).toEqual(
      expect.arrayContaining(["/activities", "/activities/{id}", "/activities/{id}/complete", "/activities/{id}/reopen"]),
    );
  });

  it("asks for a token on every route", async () => {
    for (const [method, path] of [
      ["GET", "/activities?companyId=x"],
      ["POST", "/activities"],
      ["PATCH", "/activities/x"],
      ["DELETE", "/activities/x"],
      ["POST", "/activities/x/complete"],
      ["POST", "/activities/x/reopen"],
    ] as const) {
      expect((await call(method, path, { as: null })).status).toBe(401);
    }
    expect(hosts.crm.resolves).toHaveLength(0);
  });

  it("an activity deleted while the host was being asked is a 404, not a fault", async () => {
    const company = makeCompany();
    const task = (await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "T", companyId: company.id } })).json;
    hosts.crm.mode = { delayMs: 150 };
    const patch = call("PATCH", `/activities/${task.id}`, { as: "consultant", body: { subject: "x" } });
    const complete = call("POST", `/activities/${task.id}/complete`, { as: "consultant" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await db.activity.delete({ where: { id: task.id } });
    expect((await patch).status).toBe(404);
    expect((await complete).status).toBe(404);
  });
});

describe("the host decides, as the caller (AC-8.1, AC-8.3)", () => {
  it("forwards the caller's own token, never a token of its own", async () => {
    const company = await makeCompany();
    await call("POST", "/activities", { as: "colleague", body: { type: "note", subject: "S", companyId: company.id } });
    expect(hosts.crm.resolves.length).toBeGreaterThan(0);
    for (const resolve of hosts.crm.resolves) expect(resolve.authorization).toBe(await bearerOf("colleague"));
  });

  it("an activity the caller cannot read is a 404 on every route, the same as one that does not exist", async () => {
    const company = await makeCompany();
    const note = (await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "S", companyId: company.id } })).json;
    hosts.crm.setReader("user-outsider", false);
    const routes: [string, string, unknown?][] = [
      ["PATCH", `/activities/${note.id}`, { subject: "x" }],
      ["DELETE", `/activities/${note.id}`],
      ["POST", `/activities/${note.id}/complete`],
      ["POST", `/activities/${note.id}/reopen`],
    ];
    for (const [method, path, body] of routes) {
      const real = await call(method, path, { as: "outsider", ...(body ? { body } : {}) });
      const nothing = await call(method, path.replace(note.id, "no-such-activity"), { as: "outsider", ...(body ? { body } : {}) });
      expect(real.status).toBe(404);
      expect(nothing.status).toBe(404);
      const { instance: _a, ...a } = real.json;
      const { instance: _b, ...b } = nothing.json;
      expect(a).toEqual(b);
    }
    // And nothing changed.
    const row = await db.activity.findUniqueOrThrow({ where: { id: note.id } });
    expect(row.subject).toBe("S");
    expect(row.completedAt).toBeNull();
  });
});
