/**
 * The task lists (specs/028-activities US-3 AC-3.4/3.5, US-7; plan § API contracts): `GET /tasks`
 * and `GET /tasks/assignees`. crm-api's Tasks-page scenarios (specs/017 AC-4.3/4.4/8.2: me / any /
 * a colleague, participants) ported against the crm test host, plus the new ones: one project's
 * tasks, the mixed "My tasks" list with a host that cannot answer, and a host that is not a reader.
 *
 * Rows are written straight to the table: the order of a list depends on `createdAt` and
 * `completedAt`, which these tests must control exactly.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, hosts, makeCompany, makeProject, resetWorld } from "../test-support/world";

type Seed = {
  subject: string;
  host: { app: "crm"; id: string } | { app: "projects"; id: string };
  dueDate?: string | null;
  assignee?: string | null;
  author?: string;
  createdAt?: string;
  completedAt?: string | null;
  participants?: string[];
  type?: "task" | "note";
};

async function seed(s: Seed) {
  const crm = s.host.app === "crm";
  return db.activity.create({
    data: {
      kind: crm ? "pre_sales" : "operational",
      type: s.type ?? "task",
      hostApp: s.host.app,
      hostType: crm ? "company" : "project",
      hostId: s.host.id,
      subject: s.subject,
      occurredAt: new Date("2026-11-01T09:00:00Z"),
      authorUserId: s.author ?? "user-consultant",
      ...((s.type ?? "task") === "task"
        ? {
            dueDate: s.dueDate ? new Date(`${s.dueDate}T00:00:00Z`) : null,
            assigneeUserId: s.assignee === undefined ? (s.author ?? "user-consultant") : s.assignee,
            completedAt: s.completedAt ? new Date(s.completedAt) : null,
            completedByUserId: s.completedAt ? "user-colleague" : null,
          }
        : {}),
      ...(s.createdAt ? { createdAt: new Date(s.createdAt) } : {}),
      ...(s.participants ? { participants: { create: s.participants.map((userId) => ({ userId, createdBy: s.author ?? "user-consultant" })) } } : {}),
    },
  });
}

const subjects = (res: { json: { items: { subject: string }[] } }) => res.json.items.map((t) => t.subject);

describe("GET /tasks — the CRM Tasks page (ported from crm-api, specs/017 AC-4.3, AC-4.4, AC-8.2)", () => {
  beforeEach(resetWorld);

  it("my open tasks by due date, no date last; done ones newest completion first; any; a colleague", async () => {
    const co = makeCompany();
    const host = { app: "crm", id: co.id } as const;
    await seed({ subject: "Whenever", host });
    await seed({ subject: "Later", host, dueDate: "2026-12-20", completedAt: "2026-11-05T10:00:00Z" });
    await seed({ subject: "Sooner", host, dueDate: "2026-11-02" });
    await seed({ subject: "For colleague", host, assignee: "user-colleague" });
    await seed({ subject: "Done earlier", host, completedAt: "2026-11-03T10:00:00Z" });

    const mine = await call("GET", "/tasks?kind=pre_sales", { as: "consultant" });
    expect(mine.status).toBe(200);
    expect(subjects(mine)).toEqual(["Sooner", "Whenever"]);
    expect(mine.json).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(mine.json.unavailable).toBeUndefined();

    // the default status is open, the default assignee is the caller
    expect(subjects(await call("GET", "/tasks?kind=pre_sales", { as: "consultant" }))).toEqual(["Sooner", "Whenever"]);
    expect(subjects(await call("GET", "/tasks?kind=pre_sales&status=done", { as: "consultant" }))).toEqual(["Later", "Done earlier"]);
    expect((await call("GET", "/tasks?kind=pre_sales&assignee=any")).json.total).toBe(3);
    const colleague = await call("GET", "/tasks?kind=pre_sales&assignee=user-colleague", { as: "consultant" });
    expect(subjects(colleague)).toEqual(["For colleague"]);
  });

  it("equal due dates fall back to the oldest created, then the id (a stable order)", async () => {
    const co = makeCompany();
    const host = { app: "crm", id: co.id } as const;
    await seed({ subject: "B newer", host, dueDate: "2026-11-10", createdAt: "2026-11-02T10:00:00Z" });
    await seed({ subject: "A older", host, dueDate: "2026-11-10", createdAt: "2026-11-01T10:00:00Z" });
    await seed({ subject: "C undated older", host, createdAt: "2026-10-01T10:00:00Z" });
    expect(subjects(await call("GET", "/tasks?kind=pre_sales&assignee=any"))).toEqual(["A older", "B newer", "C undated older"]);
  });

  it("a person's tasks include the ones they take part in, not the author's notes (AC-8.2)", async () => {
    const co = makeCompany();
    const host = { app: "crm", id: co.id } as const;
    await seed({ subject: "Assigned to colleague", host, assignee: "user-colleague", dueDate: "2026-11-09" });
    await seed({ subject: "Colleague took part", host, assignee: "user-consultant", participants: ["user-colleague"], dueDate: "2026-11-12" });
    await seed({ subject: "Nothing to do with them", host, assignee: "user-consultant" });
    await seed({ subject: "A note they took part in", host, type: "note", participants: ["user-colleague"] });

    expect(subjects(await call("GET", "/tasks?kind=pre_sales", { as: "colleague" }))).toEqual(["Assigned to colleague", "Colleague took part"]);
    expect(subjects(await call("GET", "/tasks?kind=pre_sales&assignee=user-colleague", { as: "consultant" }))).toEqual([
      "Assigned to colleague",
      "Colleague took part",
    ]);
    // the participants come back on the view
    const view = (await call("GET", "/tasks?kind=pre_sales", { as: "colleague" })).json.items[1];
    expect(view.participants.map((p: { id: string }) => p.id)).toEqual(["user-colleague"]);
  });

  it("the view is the activity view: kind, company with the host's label, no project, may flags, assignee", async () => {
    const co = makeCompany("Acme SA");
    await seed({ subject: "T", host: { app: "crm", id: co.id }, dueDate: "2026-11-02" });
    const [item] = (await call("GET", "/tasks?kind=pre_sales", { as: "consultant" })).json.items;
    expect(item).toMatchObject({
      kind: "pre_sales",
      type: "task",
      company: { id: co.id, name: "Acme SA" },
      project: null,
      task: { dueDate: "2026-11-02", assignee: { id: "user-consultant" }, completedAt: null },
      may: { complete: true },
    });
  });

  it("pages: total counts every match, a page past the end is empty", async () => {
    const co = makeCompany();
    for (let i = 1; i <= 5; i++) await seed({ subject: `T${i}`, host: { app: "crm", id: co.id }, dueDate: `2026-11-0${i}` });
    const second = await call("GET", "/tasks?kind=pre_sales&assignee=any&page=2&pageSize=2");
    expect(subjects(second)).toEqual(["T3", "T4"]);
    expect(second.json).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(subjects(await call("GET", "/tasks?kind=pre_sales&assignee=any&page=9&pageSize=2"))).toEqual([]);
  });

  it("kind=pre_sales never returns an operational task, whoever is asked about (AC-7.1)", async () => {
    const co = makeCompany();
    const pr = makeProject();
    await seed({ subject: "Pre-sales", host: { app: "crm", id: co.id }, author: "user-alice" });
    await seed({ subject: "Operational", host: { app: "projects", id: pr.id }, author: "user-alice" });
    for (const q of ["assignee=me", "assignee=any", "assignee=user-alice", "status=open"]) {
      const res = await call("GET", `/tasks?kind=pre_sales&${q}`);
      expect(subjects(res)).toEqual(["Pre-sales"]);
      expect(res.json.total).toBe(1);
    }
    expect(subjects(await call("GET", "/tasks?kind=operational&assignee=any"))).toEqual(["Operational"]);
  });

  it("without a kind the list is the CRM's, as crm-api's was; unknown kind and bad paging are 422", async () => {
    const co = makeCompany();
    const pr = makeProject();
    await seed({ subject: "Pre-sales", host: { app: "crm", id: co.id }, author: "user-alice" });
    await seed({ subject: "Operational", host: { app: "projects", id: pr.id }, author: "user-alice" });
    expect(subjects(await call("GET", "/tasks"))).toEqual(["Pre-sales"]);
    expect((await call("GET", "/tasks?kind=everything")).status).toBe(422);
    expect((await call("GET", "/tasks?kind=pre_sales&status=late")).status).toBe(422);
    expect((await call("GET", "/tasks?kind=pre_sales&pageSize=101")).status).toBe(422);
  });

  it("needs a signed-in caller", async () => {
    expect((await call("GET", "/tasks?kind=pre_sales", { as: null })).status).toBe(401);
    expect((await call("GET", "/tasks/assignees", { as: null })).status).toBe(401);
  });
});

describe("GET /tasks?projectId= — a project's Tasks card (AC-3.4, AC-3.5)", () => {
  beforeEach(resetWorld);

  it("lists one project's tasks in plan order, open and done, and no other project's", async () => {
    const pr = makeProject("Rollout");
    const other = makeProject("Other");
    const co = makeCompany();
    const host = { app: "projects", id: pr.id } as const;
    await seed({ subject: "Undated", host, assignee: "user-pm", createdAt: "2026-11-01T08:00:00Z" });
    await seed({ subject: "Due late", host, assignee: "user-member", dueDate: "2026-12-01" });
    await seed({ subject: "Due soon", host, assignee: "user-pm", dueDate: "2026-11-15" });
    await seed({ subject: "Undated newer", host, assignee: null, createdAt: "2026-11-02T08:00:00Z" });
    await seed({ subject: "Done first", host, assignee: "user-pm", completedAt: "2026-11-04T10:00:00Z" });
    await seed({ subject: "Done last", host, assignee: "user-pm", dueDate: "2026-10-01", completedAt: "2026-11-06T10:00:00Z" });
    await seed({ subject: "Elsewhere", host: { app: "projects", id: other.id } });
    await seed({ subject: "Pre-sales", host: { app: "crm", id: co.id } });

    // a projects:access holder who manages nothing and is on no task reads the card (AC-3.5)
    const open = await call("GET", `/tasks?projectId=${pr.id}&status=open`, { as: "viewer" });
    expect(open.status).toBe(200);
    expect(subjects(open)).toEqual(["Due soon", "Due late", "Undated", "Undated newer"]);
    expect(open.json.total).toBe(4);
    expect(open.json.items[0]).toMatchObject({
      kind: "operational",
      project: { id: pr.id, name: "Rollout" },
      company: null,
      task: { assignee: { id: "user-pm" } },
    });
    expect(subjects(await call("GET", `/tasks?projectId=${pr.id}&status=done`, { as: "viewer" }))).toEqual(["Done last", "Done first"]);
    // open is the default status
    expect(subjects(await call("GET", `/tasks?projectId=${pr.id}`, { as: "viewer" }))).toEqual(["Due soon", "Due late", "Undated", "Undated newer"]);
  });

  it("pages the card", async () => {
    const pr = makeProject();
    for (let i = 1; i <= 3; i++) await seed({ subject: `T${i}`, host: { app: "projects", id: pr.id }, dueDate: `2026-11-0${i}` });
    const res = await call("GET", `/tasks?projectId=${pr.id}&page=2&pageSize=2`, { as: "viewer" });
    expect(subjects(res)).toEqual(["T3"]);
    expect(res.json).toMatchObject({ total: 3, page: 2, pageSize: 2 });
  });

  it("an explicit assignee narrows the card; the default is everyone", async () => {
    const pr = makeProject();
    const host = { app: "projects", id: pr.id } as const;
    await seed({ subject: "PM's", host, assignee: "user-pm" });
    await seed({ subject: "Member's", host, assignee: "user-member" });
    expect(subjects(await call("GET", `/tasks?projectId=${pr.id}&assignee=user-member`, { as: "viewer" }))).toEqual(["Member's"]);
  });

  it("a project the caller cannot read, or that does not exist, is the same 404; a projects outage is 503 (AC-8.2, AC-8.3)", async () => {
    const pr = makeProject();
    await seed({ subject: "T", host: { app: "projects", id: pr.id } });
    hosts.projects.setReader("user-outsider", false);
    const unreadable = await call("GET", `/tasks?projectId=${pr.id}`, { as: "outsider" });
    const missing = await call("GET", "/tasks?projectId=pr-nope", { as: "viewer" });
    expect(unreadable.status).toBe(404);
    expect(missing.status).toBe(404);
    expect({ ...unreadable.json, instance: "" }).toEqual({ ...missing.json, instance: "" });

    hosts.projects.mode = { status: 500 };
    const down = await call("GET", `/tasks?projectId=${pr.id}`, { as: "viewer" });
    expect(down.status).toBe(503);
    expect(down.json.code).toBe("host_unavailable");
  });

  it("projectId is operational: another kind with it is a 422", async () => {
    const pr = makeProject();
    for (const kind of ["pre_sales", "all"]) {
      const res = await call("GET", `/tasks?projectId=${pr.id}&kind=${kind}`, { as: "viewer" });
      expect(res.status).toBe(422);
      expect(res.json.field).toBe("kind");
    }
    expect((await call("GET", `/tasks?projectId=${pr.id}&kind=operational`, { as: "viewer" })).status).toBe(200);
  });
});

describe("GET /tasks?kind=all&assignee=me — My tasks across both tools (US-7)", () => {
  beforeEach(resetWorld);

  async function mixed() {
    const co = makeCompany("Acme SA");
    const pr = makeProject("Rollout");
    const crm = { app: "crm", id: co.id } as const;
    const projects = { app: "projects", id: pr.id } as const;
    await seed({ subject: "CRM mid", host: crm, assignee: "user-alice", dueDate: "2026-11-20" });
    await seed({ subject: "Project first", host: projects, assignee: "user-alice", dueDate: "2026-11-10", author: "user-pm" });
    await seed({ subject: "Project undated", host: projects, assignee: "user-alice", author: "user-pm" });
    await seed({ subject: "CRM last", host: crm, assignee: "user-alice", dueDate: "2026-12-01" });
    await seed({ subject: "Took part", host: projects, assignee: "user-pm", author: "user-pm", participants: ["user-alice"], dueDate: "2026-11-15" });
    await seed({ subject: "Not mine", host: projects, assignee: "user-pm", author: "user-pm" });
    await seed({ subject: "Not mine either", host: crm, assignee: "user-bob", author: "user-bob" });
    return { co, pr };
  }

  it("mixes both kinds in one due-date order, with the CRM company and the project on each item (AC-7.2)", async () => {
    const { co, pr } = await mixed();
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(subjects(res)).toEqual(["Project first", "Took part", "CRM mid", "CRM last", "Project undated"]);
    expect(res.json.total).toBe(5);
    expect(res.json.unavailable).toBeUndefined();
    expect(res.json.items[0]).toMatchObject({ kind: "operational", project: { id: pr.id, name: "Rollout" }, company: null });
    expect(res.json.items[2]).toMatchObject({ kind: "pre_sales", company: { id: co.id, name: "Acme SA" }, project: null });
  });

  it("pages across both kinds as one list", async () => {
    await mixed();
    const res = await call("GET", "/tasks?kind=all&assignee=me&page=2&pageSize=2");
    expect(subjects(res)).toEqual(["CRM mid", "CRM last"]);
    expect(res.json.total).toBe(5);
  });

  it("done tasks of both kinds, newest completion first", async () => {
    const co = makeCompany();
    const pr = makeProject();
    await seed({ subject: "CRM done", host: { app: "crm", id: co.id }, assignee: "user-alice", completedAt: "2026-11-05T10:00:00Z" });
    await seed({ subject: "Project done", host: { app: "projects", id: pr.id }, assignee: "user-alice", completedAt: "2026-11-07T10:00:00Z" });
    await seed({ subject: "Open", host: { app: "projects", id: pr.id }, assignee: "user-alice" });
    expect(subjects(await call("GET", "/tasks?kind=all&assignee=me&status=done"))).toEqual(["Project done", "CRM done"]);
  });

  it("is only for me: another person or any is a 422", async () => {
    for (const assignee of ["any", "user-bob"]) {
      const res = await call("GET", `/tasks?kind=all&assignee=${assignee}`);
      expect(res.status).toBe(422);
      expect(res.json.field).toBe("assignee");
    }
    // not defaulted either: kind=all without an assignee would otherwise be "me" silently — it is "me"
    expect((await call("GET", "/tasks?kind=all")).status).toBe(200);
  });

  it("a caller the CRM host does not let read gets no pre-sales items, and no notice (AC-7.4)", async () => {
    await mixed();
    hosts.crm.setReader("user-alice", false);
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(subjects(res)).toEqual(["Project first", "Took part", "Project undated"]);
    expect(res.json.total).toBe(3);
    expect(res.json.unavailable).toBeUndefined();
  });

  it("the projects host's non-reader shape (every id missing) gives the same result, never host_unavailable (AC-7.4)", async () => {
    await mixed();
    hosts.projects.setReader("user-alice", false);
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(subjects(res)).toEqual(["CRM mid", "CRM last"]);
    expect(res.json.unavailable).toBeUndefined();
  });

  it("neither host lets the caller read: an empty list, 200", async () => {
    await mixed();
    hosts.crm.setReader("user-alice", false);
    hosts.projects.setReader("user-alice", false);
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ items: [], total: 0 });
  });

  it("the CRM host down: the operational items and unavailable [\"crm\"] (AC-7.5)", async () => {
    await mixed();
    hosts.crm.mode = { status: 500 };
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(subjects(res)).toEqual(["Project first", "Took part", "Project undated"]);
    expect(res.json.total).toBe(3);
    expect(res.json.unavailable).toEqual(["crm"]);
    // no company label of the left-out host leaks: only the projects host was asked about labels
    expect(res.json.items.every((i: { kind: string }) => i.kind === "operational")).toBe(true);
  });

  it("the CRM host timing out or answering garbage is down too", async () => {
    await mixed();
    hosts.crm.mode = { malformed: true };
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.json.unavailable).toEqual(["crm"]);
    expect(res.json.total).toBe(3);
  });

  it("the projects host down: the pre-sales items and unavailable [\"projects\"]", async () => {
    await mixed();
    hosts.projects.mode = { status: 503 };
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(subjects(res)).toEqual(["CRM mid", "CRM last"]);
    expect(res.json.unavailable).toEqual(["projects"]);
  });

  describe("a host that answers the probe but fails the label call (AC-7.5)", () => {
    const expectCrmLeftOut = (res: { status: number; json: any }) => {
      expect(res.status).toBe(200);
      // Only the operational items, and none of them unlabelled-from-the-other-host: nothing of the CRM is shown.
      expect(subjects(res)).toEqual(["Project first", "Took part", "Project undated"]);
      expect(res.json.total).toBe(3);
      expect(res.json.unavailable).toEqual(["crm"]);
      expect(res.json.items.every((i: { kind: string }) => i.kind === "operational")).toBe(true);
      expect(res.json.items[0].project).toMatchObject({ name: "Rollout" });
    };

    it("the CRM answers the probe, then 500s the label call: the project tasks and unavailable [\"crm\"]", async () => {
      await mixed();
      hosts.crm.mode = { status: 500, onlyWhenIdsAsked: true };
      expectCrmLeftOut(await call("GET", "/tasks?kind=all&assignee=me"));
      // It really was probed first and asked for labels after.
      expect(hosts.crm.resolves.length).toBeGreaterThanOrEqual(1);
    });

    it("the CRM answers the probe, then answers garbage to the label call", async () => {
      await mixed();
      hosts.crm.mode = { malformed: true, onlyWhenIdsAsked: true };
      expectCrmLeftOut(await call("GET", "/tasks?kind=all&assignee=me"));
    });

    it("the CRM answers the probe, then times out on the label call", async () => {
      await mixed();
      hosts.crm.mode = { delayMs: 2_600, onlyWhenIdsAsked: true };
      expectCrmLeftOut(await call("GET", "/tasks?kind=all&assignee=me"));
    }, 15_000);

    it("the converse: projects answers the probe and fails the label call: the pre-sales items and unavailable [\"projects\"]", async () => {
      await mixed();
      hosts.projects.mode = { status: 503, onlyWhenIdsAsked: true };
      const res = await call("GET", "/tasks?kind=all&assignee=me");
      expect(res.status).toBe(200);
      expect(subjects(res)).toEqual(["CRM mid", "CRM last"]);
      expect(res.json.total).toBe(2);
      expect(res.json.unavailable).toEqual(["projects"]);
      expect(res.json.items.every((i: { kind: string }) => i.kind === "pre_sales")).toBe(true);
    });

    it("both hosts fail the label call: an empty list naming both, still 200", async () => {
      await mixed();
      hosts.crm.mode = { status: 500, onlyWhenIdsAsked: true };
      hosts.projects.mode = { status: 500, onlyWhenIdsAsked: true };
      const res = await call("GET", "/tasks?kind=all&assignee=me");
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ items: [], total: 0 });
      expect([...res.json.unavailable].sort()).toEqual(["crm", "projects"]);
    });

    it("a host that stops being a reader between the probe and the labels contributes nothing, unnamed (AC-7.4)", async () => {
      await mixed();
      // reader:true on the probe, reader:false on the label call.
      hosts.crm.mode = { body: { reader: false, items: [], related: [] }, onlyWhenIdsAsked: true };
      const res = await call("GET", "/tasks?kind=all&assignee=me");
      expect(res.status).toBe(200);
      expect(subjects(res)).toEqual(["Project first", "Took part", "Project undated"]);
      expect(res.json.unavailable).toBeUndefined();
    });
  });

  it("both hosts down: an empty list naming both, still 200", async () => {
    await mixed();
    hosts.crm.mode = { status: 500 };
    hosts.projects.mode = { status: 500 };
    const res = await call("GET", "/tasks?kind=all&assignee=me");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ items: [], total: 0 });
    expect([...res.json.unavailable].sort()).toEqual(["crm", "projects"]);
  });

  it("asks each host as the caller, with the caller's own token", async () => {
    await mixed();
    await call("GET", "/tasks?kind=all&assignee=me", { as: "alice" });
    expect(hosts.crm.resolves.length).toBeGreaterThan(0);
    expect(hosts.projects.resolves.length).toBeGreaterThan(0);
    for (const r of [...hosts.crm.resolves, ...hosts.projects.resolves]) expect(r.authorization).toStartWith("Bearer ");
  });
});

describe("a single-kind list needs a host that lets the caller read", () => {
  beforeEach(resetWorld);

  it("a non-reader of the kind's host is a 404 — with `me` and with `any`, and for an empty list too (AC-7.4, AC-8.3)", async () => {
    const co = makeCompany();
    await seed({ subject: "T", host: { app: "crm", id: co.id }, assignee: "user-outsider" });
    for (const q of ["kind=pre_sales&assignee=me", "kind=pre_sales&assignee=any", "kind=pre_sales&assignee=user-bob", "kind=operational&assignee=any"]) {
      const res = await call("GET", `/tasks?${q}`, { as: "outsider" });
      expect(res.status).toBe(404);
    }
  });

  it("a host that cannot answer is a 503 host_unavailable, nothing listed (AC-8.2)", async () => {
    const co = makeCompany();
    await seed({ subject: "T", host: { app: "crm", id: co.id } });
    hosts.crm.mode = { status: 500 };
    const res = await call("GET", "/tasks?kind=pre_sales&assignee=any");
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("host_unavailable");
  });

  it("a host that answers the probe and then fails the label call is a 503 for a single kind, never a list (AC-8.2)", async () => {
    const co = makeCompany();
    const pr = makeProject();
    await seed({ subject: "CRM", host: { app: "crm", id: co.id }, assignee: "user-alice" });
    await seed({ subject: "Project", host: { app: "projects", id: pr.id }, assignee: "user-alice" });
    hosts.crm.mode = { status: 500, onlyWhenIdsAsked: true };
    hosts.projects.mode = { status: 500, onlyWhenIdsAsked: true };
    for (const q of ["kind=pre_sales", "kind=operational", "kind=pre_sales&assignee=any", `projectId=${pr.id}`]) {
      const res = await call("GET", `/tasks?${q}`);
      expect(res.status).toBe(503);
      expect(res.json.code).toBe("host_unavailable");
      expect(res.json.items).toBeUndefined();
    }
  });

  it("the other host being down does not matter to a list of this kind", async () => {
    const co = makeCompany();
    await seed({ subject: "T", host: { app: "crm", id: co.id }, author: "user-alice" });
    hosts.projects.mode = { status: 500 };
    expect((await call("GET", "/tasks?kind=pre_sales")).status).toBe(200);
    expect(hosts.projects.resolves).toHaveLength(0);
  });
});

describe("GET /tasks/assignees (ported from crm-api)", () => {
  beforeEach(resetWorld);

  it("the people CRM tasks were given to, by name, once each — and only pre-sales ones for kind=pre_sales", async () => {
    const co = makeCompany();
    const pr = makeProject();
    const crm = { app: "crm", id: co.id } as const;
    await seed({ subject: "A", host: crm, assignee: "user-consultant" });
    await seed({ subject: "B", host: crm, assignee: "user-consultant" });
    await seed({ subject: "C", host: crm, assignee: "user-colleague" });
    await seed({ subject: "Unassigned", host: crm, assignee: null });
    await seed({ subject: "Note", host: crm, type: "note" });
    await seed({ subject: "Project's", host: { app: "projects", id: pr.id }, assignee: "user-pm" });

    const res = await call("GET", "/tasks/assignees?kind=pre_sales", { as: "consultant" });
    expect(res.status).toBe(200);
    expect(res.json.items.map((p: { id: string }) => p.id)).toEqual(["user-colleague", "user-consultant"]);
    expect(res.json.items[0]).toMatchObject({ name: "Name of user-colleague", status: "active" });

    const operational = await call("GET", "/tasks/assignees?kind=operational", { as: "viewer" });
    expect(operational.json.items.map((p: { id: string }) => p.id)).toEqual(["user-pm"]);
  });

  it("a person who left shows as such, an unknown id as unknown, names sorted (nameless last)", async () => {
    const co = makeCompany();
    const crm = { app: "crm", id: co.id } as const;
    await seed({ subject: "A", host: crm, assignee: "user-gone" });
    await seed({ subject: "B", host: crm, assignee: "stranger" });
    await seed({ subject: "C", host: crm, assignee: "user-bob" });
    const res = await call("GET", "/tasks/assignees?kind=pre_sales");
    expect(res.json.items.map((p: { id: string }) => p.id)).toEqual(["user-bob", "stranger", "user-gone"]);
    expect(res.json.items[0]).toMatchObject({ id: "user-bob", name: "Name of user-bob" });
    expect(res.json.items.at(-1).name).toBeNull();
  });

  it("without a kind it is the CRM's; the host must let the caller read (404), and must answer (503)", async () => {
    const co = makeCompany();
    await seed({ subject: "A", host: { app: "crm", id: co.id }, assignee: "user-bob" });
    expect((await call("GET", "/tasks/assignees")).json.items.map((p: { id: string }) => p.id)).toEqual(["user-bob"]);
    expect((await call("GET", "/tasks/assignees?kind=pre_sales", { as: "outsider" })).status).toBe(404);
    expect((await call("GET", "/tasks/assignees?kind=all")).status).toBe(422);
    hosts.crm.mode = { status: 500 };
    const down = await call("GET", "/tasks/assignees?kind=pre_sales");
    expect(down.status).toBe(503);
    expect(down.json.code).toBe("host_unavailable");
  });
});
