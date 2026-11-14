/**
 * A task's description and files (ADR 20261113-task-description-files-in-activities-api-bucket): the upload in two phases, the limits, the short
 * URLs, the images a description may show, the clean-up of images it stops showing, and that
 * deleting a task (by a user or by crm-api's compensation) deletes its objects first and keeps
 * everything when the bucket refuses. Who may do what is the matrix's (src/matrix.test.ts).
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { call, db, makeCompany, makeProject, resetWorld, type PersonaName } from "../test-support/world";
import { useFakeStorage, type FakeStorage } from "../test-support/storage";
import { setStorageForTests } from "../lib/storage";
import { textToDoc } from "./description";

let storage: FakeStorage;
beforeEach(async () => {
  await resetWorld();
  storage = useFakeStorage();
});

const doc = (...content: unknown[]) => ({ type: "doc", content });
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = (fileId: string) => ({ type: "image", attrs: { fileId, alt: null } });

async function task(as: PersonaName = "consultant", extra: Record<string, unknown> = {}) {
  const company = makeCompany();
  const res = await call("POST", "/activities", { as, body: { type: "task", subject: "Prepare the demo", companyId: company.id, ...extra } });
  expect(res.status).toBe(201);
  return res.json as { id: string };
}

/** Starts an upload, lands the bytes and confirms it: what the browser does. */
async function upload(activityId: string, kind: "image" | "attachment", options: { as?: PersonaName; contentType?: string; sizeBytes?: number; fileName?: string } = {}) {
  const contentType = options.contentType ?? (kind === "image" ? "image/png" : "application/pdf");
  const sizeBytes = options.sizeBytes ?? 2048;
  const started = await call("POST", `/activities/${activityId}/files`, {
    as: options.as ?? "consultant",
    body: { kind, fileName: options.fileName ?? (kind === "image" ? "shot.png" : "offer.pdf"), contentType, sizeBytes },
  });
  expect(started.status).toBe(201);
  storage.upload(started.json.upload.fields.key, sizeBytes, contentType);
  const confirmed = await call("POST", `/activities/${activityId}/files/${started.json.fileId}/confirm`, { as: options.as ?? "consultant" });
  expect(confirmed.status).toBe(200);
  return confirmed.json as { id: string; kind: string };
}

const view = async (activityId: string, companyAs: PersonaName = "consultant") => {
  const row = await db.activity.findUniqueOrThrow({ where: { id: activityId } });
  const list = await call("GET", `/activities?companyId=${row.hostId}`, { as: companyAs });
  return list.json.items.find((item: { id: string }) => item.id === activityId);
};

describe("the description of a task", () => {
  it("is saved and returned as given; an empty document is no description", async () => {
    const created = await task("consultant", { description: doc(para("Bring the cables"), { type: "bulletList", content: [] }) });
    expect((await view(created.id)).task.description).toEqual(doc(para("Bring the cables"), { type: "bulletList", content: [] }));
    const cleared = await call("PATCH", `/activities/${created.id}`, { as: "consultant", body: { description: doc({ type: "paragraph" }) } });
    expect(cleared.status).toBe(200);
    expect(cleared.json.task.description).toBeNull();
  });

  it("a plain body sent for a task becomes its description, one paragraph per line; other types keep their body", async () => {
    const created = await task("consultant", { body: "First line\n\nThird line" });
    const row = await db.activity.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.body).toBeNull();
    expect(row.description as unknown).toEqual(doc(para("First line"), { type: "paragraph" }, para("Third line")));
    expect(textToDoc("one") as unknown).toEqual(doc(para("one")));

    const company = makeCompany();
    const note = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "Call notes", body: "Plain", companyId: company.id } });
    expect(note.json.body).toBe("Plain");
    const refused = await call("POST", "/activities", {
      as: "consultant",
      body: { type: "note", subject: "x", companyId: company.id, description: doc(para("rich")) },
    });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: "task_fields_on_non_task", field: "description" });
  });

  it("must be a document of at most 128 KiB, without NUL", async () => {
    const company = makeCompany();
    const base = { type: "task", subject: "x", companyId: company.id };
    expect((await call("POST", "/activities", { body: { ...base, description: { type: "paragraph" } } })).status).toBe(422);
    expect((await call("POST", "/activities", { body: { ...base, description: doc(para("a\u0000b")) } })).status).toBe(422);
    const big = doc(para("x".repeat(140 * 1024)));
    expect((await call("POST", "/activities", { body: { ...base, description: big } })).status).toBe(422);
    expect(await db.activity.count()).toBe(0);
  });

  it("shows only this task's own stored images", async () => {
    const company = makeCompany();
    // A new task has no files: no image can be shown yet.
    const early = await call("POST", "/activities", {
      as: "consultant",
      body: { type: "task", subject: "x", companyId: company.id, description: doc(image(crypto.randomUUID())) },
    });
    expect(early.status).toBe(422);
    expect(early.json.code).toBe("image_not_found");

    const mine = await task();
    const other = await task();
    const shot = await upload(mine.id, "image");
    const elsewhere = await upload(other.id, "image");
    const attachment = await upload(mine.id, "attachment");

    for (const id of [elsewhere.id, attachment.id]) {
      const res = await call("PATCH", `/activities/${mine.id}`, { as: "consultant", body: { description: doc(image(id)) } });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe("image_not_found");
    }
    const ok = await call("PATCH", `/activities/${mine.id}`, { as: "consultant", body: { description: doc(para("See:"), image(shot.id)) } });
    expect(ok.status).toBe(200);
    expect(ok.json.task.files.map((file: { id: string }) => file.id)).toEqual([shot.id, attachment.id]);
  });
});

