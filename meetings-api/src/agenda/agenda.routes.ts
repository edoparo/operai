/**
 * A meeting's agenda: an ordered list of points (a title and an optional note) that the people in the meeting follow
 * and tick as covered, and that a summary can follow (the "By agenda" template, or "Follow the agenda").
 *
 *   GET  /meetings/:id/agenda                              anyone who can open the meeting; ETag = agenda version
 *   PUT  /meetings/:id/agenda                              agenda editor, If-Match: the whole list (add, edit, remove, reorder)
 *   PUT  /meetings/:id/agenda/points/:pointId/covered      agenda editor, NO If-Match: one point's covered mark
 *
 * WHO EDITS. An agenda editor is the creator OR an Operai participant, holding `meetings:access`, on a meeting that
 * is not frozen. A host reader reads it and is refused (403 `agenda_editors_only`); so is a participant or creator
 * without the grant (403 `meetings_access_required`) and anyone on a frozen meeting (403 `frozen`, checked live and
 * fail closed: an identity outage is a 503, never a pass). Order: visibility (the identical 404), role, frozen, grant.
 *
 * CONCURRENCY. The list carries `meeting.agendaVersion`: every change of the points bumps it and needs `If-Match`
 * (ADR-0038), so a change made from an out-of-date list is a 409 and overwrites nothing. A covered mark does NOT bump
 * it and needs no precondition: two people ticking different points never conflict, and a full replace keeps the
 * marks of the points it keeps (it never sends them). A tick on a point that is gone is a 404 `agenda_point_not_found`.
 *
 * Titles and notes are plain text written by people: they reach a model only as quoted data (prompts/summary.ts) and
 * are never logged. The covered mark never reaches a model.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AuthzVariables } from "../auth/authz.middleware";
import { selfScoped } from "../auth/guards";
import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { commonErrors, etag, requireIfMatch, versionConflict } from "../lib/http";
import { requireIdentities } from "../lib/identities";
import { ProblemError, forbidden, unprocessable, validationHook } from "../lib/problem";
import { AGENDA_LIMITS, MAX_AGENDA_POINTS } from "../templates/builtin";
import { callerOf, creatorControl } from "../meetings/caller";
import { lockMeeting } from "../meetings/lock";
import { creatorFrozen, meetingNotFound, openMeeting, type Caller, type MeetingRole } from "../meetings/visibility";

// ─── Shapes ──────────────────────────────────────────────────────────────────

const NoteInput = z
  .string()
  .max(AGENDA_LIMITS.note)
  .nullish()
  .transform((note) => (note == null || note.trim() === "" ? null : note.trim()));

/** One point as written: plain text, trimmed. */
export const AgendaPointInput = z.object({
  title: z.string().trim().min(1).max(AGENDA_LIMITS.title),
  note: NoteInput,
});

const PutPoint = AgendaPointInput.extend({
  /** A point already on the agenda keeps its id (and its covered mark); a new one has none. */
  id: z.string().min(1).max(64).optional(),
}).strict();

const PutBody = z.object({ points: z.array(PutPoint) });
const CoveredBody = z.object({ covered: z.boolean() });

const AgendaPointSchema = z.object({ id: z.string(), title: z.string(), note: z.string().nullable(), covered: z.boolean() });
export const AgendaSchema = z.object({
  /** The `If-Match` precondition of a PUT (also sent as the ETag). */
  version: z.number().int(),
  points: z.array(AgendaPointSchema),
  /** A hint for the UI; every write is checked again. */
  can: z.object({ edit: z.boolean() }),
});
export type AgendaView = z.infer<typeof AgendaSchema>;

const Params = z.object({ id: z.string().min(1).max(64) });
const PointParams = Params.extend({ pointId: z.string().min(1).max(64) });
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

// ─── Who may edit ────────────────────────────────────────────────────────────

const isEditorRole = (role: MeetingRole): boolean => role === "creator" || role === "participant";

/**
 * GATE for every agenda write: an editor role, a creator who is not deactivated (live, uncached, fail closed: a
 * failed lookup is a 503), and `meetings:access`.
 */
