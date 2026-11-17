import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createKit, type Kit } from "../test-support/routeKit";
import { setAttachmentsClockForTests } from "./attachments.routes";
import { loadMeetingContext, bytesMatchType } from "./aiContext";
import { aiContextOf } from "./derived";

// Files and links attached to a meeting (ADR 20261117-meeting-attachments-in-the-audio-bucket-forwarded-unparsed):
// edited by the agenda's editors, read by everyone who can open the meeting, files kept 29 days like the audio.

const kit: Kit = await createKit();

let logs: ReturnType<typeof spyOn>[];
beforeEach(async () => {
  await kit.reset();
  for (const user of ["creator", "pat", "stranger"]) kit.grant(user, "access");
  kit.grant("nina"); // a participant without meetings:access
  setAttachmentsClockForTests(null);
  logs = [spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "log").mockImplementation(() => {})];
});
afterEach(() => {
  logs.forEach((s) => s.mockRestore());
  setAttachmentsClockForTests(null);
});

const json = async (res: Response) => (await res.json()) as Record<string, any>;
const PDF = new TextEncoder().encode("%PDF-1.7 slides");

async function seed() {
  return kit.db.meeting.create({
    data: {
      title: "Roadmap",
      format: "online",
      startsAt: new Date("2026-11-05T09:00:00.000Z"),
      language: "en",
      source: "recorded",
      creatorUserId: "creator",
      participants: { create: [{ userId: "pat", addedBy: "creator" }, { userId: "nina", addedBy: "creator" }] },
    },
  });
}
const list = (id: string, who = "creator") => kit.call(who, "GET", `/meetings/${id}/attachments`);

/** Mint, "upload" into the fake bucket, confirm. */
async function attach(id: string, file: { name: string; contentType: string; bytes: Uint8Array }, who = "creator") {
  const minted = await kit.call(who, "POST", `/meetings/${id}/attachments/files`, { name: file.name, contentType: file.contentType, sizeBytes: file.bytes.length });
  expect(minted.status).toBe(201);
  const { attachmentId, upload } = await json(minted);
  kit.storage.put(upload.fields.key, file.bytes.length, file.contentType, file.bytes);
  return { attachmentId: attachmentId as string, key: upload.fields.key as string, confirm: () => kit.call(who, "POST", `/meetings/${id}/attachments/${attachmentId}/confirm`) };
}

