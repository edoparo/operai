/**
 * Files and links attached to a meeting: an agenda, slides, notes, a document (ADR 20261117-meeting-attachments-in-the-audio-bucket-forwarded-unparsed).
 * They help the people in the meeting and give the AI context: the transcription reads them to spell names and terms,
 * summaries and answers to understand what people refer to. They are never evidence of what was said.
 *
 *   GET    /meetings/:id/attachments                         anyone who can open the meeting
 *   POST   /meetings/:id/attachments/files                   editor: mint the upload of one file (pending row + presigned POST)
 *   POST   /meetings/:id/attachments/:attachmentId/confirm   the editor who minted it: the bucket object is checked, then stored
 *   POST   /meetings/:id/attachments/links                   editor: a link (a reference: the service never fetches it)
 *   GET    /meetings/:id/attachments/:attachmentId/download  anyone who can open the meeting: a 60 s GET that forces a download
 *   DELETE /meetings/:id/attachments/:attachmentId           editor: the object first, then the row
 *
 * WHO EDITS: the agenda's editors (creator or Operai participant, holding `meetings:access`, meeting not frozen;
 * `assertMeetingEditor`), with `attachment_editors_only` for a host reader. Each attachment is an item of its own, never
 * edited, so there is no list version and no If-Match: adding or removing one never overwrites anyone's change.
 *
 * FILES live in the meetings bucket under `meetings/<id>/attachments/<uuid>`, a fresh key per mint, the POST pinned to
 * the declared type (allowlisted) and EXACT size. The bucket-wide lifecycle rule removes them 29 days after upload like
 * the audio: `expired` is derived on read (`derived.ts`), never written, and an expired file is listed (so people know
 * it was there) but not downloadable. Deleting the recording keeps them (`Storage.deleteAudio`); deleting the meeting
 * removes them with everything else. A pending row whose upload never came is invisible, and its object, if any,
 * expires with the bucket rule: nothing is swept.
 *
 * LINKS are `http(s)` URLs without credentials, stored as written (normalised by the URL parser). Nothing here fetches
 * them; only their label reaches a model, as quoted text.
 *
 * Names, labels and URLs are written by people: never logged, and rendered as text by the UI.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { assertMeetingEditor, canEditHint } from "../agenda/agenda.routes";
import type { AuthzVariables } from "../auth/authz.middleware";
import { selfScoped } from "../auth/guards";
import { storageCall } from "../capture/caller";
import { db } from "../lib/db";
import type { MeetingAttachment } from "../lib/generated/prisma/client";
import { commonErrors } from "../lib/http";
import { ProblemError, conflict, forbidden, unprocessable, validationHook } from "../lib/problem";
import { isAttachmentKeyOf, requireStorage } from "../lib/storage";
import { callerOf, creatorControl } from "../meetings/caller";
import { lockMeeting } from "../meetings/lock";
import { openMeeting } from "../meetings/visibility";
import { aiContextOf, expiresAtOf, isExpired, type AiContext } from "./derived";
import {
  AI_CONTENT_TYPES,
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_POST_SECONDS,
  MAX_ATTACHMENT_BYTES,
  MAX_FILES_PER_MEETING,
  MAX_LABEL_CHARS,
  MAX_LINKS_PER_MEETING,
  MAX_NAME_CHARS,
  MAX_URL_CHARS,
  isAttachmentContentType,
} from "./policy";

// ─── Clock seam (expiry is derived against it) ───────────────────────────────

let clock: () => Date = () => new Date();

/** Tests only. */
export function setAttachmentsClockForTests(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

/** A confirm may arrive a little after the policy expired: the upload itself may have finished on its last second. */
const CONFIRM_GRACE_MS = 5 * 60_000;
const pendingWindowMs = ATTACHMENT_POST_SECONDS * 1000 + CONFIRM_GRACE_MS;

// ─── Shapes ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f/\\]/g;

const FileBody = z.object({
  /** The file's name as the person sees it; control characters and path separators become "_". */
  name: z
    .string()
    .transform((name) => name.replace(UNSAFE_NAME_CHARS, "_").trim())
    .pipe(z.string().min(1).max(MAX_NAME_CHARS)),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().min(1),
});

const LinkBody = z.object({
  url: z.string().trim().min(1).max(MAX_URL_CHARS),
  label: z
    .string()
    .max(MAX_LABEL_CHARS)
    .nullish()
    .transform((label) => (label == null || label.trim() === "" ? null : label.trim())),
});

const AiContextSchema = z.enum(["used", "not_supported", "too_large", "expired", "label_only"]);

const FileSchema = z.object({
  id: z.string(),
  kind: z.literal("file"),
  name: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  addedByUserId: z.string(),
  addedAt: z.string(),
  /** When the bucket's lifecycle rule removes the file (29 days after upload). */
  expiresAt: z.string(),
  expired: z.boolean(),
  aiContext: AiContextSchema,
});
const LinkSchema = z.object({
  id: z.string(),
  kind: z.literal("link"),
  url: z.string(),
  label: z.string(),
  addedByUserId: z.string(),
  addedAt: z.string(),
  aiContext: AiContextSchema,
});
const AttachmentSchema = z.union([FileSchema, LinkSchema]);
type AttachmentView = z.infer<typeof AttachmentSchema>;

const ListSchema = z.object({
  attachments: z.array(AttachmentSchema),
  /** A hint for the UI; every write is checked again. */
  can: z.object({ edit: z.boolean() }),
  limits: z.object({
    maxFiles: z.number().int(),
    maxLinks: z.number().int(),
    maxFileBytes: z.number().int(),
    contentTypes: z.array(z.string()),
    aiContentTypes: z.array(z.string()),
  }),
});

const UploadSchema = z.object({
  attachmentId: z.string(),
  upload: z.object({ url: z.string(), fields: z.record(z.string(), z.string()), expiresAt: z.string() }),
});
const DownloadSchema = z.object({ url: z.string(), expiresAt: z.string() });

const Params = z.object({ id: z.string().min(1).max(64) });
const ItemParams = Params.extend({ attachmentId: z.string().min(1).max(64) });
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const attachmentNotFound = (): ProblemError =>
  new ProblemError({ status: 404, code: "attachment_not_found", detail: "This attachment is no longer on the meeting. Reload to see the current list." });

const editorsOnly = (): ProblemError => forbidden("Only the creator and the participants of the meeting can change its attachments", "attachment_editors_only");

/** A link as stored: `http(s)`, no credentials, normalised by the parser. `null` when it is not one. */
export function normaliseLink(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname === "") return null;
  const href = parsed.href;
  return href.length > MAX_URL_CHARS ? null : href;
}