describe("uploading a file", () => {
  it("is pending until the uploader confirms it, and the size recorded is what landed", async () => {
    const created = await task();
    const started = await call("POST", `/activities/${created.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "../../etc/Offer final.pdf", contentType: "application/pdf", sizeBytes: 5000 },
    });
    expect(started.status).toBe(201);
    const key = `activities/${created.id}/${started.json.fileId}`;
    expect(started.json.upload.fields.key).toBe(key);
    expect(storage.posts).toEqual([{ objectKey: key, contentType: "application/pdf", maxBytes: 20 * 1024 * 1024 }]);
    expect((await view(created.id)).task.files).toEqual([]);

    const early = await call("POST", `/activities/${created.id}/files/${started.json.fileId}/confirm`, { as: "consultant" });
    expect(early.status).toBe(409);
    expect(early.json.code).toBe("upload_missing");

    storage.upload(key, 4321);
    const confirmed = await call("POST", `/activities/${created.id}/files/${started.json.fileId}/confirm`, { as: "consultant" });
    expect(confirmed.json).toMatchObject({ kind: "attachment", fileName: "Offer final.pdf", sizeBytes: 4321, uploadedBy: { id: "user-consultant" } });
    // Confirming twice is harmless.
    expect((await call("POST", `/activities/${created.id}/files/${started.json.fileId}/confirm`, { as: "consultant" })).status).toBe(200);
    expect((await view(created.id)).task.files).toHaveLength(1);
  });

  it("only the uploader confirms (a second manager of the project cannot)", async () => {
    const project = makeProject();
    const created = await call("POST", "/activities", { as: "manager", body: { type: "task", subject: "x", projectId: project.id } });
    const started = await call("POST", `/activities/${created.json.id}/files`, {
      as: "manager",
      body: { kind: "attachment", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 },
    });
    storage.upload(started.json.upload.fields.key, 10);
    const res = await call("POST", `/activities/${created.json.id}/files/${started.json.fileId}/confirm`, { as: "alice" });
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("uploader_only");
  });

  it("refuses types and sizes outside the policy, on a task only", async () => {
    const created = await task();
    const start = (body: Record<string, unknown>) => call("POST", `/activities/${created.id}/files`, { as: "consultant", body: { fileName: "f", sizeBytes: 10, ...body } });
    expect((await start({ kind: "image", contentType: "application/pdf" })).json.code).toBe("file_type_not_allowed");
    expect((await start({ kind: "image", contentType: "image/svg+xml" })).json.code).toBe("file_type_not_allowed");
    expect((await start({ kind: "attachment", contentType: "application/x-msdownload" })).json.code).toBe("file_type_not_allowed");
    expect((await start({ kind: "image", contentType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 })).json.code).toBe("file_too_large");
    expect((await start({ kind: "attachment", contentType: "application/pdf", sizeBytes: 20 * 1024 * 1024 + 1 })).json.code).toBe("file_too_large");
    expect((await start({ kind: "attachment", contentType: "text/csv" })).status).toBe(201);

    const company = makeCompany();
    const note = await call("POST", "/activities", { as: "consultant", body: { type: "note", subject: "n", companyId: company.id } });
    const onNote = await call("POST", `/activities/${note.json.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "f", contentType: "application/pdf", sizeBytes: 10 },
    });
    expect(onNote.json.code).toBe("not_a_task");
  });

  it("a task holds at most 20 files", async () => {
    const created = await task();
    for (let i = 0; i < 20; i++) {
      const res = await call("POST", `/activities/${created.id}/files`, {
        as: "consultant",
        body: { kind: "attachment", fileName: `f${i}.pdf`, contentType: "application/pdf", sizeBytes: 10 },
      });
      expect(res.status).toBe(201);
    }
    const res = await call("POST", `/activities/${created.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "one-more.pdf", contentType: "application/pdf", sizeBytes: 10 },
    });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("too_many_files");
  });

  it("is a 503 storage_unconfigured without a bucket, and nothing is recorded", async () => {
    const created = await task();
    setStorageForTests(null);
    const res = await call("POST", `/activities/${created.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 },
    });
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("storage_unconfigured");
    expect(await db.activityFile.count()).toBe(0);
  });
});

