/**
 * QE exploratory probes (specs/028), contract edges the feature tests do not name. Each case states the
 * expectation from the spec; a failure here is a defect, not a test to adjust.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, makeProject, resetWorld, type PersonaName } from "./test-support/world";

beforeEach(resetWorld);

const create = (body: Record<string, unknown>, as: PersonaName = "manager") =>
  call("POST", "/activities", { as, body: { type: "task", subject: "T", ...body } });

describe("targets of a create (AC-3.6, plan § API contracts)", () => {
  it("exactly one of companyId / projectId: both, or neither, is a 422 and writes nothing", async () => {
    const project = makeProject();
    const company = makeCompany();
    expect((await create({ projectId: project.id, companyId: company.id })).status).toBe(422);
    expect((await create({})).status).toBe(422);
    expect(await db.activity.count()).toBe(0);
  });

  it("a calendar-invalid or malformed due date is a 422, a valid one is accepted", async () => {
    const project = makeProject();
    expect((await create({ projectId: project.id, dueDate: "2026-02-30" })).status).toBe(422);
    expect((await create({ projectId: project.id, dueDate: "not-a-date" })).status).toBe(422);
    expect((await create({ projectId: project.id, dueDate: "2026-12-31" })).status).toBe(201);
  });

  it("an unknown blocker id is refused, not ignored, and nothing is written", async () => {
    const project = makeProject();
    const res = await create({ projectId: project.id, blockedByIds: ["does-not-exist"] });
    expect(res.status).toBe(422);
    expect(await db.activity.count()).toBe(0);
  });

  it("paging is bounded: pageSize 101 and page 0 are 422", async () => {
    const project = makeProject();
    expect((await call("GET", `/tasks?projectId=${project.id}&pageSize=101`, { as: "viewer" })).status).toBe(422);
    expect((await call("GET", `/tasks?projectId=${project.id}&page=0`, { as: "viewer" })).status).toBe(422);
  });
});

describe("a project task is not editable into something else (AC-3.6)", () => {
  it("PATCH cannot give it a body type, a company, a contact or a deal", async () => {
    const project = makeProject();
    const task = (await create({ projectId: project.id })).json;
    for (const patch of [{ type: "note" }, { companyId: "x" }, { contactId: "x" }, { dealId: "x" }, { projectId: "other" }, { kind: "pre_sales" }]) {
      const res = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: patch });
      expect([422, 400]).toContain(res.status);
    }
    const row = await db.activity.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ kind: "operational", type: "task", hostApp: "projects", contactId: null, dealId: null });
  });
});

describe("completion on a project task by someone who is neither assignee nor manager (AC-3.3)", () => {
  it("a team member who is not the assignee gets 403 on complete and on reopen, and nothing changes", async () => {
    const project = makeProject();
    const task = (await create({ projectId: project.id, assigneeUserId: "user-pm" })).json;
    expect((await call("POST", `/activities/${task.id}/complete`, { as: "member" })).status).toBe(403);
    expect((await call("POST", `/activities/${task.id}/complete`, { as: "pm" })).status).toBe(200);
    expect((await call("POST", `/activities/${task.id}/reopen`, { as: "member" })).status).toBe(403);
    expect((await db.activity.findUniqueOrThrow({ where: { id: task.id } })).completedByUserId).toBe("user-pm");
  });

  it("a note cannot be completed (not_a_task)", async () => {
    const company = makeCompany();
    const note = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "n", companyId: company.id, occurredAt: "2026-10-01T09:00:00Z" } });
    const res = await call("POST", `/activities/${note.json.id}/complete`, { as: "consultant" });
    expect(res.status).toBe(422);
  });
});
