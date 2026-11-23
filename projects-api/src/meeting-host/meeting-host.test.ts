/**
 * The meeting-host resolve projects-api serves to meetings-api (specs/20261104-meetings A18, US-11). Runs the
 * ASSEMBLED app against the `*_test` database.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, resetWorld, type PersonaName } from "../test-support/world";

beforeEach(resetWorld);

const seed = () =>
  db.project.create({
    data: { name: "Koordy", type: "internal", entity: "welld_ch", projectManagerId: "user-pm-ch", createdById: "user-pm-ch" },
  });

const resolve = (ids: string[], as: PersonaName | null = "viewer", entityType = "project") =>
  call("POST", "/meeting-host/v1/resolve", { as, body: { entityType, ids } });

describe("POST /meeting-host/v1/resolve", () => {
  it("is 401 without a token, 400 for another entity type or no id", async () => {
    expect((await resolve(["x"], null)).status).toBe(401);
    expect((await resolve(["x"], "viewer", "deal")).status).toBe(400);
    expect((await resolve([], "viewer")).status).toBe(400);
  });

  it("describes a project to a reader: title and page; a team member is a host reader, anyone else is not", async () => {
    const project = await seed();
    await db.projectMember.create({ data: { projectId: project.id, userId: "user-colleague" } });
    const open = { id: project.id, state: "open", title: "Koordy", href: `/projects/${project.id}` };

    const viewer = await resolve([project.id], "viewer");
    expect(viewer.status).toBe(200);
    expect(viewer.headers.get("cache-control")).toBe("no-store");
    expect(viewer.json.items).toEqual([{ ...open, hostVisible: false }]);
    expect((await resolve([project.id], "colleague")).json.items).toEqual([{ ...open, hostVisible: true }]);
    expect((await resolve([project.id], "pmCh")).json.items).toEqual([{ ...open, hostVisible: true }]);
    // An admin is not on the team: no role overrides the team rule.
    expect((await resolve([project.id], "admin")).json.items).toEqual([{ ...open, hostVisible: false }]);
  });

  it("answers missing for an unknown project and closed to a caller without projects:access, once per id", async () => {
    const project = await seed();
    const res = await resolve([project.id, "nope", project.id], "outsider");
    expect(res.json.items).toEqual([
      { id: project.id, state: "closed" },
      { id: "nope", state: "missing" },
    ]);
  });
});
