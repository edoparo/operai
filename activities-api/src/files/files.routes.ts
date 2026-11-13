/**
 * A task's images and attachments (ADR-0089; ADR-0016 posture, two-phase like crm-api's deal
 * attachments):
 *
 *   POST   /activities/{id}/files                     a pending row + a presigned POST (type and size pinned)
 *   POST   /activities/{id}/files/{fileId}/confirm    the uploader: HEAD the object, then `stored`
 *   GET    /activities/{id}/files/{fileId}/url        a ~60 s presigned GET (inline for an image)
 *   DELETE /activities/{id}/files/{fileId}            object first, then the row
 *
 * The stored files are listed in the task's own view (`task.files`). Access is the task's,
 * asked of the host as the caller on every request (ADR-0081): whoever may read the task sees
 * and downloads its files; whoever may edit it adds and removes them (the same `mayChange` and
 * `writable` as an edit, so a closed project's task is read-only, AC-3.8). A file of another
 * task, or one still pending, is the same 404 as one that does not exist.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { JwtVariables } from "../auth/jwt.middleware";
import { jwtMiddleware } from "../auth/jwt.middleware";
import { db } from "../lib/db";
import { IdParams, commonErrors, noNul, NUL_MESSAGE, type HeaderSource } from "../lib/http";
import { loadPeople } from "../lib/people";
import { ProblemError, forbidden, unprocessable, validationHook } from "../lib/problem";
import {
  ATTACHMENT_CONTENT_TYPES,
  DOWNLOAD_URL_SECONDS,
  IMAGE_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_TASK,
  MAX_IMAGE_BYTES,
  displayFileName,
  objectKeyOf,
  requireStorage,
} from "../lib/storage";
import { notFoundProblem } from "../activities/access";
import { loadFor, type Caller } from "../activities/load";
import { changeRefused, hostReadOnly, mayChange } from "../activities/rules";
import { imageIdsOf } from "./description";
import { FILE_KINDS, FileSchema, PENDING_ABANDONED_MS, storedFiles, storageUnavailable, toFileView } from "./files";

const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

const FileParams = z.object({
  id: IdParams.shape.id,
  fileId: z.string().uuid(),
});

const CreateFileSchema = z
  .object({
    kind: z.enum(FILE_KINDS),
    fileName: z.string().min(1).max(255).refine(noNul, NUL_MESSAGE),
    contentType: z.string().min(1).max(200),
    sizeBytes: z.number().int().min(1),
  })
  .strict();

const UploadSchema = z.object({ url: z.string(), fields: z.record(z.string(), z.string()) });

const createRoute_ = createRoute({
  method: "post",
  path: "/activities/{id}/files",
  tags: ["Task files"],
  summary: "Start an upload: a pending file and a presigned POST (upload to `upload.url` with `upload.fields`, then confirm)",
  middleware: [jwtMiddleware],
  request: { params: IdParams, body: { content: { "application/json": { schema: CreateFileSchema } }, required: true } },
  responses: { 201: { description: "Pending", ...json(z.object({ fileId: z.string(), upload: UploadSchema })) }, ...commonErrors },
});

const confirmRoute = createRoute({
  method: "post",
  path: "/activities/{id}/files/{fileId}/confirm",
  tags: ["Task files"],
  summary: "Confirm an upload (the uploader): the object is checked, the file is stored",
  middleware: [jwtMiddleware],
  request: { params: FileParams },
  responses: { 200: { description: "Stored", ...json(FileSchema) }, ...commonErrors },
});

const urlRoute = createRoute({
  method: "get",
  path: "/activities/{id}/files/{fileId}/url",
  tags: ["Task files"],
  summary: "A short-lived URL to show or download a file",
  middleware: [jwtMiddleware],
  request: { params: FileParams },
  responses: { 200: { description: "Presigned GET", ...json(z.object({ url: z.string(), expiresAt: z.string() })) }, ...commonErrors },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/activities/{id}/files/{fileId}",
  tags: ["Task files"],
  summary: "Remove a file (an image only once the description no longer shows it)",
  middleware: [jwtMiddleware],
  request: { params: FileParams },
  responses: { 204: { description: "Removed" }, ...commonErrors },
});

export const filesRouter = new OpenAPIHono<{ Variables: JwtVariables }>({ defaultHook: validationHook });

type Ctx = Caller & HeaderSource;

/** The task, for a caller who may change it (the same refusals as an edit). */
async function editableTask(c: Ctx, id: string) {
  const loaded = await loadFor(c, id);
  if (loaded.row.type !== "task") throw unprocessable("Only a task has files", { field: "type" }, "not_a_task");
  if (!mayChange(loaded.host, loaded.entity, loaded.row, c.get("userId"))) throw changeRefused(loaded.host);
  if (!loaded.entity.writable) throw hostReadOnly();
  return loaded;
}

