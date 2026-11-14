import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createKit, type Kit } from "../test-support/routeKit";

// Personal meeting folders (ADR 20261113-personal-meeting-folders): each person's own, one level, a meeting in at most one folder per person.

const kit: Kit = await createKit();

let logs: ReturnType<typeof spyOn>[];
beforeEach(async () => {
  await kit.reset();
  for (const user of ["creator", "pat", "stranger"]) kit.grant(user, "access");
  logs = [spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "log").mockImplementation(() => {})];
});
afterEach(() => logs.forEach((s) => s.mockRestore()));

const json = async (res: Response) => (await res.json()) as Record<string, any>;
const seed = (title = "Budget review", startsAt = "2026-11-05T09:00:00.000Z") =>
  kit.db.meeting.create({
    data: {
      title,
      format: "online",
      startsAt: new Date(startsAt),
      language: "en",
      source: "recorded",
      creatorUserId: "creator",
      participants: { create: [{ userId: "pat", addedBy: "creator" }] },
    },
  });
const create = (name: string, who = "creator") => kit.call(who, "POST", "/folders", { name });
const list = async (who = "creator") => (await json(await kit.call(who, "GET", "/folders")))["items"] as Record<string, any>[];
const file = (meetingId: string, folderId: string | null, who = "creator") => kit.call(who, "PUT", `/meetings/${meetingId}/folder`, { folderId });
const meetings = async (query: string, who = "creator") => (await json(await kit.call(who, "GET", `/meetings?${query}`)))["items"] as Record<string, any>[];

describe("folders", () => {
  it("are created, listed by name with their counts, renamed and deleted", async () => {
    const b = await json(await create("  Clients  "));
    expect(b).toMatchObject({ name: "Clients", meetingCount: 0 });
    await create("Archive");
    expect((await list()).map((f) => f["name"])).toEqual(["Archive", "Clients"]);

    const renamed = await kit.call("creator", "PATCH", `/folders/${b["id"]}`, { name: "Customers" });
    expect(renamed.status).toBe(200);
    expect((await json(renamed))["name"]).toBe("Customers");

    expect((await kit.call("creator", "DELETE", `/folders/${b["id"]}`)).status).toBe(204);
    expect((await list()).map((f) => f["name"])).toEqual(["Archive"]);
  });

  it("refuse a name the same person already uses, ignoring case, and an empty or overlong one", async () => {
    await create("Clients");
    const dup = await create("clients");
    expect(dup.status).toBe(409);
    expect((await json(dup))["code"]).toBe("folder_name_taken");
    // Another person may use the same name.
    expect((await create("Clients", "pat")).status).toBe(201);
    expect((await create("   ")).status).toBe(422);
    expect((await create("x".repeat(81))).status).toBe(422);
    expect((await create("a\u0007b")).status).toBe(422);
  });

  it("are private: another person's folder is the 404 of a missing one, and never listed", async () => {
    const mine = await json(await create("Clients"));
    expect(await list("pat")).toEqual([]);
    expect((await kit.call("pat", "PATCH", `/folders/${mine["id"]}`, { name: "Mine now" })).status).toBe(404);
    expect((await kit.call("pat", "DELETE", `/folders/${mine["id"]}`)).status).toBe(404);
    expect((await list()).map((f) => f["name"])).toEqual(["Clients"]);
  });
});

describe("filing a meeting", () => {
  it("puts it in one folder at a time, per person, and the list filters on it", async () => {
    const budget = await seed("Budget review");
    const kickoff = await seed("Kickoff", "2026-11-06T09:00:00.000Z");
    const clients = await json(await create("Clients"));
    const archive = await json(await create("Archive"));

    expect(await json(await file(budget.id, clients["id"]))).toEqual({ folderId: clients["id"] });
    // Moving replaces: a meeting is in at most one folder for a person.
    await file(budget.id, archive["id"]);
    expect((await meetings(`folder=${archive["id"]}`)).map((m) => m["title"])).toEqual(["Budget review"]);
    expect(await meetings(`folder=${clients["id"]}`)).toEqual([]);
    expect((await meetings("folder=none")).map((m) => m["title"])).toEqual(["Kickoff"]);
    expect((await meetings("")).map((m) => [m["title"], m["folderId"]])).toEqual([
      ["Kickoff", null],
      ["Budget review", archive["id"]],
    ]);
    expect((await list()).map((f) => [f["name"], f["meetingCount"]])).toEqual([
      ["Archive", 1],
      ["Clients", 0],
    ]);

    // The participant files the same meeting their own way, and sees none of the creator's choice.
    const pats = await json(await create("Q4", "pat"));
    await file(budget.id, pats["id"], "pat");
    expect((await meetings("", "pat")).find((m) => m["title"] === "Budget review")?.["folderId"]).toBe(pats["id"]);
    expect((await meetings(`folder=${archive["id"]}`)).map((m) => m["title"])).toEqual(["Budget review"]);

    // Out of every folder.
    expect(await json(await file(budget.id, null))).toEqual({ folderId: null });
    expect((await meetings("folder=none")).map((m) => m["title"]).sort()).toEqual(["Budget review", "Kickoff"]);
  });

  it("refuses someone else's folder, and a meeting the caller cannot open is the 404 of a missing one", async () => {
    const m = await seed();
    const pats = await json(await create("Q4", "pat"));
    const refused = await file(m.id, pats["id"], "creator");
    expect(refused.status).toBe(422);
    expect((await json(refused))["code"]).toBe("folder_not_found");

    const strangers = await json(await create("Spy", "stranger"));
    expect((await file(m.id, strangers["id"], "stranger")).status).toBe(404);
    expect((await file("missing-id", null)).status).toBe(404);
  });

  it("deleting a folder leaves its meetings, in no folder; deleting a meeting leaves the folder", async () => {
    const m = await seed();
    const other = await seed("Kickoff", "2026-11-06T09:00:00.000Z");
    const clients = await json(await create("Clients"));
    await file(m.id, clients["id"]);
    await file(other.id, clients["id"]);

    await kit.db.meeting.delete({ where: { id: other.id } });
    expect((await list()).map((f) => f["meetingCount"])).toEqual([1]);

    await kit.call("creator", "DELETE", `/folders/${clients["id"]}`);
    expect((await meetings("folder=none")).map((m) => m["title"])).toEqual(["Budget review"]);
    expect(await kit.db.meetingFolderEntry.count()).toBe(0);
  });

  it("counts only the meetings the person can still open", async () => {
    const m = await seed();
    const pats = await json(await create("Q4", "pat"));
    await file(m.id, pats["id"], "pat");
    expect((await list("pat"))[0]?.["meetingCount"]).toBe(1);

    // Removed from the meeting: it no longer counts, and the folder lists nothing.
    await kit.db.meetingParticipant.deleteMany({ where: { meetingId: m.id, userId: "pat" } });
    expect((await list("pat"))[0]?.["meetingCount"]).toBe(0);
    expect(await meetings(`folder=${pats["id"]}`, "pat")).toEqual([]);
  });

  it("stops at 200 folders a person", async () => {
    await kit.db.meetingFolder.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ ownerUserId: "creator", name: `F${i}` })) });
    const refused = await create("One more");
    expect(refused.status).toBe(422);
    expect((await json(refused))["code"]).toBe("folder_limit");
  });
});
