/**
 * Personal meeting folders (ADR 20261113-personal-meeting-folders): each person organises the meetings they see into folders of their own.
 *
 *   GET    /folders                  the caller's folders, name order, each with how many of its meetings they can open
 *   POST   /folders                  create one (`{ name }`); 409 `folder_name_taken`, 422 `folder_limit` past 200
 *   PATCH  /folders/:id              rename it
 *   DELETE /folders/:id              delete it; its meetings stay, just in no folder
 *   PUT    /meetings/:id/folder      file the meeting in one of the caller's folders (`{ folderId }`), or none (`null`)
 *
 * PRIVATE BY CONSTRUCTION, like personal notes: every query is keyed by the verified `sub`, a folder of anyone else
 * is the 404 of a missing one, and there is no route, parameter or role that reads another person's folders. Two
 * participants of the same meeting file it independently. A folder never reaches a model, a host or a log.
 *
 * WHO. Any signed-in user, with a JWT only (`selfScoped`): organising your own view changes nothing of any meeting's
 * record, so it needs no grant and keeps working when `auth` cannot answer. Filing a meeting needs only that the
 * caller can open it (the identical 404 otherwise).
 *
 * SHAPE. One level, and a meeting is in at most one folder per person (the entry's primary key); moving it replaces
 * the entry. A folder's meetings are deleted from it with the meeting; deleting a folder deletes only its entries.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AuthzVariables } from "../auth/authz.middleware";
import { selfScoped } from "../auth/guards";
import { db } from "../lib/db";
import { commonErrors } from "../lib/http";
import { conflict, notFound, unprocessable, validationHook } from "../lib/problem";
import { callerOf } from "../meetings/caller";
import { openMeeting } from "../meetings/visibility";

/** The most folders one person may keep. */
export const MAX_FOLDERS = 200;
export const MAX_FOLDER_NAME = 80;

// Control characters never belong in a name a list shows.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const Name = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FOLDER_NAME)
  .refine((name) => !CONTROL.test(name), "no control characters");
const NameBody = z.object({ name: Name });
const FolderParams = z.object({ id: z.string().min(1).max(64) });
const MeetingParams = z.object({ id: z.string().min(1).max(64) });
const FileBody = z.object({ folderId: z.string().min(1).max(64).nullable() });

export const FolderSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** The meetings in it that the caller can still open (created by them or shared with them). */
    meetingCount: z.number().int(),
  })
  .openapi("MeetingFolder");
const FolderListSchema = z.object({ items: z.array(FolderSchema) });
const FiledSchema = z.object({ folderId: z.string().nullable() });
const json = (schema: z.ZodTypeAny) => ({ content: { "application/json": { schema } } });

/** The meetings a person can open from their own list: created by them, or shared with them as an Operai participant. */
export const visibleTo = (userId: string) => ({
  OR: [{ creatorUserId: userId }, { participants: { some: { userId } } }],
});

const folderNotFound = () => notFound("Folder not found");
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
const nameTaken = () => conflict("folder_name_taken", "You already have a folder with this name");

/** The caller's folder `id`, or the 404 of a missing one (someone else's folder included). */
async function ownFolder(id: string, userId: string) {
  const folder = await db.meetingFolder.findFirst({ where: { id, ownerUserId: userId } });
  if (!folder) throw folderNotFound();
  return folder;
}

async function countsOf(userId: string, folderIds: readonly string[]): Promise<Map<string, number>> {
  if (folderIds.length === 0) return new Map();
  const grouped = await db.meetingFolderEntry.groupBy({
    by: ["folderId"],
    where: { userId, folderId: { in: [...folderIds] }, meeting: visibleTo(userId) },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.folderId, g._count._all]));
}

const view = (folder: { id: string; name: string }, count: number) => ({ id: folder.id, name: folder.name, meetingCount: count });

const listRoute = createRoute({
  method: "get",
  path: "/folders",
  tags: ["Folders"],
  summary: "The caller's own meeting folders",
  middleware: selfScoped,
  responses: { 200: { description: "The caller's folders, name order", ...json(FolderListSchema) }, 401: commonErrors[401] },
});