export async function assertAgendaEditor(role: MeetingRole, caller: Caller, creatorUserId: string): Promise<void> {
  if (!isEditorRole(role)) throw forbidden("Only the creator and the participants of the meeting can change its agenda", "agenda_editors_only");
  const found = await requireIdentities(caller.authorization, [creatorUserId]);
  const status = found.get(creatorUserId)?.status;
  if (status === "deleted") throw forbidden("The creator's account is deactivated: this meeting is frozen", "frozen");
  if (status !== "active") throw new ProblemError({ status: 503, code: "identity_unavailable", detail: "The creator could not be checked" });
  if (!caller.holdsAccess) throw forbidden("You need access to Meetings to do this", "meetings_access_required");
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The agenda's points in order, as a summary keeps them. */
export async function agendaItemsOf(client: Pick<Prisma.TransactionClient, "agendaPoint">, meetingId: string): Promise<{ title: string; note: string | null }[]> {
  const rows = await client.agendaPoint.findMany({ where: { meetingId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true, note: true } });
  return rows.map((r) => ({ title: r.title, note: r.note }));
}

async function agendaView(meetingId: string, canEdit: boolean): Promise<AgendaView> {
  const [meeting, rows] = await Promise.all([
    db.meeting.findUnique({ where: { id: meetingId }, select: { agendaVersion: true } }),
    db.agendaPoint.findMany({ where: { meetingId }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
  ]);
  if (!meeting) throw meetingNotFound();
  return {
    version: meeting.agendaVersion,
    points: rows.map((r) => ({ id: r.id, title: r.title, note: r.note, covered: r.covered })),
    can: { edit: canEdit },
  };
}

/** The `can.edit` hint: conservative, so an unknown creator state withholds it. */
async function canEditHint(role: MeetingRole, caller: Caller, creatorUserId: string): Promise<boolean> {
  if (!isEditorRole(role) || !caller.holdsAccess) return false;
  return (await creatorFrozen(caller.authorization, creatorUserId)) === false;
}

/** Writes the points of a NEW meeting (the create route), inside its transaction. */
export async function createAgenda(tx: Prisma.TransactionClient, meetingId: string, points: readonly { title: string; note: string | null }[]): Promise<void> {
  if (points.length === 0) return;
  await tx.agendaPoint.createMany({ data: points.map((p, position) => ({ meetingId, position, title: p.title, note: p.note })) });
}

export const tooManyPoints = (): ProblemError =>
  unprocessable(`An agenda has at most ${MAX_AGENDA_POINTS} points`, { field: "agenda" }, "too_many_agenda_points");

// ─── Routes ──────────────────────────────────────────────────────────────────

const getRoute = createRoute({
  method: "get",
  path: "/meetings/{id}/agenda",
  tags: ["Agenda"],
  summary: "The meeting's agenda (anyone who can open the meeting)",
  middleware: selfScoped,
  request: { params: Params },
  responses: { 200: { description: "The agenda", ...json(AgendaSchema) }, 401: commonErrors[401], 404: { description: "Not found" } },
});

const putRoute = createRoute({
  method: "put",
  path: "/meetings/{id}/agenda",
  tags: ["Agenda"],
  summary: "Replace the agenda's points: add, edit, remove, reorder (agenda editor; If-Match)",
  middleware: creatorControl,
  request: { params: Params, body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: {
    200: { description: "The agenda", ...json(AgendaSchema) },
    401: commonErrors[401],
    403: { description: "agenda_editors_only, frozen or meetings_access_required" },
    404: { description: "Not found" },
    409: { description: "version_conflict" },
    422: { description: "An invalid point, too_many_agenda_points or unknown_agenda_point { index }" },
    428: { description: "precondition_required" },
    503: { description: "identity_unavailable, or auth is unavailable" },
  },
});

const coveredRoute = createRoute({
  method: "put",
  path: "/meetings/{id}/agenda/points/{pointId}/covered",
  tags: ["Agenda"],
  summary: "Tick or untick one point as covered (agenda editor; no If-Match)",
  middleware: creatorControl,
  request: { params: PointParams, body: { content: { "application/json": { schema: CoveredBody } }, required: true } },
  responses: {
    200: { description: "The agenda", ...json(AgendaSchema) },
    401: commonErrors[401],
    403: { description: "agenda_editors_only, frozen or meetings_access_required" },
    404: { description: "Not found, or agenda_point_not_found" },
    503: { description: "identity_unavailable, or auth is unavailable" },
  },
});

export const agendaRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

agendaRouter.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  const view = await agendaView(id, await canEditHint(role, caller, meeting.creatorUserId));
  c.header("ETag", etag(view.version));
  return c.json(view, 200);
});

agendaRouter.openapi(putRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { points } = c.req.valid("json");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertAgendaEditor(role, caller, meeting.creatorUserId);
  const expected = requireIfMatch(c);
  if (points.length > MAX_AGENDA_POINTS) throw tooManyPoints();

  await db.$transaction(async (tx) => {
    await lockMeeting(tx, id);
    const row = await tx.meeting.findUnique({ where: { id }, select: { agendaVersion: true } });
    if (!row) throw meetingNotFound();
    if (row.agendaVersion !== expected) throw versionConflict(row.agendaVersion);

    const current = new Set((await tx.agendaPoint.findMany({ where: { meetingId: id }, select: { id: true } })).map((p) => p.id));
    const kept = new Set<string>();
    points.forEach((point, index) => {
      if (point.id === undefined) return;
      // The list matched the current version, so an id that is not there (or comes twice) was never this agenda's.
      if (!current.has(point.id) || kept.has(point.id)) {
        throw unprocessable("This point is not on the agenda", { field: `points.${index}.id`, index }, "unknown_agenda_point");
      }
      kept.add(point.id);
    });

    await tx.agendaPoint.deleteMany({ where: { meetingId: id, id: { notIn: [...kept] } } });
    for (const [position, point] of points.entries()) {
      if (point.id !== undefined) {
        // The covered mark is left as it is: it is not part of the list.
        await tx.agendaPoint.update({ where: { id: point.id }, data: { position, title: point.title, note: point.note } });
      } else {
        await tx.agendaPoint.create({ data: { meetingId: id, position, title: point.title, note: point.note } });
      }
    }
    await tx.meeting.update({ where: { id }, data: { agendaVersion: { increment: 1 } } });
  });

  const view = await agendaView(id, true);
  c.header("ETag", etag(view.version));
  return c.json(view, 200);
});

agendaRouter.openapi(coveredRoute, async (c) => {
  const { id, pointId } = c.req.valid("param");
  const { covered } = c.req.valid("json");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertAgendaEditor(role, caller, meeting.creatorUserId);

  const changed = await db.agendaPoint.updateMany({ where: { id: pointId, meetingId: id }, data: { covered } });
  if (changed.count === 0) {
    throw new ProblemError({ status: 404, code: "agenda_point_not_found", detail: "This point is no longer on the agenda. Reload to see the current agenda." });
  }

  const view = await agendaView(id, true);
  c.header("ETag", etag(view.version));
  return c.json(view, 200);
});
