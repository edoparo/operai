import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createKit, type Kit } from "../test-support/routeKit";

// The meeting agenda: an ordered list of points, edited by the creator and the Operai participants holding
// meetings:access, ticked as covered by the same people, read by everyone who can open the meeting.

const kit: Kit = await createKit();

let logs: ReturnType<typeof spyOn>[];
beforeEach(async () => {
  await kit.reset();
  for (const user of ["creator", "pat", "stranger"]) kit.grant(user, "access");
  kit.grant("nina"); // a participant without meetings:access
  logs = [spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "log").mockImplementation(() => {})];
});
afterEach(() => logs.forEach((s) => s.mockRestore()));

const json = async (res: Response) => (await res.json()) as Record<string, any>;
async function seed() {
  return kit.db.meeting.create({
    data: {
      title: "Budget review",
      format: "online",
      startsAt: new Date("2026-11-05T09:00:00.000Z"),
      language: "en",
      source: "recorded",
      creatorUserId: "creator",
      participants: { create: [{ userId: "pat", addedBy: "creator" }, { userId: "nina", addedBy: "creator" }] },
    },
  });
}
const get = (id: string, who = "creator") => kit.call(who, "GET", `/meetings/${id}/agenda`);
const put = (id: string, points: unknown[], version: number | null = 0, who = "creator") =>
  kit.call(who, "PUT", `/meetings/${id}/agenda`, { points }, version === null ? {} : { "If-Match": `"${version}"` });
const tick = (id: string, pointId: string, covered: boolean, who = "creator") => kit.call(who, "PUT", `/meetings/${id}/agenda/points/${pointId}/covered`, { covered });

