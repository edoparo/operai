/**
 * QE (specs/20261110-activities AC-2.5): while the pause is on nothing can be recorded or changed, what was recorded before
 * the pause is still there afterwards, unchanged, and recording works again once the pause is lifted.
 * src/lib/maintenance.test.ts pins the 503 on every route; this pins the DATA half of the criterion.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, makeProject, resetWorld, withMaintenance } from "./test-support/world";

beforeEach(resetWorld);

describe("AC-2.5 pause keeps what was recorded and refuses everything new", () => {
  it("a CRM task and a project task survive a pause untouched; writes during it change nothing; they work again after", async () => {
    const project = makeProject();
    const company = makeCompany();
    const projectTask = (await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "Project task", projectId: project.id } })).json;
    const crmTask = (await call("POST", "/activities", { as: "consultant", body: { type: "task", subject: "CRM task", companyId: company.id } })).json;
    expect(projectTask.id).toBeTruthy();
    expect(crmTask.id).toBeTruthy();

    const snapshot = async () => ({
      activities: await db.activity.findMany({ orderBy: { id: "asc" } }),
      participants: await db.activityParticipant.findMany({ orderBy: [{ activityId: "asc" }, { userId: "asc" }] }),
      blockers: await db.taskBlocker.findMany({ orderBy: [{ blockedId: "asc" }, { blockerId: "asc" }] }),
    });
    const before = await snapshot();
    expect(before.activities).toHaveLength(2);

    await withMaintenance(async () => {
      const attempts: Array<[string, string, Record<string, unknown>?]> = [
        ["POST", "/activities", { type: "task", subject: "New", projectId: project.id }],
        ["PATCH", `/activities/${projectTask.id}`, { subject: "Changed" }],
        ["POST", `/activities/${projectTask.id}/complete`],
        ["POST", `/activities/${crmTask.id}/complete`],
        ["DELETE", `/activities/${crmTask.id}`],
      ];
      for (const [method, path, body] of attempts) {
        const res = await call(method, path, { as: "manager", ...(body ? { body } : {}) });
        expect(res.status).toBe(503);
        expect(res.json.code).toBe("maintenance");
      }
      // Reads are paused too (the CRM says "unavailable"), they do not leak a half-moved picture.
      expect((await call("GET", `/tasks?projectId=${project.id}`, { as: "manager" })).status).toBe(503);
      expect(await snapshot()).toEqual(before);
    });

    // Lifted: the same rows are there, unchanged, and recording and changing work again.
    expect(await snapshot()).toEqual(before);
    const list = await call("GET", `/tasks?projectId=${project.id}`, { as: "manager" });
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).toContain(projectTask.id);
    expect((await call("POST", `/activities/${projectTask.id}/complete`, { as: "manager" })).status).toBe(200);
    expect((await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "After", projectId: project.id } })).status).toBe(201);
  });
});