describe("files", () => {
  it("mint pins type and exact size under a fresh attachments key; confirm makes it listed and used by the AI", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "slides.pdf", contentType: "application/pdf", bytes: PDF }, "pat");
    expect(up.key).toMatch(new RegExp(`^meetings/${m.id}/attachments/[0-9a-f-]{36}$`));
    expect(kit.storage.minted.at(-1)).toMatchObject({ kind: "attachment", contentType: "application/pdf", sizeBytes: PDF.length });

    // pending: not on the list yet
    expect((await json(await list(m.id)))["attachments"]).toEqual([]);

    const res = await up.confirm();
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ kind: "file", name: "slides.pdf", sizeBytes: PDF.length, expired: false, aiContext: "used", addedByUserId: "pat" });

    const body = await json(await list(m.id, "nina"));
    expect(body["attachments"]).toHaveLength(1);
    expect(body["can"]).toEqual({ edit: false });
    expect(body["limits"]["aiContentTypes"]).toContain("application/pdf");
  });

  it("refuses an unknown type and an oversized file before minting", async () => {
    const m = await seed();
    const before = kit.storage.minted.length;
    const bad = await kit.call("creator", "POST", `/meetings/${m.id}/attachments/files`, { name: "x.exe", contentType: "application/x-msdownload", sizeBytes: 10 });
    expect(bad.status).toBe(422);
    expect((await json(bad))["code"]).toBe("unsupported_type");
    const big = await kit.call("creator", "POST", `/meetings/${m.id}/attachments/files`, { name: "x.pdf", contentType: "application/pdf", sizeBytes: 21 * 1024 * 1024 });
    expect((await json(big))["code"]).toBe("file_too_large");
    expect(kit.storage.minted).toHaveLength(before);
  });

  it("an Office file is stored but never read by the AI", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "deck.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) });
    expect((await json(await up.confirm()))["aiContext"]).toBe("not_supported");
  });

  it("confirm: missing object is 409, a mismatching one is 422 and removed, someone else's pending upload is 404", async () => {
    const m = await seed();
    const minted = await json(await kit.call("creator", "POST", `/meetings/${m.id}/attachments/files`, { name: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }));
    const confirm = (who = "creator") => kit.call(who, "POST", `/meetings/${m.id}/attachments/${minted.attachmentId}/confirm`);
    expect((await json(await confirm()))["code"]).toBe("upload_missing");
    expect((await confirm("pat")).status).toBe(404);
    kit.storage.put(minted.upload.fields.key, 11, "application/pdf");
    const mismatch = await confirm();
    expect(mismatch.status).toBe(422);
    expect((await json(mismatch))["code"]).toBe("upload_mismatch");
    expect(kit.storage.keys()).not.toContain(minted.upload.fields.key);
    expect(await kit.db.meetingAttachment.count()).toBe(0);
  });

  it("a confirm after the upload window is 409 upload_expired", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "a.pdf", contentType: "application/pdf", bytes: PDF });
    setAttachmentsClockForTests(() => new Date(Date.now() + 16 * 60_000));
    expect((await json(await up.confirm()))["code"]).toBe("upload_expired");
  });

  it("at most 10 files, counting uploads in flight", async () => {
    const m = await seed();
    for (let i = 0; i < 10; i++) await kit.call("creator", "POST", `/meetings/${m.id}/attachments/files`, { name: `f${i}.pdf`, contentType: "application/pdf", sizeBytes: 10 });
    const res = await kit.call("creator", "POST", `/meetings/${m.id}/attachments/files`, { name: "f.pdf", contentType: "application/pdf", sizeBytes: 10 });
    expect(res.status).toBe(409);
    expect((await json(res))["code"]).toBe("too_many_files");
  });

  it("expires 29 days after upload: listed as expired, no download, no AI", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "a.pdf", contentType: "application/pdf", bytes: PDF });
    await up.confirm();
    expect((await kit.call("nina", "GET", `/meetings/${m.id}/attachments/${up.attachmentId}/download`)).status).toBe(200);

    setAttachmentsClockForTests(() => new Date(Date.now() + 29 * 86_400_000 + 1000));
    const [item] = (await json(await list(m.id)))["attachments"];
    expect(item).toMatchObject({ expired: true, aiContext: "expired" });
    const dl = await kit.call("creator", "GET", `/meetings/${m.id}/attachments/${up.attachmentId}/download`);
    expect(dl.status).toBe(410);
    expect((await json(dl))["code"]).toBe("attachment_expired");
  });

  it("delete removes the object first; a store outage is a 503 and keeps the row", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "a.pdf", contentType: "application/pdf", bytes: PDF });
    await up.confirm();
    kit.storage.failWith(new Error("down"));
    expect((await kit.call("creator", "DELETE", `/meetings/${m.id}/attachments/${up.attachmentId}`)).status).toBe(503);
    kit.storage.failWith(null);
    expect(await kit.db.meetingAttachment.count()).toBe(1);
    expect((await kit.call("pat", "DELETE", `/meetings/${m.id}/attachments/${up.attachmentId}`)).status).toBe(204);
    expect(kit.storage.keys()).not.toContain(up.key);
    expect(await kit.db.meetingAttachment.count()).toBe(0);
  });

  it("deleting the recording keeps the attachments; deleting the meeting removes them", async () => {
    const m = await seed();
    const up = await attach(m.id, { name: "a.pdf", contentType: "application/pdf", bytes: PDF });
    await up.confirm();
    kit.storage.put(`meetings/${m.id}/audio.ogg`, 3, "audio/ogg");
    await kit.storage.deleteAudio(m.id);
    expect(kit.storage.keys()).toEqual([up.key]);
    await kit.storage.deletePrefix(`meetings/${m.id}/`);
    expect(kit.storage.keys()).toEqual([]);
  });
});