describe("reading a file", () => {
  it("is a short presigned GET: an image inline, an attachment as a download", async () => {
    const created = await task();
    const shot = await upload(created.id, "image");
    const pdf = await upload(created.id, "attachment");
    const imageUrl = await call("GET", `/activities/${created.id}/files/${shot.id}/url`, { as: "colleague" });
    expect(imageUrl.status).toBe(200);
    expect(imageUrl.json.url).toContain(shot.id);
    await call("GET", `/activities/${created.id}/files/${pdf.id}/url`, { as: "colleague" });
    expect(storage.gets.map((get) => get.disposition)).toEqual(["inline", "attachment"]);
  });

  it("a pending file, or one of another task, is the 404 of a file that does not exist", async () => {
    const created = await task();
    const other = await task();
    const elsewhere = await upload(other.id, "attachment");
    const started = await call("POST", `/activities/${created.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 },
    });
    const missing = await call("GET", `/activities/${created.id}/files/${crypto.randomUUID()}/url`, { as: "consultant" });
    for (const fileId of [started.json.fileId, elsewhere.id]) {
      const res = await call("GET", `/activities/${created.id}/files/${fileId}/url`, { as: "consultant" });
      expect(res.status).toBe(404);
      expect({ ...res.json, instance: undefined }).toEqual({ ...missing.json, instance: undefined });
    }
  });
});

describe("removing files", () => {
  it("an attachment: the object first, then the row; a bucket failure changes nothing", async () => {
    const created = await task();
    const pdf = await upload(created.id, "attachment");
    storage.failDeletes = true;
    const refused = await call("DELETE", `/activities/${created.id}/files/${pdf.id}`, { as: "consultant" });
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe("storage_unavailable");
    expect(await db.activityFile.count()).toBe(1);

    storage.failDeletes = false;
    expect((await call("DELETE", `/activities/${created.id}/files/${pdf.id}`, { as: "consultant" })).status).toBe(204);
    expect(storage.deletes).toEqual([`activities/${created.id}/${pdf.id}`]);
    expect(await db.activityFile.count()).toBe(0);
  });

  it("an image the description still shows is refused; one taken out of the text is removed when it is saved", async () => {
    const created = await task();
    const shot = await upload(created.id, "image");
    await call("PATCH", `/activities/${created.id}`, { as: "consultant", body: { description: doc(image(shot.id)) } });
    const inUse = await call("DELETE", `/activities/${created.id}/files/${shot.id}`, { as: "consultant" });
    expect(inUse.status).toBe(409);
    expect(inUse.json.code).toBe("image_in_use");

    const saved = await call("PATCH", `/activities/${created.id}`, { as: "consultant", body: { description: doc(para("No picture")) } });
    expect(saved.status).toBe(200);
    expect(storage.deletes).toEqual([`activities/${created.id}/${shot.id}`]);
    expect(await db.activityFile.count()).toBe(0);
  });

  it("an image uploaded a moment ago and not yet in the text is kept; an old unused one and an abandoned upload are removed", async () => {
    const created = await task();
    const fresh = await upload(created.id, "image");
    const old = await upload(created.id, "image");
    await db.activityFile.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    const abandoned = await call("POST", `/activities/${created.id}/files`, {
      as: "consultant",
      body: { kind: "attachment", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 10 },
    });
    await db.activityFile.update({ where: { id: abandoned.json.fileId }, data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

    await call("PATCH", `/activities/${created.id}`, { as: "consultant", body: { description: doc(para("text")) } });
    const left = await db.activityFile.findMany({ select: { id: true } });
    expect(left.map((file) => file.id)).toEqual([fresh.id]);
  });

  it("deleting a task deletes its objects first; when the bucket refuses, the task and its files stay", async () => {
    const created = await task();
    const pdf = await upload(created.id, "attachment");
    storage.failDeletes = true;
    const refused = await call("DELETE", `/activities/${created.id}`, { as: "consultant" });
    expect(refused.status).toBe(503);
    expect(await db.activity.count()).toBe(1);
    expect(await db.activityFile.count()).toBe(1);

    storage.failDeletes = false;
    expect((await call("DELETE", `/activities/${created.id}`, { as: "consultant" })).status).toBe(204);
    expect(storage.deletes).toEqual([`activities/${created.id}/${pdf.id}`]);
    expect(await db.activity.count()).toBe(0);
    expect(await db.activityFile.count()).toBe(0);
  });

  it("a task without files is deleted even with no bucket configured", async () => {
    const created = await task();
    setStorageForTests(null);
    expect((await call("DELETE", `/activities/${created.id}`, { as: "consultant" })).status).toBe(204);
  });
});