const createFolderRoute = createRoute({
  method: "post",
  path: "/folders",
  tags: ["Folders"],
  summary: "Create one of the caller's folders",
  middleware: selfScoped,
  request: { body: { content: { "application/json": { schema: NameBody } }, required: true } },
  responses: {
    201: { description: "Created", ...json(FolderSchema) },
    401: commonErrors[401],
    409: { description: "folder_name_taken" },
    422: { description: "An invalid name, or folder_limit" },
  },
});

const renameRoute = createRoute({
  method: "patch",
  path: "/folders/{id}",
  tags: ["Folders"],
  summary: "Rename one of the caller's folders",
  middleware: selfScoped,
  request: { params: FolderParams, body: { content: { "application/json": { schema: NameBody } }, required: true } },
  responses: {
    200: { description: "Renamed", ...json(FolderSchema) },
    401: commonErrors[401],
    404: { description: "Not found (someone else's folder included)" },
    409: { description: "folder_name_taken" },
    422: commonErrors[422],
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/folders/{id}",
  tags: ["Folders"],
  summary: "Delete one of the caller's folders; its meetings stay, in no folder",
  middleware: selfScoped,
  request: { params: FolderParams },
  responses: { 204: { description: "Deleted" }, 401: commonErrors[401], 404: { description: "Not found" } },
});

const fileRoute = createRoute({
  method: "put",
  path: "/meetings/{id}/folder",
  tags: ["Folders"],
  summary: "File the meeting in one of the caller's folders, or in none",
  middleware: selfScoped,
  request: { params: MeetingParams, body: { content: { "application/json": { schema: FileBody } }, required: true } },
  responses: {
    200: { description: "Filed", ...json(FiledSchema) },
    401: commonErrors[401],
    404: { description: "Not found: the meeting" },
    422: { description: "folder_not_found: not one of the caller's folders" },
  },
});

export const foldersRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

foldersRouter.openapi(listRoute, async (c) => {
  const { userId } = callerOf(c);
  const folders = await db.meetingFolder.findMany({ where: { ownerUserId: userId }, select: { id: true, name: true } });
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  const counts = await countsOf(userId, folders.map((f) => f.id));
  return c.json({ items: folders.map((f) => view(f, counts.get(f.id) ?? 0)) }, 200);
});

foldersRouter.openapi(createFolderRoute, async (c) => {
  const { name } = c.req.valid("json");
  const { userId } = callerOf(c);
  if ((await db.meetingFolder.count({ where: { ownerUserId: userId } })) >= MAX_FOLDERS) {
    throw unprocessable(`At most ${MAX_FOLDERS} folders`, undefined, "folder_limit");
  }
  try {
    const folder = await db.meetingFolder.create({ data: { ownerUserId: userId, name }, select: { id: true, name: true } });
    return c.json(view(folder, 0), 201);
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
});

foldersRouter.openapi(renameRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { name } = c.req.valid("json");
  const { userId } = callerOf(c);
  await ownFolder(id, userId);
  try {
    const folder = await db.meetingFolder.update({ where: { id }, data: { name }, select: { id: true, name: true } });
    const counts = await countsOf(userId, [id]);
    return c.json(view(folder, counts.get(id) ?? 0), 200);
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
});

foldersRouter.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { userId } = callerOf(c);
  // One statement scoped to the owner: a folder of someone else deletes nothing and is the same 404.
  const deleted = await db.meetingFolder.deleteMany({ where: { id, ownerUserId: userId } });
  if (deleted.count === 0) throw folderNotFound();
  return c.body(null, 204);
});

foldersRouter.openapi(fileRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { folderId } = c.req.valid("json");
  const caller = callerOf(c);
  await openMeeting(id, caller);
  const key = { meetingId: id, userId: caller.userId };

  if (folderId === null) {
    await db.meetingFolderEntry.deleteMany({ where: key });
    return c.json({ folderId: null }, 200);
  }

  const folder = await db.meetingFolder.findFirst({ where: { id: folderId, ownerUserId: caller.userId }, select: { id: true } });
  if (!folder) throw unprocessable("Not one of your folders", { field: "folderId" }, "folder_not_found");
  await db.meetingFolderEntry.upsert({
    where: { meetingId_userId: key },
    create: { ...key, folderId },
    update: { folderId },
  });
  return c.json({ folderId }, 200);
});