describe("links", () => {
  it("stores an http(s) link with its label; refuses other schemes and credentials", async () => {
    const m = await seed();
    const ok = await kit.call("pat", "POST", `/meetings/${m.id}/attachments/links`, { url: "https://docs.example.com/slides?id=1", label: "  Q3 slides " });
    expect(ok.status).toBe(201);
    expect(await json(ok)).toMatchObject({ kind: "link", url: "https://docs.example.com/slides?id=1", label: "Q3 slides", aiContext: "label_only" });
    for (const url of ["javascript:alert(1)", "ftp://x.example.com", "https://user:pw@example.com/", "not a url"]) {
      const res = await kit.call("pat", "POST", `/meetings/${m.id}/attachments/links`, { url });
      expect((await json(res))["code"], url).toBe("invalid_url");
    }
  });
});

describe("who", () => {
  it("a host-reader-less outsider gets the meeting's 404; a participant without the grant cannot write", async () => {
    const m = await seed();
    expect((await list(m.id, "stranger")).status).toBe(404);
    const res = await kit.call("nina", "POST", `/meetings/${m.id}/attachments/links`, { url: "https://example.com" });
    expect(res.status).toBe(403);
    expect((await json(res))["code"]).toBe("meetings_access_required");
  });
});

describe("AI context", () => {
  it("takes used files oldest first within the budget, checks their signature, and names link labels", async () => {
    const m = await seed();
    const pdf = await attach(m.id, { name: "agenda.pdf", contentType: "application/pdf", bytes: PDF });
    await pdf.confirm();
    const fake = await attach(m.id, { name: "fake.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("<html>") });
    await fake.confirm();
    const md = await attach(m.id, { name: "notes.md", contentType: "text/markdown", bytes: new TextEncoder().encode("# Terms\nKubernetes") });
    await md.confirm();
    await kit.call("creator", "POST", `/meetings/${m.id}/attachments/links`, { url: "https://example.com", label: "Board" });

    const context = await loadMeetingContext({ db: kit.db, storage: () => kit.storage }, m.id, new Date());
    expect(context.documents.map((d) => [d.name, d.mediaType])).toEqual([
      ["agenda.pdf", "application/pdf"],
      ["notes.md", "text/plain"],
    ]);
    expect(context.linkLabels).toEqual(["Board"]);
  });

  it("a storage outage leaves the files out and never throws", async () => {
    const m = await seed();
    const pdf = await attach(m.id, { name: "agenda.pdf", contentType: "application/pdf", bytes: PDF });
    await pdf.confirm();
    kit.storage.failWith(new Error("down"));
    const context = await loadMeetingContext({ db: kit.db, storage: () => kit.storage }, m.id, new Date());
    kit.storage.failWith(null);
    expect(context.documents).toEqual([]);
  });

  it("budget: one file over 5 MiB and whatever passes 8 MiB in total are too_large", () => {
    const at = new Date("2026-11-10T00:00:00Z");
    const f = (id: string, mb: number, minutes: number) => ({ id, contentType: "application/pdf", sizeBytes: mb * 1024 * 1024, storedAt: new Date(at.getTime() + minutes * 60_000) });
    const map = aiContextOf([f("c", 3, 2), f("a", 4, 0), f("big", 6, 1), f("b", 3, 3)], at);
    expect(Object.fromEntries(map)).toEqual({ a: "used", big: "too_large", c: "used", b: "too_large" });
  });

  it("signatures", () => {
    const b = (...xs: number[]) => new Uint8Array(xs);
    expect(bytesMatchType(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png")).toBe(true);
    expect(bytesMatchType(b(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(bytesMatchType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
    expect(bytesMatchType(b(0xff, 0xfe, 0x00), "text/plain")).toBe(false);
    expect(bytesMatchType(new TextEncoder().encode("plain"), "application/pdf")).toBe(false);
  });
});
