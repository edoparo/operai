import { beforeEach, describe, expect, it } from "bun:test";
import { bucket, call, makeCompany, makeDeal, resetWorld } from "../test-support/world";

/** specs/018 AC-4.3/4.4 and AC-1.3: two-phase upload, limits, who downloads and deletes. */
describe("attachments (specs/018)", () => {
  beforeEach(resetWorld);

  const start = (dealId: string, as: "consultant" | "salesCh" | "admin", body: Record<string, unknown> = {}) =>
    call("POST", `/deals/${dealId}/attachments`, {
      as,
      body: { fileName: "../Signed offer ✓.pdf", contentType: "application/pdf", sizeBytes: 1234, ...body },
    });
  /** Simulates the browser's POST landing in the bucket. */
  const land = (objectKey: string, sizeBytes = 1200) =>
    bucket.objects.set(objectKey, { bytes: null, contentType: "application/pdf", sizeBytes });

  it("starts with a presigned POST, refuses other types and oversize files", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const res = await start(deal.id, "consultant");
    expect(res.status).toBe(201);
    expect(res.json.upload.fields.key).toMatch(new RegExp(`^attachments/${deal.id}/[0-9a-f-]+/Signed_offer__.pdf$`));
    expect((await start(deal.id, "consultant", { contentType: "text/html" })).json.code).toBe("attachment_type_not_allowed");
    expect((await start(deal.id, "consultant", { sizeBytes: 21 * 1024 * 1024 })).json.code).toBe("attachment_too_large");
  });

  it("confirms only what landed, by the uploader; lists stored files only", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const { attachmentId, upload } = (await start(deal.id, "consultant")).json;
    const confirm = (as: "consultant" | "salesCh") => call("POST", `/deals/${deal.id}/attachments/${attachmentId}/confirm`, { as });

    expect((await call("GET", `/deals/${deal.id}/attachments`)).json.items).toHaveLength(0);
    expect((await confirm("consultant")).json.code).toBe("upload_missing");
    land(upload.fields.key, 1200);
    expect((await confirm("salesCh")).json.code).toBe("uploader_only");
    const stored = await confirm("consultant");
    expect(stored.json).toMatchObject({ fileName: "Signed offer ✓.pdf", sizeBytes: 1200, uploadedBy: { id: "user-consultant" } });
    expect((await call("GET", `/deals/${deal.id}/attachments`)).json.items).toHaveLength(1);
  });

  it("a technician downloads only their own uploads (AC-1.3); delete by uploader or admin", async () => {
    const deal = await makeDeal((await makeCompany()).id);
    const upload = async (as: "consultant" | "salesCh") => {
      const { attachmentId, upload: post } = (await start(deal.id, as)).json;
      land(post.fields.key);
      await call("POST", `/deals/${deal.id}/attachments/${attachmentId}/confirm`, { as });
      return attachmentId as string;
    };
    const own = await upload("consultant");
    const sales = await upload("salesCh");
    const download = (id: string, as: "consultant" | "salesCh") =>
      call("GET", `/deals/${deal.id}/attachments/${id}/download`, { as });

    expect((await download(own, "consultant")).json.url).toContain("?signed");
    expect((await download(sales, "consultant")).json.code).toBe("financials_required");
    expect((await download(own, "salesCh")).status).toBe(200);
    const list = await call("GET", `/deals/${deal.id}/attachments`, { as: "consultant" });
    expect(Object.fromEntries(list.json.items.map((a: { id: string; canDownload: boolean }) => [a.id, a.canDownload]))).toEqual({
      [own]: true,
      [sales]: false,
    });

    expect((await call("DELETE", `/deals/${deal.id}/attachments/${sales}`, { as: "consultant" })).json.code).toBe("uploader_only");
    expect((await call("DELETE", `/deals/${deal.id}/attachments/${sales}`, { as: "admin" })).status).toBe(204);
    expect((await call("GET", `/deals/${deal.id}/attachments`)).json.items).toHaveLength(1);
  });
});
