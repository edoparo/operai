/**
 * Personal meeting notes: each person who can open a meeting keeps their own notes on it, saved as they type.
 *
 *   GET  /meetings/:id/notes     the CALLER'S own notes (empty, version 0, when they have none); ETag = version
 *   PUT  /meetings/:id/notes     replaces the caller's own notes; If-Match: the version it was read at (0 = none yet)
 *
 * PRIVATE BY CONSTRUCTION. Every query is keyed by the verified `sub`: there is no route, parameter or role (not the
 * meeting's creator, not an admin, not `meeting:erase`) that reads someone else's notes. They never reach a model
 * (summaries and answers read the transcript and the agenda only), are never sent to a host and never logged.
 *
 * WHO. Anyone who can open the meeting (the identical 404 otherwise), with a JWT only (`selfScoped`): writing your own
 * notes changes nothing of the meeting's record, so it needs no grant and works on a frozen meeting too, and it
 * keeps working when `auth` cannot answer. A participant who is removed can no longer open the meeting, and so no
 * longer reach their notes; the notes are deleted with the meeting.
 *
 * CONTENT. A rich-text document (the UI's TipTap JSON): an object whose `type` is `doc`, at most 512 KiB as JSON.
 * The service never interprets it beyond that: it is stored and returned as data, and only the editor's schema
 * renders it (no HTML is ever produced from it here).
 *
 * CONCURRENCY. The autosave sends the version it last saw (ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004): the same person typing in two tabs gets a 409
 * in the stale one instead of a silent overwrite.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AuthzVariables } from "../auth/authz.middleware";
import { selfScoped } from "../auth/guards";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { commonErrors, etag, requireIfMatch, versionConflict } from "../lib/http";
import { validationHook } from "../lib/problem";
import { callerOf } from "../meetings/caller";
import { openMeeting } from "../meetings/visibility";

/** The most a person's notes on one meeting may weigh, as JSON (CHECK in SQL too). */
export const MAX_NOTE_BYTES = 512 * 1024;

const Params = z.object({ id: z.string().min(1).max(64) });

/** A rich-text document: an object of type `doc`; anything else in it is the editor's to read. */
const DocSchema = z
  .object({ type: z.literal("doc"), content: z.array(z.unknown()).optional() })
  .passthrough()
  .refine((doc) => Buffer.byteLength(JSON.stringify(doc), "utf8") <= MAX_NOTE_BYTES, `at most ${MAX_NOTE_BYTES} bytes`);
const PutBody = z.object({ content: DocSchema });

export const NotesSchema = z.object({
  /** `null` while the person has no notes on this meeting. */
  content: z.record(z.string(), z.unknown()).nullable(),
  /** The `If-Match` of the next save: 0 while the person has no notes on this meeting yet. */
  version: z.number().int(),
  updatedAt: z.string().nullable(),
});
type Notes = z.infer<typeof NotesSchema>;
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

async function notesOf(meetingId: string, userId: string): Promise<Notes> {
  const row = await db.meetingNote.findUnique({ where: { meetingId_userId: { meetingId, userId } } });
  return row
    ? { content: row.content as Record<string, unknown>, version: row.version, updatedAt: row.updatedAt.toISOString() }
    : { content: null, version: 0, updatedAt: null };
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";

const getRoute = createRoute({
  method: "get",
  path: "/meetings/{id}/notes",
  tags: ["Notes"],
  summary: "The caller's own notes on the meeting (anyone who can open it)",
  middleware: selfScoped,
  request: { params: Params },
  responses: { 200: { description: "The caller's notes", ...json(NotesSchema) }, 401: commonErrors[401], 404: { description: "Not found" } },
});

const putRoute = createRoute({
  method: "put",
  path: "/meetings/{id}/notes",
  tags: ["Notes"],
  summary: "Save the caller's own notes on the meeting (If-Match; 0 for the first save)",
  middleware: selfScoped,
  request: { params: Params, body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: {
    200: { description: "Saved", ...json(NotesSchema) },
    401: commonErrors[401],
    404: { description: "Not found" },
    409: { description: "version_conflict: saved meanwhile from another tab" },
    422: { description: "Longer than the limit" },
    428: { description: "precondition_required" },
  },
});

export const notesRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

notesRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const caller = callerOf(c);
  await openMeeting(id, caller);
  const notes = await notesOf(id, caller.userId);
  c.header("ETag", etag(notes.version));
  return c.json(notes, 200);
});

notesRouter.openapi(putRoute, async (c) => {
  const { id } = c.req.valid("param");
  const content = c.req.valid("json").content as Prisma.InputJsonValue;
  const caller = callerOf(c);
  await openMeeting(id, caller);
  const expected = requireIfMatch(c);
  const key = { meetingId: id, userId: caller.userId };

  if (expected === 0) {
    // The first save: a row that exists already was written from another tab.
    try {
      await db.meetingNote.create({ data: { ...key, content } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw versionConflict((await notesOf(id, caller.userId)).version);
    }
  } else {
    // Compare-and-set on the version the caller saw (ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004).
    const saved = await db.meetingNote.updateMany({ where: { ...key, version: expected }, data: { content, version: { increment: 1 } } });
    if (saved.count === 0) throw versionConflict((await notesOf(id, caller.userId)).version);
  }

  const notes = await notesOf(id, caller.userId);
  c.header("ETag", etag(notes.version));
  return c.json(notes, 200);
});
