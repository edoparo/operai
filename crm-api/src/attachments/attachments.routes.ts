/**
 * Files attached to a deal (specs/20261101-crm-sales-flow AC-4.3/4.4; plan.md § Offers and
 * attachments). Two-phase like inventory's invoice files (ADR 20260716-eu-object-storage-refund-attachments posture):
 *
 *   POST   /deals/{id}/attachments                     a pending row + a presigned POST (≤ 20 MiB, allowed types)
 *   POST   /deals/{id}/attachments/{aid}/confirm       the uploader: HEAD the object, then `stored`
 *   GET    /deals/{id}/attachments                     stored ones
 *   GET    /deals/{id}/attachments/{aid}/download      60 s presigned GET
 *   DELETE /deals/{id}/attachments/{aid}               uploader or admin
 *
 * Any `crm:access` holder attaches and lists. A caller without
 * `deal:financials` downloads only their own uploads (AC-1.3): an attachment
 * may well be a signed offer with prices.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { authorized, canSeeFinancials, managesAllDeals } from "../auth/guards";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { IdParams, PersonRefSchema, commonErrors, type HeaderSource } from "../lib/http";
import { loadPeople } from "../lib/people";
import { ProblemError, forbidden, notFound, unprocessable, validationHook } from "../lib/problem";
import {
  ATTACHMENT_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  displayFileName,
  isAttachmentContentType,
  requireStorage,
  sanitizeFileName,
} from "../lib/storage";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });
const AttachmentParams = z.object({ id: z.string().min(1).max(64), aid: z.string().min(1).max(64) });

const CreateAttachmentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(200),
    sizeBytes: z.number().int().min(1),
  })
  .strict();

const AttachmentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  uploadedBy: PersonRefSchema,
  createdAt: z.string(),
  /** Whether the caller may download it (AC-1.3). */
  canDownload: z.boolean(),
});

type AttachmentRow = Awaited<ReturnType<typeof db.dealAttachment.findMany>>[number];

async function toViews(c: HeaderSource & { get(key: "userId"): string; get(key: "authz"): AuthzVariables["authz"] }, rows: readonly AttachmentRow[]) {
  const { person } = await loadPeople(c, rows.map((row) => row.uploadedBy));
  const financials = canSeeFinancials(c);
  const userId = c.get("userId");
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: person(row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    canDownload: financials || row.uploadedBy === userId,
  }));
}

const createAttachmentRoute = createRoute({
  method: "post",
  path: "/deals/{id}/attachments",
  tags: ["Attachments"],
  summary: "Start an upload: a pending attachment and a presigned POST",
  middleware: authorized,
  request: { params: IdParams, body: { content: { "application/json": { schema: CreateAttachmentSchema } }, required: true } },
  responses: {
    201: {
      description: "Upload to `upload.url` with `upload.fields`, then confirm",
      ...json(z.object({ attachmentId: z.string(), upload: z.object({ url: z.string(), fields: z.record(z.string(), z.string()) }) })),
    },
    404: { description: "Not found" },
    ...commonErrors,
  },
});

const confirmRoute = createRoute({
  method: "post",
  path: "/deals/{id}/attachments/{aid}/confirm",
  tags: ["Attachments"],
  summary: "Confirm an upload (uploader)",
  middleware: authorized,
  request: { params: AttachmentParams },
  responses: { 200: { description: "Stored", ...json(AttachmentSchema) }, 404: { description: "Not found" }, 409: { description: "upload_missing" }, ...commonErrors },
});

const listRoute = createRoute({
  method: "get",
  path: "/deals/{id}/attachments",
  tags: ["Attachments"],
  summary: "A deal's attachments, newest first",
  middleware: authorized,
  request: { params: IdParams },
  responses: { 200: { description: "Attachments", ...json(z.object({ items: z.array(AttachmentSchema) })) }, 404: { description: "Not found" }, ...commonErrors },
});

const downloadRoute = createRoute({
  method: "get",
  path: "/deals/{id}/attachments/{aid}/download",
  tags: ["Attachments"],
  summary: "A short-lived download link",
  middleware: authorized,
  request: { params: AttachmentParams },
  responses: { 200: { description: "Presigned URL", ...json(z.object({ url: z.string() })) }, 404: { description: "Not found" }, ...commonErrors },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/deals/{id}/attachments/{aid}",
  tags: ["Attachments"],
  summary: "Delete an attachment (uploader or admin)",
  middleware: authorized,
  request: { params: AttachmentParams },
  responses: { 204: { description: "Deleted" }, 404: { description: "Not found" }, ...commonErrors },
});

