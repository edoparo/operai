/**
 * Who sees the details of a CRM activity (specs/20261110-activities US-9): its text, a task's description and files
 * are sent only to who the author chose — everyone, the sales team (the CRM's `salesTeam` answer) or only the author
 * and a task's assignee. Everything else about the activity stays visible to every reader (AC-9.2); no role overrides
 * the choice (AC-9.3); a host that does not say `salesTeam` is "not in the team" (AC-9.4).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, hosts, makeCompany, makeProject, resetWorld, type PersonaName } from "../test-support/world";
import { useFakeStorage, type FakeStorage } from "../test-support/storage";

let storage: FakeStorage;
beforeEach(async () => {
  await resetWorld();
  storage = useFakeStorage();
  // The sales team, as crm-api would answer: `admin` and `alice` manage deals; `consultant`, `colleague`, `tech` do not.
  hosts.crm.setSalesTeam("user-admin", true);
  hosts.crm.setSalesTeam("user-alice", true);
});

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

type View = {
  id: string;
  subject: string;
  body: string | null;
  detailsVisibility: string;
  detailsHidden: boolean;
  task: { description: unknown; files: unknown[]; assignee: { id: string } | null } | null;
};

async function create(as: PersonaName, body: Record<string, unknown>) {
  const company = await makeCompany("Acme SA");
  const res = await call("POST", "/activities", { as, body: { companyId: company.id, ...body } });
  expect(res.status).toBe(201);
  return res.json as View & { company: { id: string } };
}

const seenBy = async (as: PersonaName, activity: { id: string; company: { id: string } }): Promise<View> => {
  const list = await call("GET", `/activities?companyId=${activity.company.id}`, { as });
  expect(list.status).toBe(200);
  return list.json.items.find((item: View) => item.id === activity.id);
};

async function attach(activityId: string, as: PersonaName) {
  const started = await call("POST", `/activities/${activityId}/files`, {
    as,
    body: { kind: "attachment", fileName: "offer.pdf", contentType: "application/pdf", sizeBytes: 2048 },
  });
  expect(started.status).toBe(201);
  storage.upload(started.json.upload.fields.key, 2048, "application/pdf");
  const confirmed = await call("POST", `/activities/${activityId}/files/${started.json.fileId}/confirm`, { as });
  expect(confirmed.status).toBe(200);
  return confirmed.json as { id: string };
}

describe("details visibility (US-9)", () => {
  it("is `everyone` by default: every reader sees the details, as before", async () => {
    const note = await create("consultant", { type: "note", subject: "Call notes", body: "Budget is 80k" });
    expect(note).toMatchObject({ detailsVisibility: "everyone", detailsHidden: false, body: "Budget is 80k" });
    expect(await seenBy("tech", note)).toMatchObject({ detailsHidden: false, body: "Budget is 80k" });
  });

  it("`sales_team`: the sales team and the author see the details; another reader sees the activity without them (AC-9.2)", async () => {
    const note = await create("consultant", { type: "note", subject: "Pricing", body: "Discount up to 15%", detailsVisibility: "sales_team" });
    expect(note).toMatchObject({ detailsVisibility: "sales_team", detailsHidden: false, body: "Discount up to 15%" });
    expect(await seenBy("alice", note)).toMatchObject({ detailsHidden: false, body: "Discount up to 15%" });
    expect(await seenBy("admin", note)).toMatchObject({ detailsHidden: false, body: "Discount up to 15%" });
    const tech = await seenBy("tech", note);
    expect(tech).toMatchObject({ subject: "Pricing", detailsVisibility: "sales_team", detailsHidden: true, body: null });
  });

  it("`author` on a task: the author and the assignee only; not the sales team, not an admin (AC-9.3)", async () => {
    const task = await create("consultant", {
      type: "task",
      subject: "Prepare the offer",
      description: doc("Client's margin is 4%"),
      assigneeUserId: "user-colleague",
      detailsVisibility: "author",
    });
    expect((await seenBy("colleague", task)).task!.description).toEqual(doc("Client's margin is 4%"));
    for (const who of ["alice", "admin", "tech"] as const) {
      const view = await seenBy(who, task);
      expect(view).toMatchObject({ subject: "Prepare the offer", detailsHidden: true });
      expect(view.task).toMatchObject({ description: null, files: [], assignee: { id: "user-colleague" } });
    }
  });

  it("a task's files are withheld from the view and their download is a 404, the same as a missing file (AC-9.2)", async () => {
    const task = await create("consultant", { type: "task", subject: "Contract", detailsVisibility: "author" });
    const file = await attach(task.id, "consultant");
    expect((await seenBy("consultant", task)).task!.files).toHaveLength(1);
    expect((await seenBy("tech", task)).task!.files).toEqual([]);
    expect((await call("GET", `/activities/${task.id}/files/${file.id}/url`, { as: "consultant" })).status).toBe(200);
    const hidden = await call("GET", `/activities/${task.id}/files/${file.id}/url`, { as: "tech" });
    const missing = await call("GET", `/activities/${task.id}/files/${crypto.randomUUID()}/url`, { as: "tech" });
    expect(hidden.status).toBe(404);
    // The same problem as a file that does not exist (only `instance`, the request path, differs).
    const { instance: _a, ...hiddenProblem } = hidden.json;
    const { instance: _b, ...missingProblem } = missing.json;
    expect(hiddenProblem).toEqual(missingProblem);
  });

  it("a host that does not say `salesTeam` is not the sales team (AC-9.4, fail closed)", async () => {
    const note = await create("consultant", { type: "note", subject: "Pricing", body: "Secret", detailsVisibility: "sales_team" });
    hosts.crm.mode = {
      body: { reader: true, items: [{ id: note.company.id, state: "open", writable: true, label: "Acme SA", href: `/crm/companies/${note.company.id}`, may: { write: true, manage: true } }], related: [] },
    };
    expect(await seenBy("alice", note)).toMatchObject({ detailsHidden: true, body: null });
    // the author still sees their own
    expect(await seenBy("consultant", note)).toMatchObject({ detailsHidden: false, body: "Secret" });
  });

  it("the My tasks list withholds them too", async () => {
    await create("consultant", { type: "task", subject: "Call back", description: doc("Home number"), assigneeUserId: "user-tech", detailsVisibility: "sales_team" });
    const mine = await call("GET", "/tasks?assignee=user-tech&kind=pre_sales", { as: "colleague" });
    expect(mine.status).toBe(200);
    expect(mine.json.items[0]).toMatchObject({ subject: "Call back", detailsHidden: true, task: { description: null } });
  });

  it("only the author changes it; an unchanged value from someone else is not a change", async () => {
    const note = await create("consultant", { type: "note", subject: "Pricing", body: "x" });
    const changed = await call("PATCH", `/activities/${note.id}`, { as: "consultant", body: { detailsVisibility: "author" } });
    expect(changed.status).toBe(200);
    expect(changed.json.detailsVisibility).toBe("author");
    expect((await db.activity.findUniqueOrThrow({ where: { id: note.id } })).detailsVisibility).toBe("author");
    // In the CRM only the author edits at all: another caller is refused before the field is looked at.
    expect((await call("PATCH", `/activities/${note.id}`, { as: "alice", body: { detailsVisibility: "everyone" } })).status).toBe(403);
  });

  it("refuses an unknown value", async () => {
    const company = await makeCompany();
    const res = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "x", companyId: company.id, detailsVisibility: "admins" } });
    expect(res.status).toBe(422);
  });

  it("a project task has no such choice: 422 field_not_allowed, and it is always `everyone`", async () => {
    const project = makeProject();
    const refused = await call("POST", "/activities", {
      as: "manager",
      body: { type: "task", subject: "Deploy", projectId: project.id, detailsVisibility: "author" },
    });
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe("field_not_allowed");
    const created = await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "Deploy", projectId: project.id } });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ detailsVisibility: "everyone", detailsHidden: false });
  });

  it("the database refuses a restricted project task (CHECK activity_details_visibility_crm_only)", async () => {
    const project = makeProject();
    const created = await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "Deploy", projectId: project.id } });
    const refused = await db.activity
      .update({ where: { id: created.json.id }, data: { detailsVisibility: "author" } })
      .then(() => null, (error: unknown) => error);
    expect(String(refused)).toContain("activity_details_visibility_crm_only");
  });
});
