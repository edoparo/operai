/**
 * The activity-host contract projects-api serves to activities-api (specs/20261110-activities T5; AC-3.2, AC-3.5,
 * AC-3.8, AC-8.1, plan.md § Host contract). Runs the ASSEMBLED app against the `*_test` database.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, resetWorld, seedDealProject, type PersonaName } from "../test-support/world";
import type { Prisma } from "../lib/generated/prisma/client";

beforeEach(resetWorld);

const seed = (over: Partial<Prisma.ProjectUncheckedCreateInput> = {}) =>
  db.project.create({
    data: {
      name: "Koordy",
      type: "internal",
      entity: "welld_ch",
      projectManagerId: "user-pm-ch",
      createdById: "user-pm-ch",
      ...over,
    },
  });

const resolve = (body: unknown, as: PersonaName | null = "viewer") =>
  call("POST", "/activity-host/v1/resolve", { as, body });

const resolveOne = async (id: string, as: PersonaName | null = "viewer") => {
  const res = await resolve({ entityType: "project", ids: [id] }, as);
  expect(res.status).toBe(200);
  return res.json as { reader: boolean; items: Array<Record<string, unknown>> };
};

describe("POST /activity-host/v1/resolve", () => {
  it("is 401 without a token", async () => {
    expect((await resolve({ entityType: "project", ids: [] }, null)).status).toBe(401);
  });

  it("describes an open project to any reader: label, href, assignees = PM + team (AC-3.1, AC-3.5)", async () => {
    const project = await seed({ name: "Koordy" });
    await db.projectMember.createMany({
      data: [
        { projectId: project.id, userId: "user-viewer" },
        { projectId: project.id, userId: "user-pm-ch" }, // also the PM: listed once
      ],
    });
    const body = await resolveOne(project.id, "viewer");
    expect(body.reader).toBe(true);
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item).toMatchObject({
      id: project.id,
      state: "open",
      writable: true,
      label: "Koordy",
      href: `/projects/${project.id}`,
      may: { write: false, manage: false },
    });
    expect(item["assignees"]).toEqual(["user-pm-ch", "user-viewer"]); // the PM first, no duplicate
  });

  it("lists only the team as assignees while a project from a deal awaits its project manager (specs/20261103-projects-handoff D42)", async () => {
    const { project } = await seedDealProject();
    await db.projectMember.create({ data: { projectId: project.id, userId: "user-viewer" } });
    const body = await resolveOne(project.id, "viewer");
    expect(body.items[0]!["assignees"]).toEqual(["user-viewer"]); // no null where the PM will be
  });

  it("answers `may.manage` from project:manage on the project's own entity (AC-3.2)", async () => {
    const ch = await seed({ entity: "welld_ch" });
    const it = await seed({ entity: "welld_it", name: "Italia" });
    const matrix: Array<[PersonaName, boolean, boolean]> = [
      ["viewer", false, false],
      ["accounting", false, false],
      ["pmCh", true, false],
      ["salesIt", false, true],
      ["admin", true, true],
    ];
    for (const [persona, onCh, onIt] of matrix) {
      const chItem = (await resolveOne(ch.id, persona)).items[0]!;
      const itItem = (await resolveOne(it.id, persona)).items[0]!;
      expect(chItem["may"]).toEqual({ write: onCh, manage: onCh });
      expect(itItem["may"]).toEqual({ write: onIt, manage: onIt });
    }
  });

  it("marks a closed or cancelled project not writable but still open to read (AC-3.8)", async () => {
    const states = ["planned", "active", "on_hold", "closed", "cancelled"] as const;
    for (const state of states) {
      const project = await seed({ state, ...(state === "on_hold" ? { stateBeforeHold: "active" } : {}) });
      const item = (await resolveOne(project.id)).items[0]!;
      expect(item["state"]).toBe("open");
      expect(item["writable"]).toBe(state !== "closed" && state !== "cancelled");
    }
  });

  it("reports an unknown id as missing, with nothing else", async () => {
    const item = (await resolveOne("nope")).items[0]!;
    expect(item).toEqual({ id: "nope", state: "missing" });
  });

  it("answers every distinct id once, in request order, mixing found and missing", async () => {
    const a = await seed({ name: "A" });
    const b = await seed({ name: "B" });
    const res = await resolve({ entityType: "project", ids: [b.id, "nope", a.id, b.id] });
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: { id: string }) => i.id)).toEqual([b.id, "nope", a.id]);
    expect(res.json.items.map((i: { state: string }) => i.state)).toEqual(["open", "missing", "open"]);
  });

  it('with no ids answers only `reader` ("may I read at all?")', async () => {
    expect((await resolve({ entityType: "project", ids: [] }, "viewer")).json).toEqual({ reader: true, items: [] });
  });

  it("tells a caller without projects:access `reader:false`, 200, and leaks no project (AC-8.1)", async () => {
    const project = await seed({ name: "Secret" });
    const res = await resolve({ entityType: "project", ids: [project.id, "nope"] }, "outsider");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      reader: false,
      items: [
        { id: project.id, state: "missing" },
        { id: "nope", state: "missing" },
      ],
    });
    expect((await resolve({ entityType: "project", ids: [] }, "outsider")).json).toEqual({ reader: false, items: [] });
  });

  it("is never cached", async () => {
    const res = await resolve({ entityType: "project", ids: [] });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is 400 `validation_failed` for another entity type, more than 25 ids, an empty id, an unknown member or no ids", async () => {
    const ids26 = Array.from({ length: 26 }, (_, i) => `p${i}`);
    for (const body of [
      { entityType: "company", ids: [] },
      { entityType: "project", ids: ids26 },
      { entityType: "project", ids: [""] },
      { entityType: "project", ids: [], extra: 1 },
      { entityType: "project" },
    ]) {
      const res = await resolve(body);
      expect(res.status).toBe(400);
    }
    expect((await resolve({ entityType: "project", ids: ids26.slice(0, 25) })).status).toBe(200);
  });

  it("400 validation_failed for a NUL character in any id: Postgres text cannot hold it, so it is refused before the lookup, never a 500 (security re-review)", async () => {
    const nul = "pro\u0000ject";
    const asked = await resolve({ entityType: "project", ids: [nul] });
    expect(asked.status).toBe(400);
    expect(asked.json).toMatchObject({ code: "validation_failed", field: "ids.0" });
    expect((await resolve({ entityType: "project", ids: [], related: { deal: [nul] } })).status).toBe(400);
  });

  it("ignores `related` (CRM-only), which this host never answers", async () => {
    const res = await resolve({ entityType: "project", ids: [], related: { deal: ["d1"] } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reader: true, items: [] });
  });

  it("changes nothing", async () => {
    const project = await seed();
    const before = JSON.stringify(await db.project.findMany());
    await resolve({ entityType: "project", ids: [project.id] }, "admin");
    expect(JSON.stringify(await db.project.findMany())).toBe(before);
  });
});
