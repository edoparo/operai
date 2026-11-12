import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createKit, type Kit } from "../test-support/routeKit";

// Personal meeting notes: each person who can open a meeting has their own, private, autosaved notes.

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
const seed = () =>
  kit.db.meeting.create({
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
const get = (id: string, who = "creator") => kit.call(who, "GET", `/meetings/${id}/notes`);
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = (body: Record<string, any>) => body["content"]?.content?.[0]?.content?.[0]?.text ?? null;
const putDoc = (id: string, content: unknown, version: number | null, who = "creator") =>
  kit.call(who, "PUT", `/meetings/${id}/notes`, { content }, version === null ? {} : { "If-Match": `"${version}"` });
const put = (id: string, text: string, version: number | null, who = "creator") => putDoc(id, doc(text), version, who);

describe("own notes", () => {
  it("start empty at version 0, then each save moves the version", async () => {
    const m = await seed();
    const empty = await get(m.id);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("ETag")).toBe('"0"');
    expect(await json(empty)).toEqual({ content: null, version: 0, updatedAt: null });

    const first = await put(m.id, "Ask about Q3", 0);
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    expect(firstBody).toMatchObject({ content: doc("Ask about Q3"), version: 1 });
    const second = await json(await put(m.id, "Ask about Q3\n- budget owner?", 1));
    expect(second["version"]).toBe(2);
    expect(textOf(await json(await get(m.id)))).toBe("Ask about Q3\n- budget owner?");
  });

  it("are private: each person reads only their own, the meeting's creator included", async () => {
    const m = await seed();
    await put(m.id, "creator's thoughts", 0, "creator");
    await put(m.id, "pat's thoughts", 0, "pat");
    expect(textOf(await json(await get(m.id, "creator")))).toBe("creator's thoughts");
    expect(textOf(await json(await get(m.id, "pat")))).toBe("pat's thoughts");
    expect((await json(await get(m.id, "nina")))["content"]).toBeNull();
  });

  it("a participant without meetings:access, and anyone on a frozen meeting, still keep their own notes", async () => {
    const m = await seed();
    expect((await put(m.id, "mine", 0, "nina")).status).toBe(200);
    kit.deactivate("creator");
    expect((await put(m.id, "still mine", 0, "pat")).status).toBe(200);
  });

  it("someone who cannot open the meeting gets the meeting's 404, and a removed participant loses access", async () => {
    const m = await seed();
    expect((await get(m.id, "stranger")).status).toBe(404);
    expect((await put(m.id, "x", 0, "stranger")).status).toBe(404);
    await put(m.id, "pat's", 0, "pat");
    await kit.db.meetingParticipant.deleteMany({ where: { meetingId: m.id, userId: "pat" } });
    expect((await get(m.id, "pat")).status).toBe(404);
  });

  it("a save from a stale tab is 409 and overwrites nothing; no precondition is 428", async () => {
    const m = await seed();
    await put(m.id, "tab A", 0);
    const stale = await put(m.id, "tab B", 0);
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: "version_conflict", currentVersion: 1 });
    expect((await put(m.id, "tab B", 5)).status).toBe(409);
    expect((await put(m.id, "x", null)).status).toBe(428);
    expect(textOf(await json(await get(m.id)))).toBe("tab A");
  });

  it("only a document, at most 512 KiB; deleted with the meeting", async () => {
    const m = await seed();
    for (const bad of ["plain text", { type: "paragraph" }, null, [doc("x")]]) expect((await putDoc(m.id, bad, 0)).status).toBe(422);
    expect((await put(m.id, "x".repeat(530_000), 0)).status).toBe(422);
    // what the editor adds (marks, attrs, task lists) is kept as given
    const rich = { type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Done" }] }] }] }] };
    expect(await json(await putDoc(m.id, rich, 0))).toMatchObject({ content: rich, version: 1 });
    expect((await kit.call("creator", "DELETE", `/meetings/${m.id}`)).status).toBe(204);
    expect(await kit.db.meetingNote.count({ where: { meetingId: m.id } })).toBe(0);
  });
});
