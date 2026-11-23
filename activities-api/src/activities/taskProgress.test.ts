/**
 * A task in progress (specs/20261110-activities US-10): open → in progress → done, by whoever may mark it done; a
 * blocked task cannot be started; reopening makes it open; the lists' `in_progress` filter.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, makeProject, resetWorld, type PersonaName } from "../test-support/world";

beforeEach(resetWorld);

type Task = { id: string; task: { status: string; startedAt: string | null; startedBy: { id: string } | null; completedAt: string | null } };

async function crmTask(as: PersonaName = "consultant", extra: Record<string, unknown> = {}, companyId?: string) {
  const company = companyId ?? (await makeCompany("Acme SA")).id;
  const res = await call("POST", "/activities", { as, body: { type: "task", subject: "Prepare the demo", companyId: company, ...extra } });
  expect(res.status).toBe(201);
  return res.json as Task & { company: { id: string } };
}

const act = (id: string, action: "start" | "stop" | "complete" | "reopen", as: PersonaName = "consultant") =>
  call("POST", `/activities/${id}/${action}`, { as });

describe("a task in progress (US-10)", () => {
  it("is open when created; start makes it in progress with who and when; stop makes it open again", async () => {
    const task = await crmTask();
    expect(task.task).toMatchObject({ status: "open", startedAt: null, startedBy: null });

    const started = await act(task.id, "start", "colleague");
    expect(started.status).toBe(200);
    expect(started.json.task).toMatchObject({ status: "in_progress", startedBy: { id: "user-colleague" } });
    expect(started.json.task.startedAt).not.toBeNull();

    const stopped = await act(task.id, "stop");
    expect(stopped.status).toBe(200);
    expect(stopped.json.task).toMatchObject({ status: "open", startedAt: null, startedBy: null });
  });

  it("starting an in-progress task or stopping an open one changes nothing (AC-10.3)", async () => {
    const task = await crmTask();
    const first = await act(task.id, "start", "colleague");
    const again = await act(task.id, "start", "consultant");
    expect(again.status).toBe(200);
    expect(again.json.task.startedBy).toEqual(first.json.task.startedBy);
    expect(again.json.task.startedAt).toBe(first.json.task.startedAt);

    const open = await crmTask();
    expect((await act(open.id, "stop")).json.task.status).toBe("open");
  });

  it("done is reached from in progress or straight from open; reopening always lands on open (AC-10.1)", async () => {
    const task = await crmTask();
    await act(task.id, "start");
    const done = await act(task.id, "complete");
    expect(done.json.task.status).toBe("done");
    const reopened = await act(task.id, "reopen");
    expect(reopened.json.task).toMatchObject({ status: "open", startedAt: null, completedAt: null });

    const direct = await crmTask();
    expect((await act(direct.id, "complete")).json.task.status).toBe("done");
  });

  it("a done task is neither started nor stopped: 409 task_done (AC-10.3)", async () => {
    const task = await crmTask();
    await act(task.id, "complete");
    for (const action of ["start", "stop"] as const) {
      const refused = await act(task.id, action);
      expect(refused.status).toBe(409);
      expect(refused.json.code).toBe("task_done");
    }
  });

  it("a blocked task cannot be started, and an in-progress blocker still blocks (AC-10.2)", async () => {
    const blocker = await crmTask();
    const waiting = await crmTask("consultant", { blockedByIds: [blocker.id] }, blocker.company.id);
    await act(blocker.id, "start");
    const refused = await act(waiting.id, "start");
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe("task_blocked");
    expect((await act(waiting.id, "complete")).status).toBe(409);

    await act(blocker.id, "complete");
    expect((await act(waiting.id, "start")).json.task.status).toBe("in_progress");
  });

  it("only a task can be started", async () => {
    const company = await makeCompany();
    const note = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "x", companyId: company.id } });
    expect((await act(note.json.id, "start")).status).toBe(422);
  });

  it("on a project, the assignee or a manager starts it; another reader may not (AC-3.3)", async () => {
    const project = makeProject();
    const created = await call("POST", "/activities", {
      as: "manager",
      body: { type: "task", subject: "Deploy", projectId: project.id, assigneeUserId: "user-member" },
    });
    expect(created.status).toBe(201);
    expect((await act(created.json.id, "start", "viewer")).status).toBe(403);
    expect((await act(created.json.id, "start", "member")).json.task.status).toBe("in_progress");
    expect((await act(created.json.id, "stop", "manager")).json.task.status).toBe("open");
  });

  it("lists: open includes in progress, in_progress only those, done only done (AC-10.4)", async () => {
    const company = await makeCompany();
    const open = await crmTask("consultant", {}, company.id);
    const started = await crmTask("consultant", {}, company.id);
    const done = await crmTask("consultant", {}, company.id);
    await act(started.id, "start");
    await act(done.id, "complete");
    const ids = async (status: string) =>
      (await call("GET", `/tasks?status=${status}`, { as: "consultant" })).json.items.map((item: { id: string }) => item.id).sort();
    expect(await ids("open")).toEqual([open.id, started.id].sort());
    expect(await ids("in_progress")).toEqual([started.id]);
    expect(await ids("done")).toEqual([done.id]);
  });

  it("the database keeps started fields on tasks only, and in pairs", async () => {
    const company = await makeCompany();
    const note = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "x", companyId: company.id } });
    const onNote = await db.activity
      .update({ where: { id: note.json.id }, data: { startedAt: new Date(), startedByUserId: "user-consultant" } })
      .then(() => null, (error: unknown) => error);
    expect(String(onNote)).toContain("activity_started_only_on_tasks");
    const task = await crmTask("consultant", {}, company.id);
    const half = await db.activity
      .update({ where: { id: task.id }, data: { startedAt: new Date() } })
      .then(() => null, (error: unknown) => error);
    expect(String(half)).toContain("activity_started_pair");
  });
});