async function fileOf(activityId: string, fileId: string, status: "pending" | "stored" | "any") {
  const file = await db.activityFile.findUnique({ where: { id: fileId } });
  if (!file || file.activityId !== activityId || (status !== "any" && file.status !== status)) throw notFoundProblem();
  return file;
}

filesRouter.openapi(createRoute_, async (c) => {
  const { id } = c.req.valid("param");
  const { kind, fileName, contentType, sizeBytes } = c.req.valid("json");
  await editableTask(c, id);

  const types: readonly string[] = kind === "image" ? IMAGE_CONTENT_TYPES : ATTACHMENT_CONTENT_TYPES;
  if (!types.includes(contentType)) {
    throw unprocessable(`Allowed types: ${types.join(", ")}`, { field: "contentType", allowed: [...types] }, "file_type_not_allowed");
  }
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES;
  if (sizeBytes > maxBytes) {
    throw unprocessable(`At most ${maxBytes} bytes`, { field: "sizeBytes", maxBytes }, "file_too_large");
  }
  const storage = requireStorage();
  const recentPending = new Date(Date.now() - PENDING_ABANDONED_MS);
  const count = await db.activityFile.count({
    where: { activityId: id, OR: [{ status: "stored" }, { status: "pending", createdAt: { gt: recentPending } }] },
  });
  if (count >= MAX_FILES_PER_TASK) {
    throw new ProblemError({
      status: 409,
      code: "too_many_files",
      detail: `A task has at most ${MAX_FILES_PER_TASK} files`,
      extras: { max: MAX_FILES_PER_TASK },
    });
  }

  const fileId = crypto.randomUUID();
  const objectKey = objectKeyOf(id, fileId);
  const upload = await storage.mintPresignedPost(objectKey, contentType, maxBytes);
  await db.activityFile.create({
    data: {
      id: fileId,
      activityId: id,
      kind,
      fileName: displayFileName(fileName),
      contentType,
      sizeBytes,
      objectKey,
      uploadedByUserId: c.get("userId"),
    },
  });
  return c.json({ fileId, upload }, 201);
});

filesRouter.openapi(confirmRoute, async (c) => {
  const { id, fileId } = c.req.valid("param");
  await editableTask(c, id);
  const file = await fileOf(id, fileId, "any");
  if (file.uploadedByUserId !== c.get("userId")) throw forbidden("Only the uploader confirms an upload", "uploader_only");
  if (file.status === "pending") {
    const head = await requireStorage().headObject(file.objectKey);
    if (!head) throw new ProblemError({ status: 409, code: "upload_missing", detail: "The file has not reached storage yet" });
    // What landed is the truth: the policy capped the size and pinned the type, record the real size.
    await db.activityFile.update({
      where: { id: fileId },
      data: { status: "stored", storedAt: new Date(), sizeBytes: head.sizeBytes },
    });
  }
  const stored = await db.activityFile.findUniqueOrThrow({ where: { id: fileId }, select: storedFiles.select });
  const { person } = await loadPeople(c, [stored.uploadedByUserId]);
  return c.json(toFileView(stored, person), 200);
});

filesRouter.openapi(urlRoute, async (c) => {
  const { id, fileId } = c.req.valid("param");
  const { row } = await loadFor(c, id);
  if (row.type !== "task") throw notFoundProblem();
  const file = await fileOf(id, fileId, "stored");
  const url = await requireStorage().mintPresignedGet(file.objectKey, {
    contentType: file.contentType,
    fileName: file.fileName,
    disposition: file.kind === "image" ? "inline" : "attachment",
  });
  return c.json({ url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() }, 200);
});

filesRouter.openapi(deleteRoute, async (c) => {
  const { id, fileId } = c.req.valid("param");
  const { row } = await editableTask(c, id);
  const file = await fileOf(id, fileId, "any");
  if (file.kind === "image" && imageIdsOf(row.description).includes(fileId)) {
    throw new ProblemError({
      status: 409,
      code: "image_in_use",
      detail: "The description still shows this image: remove it from the text and save",
    });
  }
  try {
    await requireStorage().deleteObject(file.objectKey);
  } catch {
    throw storageUnavailable();
  }
  await db.activityFile.deleteMany({ where: { id: fileId } });
  return c.body(null, 204);
});
