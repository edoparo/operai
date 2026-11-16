import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as isolated from "../entity-profiles/isolatedPdfCheck";
import { deflatedRun, objStmBombPdf } from "../test-support/pdfBuild";
import { bucket, call, db, makeCompany, makeDeal, resetWorld } from "../test-support/world";

/**
 * Security round 6, M-7 (specs/20261115-crm-offer-wizard): a PDF attachment is bounded before any parser reads it, from
 * the first byte crm-api touches. At confirm the bytes are read once and measured by `boundPdf`; a refusal is 422
 * `attachment_unreadable` naming the file (the shape generation already answers), and the object and the row are gone.
 */
describe("a PDF attachment is bounded at confirm (security M-7)", () => {
  beforeEach(resetWorld);

  const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
  const start = async (dealId: string, body: Record<string, unknown> = {}) =>
    (await call("POST", `/deals/${dealId}/attachments`, { as: "consultant", body: { fileName: "Bomb.pdf", contentType: "application/pdf", sizeBytes: 600, ...body } }))
      .json as { attachmentId: string; upload: { fields: Record<string, string> } };
  const keyOf = (started: { upload: { fields: Record<string, string> } }) => started.upload.fields["key"]!;
  const land = (objectKey: string, bytes: Uint8Array | null, sizeBytes = bytes?.length ?? 1200, contentType = "application/pdf") =>
    bucket.objects.set(objectKey, { bytes, contentType, sizeBytes });
  const confirm = (dealId: string, attachmentId: string) => call("POST", `/deals/${dealId}/attachments/${attachmentId}/confirm`, { as: "consultant" });

  it("refuses an object-stream bomb with 422 attachment_unreadable naming the file; the object and the row go", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const started = await start(deal.id);
    const bomb = objStmBombPdf(await deflatedRun(16)); // about 16 KB, 16 MiB inflated: over the 8 MiB non-image cap
    land(keyOf(started), bomb);
    const res = await confirm(deal.id, started.attachmentId);
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ code: "attachment_unreadable", fileName: "Bomb.pdf", reason: "decoded_too_large" });
    expect(bucket.deleted).toContain(keyOf(started));
    expect(bucket.objects.has(keyOf(started))).toBe(false);
    expect((await call("GET", `/deals/${deal.id}/attachments`)).json.items).toHaveLength(0);
    const row = await db.dealAttachment.findUniqueOrThrow({ where: { id: started.attachmentId } });
    expect(row.status).toBe("pending");
    expect(row.deletedAt).not.toBeNull();
    // it cannot be confirmed again, and the body does not name the storage key
    expect((await confirm(deal.id, started.attachmentId)).status).toBe(404);
    expect(JSON.stringify(res.json)).not.toContain(keyOf(started));
  });

  it("refuses a filter the bound cannot measure, and confirms an ordinary PDF with the size storage reports", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const lzw = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Filter /LZWDecode /Length 4 >>\nstream\nabcd\nendstream\nendobj\n");
    const bad = await start(deal.id);
    land(keyOf(bad), lzw);
    expect((await confirm(deal.id, bad.attachmentId)).json).toMatchObject({ code: "attachment_unreadable", reason: "unbounded_stream" });
    const good = await start(deal.id, { fileName: "Fine.pdf" });
    land(keyOf(good), PDF, 1200);
    const ok = await confirm(deal.id, good.attachmentId);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ fileName: "Fine.pdf", sizeBytes: 1200 });
  });

  it("reads only a PDF, once: an image is not read, a stored file is not read again", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const image = await start(deal.id, { fileName: "logo.png", contentType: "image/png" });
    land(keyOf(image), new Uint8Array([1, 2, 3]), 900, "image/png");
    expect((await confirm(deal.id, image.attachmentId)).status).toBe(200);
    expect(bucket.reads).toEqual([]);
    const pdf = await start(deal.id);
    land(keyOf(pdf), PDF);
    await confirm(deal.id, pdf.attachmentId);
    await confirm(deal.id, pdf.attachmentId);
    expect(bucket.reads).toEqual([keyOf(pdf)]);
  });

  it("does not take a failed read for a verdict: the row stays pending and a retry works", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const started = await start(deal.id);
    land(keyOf(started), null, 1200); // the object is there, its bytes cannot be read
    expect((await confirm(deal.id, started.attachmentId)).status).toBe(500);
    const row = await db.dealAttachment.findUniqueOrThrow({ where: { id: started.attachmentId } });
    expect(row).toMatchObject({ status: "pending", deletedAt: null });
    land(keyOf(started), PDF);
    expect((await confirm(deal.id, started.attachmentId)).status).toBe(200);
  });

  it("a check killed for time or memory is the refusal `too_complex` (422, the row goes); a child that cannot answer is a 503 and the row stays pending", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const killed = await start(deal.id);
    land(keyOf(killed), PDF);
    const check = spyOn(isolated, "boundPdfIsolated").mockResolvedValueOnce({ ok: false, reason: "too_complex" });
    try {
      expect((await confirm(deal.id, killed.attachmentId)).json).toMatchObject({ code: "attachment_unreadable", fileName: "Bomb.pdf", reason: "too_complex" });
      const gone = await db.dealAttachment.findUniqueOrThrow({ where: { id: killed.attachmentId } });
      expect(gone.deletedAt).not.toBeNull();

      const unanswered = await start(deal.id, { fileName: "Later.pdf" });
      land(keyOf(unanswered), PDF);
      check.mockRejectedValueOnce(new isolated.PdfCheckUnavailableError());
      const res = await confirm(deal.id, unanswered.attachmentId);
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ code: "pdf_check_unavailable" });
      expect(await db.dealAttachment.findUniqueOrThrow({ where: { id: unanswered.attachmentId } })).toMatchObject({ status: "pending", deletedAt: null });
    } finally {
      check.mockRestore();
    }
  });
});