function viewOf(row: MeetingAttachment, ai: ReadonlyMap<string, AiContext>, now: Date): AttachmentView {
  if (row.kind === "link") {
    return { id: row.id, kind: "link", url: row.url!, label: row.label ?? "", addedByUserId: row.addedByUserId, addedAt: row.createdAt.toISOString(), aiContext: "label_only" };
  }
  const storedAt = row.storedAt!;
  return {
    id: row.id,
    kind: "file",
    name: row.name!,
    contentType: row.contentType!,
    sizeBytes: row.sizeBytes!,
    addedByUserId: row.addedByUserId,
    addedAt: storedAt.toISOString(),
    expiresAt: expiresAtOf(storedAt).toISOString(),
    expired: isExpired(storedAt, now),
    aiContext: ai.get(row.id) ?? "not_supported",
  };
}

async function storedRows(meetingId: string): Promise<MeetingAttachment[]> {
  return db.meetingAttachment.findMany({ where: { meetingId, status: "stored" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

function aiMapOf(rows: readonly MeetingAttachment[], now: Date): Map<string, AiContext> {
  return aiContextOf(
    rows.filter((r) => r.kind === "file").map((r) => ({ id: r.id, contentType: r.contentType!, sizeBytes: r.sizeBytes!, storedAt: r.storedAt! })),
    now,
  );
}

async function viewOne(meetingId: string, attachmentId: string, now: Date): Promise<AttachmentView> {
  const rows = await storedRows(meetingId);
  const row = rows.find((r) => r.id === attachmentId);
  if (!row) throw attachmentNotFound();
  return viewOf(row, aiMapOf(rows, now), now);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const writeErrors = {
  401: commonErrors[401],
  403: { description: "attachment_editors_only, frozen or meetings_access_required" },
  404: { description: "Not found, or attachment_not_found" },
  503: { description: "storage_unavailable, identity_unavailable, or auth is unavailable" },
} as const;

const listRoute = createRoute({
  method: "get",
  path: "/meetings/{id}/attachments",
  tags: ["Attachments"],
  summary: "The meeting's files and links, oldest first (anyone who can open the meeting)",
  middleware: selfScoped,
  request: { params: Params },
  responses: { 200: { description: "The attachments", ...json(ListSchema) }, 401: commonErrors[401], 404: { description: "Not found" } },
});

const fileRoute = createRoute({
  method: "post",
  path: "/meetings/{id}/attachments/files",
  tags: ["Attachments"],
  summary: "Start the upload of one file: a presigned POST pinned to its type and exact size (editor)",
  middleware: creatorControl,
  request: { params: Params, body: { content: { "application/json": { schema: FileBody } }, required: true } },
  responses: {
    201: { description: "The upload", ...json(UploadSchema) },
    409: { description: "too_many_files" },
    422: { description: "unsupported_type, file_too_large or an invalid name" },
    ...writeErrors,
  },
});

const confirmRoute = createRoute({
  method: "post",
  path: "/meetings/{id}/attachments/{attachmentId}/confirm",
  tags: ["Attachments"],
  summary: "Confirm an uploaded file: the bucket object is checked against what was declared (the editor who started it)",
  middleware: creatorControl,
  request: { params: ItemParams },
  responses: {
    200: { description: "The attachment", ...json(AttachmentSchema) },
    409: { description: "upload_missing or upload_expired" },
    422: { description: "upload_mismatch" },
    ...writeErrors,
  },
});

const linkRoute = createRoute({
  method: "post",
  path: "/meetings/{id}/attachments/links",
  tags: ["Attachments"],
  summary: "Attach a link: a reference, never fetched (editor)",
  middleware: creatorControl,
  request: { params: Params, body: { content: { "application/json": { schema: LinkBody } }, required: true } },
  responses: {
    201: { description: "The attachment", ...json(AttachmentSchema) },
    409: { description: "too_many_links" },
    422: { description: "invalid_url" },
    ...writeErrors,
  },
});

const downloadRoute = createRoute({
  method: "get",
  path: "/meetings/{id}/attachments/{attachmentId}/download",
  tags: ["Attachments"],
  summary: "A 60 s link that downloads one file (anyone who can open the meeting)",
  middleware: selfScoped,
  request: { params: ItemParams },
  responses: {
    200: { description: "The link", ...json(DownloadSchema) },
    401: commonErrors[401],
    404: { description: "Not found, or attachment_not_found" },
    410: { description: "attachment_expired" },
    503: { description: "storage_unavailable" },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/meetings/{id}/attachments/{attachmentId}",
  tags: ["Attachments"],
  summary: "Remove a file or a link (editor); a file's object is deleted first",
  middleware: creatorControl,
  request: { params: ItemParams },
  responses: { 204: { description: "Removed" }, ...writeErrors },
});

export const attachmentsRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

attachmentsRouter.openapi(listRoute, async (c) => {
  const { id } = c.req.valid("param");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  const now = clock();
  const [rows, canEdit] = await Promise.all([storedRows(id), canEditHint(role, caller, meeting.creatorUserId)]);
  const ai = aiMapOf(rows, now);
  return c.json(
    {
      attachments: rows.map((row) => viewOf(row, ai, now)),
      can: { edit: canEdit },
      limits: {
        maxFiles: MAX_FILES_PER_MEETING,
        maxLinks: MAX_LINKS_PER_MEETING,
        maxFileBytes: MAX_ATTACHMENT_BYTES,
        contentTypes: [...ATTACHMENT_CONTENT_TYPES],
        aiContentTypes: [...AI_CONTENT_TYPES],
      },
    },
    200,
  );
});

attachmentsRouter.openapi(fileRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertMeetingEditor(role, caller, meeting.creatorUserId, editorsOnly);
  if (!isAttachmentContentType(body.contentType)) {
    throw unprocessable("This type of file cannot be attached", { field: "contentType" }, "unsupported_type");
  }
  if (body.sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw unprocessable(`A file is at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB`, { field: "sizeBytes" }, "file_too_large");
  }

  const post = await storageCall(() => requireStorage().mintAttachmentPost(id, body.contentType, body.sizeBytes));
  const now = clock();
  const row = await db.$transaction(async (tx) => {
    await lockMeeting(tx, id);
    // Stored files, plus uploads still in flight: two people adding at once cannot pass the limit together.
    const taken = await tx.meetingAttachment.count({
      where: { meetingId: id, kind: "file", OR: [{ status: "stored" }, { status: "pending", createdAt: { gt: new Date(now.getTime() - pendingWindowMs) } }] },
    });
    if (taken >= MAX_FILES_PER_MEETING) throw conflict("too_many_files", `A meeting has at most ${MAX_FILES_PER_MEETING} files`);
    return tx.meetingAttachment.create({
      data: {
        meetingId: id,
        kind: "file",
        status: "pending",
        name: body.name,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        objectKey: post.objectKey,
        addedByUserId: caller.userId,
        createdAt: now,
      },
    });
  });
  return c.json({ attachmentId: row.id, upload: { url: post.url, fields: post.fields, expiresAt: post.expiresAt } }, 201);
});

attachmentsRouter.openapi(confirmRoute, async (c) => {
  const { id, attachmentId } = c.req.valid("param");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertMeetingEditor(role, caller, meeting.creatorUserId, editorsOnly);

  const row = await db.meetingAttachment.findFirst({ where: { id: attachmentId, meetingId: id, kind: "file" } });
  // Someone else's upload in flight is not this caller's to confirm, and is not on the list either.
  if (!row || (row.status === "pending" && row.addedByUserId !== caller.userId)) throw attachmentNotFound();
  const now = clock();
  if (row.status === "stored") return c.json(await viewOne(id, row.id, now), 200);
  if (now.getTime() > row.createdAt.getTime() + pendingWindowMs) {
    throw conflict("upload_expired", "This upload took too long: add the file again");
  }

  const key = row.objectKey!;
  if (!isAttachmentKeyOf(id, key)) throw attachmentNotFound();
  const head = await storageCall(() => requireStorage().headObject(key));
  if (head === null) throw conflict("upload_missing", "The file has not arrived: upload it, then confirm");
  if (head.sizeBytes !== row.sizeBytes || head.contentType !== row.contentType) {
    // The policy pins both, so this is a store that did not enforce it: the object is not kept.
    await storageCall(() => requireStorage().deleteObject(key));
    await db.meetingAttachment.deleteMany({ where: { id: row.id, status: "pending" } });
    throw unprocessable("The uploaded file is not the one that was declared", undefined, "upload_mismatch");
  }

  await db.meetingAttachment.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "stored", storedAt: now } });
  return c.json(await viewOne(id, row.id, now), 200);
});

attachmentsRouter.openapi(linkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertMeetingEditor(role, caller, meeting.creatorUserId, editorsOnly);
  const url = normaliseLink(body.url);
  if (url === null) throw unprocessable("A link is an http or https address without a user name or password", { field: "url" }, "invalid_url");

  const now = clock();
  const row = await db.$transaction(async (tx) => {
    await lockMeeting(tx, id);
    const taken = await tx.meetingAttachment.count({ where: { meetingId: id, kind: "link" } });
    if (taken >= MAX_LINKS_PER_MEETING) throw conflict("too_many_links", `A meeting has at most ${MAX_LINKS_PER_MEETING} links`);
    return tx.meetingAttachment.create({
      data: { meetingId: id, kind: "link", status: "stored", url, label: body.label, addedByUserId: caller.userId, createdAt: now },
    });
  });
  return c.json(viewOf(row, new Map(), now), 201);
});

attachmentsRouter.openapi(downloadRoute, async (c) => {
  const { id, attachmentId } = c.req.valid("param");
  const caller = callerOf(c);
  await openMeeting(id, caller);
  const row = await db.meetingAttachment.findFirst({ where: { id: attachmentId, meetingId: id, kind: "file", status: "stored" } });
  if (!row) throw attachmentNotFound();
  if (isExpired(row.storedAt!, clock())) {
    throw new ProblemError({ status: 410, code: "attachment_expired", detail: "This file was deleted 29 days after it was added" });
  }
  const key = row.objectKey!;
  if (!isAttachmentKeyOf(id, key)) throw attachmentNotFound();
  return c.json(await storageCall(() => requireStorage().mintAttachmentGet(key, row.name!)), 200);
});

attachmentsRouter.openapi(deleteRoute, async (c) => {
  const { id, attachmentId } = c.req.valid("param");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertMeetingEditor(role, caller, meeting.creatorUserId, editorsOnly);
  const row = await db.meetingAttachment.findFirst({ where: { id: attachmentId, meetingId: id } });
  if (!row) throw attachmentNotFound();
  // The object before its row: a failed delete leaves the row, so the file is never unreachable yet stored.
  if (row.objectKey !== null) {
    const key = row.objectKey;
    if (isAttachmentKeyOf(id, key)) await storageCall(() => requireStorage().deleteObject(key));
  }
  await db.meetingAttachment.deleteMany({ where: { id: row.id } });
  return c.body(null, 204);
});