describe("reading", () => {
  it("an empty agenda at version 0, with the edit hint for an editor only", async () => {
    const m = await seed();
    const res = await get(m.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"0"');
    expect(await json(res)).toEqual({ version: 0, points: [], can: { edit: true } });
    expect((await json(await get(m.id, "pat")))["can"]).toEqual({ edit: true });
    expect((await json(await get(m.id, "nina")))["can"]).toEqual({ edit: false });
  });

  it("a caller who cannot open the meeting gets the meeting's 404, for reading and writing", async () => {
    const m = await seed();
    expect((await get(m.id, "stranger")).status).toBe(404);
    expect((await put(m.id, [{ title: "x" }], 0, "stranger")).status).toBe(404);
    expect((await get("no-such-meeting")).status).toBe(404);
  });
});

describe("writing the list", () => {
  it("adds, edits, reorders and removes points; each change bumps the version", async () => {
    const m = await seed();
    const first = await json(await put(m.id, [{ title: " Budget ", note: "Agree Q3" }, { title: "Hiring", note: "  " }, { title: "AOB" }]));
    expect(first["version"]).toBe(1);
    expect(first["points"].map((p: any) => [p.title, p.note, p.covered])).toEqual([
      ["Budget", "Agree Q3", false],
      ["Hiring", null, false],
      ["AOB", null, false],
    ]);
    const [budget, hiring] = first["points"];

    // the participant reorders, edits one, drops the last and adds one
    const res = await put(m.id, [{ id: hiring.id, title: "Hiring plan" }, { id: budget.id, title: "Budget", note: "Agree Q3" }, { title: "Next steps" }], 1, "pat");
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('"2"');
    const second = await json(res);
    expect(second["points"].map((p: any) => p.title)).toEqual(["Hiring plan", "Budget", "Next steps"]);
    expect(second["points"][0].id).toBe(hiring.id);
    expect(await kit.db.agendaPoint.count({ where: { meetingId: m.id } })).toBe(3);
  });

  it("can be set when the meeting is created", async () => {
    const res = await kit.call("creator", "POST", "/meetings", { title: "Kick-off", format: "online", language: "en", source: "text", agenda: [{ title: "Scope" }, { title: "Plan", note: "Dates" }] });
    expect(res.status).toBe(201);
    const id = (await json(res))["id"] as string;
    expect((await json(await get(id)))["points"].map((p: any) => [p.title, p.note])).toEqual([
      ["Scope", null],
      ["Plan", "Dates"],
    ]);
  });

  it("a change made from an out-of-date list is 409 and overwrites nothing; no precondition is 428", async () => {
    const m = await seed();
    await put(m.id, [{ title: "Budget" }]);
    const stale = await put(m.id, [{ title: "Something else" }], 0, "pat");
    expect(stale.status).toBe(409);
    expect((await json(stale))["code"]).toBe("version_conflict");
    expect((await put(m.id, [{ title: "x" }], null)).status).toBe(428);
    expect((await json(await get(m.id)))["points"].map((p: any) => p.title)).toEqual(["Budget"]);
  });

  it("limits: 30 points, title 1-80, note up to 500; an id not on the agenda is 422", async () => {
    const m = await seed();
    const thirty = Array.from({ length: 30 }, (_, i) => ({ title: `Point ${i}` }));
    expect((await put(m.id, thirty)).status).toBe(200);
    const tooMany = await put(m.id, [...thirty, { title: "One more" }], 1);
    expect(tooMany.status).toBe(422);
    expect((await json(tooMany))["code"]).toBe("too_many_agenda_points");
    expect((await put(m.id, [{ title: "" }], 1)).status).toBe(422);
    expect((await put(m.id, [{ title: "x".repeat(81) }], 1)).status).toBe(422);
    expect((await put(m.id, [{ title: "ok", note: "n".repeat(501) }], 1)).status).toBe(422);
    const unknown = await put(m.id, [{ id: "not-a-point", title: "x" }], 1);
    expect(unknown.status).toBe(422);
    expect(await json(unknown)).toMatchObject({ code: "unknown_agenda_point", index: 0 });
    expect(await kit.db.agendaPoint.count({ where: { meetingId: m.id } })).toBe(30);
  });

  it("who may change it: not a participant without meetings:access, not anyone on a frozen meeting", async () => {
    const m = await seed();
    const refused = await put(m.id, [{ title: "x" }], 0, "nina");
    expect(refused.status).toBe(403);
    expect((await json(refused))["code"]).toBe("meetings_access_required");

    kit.deactivate("creator");
    const frozen = await put(m.id, [{ title: "x" }], 0, "pat");
    expect(frozen.status).toBe(403);
    expect((await json(frozen))["code"]).toBe("frozen");
    expect((await json(await get(m.id, "pat")))["can"]).toEqual({ edit: false });
  });

  it("an identity outage fails closed (503) and changes nothing", async () => {
    const m = await seed();
    kit.setIdentitiesDown(true);
    const res = await put(m.id, [{ title: "x" }], 0, "pat");
    expect(res.status).toBe(503);
    expect(await kit.db.agendaPoint.count({ where: { meetingId: m.id } })).toBe(0);
  });

  it("is deleted with the meeting", async () => {
    const m = await seed();
    await put(m.id, [{ title: "Budget" }]);
    expect((await kit.call("creator", "DELETE", `/meetings/${m.id}`)).status).toBe(204);
    expect(await kit.db.agendaPoint.count({ where: { meetingId: m.id } })).toBe(0);
  });
});

describe("covered marks", () => {
  it("any editor ticks and unticks a point without a precondition; the version does not move", async () => {
    const m = await seed();
    const [budget] = (await json(await put(m.id, [{ title: "Budget" }, { title: "Hiring" }])))["points"];
    const res = await tick(m.id, budget.id, true, "pat");
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body["version"]).toBe(1);
    expect(body["points"].map((p: any) => p.covered)).toEqual([true, false]);
    expect((await json(await tick(m.id, budget.id, false)))["points"][0].covered).toBe(false);
  });

  it("two people ticking different points both keep their ticks, and a later list change keeps the marks", async () => {
    const m = await seed();
    const [a, b] = (await json(await put(m.id, [{ title: "A" }, { title: "B" }])))["points"];
    await Promise.all([tick(m.id, a.id, true, "creator"), tick(m.id, b.id, true, "pat")]);
    const after = await json(await put(m.id, [{ id: b.id, title: "B" }, { id: a.id, title: "A renamed" }, { title: "C" }], 1));
    expect(after["points"].map((p: any) => [p.title, p.covered])).toEqual([
      ["B", true],
      ["A renamed", true],
      ["C", false],
    ]);
  });

  it("a tick on a point someone else removed is 404 agenda_point_not_found", async () => {
    const m = await seed();
    const [a] = (await json(await put(m.id, [{ title: "A" }, { title: "B" }])))["points"];
    const [, b] = (await json(await get(m.id)))["points"];
    await put(m.id, [{ id: b.id, title: "B" }], 1, "pat");
    const res = await tick(m.id, a.id, true);
    expect(res.status).toBe(404);
    expect((await json(res))["code"]).toBe("agenda_point_not_found");
  });

  it("a point of another meeting is not this meeting's", async () => {
    const m = await seed();
    const other = await seed();
    const [p] = (await json(await put(other.id, [{ title: "Theirs" }])))["points"];
    expect((await tick(m.id, p.id, true)).status).toBe(404);
    expect((await kit.db.agendaPoint.findUniqueOrThrow({ where: { id: p.id } })).covered).toBe(false);
  });
});