export const attachmentsRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({
  defaultHook: validationHook,
});

async function storedOr404(dealId: string, aid: string) {
  const row = await db.dealAttachment.findUnique({ where: { id: aid } });
  if (!row || row.dealId !== dealId || row.status !== "stored" || row.deletedAt) throw notFound("Attachment not found");
  return row;
}

attachmentsRouter.openapi(createAttachmentRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { fileName, contentType, sizeBytes } = c.req.valid("json");
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Deal not found");
  if (!isAttachmentContentType(contentType)) {
    throw unprocessable(
      `Allowed types: ${ATTACHMENT_CONTENT_TYPES.join(", ")}`,
      { field: "contentType" },
      "attachment_type_not_allowed",
    );
  }
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw unprocessable("An attachment is at most 20 MiB", { field: "sizeBytes", maxBytes: MAX_ATTACHMENT_BYTES }, "attachment_too_large");
  }
  const storage = requireStorage();
  const attachmentId = crypto.randomUUID();
  const objectKey = `attachments/${id}/${attachmentId}/${sanitizeFileName(fileName)}`;
  const upload = await storage.mintPresignedPost(objectKey, contentType);
  await db.dealAttachment.create({
    data: {
      id: attachmentId,
      dealId: id,
      fileName: displayFileName(fileName),
      contentType,
      sizeBytes,
      objectKey,
      uploadedBy: c.get("userId"),
    },
  });
  return c.json({ attachmentId, upload }, 201);
});

attachmentsRouter.openapi(confirmRoute, async (c) => {
  const { id, aid } = c.req.valid("param");
  const row = await db.dealAttachment.findUnique({ where: { id: aid } });
  if (!row || row.dealId !== id || row.deletedAt) throw notFound("Attachment not found");
  if (row.uploadedBy !== c.get("userId")) throw forbidden("Only the uploader confirms an upload", "uploader_only");
  if (row.status === "pending") {
    const storage = requireStorage();
    const head = await storage.headObject(row.objectKey);
    if (!head) throw new ProblemError({ status: 409, code: "upload_missing", detail: "The file has not reached storage yet" });
    // What landed is the truth: the policy capped size and pinned the type, record the real size.
    await db.dealAttachment.update({ where: { id: aid }, data: { status: "stored", sizeBytes: head.sizeBytes } });
  }
  const stored = await db.dealAttachment.findUniqueOrThrow({ where: { id: aid } });
  const [view] = await toViews(c, [stored]);
  return c.json(view!, 200);
});

attachmentsRouter.openapi(listRoute, async (c) => {
  const { id } = c.req.valid("param");
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Deal not found");
  const rows = await db.dealAttachment.findMany({
    where: { dealId: id, status: "stored", deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  return c.json({ items: await toViews(c, rows) }, 200);
});

attachmentsRouter.openapi(downloadRoute, async (c) => {
  const { id, aid } = c.req.valid("param");
  const row = await storedOr404(id, aid);
  if (!canSeeFinancials(c) && row.uploadedBy !== c.get("userId")) {
    throw forbidden("Attachments may hold prices: you can download only your own", "financials_required");
  }
  const url = await requireStorage().mintPresignedGet(row.objectKey, { contentType: row.contentType, fileName: row.fileName });
  return c.json({ url }, 200);
});

attachmentsRouter.openapi(deleteRoute, async (c) => {
  const { id, aid } = c.req.valid("param");
  const userId = c.get("userId");
  const row = await storedOr404(id, aid);
  if (row.uploadedBy !== userId && !managesAllDeals(c)) {
    throw forbidden("Only the uploader or an admin deletes an attachment", "uploader_only");
  }
  await db.dealAttachment.update({ where: { id: aid }, data: { deletedAt: new Date(), deletedBy: userId } });
  try {
    await requireStorage().deleteObject(row.objectKey);
  } catch (error) {
    console.error("[attachments] could not delete the object:", row.objectKey, error instanceof Error ? error.message : error);
  }
  return c.body(null, 204);
});
