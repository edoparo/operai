/**
 * Task blockers (specs/20261110-activities US-4, AC-4.1..4.3, AC-6.3): crm-api's `blockers.test.ts` (specs/20261101-crm
 * US-6) ported against the crm test host, plus the same rules for the project host and across
 * the two hosts (`blocker_not_in_host`).
 *
 * "Same company" of specs/20261101-crm is "same host entity" here: the company of a CRM task, the
 * project of a project task. A pre-sales task and an operational one never block each other.
 * crm-api's last scenario (the EstimAI notice completing the estimate task) goes through the
 * system completion route, which is T10's.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { call, db, hosts, makeCompany, makeDeal, makeProject, resetWorld, type PersonaName } from "../test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "../lib/notify";
import { renderNotification } from "../lib/notificationCopy";

type Seen = NotifyEvent & { to: string[]; email: boolean; href: string; originApp: string; title: string; body: string };

let events: Seen[];

beforeEach(async () => {
  await resetWorld();
  events = [];
  setNotifierForTests({
    async notify(event) {
      const text = renderNotification(event.kind, event, event.actorName);
      events.push({ ...event, to: recipientsOf(event), email: text.email, href: text.href, originApp: text.originApp, title: text.title, body: text.body });
    },
  });
});
afterEach(() => setNotifierForTests(null));

const crmTask = async (companyId: string, extra: Record<string, unknown> = {}, as: PersonaName = "admin") => {
  const res = await call("POST", "/activities", { as, body: { type: "task", subject: "Task", companyId, ...extra } });
  expect(res.status).toBe(201);
  return res.json;
};

const projectTask = async (projectId: string, extra: Record<string, unknown> = {}, as: PersonaName = "manager") => {
  const res = await call("POST", "/activities", { as, body: { type: "task", subject: "Task", projectId, ...extra } });
  expect(res.status).toBe(201);
  return res.json;
};

const unblocked = () => events.filter((e) => e.kind === "task_unblocked");

describe("CRM task blockers (specs/20261101-crm US-6)", () => {
  it("a task waits on tasks of the same company; the view says which and whether it is blocked (AC-4.1)", async () => {
    const company = makeCompany();
    const deal = makeDeal(company.id);
    const estimate = await crmTask(company.id, { subject: "Estimate", dealId: deal.id });
    const call_ = await crmTask(company.id, { subject: "Organise the call", blockedByIds: [estimate.id] });
    expect(call_.task).toMatchObject({ blocked: true, blockedBy: [{ id: estimate.id, subject: "Estimate", completed: false }] });

    const other = makeCompany();
    const foreign = await crmTask(other.id);
    const refused = await call("POST", "/activities", {
      body: { type: "task", subject: "X", companyId: company.id, blockedByIds: [foreign.id] },
    });
    expect(refused.json).toMatchObject({ status: 422, code: "blocker_not_in_host", field: "blockedByIds" });
    const note = await call("POST", "/activities", { body: { type: "note", subject: "N", companyId: company.id } });
    expect(
      (await call("POST", "/activities", { body: { type: "task", subject: "X", companyId: company.id, blockedByIds: [note.json.id] } })).json.code,
    ).toBe("blocker_not_in_host");
    expect(
      (await call("POST", "/activities", { body: { type: "task", subject: "X", companyId: company.id, blockedByIds: ["no-such-task"] } })).json.code,
    ).toBe("blocker_not_in_host");
    expect(
      (await call("POST", "/activities", { body: { type: "note", subject: "X", companyId: company.id, blockedByIds: [estimate.id] } })).json.code,
    ).toBe("task_fields_on_non_task");
    // A refused create wrote nothing.
    expect(await db.activity.count({ where: { subject: "X" } })).toBe(0);
  });

  it("refuses a task blocking itself or a cycle; an edit replaces the whole set (AC-4.3)", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const b = await crmTask(company.id, { subject: "B", blockedByIds: [a.id] });
    expect((await call("PATCH", `/activities/${a.id}`, { as: "admin", body: { blockedByIds: [a.id] } })).json.code).toBe("blocker_is_self");
    expect((await call("PATCH", `/activities/${a.id}`, { as: "admin", body: { blockedByIds: [b.id] } })).json.code).toBe("blocker_cycle");
    const c2 = await crmTask(company.id, { subject: "C", blockedByIds: [b.id] });
    expect((await call("PATCH", `/activities/${a.id}`, { as: "admin", body: { blockedByIds: [c2.id] } })).json.code).toBe("blocker_cycle");
    // a refused edit changed nothing
    expect((await db.taskBlocker.count({ where: { blockedId: a.id } }))).toBe(0);
    const cleared = await call("PATCH", `/activities/${b.id}`, { as: "admin", body: { blockedByIds: [] } });
    expect(cleared.json.task).toMatchObject({ blocked: false, blockedBy: [] });
    // the freed shape may now be built the other way round
    expect((await call("PATCH", `/activities/${a.id}`, { as: "admin", body: { blockedByIds: [b.id] } })).status).toBe(200);
  });

  it("a diamond is not a cycle, and a duplicate id counts once", async () => {
    const company = makeCompany();
    const base = await crmTask(company.id, { subject: "Base" });
    const left = await crmTask(company.id, { subject: "Left", blockedByIds: [base.id] });
    const right = await crmTask(company.id, { subject: "Right", blockedByIds: [base.id] });
    const top = await call("POST", "/activities", {
      body: { type: "task", subject: "Top", companyId: company.id, blockedByIds: [left.id, right.id, left.id] },
    });
    expect(top.status).toBe(201);
    expect(top.json.task.blockedBy.map((b: { id: string }) => b.id)).toEqual([left.id, right.id]);
  });

  it("at most ten blockers; ten is fine (AC-4.3)", async () => {
    const company = makeCompany();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push((await crmTask(company.id, { subject: `B${i}` })).id);
    const eleven = await call("POST", "/activities", { body: { type: "task", subject: "T", companyId: company.id, blockedByIds: ids } });
    expect(eleven.status).toBe(422);
    const ten = await call("POST", "/activities", { body: { type: "task", subject: "T", companyId: company.id, blockedByIds: ids.slice(0, 10) } });
    expect(ten.status).toBe(201);
    expect(ten.json.task.blockedBy).toHaveLength(10);
    const edit = await call("PATCH", `/activities/${ten.json.id}`, { body: { blockedByIds: ids } });
    expect(edit.status).toBe(422);
    expect(await db.taskBlocker.count({ where: { blockedId: ten.json.id } })).toBe(10);
  });

  it("blockedBy lists the blockers in the order they were given, on create and on edit", async () => {
    const company = makeCompany();
    const ids: string[] = [];
    for (const name of ["one", "two", "three", "four", "five"]) ids.push((await crmTask(company.id, { subject: name })).id);
    const order = [ids[3]!, ids[0]!, ids[4]!, ids[1]!, ids[2]!];
    const created = await call("POST", "/activities", { body: { type: "task", subject: "T", companyId: company.id, blockedByIds: order } });
    expect(created.json.task.blockedBy.map((b: { id: string }) => b.id)).toEqual(order);
    // The order is stored, not left to a tie: every row of the write has its own, increasing createdAt.
    const stamps = async (id: string) => (await db.taskBlocker.findMany({ where: { blockedId: id } })).sort((x, y) => +x.createdAt - +y.createdAt);
    const stored = await stamps(created.json.id);
    expect(stored.map((row) => row.blockerId)).toEqual(order);
    expect(new Set(stored.map((row) => +row.createdAt)).size).toBe(order.length);
    const reversed = [...order].reverse();
    const edited = await call("PATCH", `/activities/${created.json.id}`, { body: { blockedByIds: reversed } });
    expect(edited.json.task.blockedBy.map((b: { id: string }) => b.id)).toEqual(reversed);
    expect((await stamps(created.json.id)).map((row) => row.blockerId)).toEqual(reversed);
    expect(new Set((await stamps(created.json.id)).map((row) => +row.createdAt)).size).toBe(reversed.length);
    const listed = await call("GET", `/activities?companyId=${company.id}&type=task`);
    const mine = listed.json.items.find((t: { id: string }) => t.id === created.json.id);
    expect(mine.task.blockedBy.map((b: { id: string }) => b.id)).toEqual(reversed);
  });

  it("only the author edits blockers, as every other field; the refusal changes nothing", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const t = await crmTask(company.id, { subject: "T" }, "consultant");
    const refused = await call("PATCH", `/activities/${t.id}`, { as: "colleague", body: { blockedByIds: [a.id] } });
    expect(refused.status).toBe(403);
    expect(await db.taskBlocker.count()).toBe(0);
  });

  it("deleting a blocker removes it from the tasks that waited on it; deleting the blocked task removes its edges (AC-4.3)", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const b = await crmTask(company.id, { subject: "B" });
    const blocked = await crmTask(company.id, { subject: "Blocked", blockedByIds: [a.id, b.id] });
    expect((await call("DELETE", `/activities/${a.id}`, { as: "admin" })).status).toBe(204);
    const after = await call("GET", `/activities?companyId=${company.id}&type=task`);
    const view = after.json.items.find((t: { id: string }) => t.id === blocked.id);
    expect(view.task.blockedBy.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect(view.task.blocked).toBe(true);
    expect((await call("DELETE", `/activities/${b.id}`, { as: "admin" })).status).toBe(204);
    // nothing waits any more: completing is allowed, and the task still exists
    const done = await call("POST", `/activities/${blocked.id}/complete`, { as: "admin" });
    expect(done.status).toBe(200);
    expect(done.json.task).toMatchObject({ blocked: false, blockedBy: [] });
    expect((await call("DELETE", `/activities/${blocked.id}`, { as: "admin" })).status).toBe(204);
    expect(await db.taskBlocker.count()).toBe(0);
  });

  it("a blocked task cannot be completed (409 task_blocked, naming the blockers); once they close it can (AC-4.2)", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const b = await crmTask(company.id, { subject: "B" });
    const blocked = await crmTask(company.id, { subject: "Blocked", blockedByIds: [a.id, b.id] });
    const open = await call("POST", `/activities/${blocked.id}/complete`, { as: "consultant" });
    expect(open.status).toBe(409);
    expect(open.json).toMatchObject({ code: "task_blocked" });
    expect(open.json.blockers).toHaveLength(2);
    expect(open.json.blockers).toContainEqual({ id: a.id, subject: "A" });
    expect(open.json.blockers).toContainEqual({ id: b.id, subject: "B" });
    expect((await db.activity.findUniqueOrThrow({ where: { id: blocked.id } })).completedAt).toBeNull();

    await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    expect((await call("POST", `/activities/${blocked.id}/complete`, { as: "consultant" })).status).toBe(409);
    await call("POST", `/activities/${b.id}/complete`, { as: "consultant" });
    expect((await call("POST", `/activities/${blocked.id}/complete`, { as: "consultant" })).json.task.completedAt).not.toBeNull();
    // reopening a blocker blocks an open task again, but never reopens a completed one
    await call("POST", `/activities/${a.id}/reopen`, { as: "consultant" });
    const after = await call("GET", `/activities?companyId=${company.id}&type=task&open=true`);
    expect(after.json.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
  });

  it("completing an already completed blocked task stays idempotent even if a blocker reopened", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const blocked = await crmTask(company.id, { subject: "Blocked", blockedByIds: [a.id] });
    await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    await call("POST", `/activities/${blocked.id}/complete`, { as: "consultant" });
    await call("POST", `/activities/${a.id}/reopen`, { as: "consultant" });
    const again = await call("POST", `/activities/${blocked.id}/complete`, { as: "consultant" });
    expect(again.status).toBe(200);
    expect(again.json.task.completedAt).not.toBeNull();
  });

  it("closing the last blocker tells the blocked task's assignee, in-app and by email, not the one who closed it (AC-6.3)", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const b = await crmTask(company.id, { subject: "B" });
    await crmTask(company.id, { subject: "Organise the call", assigneeUserId: "user-colleague", blockedByIds: [a.id, b.id] });
    events.length = 0;
    await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    expect(unblocked()).toHaveLength(0);
    await call("POST", `/activities/${b.id}/complete`, { as: "consultant" });
    expect(unblocked()).toHaveLength(1);
    expect(unblocked()[0]).toMatchObject({ kind: "task_unblocked", email: true, to: ["user-colleague"], href: "/crm/tasks", originApp: "crm" });
    expect(unblocked()[0]!.title).toContain("Organise the call");
    expect(unblocked()[0]!.body).toContain(`Company: ${company.name}`);
    // completing an already completed blocker announces nothing again
    await call("POST", `/activities/${b.id}/complete`, { as: "consultant" });
    expect(unblocked()).toHaveLength(1);
  });

  it("names the deal when the freed task hangs on one; never the person who completed it (AC-6.3)", async () => {
    const company = makeCompany();
    const deal = makeDeal(company.id, "Grid analytics");
    const a = await crmTask(company.id, { subject: "A" });
    // the assignee completes the blocker themselves: nobody is told
    await crmTask(company.id, { subject: "Mine", dealId: deal.id, assigneeUserId: "user-consultant", blockedByIds: [a.id] });
    await crmTask(company.id, { subject: "Theirs", dealId: deal.id, assigneeUserId: "user-colleague", blockedByIds: [a.id] });
    events.length = 0;
    await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    expect(unblocked().map((e) => e.to)).toEqual([["user-colleague"]]);
    expect(unblocked()[0]!.body).toContain("Deal: Grid analytics");
  });

  it("a blocked task already completed or reopened later is not announced; a still-blocked one is not", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    const b = await crmTask(company.id, { subject: "B" });
    const stillBlocked = await crmTask(company.id, { subject: "Waits on both", assigneeUserId: "user-colleague", blockedByIds: [a.id, b.id] });
    const onlyA = await crmTask(company.id, { subject: "Waits on A", assigneeUserId: "user-tech", blockedByIds: [a.id] });
    await call("POST", `/activities/${onlyA.id}/complete`, { as: "admin" }).then((r) => expect(r.status).toBe(409));
    events.length = 0;
    await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    expect(unblocked().map((e) => e.to)).toEqual([["user-tech"]]);
    expect(stillBlocked.task.blocked).toBe(true);
    // the freed task is closed by hand before the next blocker finishes: no second notice for it
    await call("POST", `/activities/${onlyA.id}/complete`, { as: "consultant" });
    events.length = 0;
    await call("POST", `/activities/${b.id}/complete`, { as: "consultant" });
    expect(unblocked().map((e) => e.to)).toEqual([["user-colleague"]]);
  });

  it("a notification outage never undoes the completion (best effort, AC-6.4)", async () => {
    const company = makeCompany();
    const a = await crmTask(company.id, { subject: "A" });
    await crmTask(company.id, { subject: "B", assigneeUserId: "user-colleague", blockedByIds: [a.id] });
    setNotifierForTests({
      async notify() {
        throw new Error("notify-api is down");
      },
    });
    const done = await call("POST", `/activities/${a.id}/complete`, { as: "consultant" });
    expect(done.status).toBe(200);
    expect(done.json.task.completedAt).not.toBeNull();
  });
});

describe("project task blockers (specs/20261110-activities AC-4.1..4.3)", () => {
  it("a project task waits on tasks of the same project (AC-4.1)", async () => {
    const project = makeProject();
    const survey = await projectTask(project.id, { subject: "Site survey" });
    const install = await projectTask(project.id, { subject: "Install", blockedByIds: [survey.id] });
    expect(install.task).toMatchObject({ blocked: true, blockedBy: [{ id: survey.id, subject: "Site survey", completed: false }] });
    expect(install.kind).toBe("operational");
    const row = await db.taskBlocker.findFirstOrThrow({ where: { blockedId: install.id } });
    expect(row).toMatchObject({ blockerId: survey.id, createdBy: "user-manager" });
  });

  it("a task of another project is not a blocker (blocker_not_in_host)", async () => {
    const mine = makeProject("Mine");
    const theirs = makeProject("Theirs");
    const foreign = await projectTask(theirs.id, { subject: "Elsewhere" });
    const refused = await call("POST", "/activities", {
      as: "manager",
      body: { type: "task", subject: "X", projectId: mine.id, blockedByIds: [foreign.id] },
    });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "blocker_not_in_host", field: "blockedByIds" });
    const own = await projectTask(mine.id, { subject: "Own" });
    const edit = await call("PATCH", `/activities/${own.id}`, { as: "manager", body: { blockedByIds: [foreign.id] } });
    expect(edit.json.code).toBe("blocker_not_in_host");
  });

  it("a pre-sales task is not a blocker of a project task, and the reverse (AC-4.1)", async () => {
    const project = makeProject();
    const company = makeCompany();
    const preSales = await crmTask(company.id, { subject: "Pre-sales" });
    const operational = await projectTask(project.id, { subject: "Operational" });

    const projectBlockedByCrm = await call("POST", "/activities", {
      as: "manager",
      body: { type: "task", subject: "X", projectId: project.id, blockedByIds: [preSales.id] },
    });
    expect(projectBlockedByCrm.status).toBe(422);
    expect(projectBlockedByCrm.json).toMatchObject({ code: "blocker_not_in_host", field: "blockedByIds" });

    // alice holds both: crm:access and manage on the project, so the refusal is the rule, not a permission
    const crmBlockedByProject = await call("POST", "/activities", {
      as: "alice",
      body: { type: "task", subject: "Y", companyId: company.id, blockedByIds: [operational.id] },
    });
    expect(crmBlockedByProject.status).toBe(422);
    expect(crmBlockedByProject.json).toMatchObject({ code: "blocker_not_in_host", field: "blockedByIds" });

    // …and by edit, in both directions
    const crmTaskOwn = await crmTask(company.id, { subject: "Own CRM" }, "alice");
    expect((await call("PATCH", `/activities/${crmTaskOwn.id}`, { as: "alice", body: { blockedByIds: [operational.id] } })).json.code).toBe(
      "blocker_not_in_host",
    );
    expect((await call("PATCH", `/activities/${operational.id}`, { as: "manager", body: { blockedByIds: [preSales.id] } })).json.code).toBe(
      "blocker_not_in_host",
    );
    expect(await db.taskBlocker.count()).toBe(0);
  });

  it("a project entity and a company with the same id are different entities", async () => {
    // ids are per host: a CRM task whose company id equals a project id must not count as that project's
    const project = makeProject();
    await db.activity.create({
      data: {
        kind: "pre_sales",
        type: "task",
        subject: "Lookalike",
        occurredAt: new Date(),
        hostApp: "crm",
        hostType: "company",
        hostId: project.id,
        authorUserId: "user-admin",
        assigneeUserId: "user-admin",
      },
    });
    const lookalike = await db.activity.findFirstOrThrow({ where: { subject: "Lookalike" } });
    const refused = await call("POST", "/activities", {
      as: "manager",
      body: { type: "task", subject: "X", projectId: project.id, blockedByIds: [lookalike.id] },
    });
    expect(refused.json.code).toBe("blocker_not_in_host");
  });

  it("refuses self, a cycle and more than ten; delete removes the edge (AC-4.3)", async () => {
    const project = makeProject();
    const a = await projectTask(project.id, { subject: "A" });
    const b = await projectTask(project.id, { subject: "B", blockedByIds: [a.id] });
    const c3 = await projectTask(project.id, { subject: "C", blockedByIds: [b.id] });
    const patch = (id: string, ids: string[]) => call("PATCH", `/activities/${id}`, { as: "manager", body: { blockedByIds: ids } });
    expect((await patch(a.id, [a.id])).json.code).toBe("blocker_is_self");
    expect((await patch(a.id, [b.id])).json.code).toBe("blocker_cycle");
    expect((await patch(a.id, [c3.id])).json.code).toBe("blocker_cycle");

    const many: string[] = [];
    for (let i = 0; i < 11; i++) many.push((await projectTask(project.id, { subject: `M${i}` })).id);
    expect((await patch(c3.id, many)).status).toBe(422);
    expect((await patch(c3.id, many.slice(0, 10))).status).toBe(200);

    expect((await call("DELETE", `/activities/${a.id}`, { as: "manager" })).status).toBe(204);
    const listed = await call("GET", `/activities?projectId=${project.id}&type=task`, { as: "manager" });
    const bView = listed.json.items.find((t: { id: string }) => t.id === b.id);
    expect(bView.task).toMatchObject({ blocked: false, blockedBy: [] });
  });

  it("blockers are edited by a manager of the project, nobody else; and not on a closed project", async () => {
    const project = makeProject();
    const a = await projectTask(project.id, { subject: "A" });
    const b = await projectTask(project.id, { subject: "B", assigneeUserId: "user-pm" });
    for (const as of ["pm", "member", "viewer"] as const) {
      expect((await call("PATCH", `/activities/${b.id}`, { as, body: { blockedByIds: [a.id] } })).status).toBe(403);
    }
    expect(await db.taskBlocker.count()).toBe(0);
    // a closed project is read-only for edits, so blockers cannot be changed
    const closed = makeProject("Closed", { writable: false });
    const task = await db.activity.create({
      data: { kind: "operational", type: "task", subject: "T", occurredAt: new Date(), hostApp: "projects", hostType: "project", hostId: closed.id, authorUserId: "user-manager", assigneeUserId: "user-manager" },
    });
    const refused = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { blockedByIds: [] } });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("host_read_only");
  });

  it("a blocked project task answers 409 task_blocked with the blockers; the assignee completes it once they close (AC-4.2)", async () => {
    const project = makeProject();
    const a = await projectTask(project.id, { subject: "Survey", assigneeUserId: "user-member" });
    const b = await projectTask(project.id, { subject: "Permits" });
    const blocked = await projectTask(project.id, { subject: "Install", assigneeUserId: "user-pm", blockedByIds: [a.id, b.id] });
    const refused = await call("POST", `/activities/${blocked.id}/complete`, { as: "pm" });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "task_blocked" });
    expect(refused.json.blockers.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(refused.json.blockers.find((x: { id: string }) => x.id === a.id)).toEqual({ id: a.id, subject: "Survey" });

    // The assignee of a blocker closes it; the manager closes the other; then the blocked one's assignee can.
    expect((await call("POST", `/activities/${a.id}/complete`, { as: "member" })).status).toBe(200);
    expect((await call("POST", `/activities/${blocked.id}/complete`, { as: "pm" })).status).toBe(409);
    expect((await call("POST", `/activities/${b.id}/complete`, { as: "manager" })).status).toBe(200);
    const done = await call("POST", `/activities/${blocked.id}/complete`, { as: "pm" });
    expect(done.status).toBe(200);
    expect(done.json.task).toMatchObject({ blocked: false, completedBy: { id: "user-pm" } });
  });

  it("a blocked task cannot be completed even by a manager, nor on a closed project (AC-4.2, AC-3.8)", async () => {
    const project = makeProject("Closed soon");
    const a = await projectTask(project.id, { subject: "A" });
    const blocked = await projectTask(project.id, { subject: "B", blockedByIds: [a.id] });
    hosts_closed(project.id);
    const refused = await call("POST", `/activities/${blocked.id}/complete`, { as: "manager" });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("task_blocked");
  });

  it("closing the last blocker tells the blocked task's assignee, with the project as context (AC-6.3)", async () => {
    const project = makeProject("Smart meter rollout");
    const a = await projectTask(project.id, { subject: "Survey" });
    const b = await projectTask(project.id, { subject: "Permits" });
    await projectTask(project.id, { subject: "Install", assigneeUserId: "user-pm", blockedByIds: [a.id, b.id] });
    events.length = 0;
    await call("POST", `/activities/${a.id}/complete`, { as: "manager" });
    expect(unblocked()).toHaveLength(0);
    await call("POST", `/activities/${b.id}/complete`, { as: "manager" });
    expect(unblocked()).toHaveLength(1);
    expect(unblocked()[0]).toMatchObject({
      kind: "task_unblocked",
      to: ["user-pm"],
      email: true,
      originApp: "projects",
      href: `/projects/${project.id}`,
    });
    expect(unblocked()[0]!.title).toBe("You can go ahead: Install");
    expect(unblocked()[0]!.body).toBe("Name of user-manager completed the last task this one was waiting on. Project: Smart meter rollout.");
  });

  it("the person who completes the last blocker is never told, even as the blocked task's assignee", async () => {
    const project = makeProject();
    const a = await projectTask(project.id, { subject: "A", assigneeUserId: "user-pm" });
    await projectTask(project.id, { subject: "B", assigneeUserId: "user-pm", blockedByIds: [a.id] });
    events.length = 0;
    expect((await call("POST", `/activities/${a.id}/complete`, { as: "pm" })).status).toBe(200);
    expect(unblocked()).toHaveLength(0);
  });
});

/** The project host reports the entity closed from now on (AC-3.8). */
function hosts_closed(projectId: string): void {
  hosts.projects.setEntity(projectId, {
    label: "Closed soon",
    href: `/projects/${projectId}`,
    assignees: ["user-pm", "user-member"],
    writable: false,
    may: { write: false, manage: false },
    mayFor: { "user-manager": { write: true, manage: true } },
  });
}
