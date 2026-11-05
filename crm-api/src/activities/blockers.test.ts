import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { call, estimaiNotice, makeCompany, makeDeal, resetWorld } from "../test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "../lib/notify";

/** specs/017 US-6: a task blocked by other tasks of the same company. */
describe("task blockers (US-6)", () => {
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

  const task = async (companyId: string, extra: Record<string, unknown> = {}, as: "admin" | "salesCh" = "admin") => {
    const res = await call("POST", "/activities", { as, body: { type: "task", subject: "Task", companyId, ...extra } });
    expect(res.status).toBe(201);
    return res.json;
  };

  it("a task waits on tasks of the same company; the view says which and whether it is blocked (AC-6.1)", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id);
    const estimate = await task(company.id, { subject: "Estimate", dealId: deal.id });
    const call_ = await task(company.id, { subject: "Organise the call", blockedByIds: [estimate.id] });
    expect(call_.task).toMatchObject({ blocked: true, blockedBy: [{ id: estimate.id, subject: "Estimate", completed: false }] });

    const other = await makeCompany();
    const foreign = await task(other.id);
    const refused = await call("POST", "/activities", {
      body: { type: "task", subject: "X", companyId: company.id, blockedByIds: [foreign.id] },
    });
    expect(refused.json).toMatchObject({ status: 422, code: "blocker_not_in_company", field: "blockedByIds" });
    const note = await call("POST", "/activities", { body: { type: "note", subject: "N", companyId: company.id } });
    expect(
      (await call("POST", "/activities", { body: { type: "task", subject: "X", companyId: company.id, blockedByIds: [note.json.id] } })).json.code,
    ).toBe("blocker_not_in_company");
    expect(
      (await call("POST", "/activities", { body: { type: "note", subject: "X", companyId: company.id, blockedByIds: [estimate.id] } })).json.code,
    ).toBe("task_fields_on_non_task");
  });

  it("refuses a task blocking itself or a cycle; an edit replaces the whole set (AC-6.1)", async () => {
    const company = await makeCompany();
    const a = await task(company.id, { subject: "A" });
    const b = await task(company.id, { subject: "B", blockedByIds: [a.id] });
    expect((await call("PATCH", `/activities/${a.id}`, { body: { blockedByIds: [a.id] } })).json.code).toBe("blocker_is_self");
    expect((await call("PATCH", `/activities/${a.id}`, { body: { blockedByIds: [b.id] } })).json.code).toBe("blocker_cycle");
    const c2 = await task(company.id, { subject: "C", blockedByIds: [b.id] });
    expect((await call("PATCH", `/activities/${a.id}`, { body: { blockedByIds: [c2.id] } })).json.code).toBe("blocker_cycle");
    const cleared = await call("PATCH", `/activities/${b.id}`, { body: { blockedByIds: [] } });
    expect(cleared.json.task).toMatchObject({ blocked: false, blockedBy: [] });
  });

  it("a blocked task cannot be completed (409 task_blocked); once its blockers close it can (AC-6.2)", async () => {
    const company = await makeCompany();
    const a = await task(company.id, { subject: "A" });
    const b = await task(company.id, { subject: "B" });
    const blocked = await task(company.id, { subject: "Blocked", blockedByIds: [a.id, b.id] });
    const refused = await call("POST", `/activities/${blocked.id}/complete`, { as: "salesCh" });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: "task_blocked" });
    expect(refused.json.blockers).toHaveLength(2);
    await call("POST", `/activities/${a.id}/complete`);
    expect((await call("POST", `/activities/${blocked.id}/complete`)).status).toBe(409);
    await call("POST", `/activities/${b.id}/complete`);
    expect((await call("POST", `/activities/${blocked.id}/complete`)).json.task.completedAt).not.toBeNull();
    // reopening a blocker blocks an open task again, but never reopens a completed one
    await call("POST", `/activities/${a.id}/reopen`);
    const after = await call("GET", `/activities?companyId=${company.id}&type=task&open=true`);
    expect(after.json.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
  });

  it("closing the last blocker tells the blocked task's assignee, in-app and by email (AC-6.3)", async () => {
    const company = await makeCompany();
    const a = await task(company.id, { subject: "A" });
    const b = await task(company.id, { subject: "B" });
    await task(company.id, { subject: "Organise the call", assigneeUserId: "user-sales-ch", blockedByIds: [a.id, b.id] });
    events.length = 0;
    await call("POST", `/activities/${a.id}/complete`);
    expect(events).toHaveLength(0);
    await call("POST", `/activities/${b.id}/complete`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "task_unblocked", email: true, to: ["user-sales-ch"], href: "/crm/tasks" });
    expect(events[0]!.title).toContain("Organise the call");
    // completing an already completed blocker announces nothing again
    await call("POST", `/activities/${b.id}/complete`);
    expect(events).toHaveLength(1);
  });

  it("marking the estimate ready closes its task and frees the tasks waiting on it", async () => {
    const company = await makeCompany();
    const deal = await makeDeal(company.id, { stage: "qualified" });
    await call("POST", `/deals/${deal.id}/estimate`, { body: { technicalUserId: "user-tech" } });
    const estimateTask = (await call("GET", `/activities?dealId=${deal.id}&type=task`)).json.items[0];
    expect(estimateTask.subject).toContain("Estimate");
    await task(company.id, { subject: "Call Avanzato", assigneeUserId: "user-sales-ch", dealId: deal.id, blockedByIds: [estimateTask.id] });
    events.length = 0;
    await estimaiNotice(deal.id);
    const unblocked = events.filter((e) => e.kind === "task_unblocked");
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0]!.to).toEqual(["user-sales-ch"]);
  });
});
