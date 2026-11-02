import { beforeEach, describe, expect, it } from "bun:test";
import { PDFDocument, degrees } from "pdf-lib";
import { bucket, call, db, resetWorld } from "../test-support/world";
import { checkLetterhead } from "./letterhead";

/** specs/020 US-2: the letterhead upload, validation and download. */
const PROFILE = { legalName: "wellD SA", addressLines: ["Via Example 1"], placeOfIssue: null };

async function pdf(pages = 1, size: [number, number] = [595.28, 841.89], rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    page.drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
    if (rotate) page.setRotation(degrees(rotate));
  }
  return doc.save();
}

const startUpload = async (entity = "welld_ch", as: "admin" | "salesCh" = "admin") =>
  call("POST", `/entity-profiles/${entity}/letterhead`, { as });
/** Mints an object name like the browser flow, then drops `bytes` into the bucket under it. */
async function upload(bytes: Uint8Array, entity = "welld_ch"): Promise<string> {
  const started = await startUpload(entity);
  expect(started.status).toBe(201);
  const objectKey: string = started.json["key"];
  bucket.objects.set(objectKey, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
  return objectKey;
}
const confirm = (objectKey: string, entity = "welld_ch", as: "admin" | "salesCh" = "admin") =>
  call("POST", `/entity-profiles/${entity}/letterhead/confirm`, { as, body: { key: objectKey } });
const storedKey = async (entity = "welld_ch") =>
  (await db.entityProfile.findUniqueOrThrow({ where: { entity: entity as "welld_ch" } })).letterheadKey;

describe("letterhead check (AC-2.5)", () => {
  it("accepts one A4 page (portrait, within 2 pt, or rotated)", async () => {
    expect(await checkLetterhead(await pdf())).toEqual({ ok: true });
    expect(await checkLetterhead(await pdf(1, [596.5, 840.2]))).toEqual({ ok: true });
    expect(await checkLetterhead(await pdf(1, [841.89, 595.28], 90))).toEqual({ ok: true });
  });

  it("refuses other sizes, several pages, garbage and a page it cannot embed", async () => {
    expect(await checkLetterhead(await pdf(1, [612, 792]))).toEqual({ ok: false, reason: "not_a4" });
    expect(await checkLetterhead(await pdf(1, [598, 841.89]))).toEqual({ ok: false, reason: "not_a4" });
    expect(await checkLetterhead(await pdf(2))).toEqual({ ok: false, reason: "page_count" });
    expect(await checkLetterhead(new TextEncoder().encode("hello"))).toEqual({ ok: false, reason: "not_pdf" });
    const blank = await PDFDocument.create();
    blank.addPage([595.28, 841.89]);
    expect(await checkLetterhead(await blank.save())).toEqual({ ok: false, reason: "unembeddable" });
  });
});

describe("letterhead routes", () => {
  beforeEach(resetWorld);
  const withProfile = () => call("PUT", "/entity-profiles/welld_ch", { body: PROFILE });

  it("mints a presigned POST capped at 5 MiB under letterheads/<entity>/<uuid>.pdf", async () => {
    await withProfile();
    const started = await startUpload();
    expect(started.json["key"]).toMatch(/^letterheads\/welld_ch\/[0-9a-f-]{36}\.pdf$/);
    expect(started.json.upload.fields["Content-Type"]).toBe("application/pdf");
    expect(bucket.lastPostMaxBytes).toBe(5 * 1024 * 1024);
  });

  it("needs the entity's profile and deal:manage over that entity", async () => {
    expect((await startUpload()).json).toMatchObject({ status: 409, code: "entity_profile_missing" });
    expect((await confirm("letterheads/welld_ch/x.pdf")).json.code).toBe("entity_profile_missing");
    await withProfile();
    await call("PUT", "/entity-profiles/welld_it", { body: PROFILE });
    expect((await startUpload("welld_it", "salesCh")).json.code).toBe("out_of_scope");
    expect((await confirm("letterheads/welld_it/x.pdf", "welld_it", "salesCh")).json.code).toBe("out_of_scope");
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead", { as: "consultant" })).status).toBe(403);
  });

  it("accepts a valid letterhead, records who and when, and replaces the previous one", async () => {
    await withProfile();
    const first = await upload(await pdf());
    const done = await confirm(first);
    expect(done.status).toBe(200);
    expect(done.json.letterhead).toMatchObject({ uploadedBy: { id: "user-admin" } });
    expect(new Date(done.json.letterhead.uploadedAt).getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(await storedKey()).toBe(first);

    const second = await upload(await pdf());
    expect((await confirm(second)).status).toBe(200);
    expect(bucket.deleted).toEqual([first]);
    expect(await storedKey()).toBe(second);
    // confirming again is harmless
    expect((await confirm(second)).status).toBe(200);
    expect(bucket.deleted).toEqual([first]);
    // editing the other details keeps the letterhead
    const put = await call("PUT", "/entity-profiles/welld_ch", { body: { ...PROFILE, placeOfIssue: "Zug" } });
    expect(put.json).toMatchObject({ placeOfIssue: "Zug", letterhead: { uploadedBy: { id: "user-admin" } } });
  });

  it("refuses two pages, a non-PDF and a wrong size with 422 letterhead_invalid, deletes the upload and keeps the old letterhead", async () => {
    await withProfile();
    const good = await upload(await pdf());
    await confirm(good);
    const cases: [string, Uint8Array][] = [
      ["page_count", await pdf(2)],
      ["not_pdf", new TextEncoder().encode("<html>nope</html>")],
      ["not_a4", await pdf(1, [612, 792])],
    ];
    for (const [reason, bytes] of cases) {
      bucket.deleted = [];
      const bad = await upload(bytes);
      const res = await confirm(bad);
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "letterhead_invalid", reason });
      expect(bucket.deleted).toEqual([bad]);
      expect(bucket.objects.has(bad)).toBe(false);
      expect(await storedKey()).toBe(good);
    }
    expect(bucket.objects.has(good)).toBe(true);
  });

  it("refuses an object over 5 MiB without reading it", async () => {
    await withProfile();
    const started = await startUpload();
    const big: string = started.json["key"];
    bucket.objects.set(big, { bytes: await pdf(), contentType: "application/pdf", sizeBytes: 5 * 1024 * 1024 + 1 });
    const res = await confirm(big);
    expect(res.json).toMatchObject({ code: "letterhead_invalid", reason: "too_large" });
    expect(bucket.reads).toEqual([]);
    expect(bucket.deleted).toEqual([big]);
  });

  it("only confirms names under this entity's letterheads/ prefix, and never reads or deletes anything else", async () => {
    await withProfile();
    await call("PUT", "/entity-profiles/welld_it", { body: PROFILE });
    const foreign = await upload(await pdf(), "welld_it");
    const attachment = "attachments/deal-1/att-1/private.pdf";
    bucket.objects.set(attachment, { bytes: await pdf(2), contentType: "application/pdf", sizeBytes: 10 });
    for (const candidate of [
      foreign,
      attachment,
      "letterheads/welld_ch/../welld_it/x.pdf",
      "letterheads/welld_ch/not-a-uuid.pdf",
      `letterheads/welld_ch/${crypto.randomUUID()}.pdf/extra`,
      "offers/deal/o.pdf",
    ]) {
      const res = await confirm(candidate);
      expect(res.json).toMatchObject({ status: 422, code: "letterhead_key_invalid" });
    }
    expect(bucket.deleted).toEqual([]);
    expect(bucket.reads).toEqual([]);
    expect(bucket.objects.has(foreign)).toBe(true);
    expect(bucket.objects.has(attachment)).toBe(true);
  });

  it("answers 409 upload_missing when nothing reached the bucket", async () => {
    await withProfile();
    expect((await confirm(`letterheads/welld_ch/${crypto.randomUUID()}.pdf`)).json.code).toBe("upload_missing");
  });

  it("downloads through a 60 s presigned link for deal:financials holders; 404 without a letterhead", async () => {
    await withProfile();
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead")).status).toBe(404);
    const stored = await upload(await pdf());
    await confirm(stored);
    const link = await call("GET", "/entity-profiles/welld_ch/letterhead", { as: "salesCh" });
    expect(link.json.url).toBe(`http://bucket.test/${stored}?signed`);
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead", { as: "consultant" })).status).toBe(403);
  });
});
