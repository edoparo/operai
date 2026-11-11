/**
 * Project tasks (specs/028 US-3, US-5, US-6; AC-3.1..3.3, 3.6..3.8, 5.1, 5.2, 6.1, 6.2, 8.1..8.3),
 * against the projects test host. Same routes and same code as the CRM's; the differences are the
 * registry's data and the host's answer, which is what these tests pin.
 *
 * In the world's default project: `user-manager` and `user-alice` manage it, `user-pm` and
 * `user-member` are its manager and team (assignable), `user-viewer` only reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appAccess, authStub, call, db, hosts, makeCompany, makeProject, resetWorld, type PersonaName } from "../test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "../lib/notify";
import { renderNotification } from "../lib/notificationCopy";
import { RESOLVE_TIMEOUT_MS } from "../hosts/client";

beforeEach(resetWorld);

const create = (projectId: string, body: Record<string, unknown> = {}, as: PersonaName = "manager") =>
  call("POST", "/activities", { as, body: { type: "task", subject: "Install the gateways", projectId, ...body } });

describe("creating a project task (AC-3.1, AC-3.2)", () => {
  it("is a task of the project, operational, with no company; the assignee defaults to its author", async () => {
    const project = makeProject("Smart meter rollout");
    const res = await create(project.id, { dueDate: "2026-12-01" });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      kind: "operational",
      type: "task",
      subject: "Install the gateways",
      company: null,
      contact: null,
      deal: null,
      project: { id: project.id, name: "Smart meter rollout" },
      author: { id: "user-manager" },
      task: { dueDate: "2026-12-01", assignee: { id: "user-manager" }, completedAt: null, blocked: false },
      may: { edit: true, delete: true, complete: true },
    });
    const row = await db.activity.findUniqueOrThrow({ where: { id: res.json.id } });
    expect(row).toMatchObject({ hostApp: "projects", hostType: "project", hostId: project.id, kind: "operational" });
  });

  it("an explicit assignee must be the project's manager or a team member", async () => {
    const project = makeProject();
    expect((await create(project.id, { assigneeUserId: "user-pm" })).json.task.assignee.id).toBe("user-pm");
    expect((await create(project.id, { assigneeUserId: "user-member" })).status).toBe(201);
    const refused = await create(project.id, { assigneeUserId: "user-viewer" });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "assignee_not_on_project", field: "assigneeUserId" });
    // Even the caller: naming yourself is a choice, and it is checked like any other.
    expect((await create(project.id, { assigneeUserId: "user-manager" })).json.code).toBe("assignee_not_on_project");
    // The check is the host's list: auth is not asked.
    expect(authStub.accessChecks).toEqual([]);
    expect(await db.activity.count()).toBe(2);
  });

  it("requires the manage capability for the project's entity, and refuses without changing anything", async () => {
    const project = makeProject();
    for (const as of ["pm", "member", "viewer"] as const) {
      const res = await create(project.id, {}, as);
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("forbidden");
    }
    expect(await db.activity.count()).toBe(0);
  });

  it("is per project: the capability for another project's entity is not this one's", async () => {
    const mine = makeProject("Mine");
    const theirs = makeProject("Theirs", { mayFor: { "user-manager": { write: false, manage: false } } });
    expect((await create(mine.id)).status).toBe(201);
    expect((await create(theirs.id)).status).toBe(403);
  });

  it("is never a note, call, meeting or email, and has no company, contact or deal (AC-3.6)", async () => {
    const project = makeProject();
    for (const type of ["note", "call", "meeting", "email"]) {
      const res = await create(project.id, { type });
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "type_not_allowed", field: "type" });
    }
    expect((await create(project.id, { contactId: "ct-1" })).json).toMatchObject({ code: "field_not_allowed", field: "contactId" });
    expect((await create(project.id, { dealId: "dl-1" })).json).toMatchObject({ code: "field_not_allowed", field: "dealId" });
    const company = makeCompany();
    expect((await create(project.id, { companyId: company.id })).status).toBe(422);
    expect((await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "No entity" } })).status).toBe(422);
    expect(await db.activity.count()).toBe(0);
  });

  it("a project that does not exist, or that the caller cannot read, is a 404", async () => {
    const project = makeProject();
    hosts.projects.setReader("user-outsider", false);
    const unknown = await create("pr-nobody");
    const unreadable = await create(project.id, {}, "outsider");
    expect(unknown.status).toBe(404);
    expect(unreadable.status).toBe(404);
    const { instance: _a, ...a } = unknown.json;
    const { instance: _b, ...b } = unreadable.json;
    expect(a).toEqual(b);
  });
});

describe("editing, reassigning and deleting (AC-3.2, AC-3.7)", () => {
  it("any manager of the entity may, not only the author; nobody else", async () => {
    const project = makeProject();
    const task = (await create(project.id, {}, "alice")).json;
    // A different manager edits what alice created (the CRM's author-only rule is not the project's).
    const edited = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { subject: "Renamed", dueDate: "2026-12-24" } });
    expect(edited.status).toBe(200);
    expect(edited.json).toMatchObject({ subject: "Renamed", task: { dueDate: "2026-12-24" } });
    for (const as of ["pm", "member", "viewer"] as const) {
      const patch = await call("PATCH", `/activities/${task.id}`, { as, body: { subject: "Nope" } });
      expect(patch.status).toBe(403);
      expect(patch.json.code).toBe("forbidden");
      expect((await call("DELETE", `/activities/${task.id}`, { as })).status).toBe(403);
    }
    expect((await db.activity.findUniqueOrThrow({ where: { id: task.id } })).subject).toBe("Renamed");
    expect((await call("DELETE", `/activities/${task.id}`, { as: "manager" })).status).toBe(204);
    expect(await db.activity.count()).toBe(0);
  });

  it("the view says who may: a manager, the assignee, a team member, a reader (design G4)", async () => {
    const project = makeProject();
    await create(project.id, { assigneeUserId: "user-pm" });
    const may = async (as: PersonaName) =>
      (await call("GET", `/activities?projectId=${project.id}`, { as })).json.items[0].may;
    expect(await may("manager")).toEqual({ edit: true, delete: true, complete: true });
    expect(await may("pm")).toEqual({ edit: false, delete: false, complete: true });
    expect(await may("member")).toEqual({ edit: false, delete: false, complete: false });
    expect(await may("viewer")).toEqual({ edit: false, delete: false, complete: false });
  });

  it("reassigning is checked against the team, and only when the assignee CHANGES (AC-3.7)", async () => {
    const project = makeProject();
    const task = (await create(project.id, { assigneeUserId: "user-pm" })).json;
    // The project manager changes: user-pm leaves the list. The task keeps its assignee and stays listed.
    hosts.projects.setEntity(project.id, {
      label: "Smart meter rollout",
      href: `/projects/${project.id}`,
      assignees: ["user-member", "user-new-pm"],
      mayFor: { "user-manager": { write: true, manage: true } },
    });
    const listed = await call("GET", `/activities?projectId=${project.id}`, { as: "viewer" });
    expect(listed.json.items.map((t: { id: string }) => t.id)).toEqual([task.id]);

    // Resent unchanged along with another edit: accepted.
    const resent = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { subject: "Renamed", assigneeUserId: "user-pm" } });
    expect(resent.status).toBe(200);
    expect(resent.json.task.assignee.id).toBe("user-pm");
    // The project's rule is the host's list: nobody is asked, and a resent assignee who has since lost
    // access to the tool altogether is still accepted (unlike the CRM, which re-checks on every edit).
    appAccess.projects.delete("user-pm");
    expect((await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { assigneeUserId: "user-pm" } })).status).toBe(200);
    expect(authStub.accessChecks).toEqual([]);

    // Assigning the departed person to ANOTHER task, or back after moving away: refused.
    const other = (await create(project.id, { assigneeUserId: "user-member" })).json;
    const toDeparted = await call("PATCH", `/activities/${other.id}`, { as: "manager", body: { assigneeUserId: "user-pm" } });
    expect(toDeparted.status).toBe(422);
    expect(toDeparted.json.code).toBe("assignee_not_on_project");
    const moved = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { assigneeUserId: "user-new-pm" } });
    expect(moved.status).toBe(200);
    const back = await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { assigneeUserId: "user-pm" } });
    expect(back.json.code).toBe("assignee_not_on_project");
  });

  it("the assignee who left the team can still complete the task (AC-3.3, AC-3.7)", async () => {
    const project = makeProject();
    const task = (await create(project.id, { assigneeUserId: "user-pm" })).json;
    hosts.projects.setEntity(project.id, { label: "P", href: `/projects/${project.id}`, assignees: [], may: { write: false, manage: false } });
    expect((await call("POST", `/activities/${task.id}/complete`, { as: "pm" })).status).toBe(200);
  });
});

describe("marking done and not done (AC-3.3)", () => {
  it("the assignee may, without the manage capability; so may a manager; nobody else", async () => {
    const project = makeProject();
    const task = (await create(project.id, { assigneeUserId: "user-pm" })).json;
    for (const as of ["member", "viewer"] as const) {
      const res = await call("POST", `/activities/${task.id}/complete`, { as });
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("forbidden");
    }
    const done = await call("POST", `/activities/${task.id}/complete`, { as: "pm" });
    expect(done.status).toBe(200);
    expect(done.json.task).toMatchObject({ completedBy: { id: "user-pm" } });
    expect((await call("POST", `/activities/${task.id}/reopen`, { as: "member" })).status).toBe(403);
    expect((await call("POST", `/activities/${task.id}/reopen`, { as: "pm" })).json.task.completedAt).toBeNull();
    expect((await call("POST", `/activities/${task.id}/complete`, { as: "manager" })).json.task.completedBy.id).toBe("user-manager");
  });
});

describe("a closed or cancelled project (AC-3.8)", () => {
  it("stays readable and can be marked done or not done, but nothing else changes", async () => {
    const project = makeProject();
    const task = (await create(project.id, { assigneeUserId: "user-pm" })).json;
    hosts.projects.setEntity(project.id, {
      label: "Smart meter rollout",
      href: `/projects/${project.id}`,
      writable: false,
      assignees: ["user-pm"],
      mayFor: { "user-manager": { write: true, manage: true } },
    });

    const readable = await call("GET", `/activities?projectId=${project.id}`, { as: "viewer" });
    expect(readable.status).toBe(200);
    expect(readable.json.items).toHaveLength(1);
    expect((await call("GET", `/activities?projectId=${project.id}`, { as: "manager" })).json.items[0].may).toEqual({
      edit: false,
      delete: false,
      complete: true,
    });

    const refused = [
      await create(project.id),
      await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { subject: "x" } }),
      await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { assigneeUserId: "user-pm" } }),
      await call("DELETE", `/activities/${task.id}`, { as: "manager" }),
    ];
    for (const res of refused) {
      expect(res.status).toBe(409);
      expect(res.json.code).toBe("host_read_only");
    }
    expect(await db.activity.count()).toBe(1);
    expect((await db.activity.findUniqueOrThrow({ where: { id: task.id } })).subject).toBe("Install the gateways");

    expect((await call("POST", `/activities/${task.id}/complete`, { as: "pm" })).status).toBe(200);
    expect((await call("POST", `/activities/${task.id}/reopen`, { as: "manager" })).status).toBe(200);
  });

  it("a caller who may not manage is told so (403), not that the project is read-only", async () => {
    const project = makeProject("P", { writable: false });
    const res = await create(project.id, {}, "viewer");
    expect(res.status).toBe(403);
  });
});

describe("participants of a project task (AC-5.1, AC-5.2)", () => {
  it("are users of the PROJECTS tool, up to ten, set by whoever may edit, and the view lists them", async () => {
    const project = makeProject();
    const res = await create(project.id, { participantIds: ["user-viewer", "user-member", "user-viewer"] });
    expect(res.status).toBe(201);
    expect(res.json.participants.map((p: { id: string }) => p.id)).toEqual(["user-viewer", "user-member"]);
    expect(res.json.task.assignee.id).toBe("user-manager");
    expect(authStub.accessChecks).toEqual([
      { appId: "projects", userId: "user-viewer" },
      { appId: "projects", userId: "user-member" },
    ]);

    const edited = await call("PATCH", `/activities/${res.json.id}`, { as: "manager", body: { participantIds: ["user-pm"] } });
    expect(edited.json.participants.map((p: { id: string }) => p.id)).toEqual(["user-pm"]);
    const listed = await call("GET", `/activities?projectId=${project.id}`, { as: "viewer" });
    expect(listed.json.items[0].participants.map((p: { id: string }) => p.id)).toEqual(["user-pm"]);
    expect((await call("PATCH", `/activities/${res.json.id}`, { as: "pm", body: { participantIds: [] } })).status).toBe(403);
  });

  it("refuses someone without access to the projects tool, with the field named", async () => {
    const project = makeProject();
    for (const id of ["user-outsider", "user-gone", "user-consultant"]) {
      const res = await create(project.id, { participantIds: [id] });
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "owner_not_app_user", field: "participantIds" });
    }
    const eleven = Array.from({ length: 11 }, (_, i) => `user-${i}`);
    expect((await create(project.id, { participantIds: eleven })).json.field).toBe("participantIds");
    expect(await db.activity.count()).toBe(0);
  });
});

describe("notifications for project tasks (AC-6.1, AC-6.2)", () => {
  type Seen = NotifyEvent & { to: string[]; email: boolean; href: string; originApp: string };
  let events: Seen[];
  beforeEach(() => {
    events = [];
    setNotifierForTests({
      async notify(event) {
        const text = renderNotification(event.kind, event, event.actorName);
        events.push({ ...event, to: recipientsOf(event), email: text.email, href: text.href, originApp: text.originApp });
      },
    });
  });
  afterEach(() => setNotifierForTests(null));

  it("a task assigned to someone else tells them, by email too, and opens the project", async () => {
    const project = makeProject("Smart meter rollout");
    await create(project.id, { assigneeUserId: "user-pm", participantIds: ["user-member"] });
    expect(events.map((e) => [e.kind, e.to, e.email, e.href, e.originApp])).toEqual([
      ["task_assigned", ["user-pm"], true, `/projects/${project.id}`, "projects"],
      ["activity_participant_added", ["user-member"], false, `/projects/${project.id}`, "projects"],
    ]);
    expect(events[0]!.target).toEqual({ host: "projects", project: { id: project.id, name: "Smart meter rollout" } });
  });

  it("assigning yourself, or leaving the assignee as it is, tells nobody", async () => {
    const project = makeProject();
    const task = (await create(project.id)).json;
    expect(events).toHaveLength(0);
    await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { subject: "Renamed", participantIds: [] } });
    expect(events).toHaveLength(0);
    await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { assigneeUserId: "user-member" } });
    expect(events.map((e) => e.to)).toEqual([["user-member"]]);
  });
});

describe("a host that cannot answer fails closed (AC-8.2)", () => {
  const failures: [string, () => void][] = [
    ["500", () => (hosts.projects.mode = { status: 500 })],
    ["400 (the host's validation answer is not the user's)", () => (hosts.projects.mode = { status: 400 })],
    ["422", () => (hosts.projects.mode = { status: 422 })],
    ["401", () => (hosts.projects.mode = { status: 401 })],
    ["404", () => (hosts.projects.mode = { status: 404 })],
    ["a malformed body", () => (hosts.projects.mode = { malformed: true })],
    ["an incomplete answer", () => (hosts.projects.mode = { body: { reader: true, items: [] } })],
    ["a redirect", () => (hosts.projects.mode = { redirect: true })],
  ];

  for (const [name, fail] of failures) {
    it(`${name}: every route is 503 host_unavailable and nothing is written`, async () => {
      const project = makeProject();
      const task = (await create(project.id, { assigneeUserId: "user-pm" })).json;
      fail();
      const attempts = [
        await create(project.id),
        await call("GET", `/activities?projectId=${project.id}`, { as: "viewer" }),
        await call("PATCH", `/activities/${task.id}`, { as: "manager", body: { subject: "x" } }),
        await call("DELETE", `/activities/${task.id}`, { as: "manager" }),
        await call("POST", `/activities/${task.id}/complete`, { as: "pm" }),
        await call("POST", `/activities/${task.id}/reopen`, { as: "pm" }),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(503);
        expect(res.json.code).toBe("host_unavailable");
      }
      expect(await db.activity.count()).toBe(1);
      const row = await db.activity.findUniqueOrThrow({ where: { id: task.id } });
      expect(row).toMatchObject({ subject: "Install the gateways", completedAt: null });
    });
  }

  it("a host that does not answer in time", async () => {
    const project = makeProject();
    hosts.projects.mode = { delayMs: RESOLVE_TIMEOUT_MS + 400 };
    const res = await create(project.id);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("host_unavailable");
    expect(await db.activity.count()).toBe(0);
  });

  it("the other host being down does not matter to this one", async () => {
    const project = makeProject();
    hosts.crm.mode = { status: 500 };
    expect((await create(project.id)).status).toBe(201);
  });
});

describe("no access is a 404, the same as an activity that does not exist (AC-8.3)", () => {
  it("whatever the route, for a caller the projects host does not let read", async () => {
    const project = makeProject();
    const task = (await create(project.id)).json;
    // The projects host answers a non-reader with every id `missing`; the CRM's shape differs
    // and is covered in activities.test.ts. Both give the same 404 here.
    hosts.projects.setReader("user-viewer", false);
    const routes: [string, string, unknown?][] = [
      ["GET", `/activities?projectId=${project.id}`],
      ["PATCH", `/activities/${task.id}`, { subject: "x" }],
      ["DELETE", `/activities/${task.id}`],
      ["POST", `/activities/${task.id}/complete`],
      ["POST", `/activities/${task.id}/reopen`],
    ];
    for (const [method, path, body] of routes) {
      const real = await call(method, path, { as: "viewer", ...(body ? { body } : {}) });
      const nothing = await call(method, path.replace(task.id, "no-such-activity").replace(project.id, "pr-nobody"), {
        as: "viewer",
        ...(body ? { body } : {}),
      });
      expect(real.status).toBe(404);
      expect(nothing.status).toBe(404);
      const { instance: _a, ...a } = real.json;
      const { instance: _b, ...b } = nothing.json;
      expect(a).toEqual(b);
    }
  });

  it("a CRM reader with no projects access reads no project task, and the reverse", async () => {
    const project = makeProject();
    const company = makeCompany();
    const task = (await create(project.id)).json;
    const note = (await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "N", companyId: company.id } })).json;
    hosts.projects.setReader("user-consultant", false);
    hosts.crm.setReader("user-pm", false);
    expect((await call("GET", `/activities?projectId=${project.id}`, { as: "consultant" })).status).toBe(404);
    expect((await call("POST", `/activities/${task.id}/complete`, { as: "consultant" })).status).toBe(404);
    expect((await call("GET", `/activities?companyId=${company.id}`, { as: "pm" })).status).toBe(404);
    expect((await call("PATCH", `/activities/${note.id}`, { as: "pm", body: { subject: "x" } })).status).toBe(404);
  });
});
